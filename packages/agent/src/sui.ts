// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The chain backend. Every send simulates first, so a refused order costs
 * nothing, and sets a measured gas budget: budgets count against an object's
 * per-commit congestion allowance, so tight ones keep shared objects moving.
 * Gas needs no handling here. The SDK pays from the sender's address balance
 * whenever it covers the budget, so there are no coins to split or reconcile.
 */

import { bcs } from "@mysten/sui/bcs";
import { SimulationError } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";
import {
    deriveDynamicFieldID,
    deriveObjectID,
    normalizeStructTag,
    normalizeSuiAddress,
} from "@mysten/sui/utils";

import type { Backend } from "./backend.ts";
import {
    AccountBcs,
    AccountRecord,
    decodeAccount,
    decodeGame,
    RecruitBcs,
    RegistryHead,
    SeatBcs,
} from "./bcs.ts";
import {
    abortMessage,
    acceptSeatsTx,
    actionsTx,
    armSquadTx,
    cancelSearchTx,
    findGameTx,
    hireRecruitsTx,
    nameChangeTx,
    newAccountTx,
    setRecoveryTx,
    type Deployment,
    type PendingSeat,
} from "./contract.ts";
import { rollsDice } from "./rules.ts";
import { ActionError, type GameState, type ObjectRef, type Receipt } from "./types.ts";

export interface SuiBackendOptions {
    network: "testnet" | "mainnet";
    deployment: Deployment;
    signer: Signer;
    /**
     * The address to act as when `signer` is an alias of it (`sui::address_alias`).
     * Everything then belongs to this owner: `Account`, name and gas. Omit when the
     * signer's own address is the owner.
     */
    owner?: string;
    rpcUrl?: string;
    /** Refuse any transaction whose budget exceeds this: the agent's own spend limit. */
    maxGasMist?: bigint;
}

/** Same safety margin the SDK uses in its own budget estimate. */
const GAS_SAFE_OVERHEAD = 1000n;
/** Hiring a squad or starting a game stores a lot, and a budget has to cover it up front. */
const DEFAULT_MAX_GAS_MIST = 200_000_000n;
/**
 * What `find_game` can need whatever a simulation saw. Finding a waiting player costs
 * less than joining the queue, and between simulating and executing that player can go.
 */
const FIND_GAME_MIN_BUDGET = 20_000_000n;
const LIST_ATTEMPTS = 5;
const LIST_RETRY_MS = 500;

/** The `AddressAliasState` singleton, and the set of aliases derived from it per owner. */
const ALIAS_STATE = "0x000000000000000000000000000000000000000000000000000000000000000a";
const AddressAliases = bcs.struct("AddressAliases", {
    id: bcs.Address,
    aliases: bcs.struct("VecSet", { contents: bcs.vector(bcs.Address) }),
});

function isNotFound(error: unknown): boolean {
    return error instanceof Error && /not.?found|deleted/i.test(error.message);
}

export function createSuiBackend(options: SuiBackendOptions): Backend {
    const { network, deployment, signer } = options;
    const signerAddress = signer.toSuiAddress();
    const address = options.owner ? normalizeSuiAddress(options.owner) : signerAddress;
    const maxGas = options.maxGasMist ?? DEFAULT_MAX_GAS_MIST;
    const client = new SuiGrpcClient({
        network,
        baseUrl: options.rpcUrl ?? `https://fullnode.${network}.sui.io:443`,
    });
    let accountId: string | null = null;
    let aliasConfirmed = address === signerAddress;

    async function content(objectId: string) {
        const { object } = await client.core.getObject({ objectId, include: { content: true } });
        return object;
    }

    async function accountIdOf(owner: string): Promise<string | null> {
        const registry = RegistryHead.parse((await content(deployment.registry)).content);
        const field = deriveDynamicFieldID(
            registry.accounts.id,
            "address",
            bcs.Address.serialize(owner).toBytes(),
        );
        try {
            return AccountRecord.parse((await content(field)).content).value;
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    }

    /** The address the leaf `<name>.<domain>` resolves to; null when free. */
    async function leafTarget(name: string): Promise<string | null> {
        const { address: target } = await client.core.resolveNameServiceAddress({
            name: `${name}.${deployment.names.domain}`,
        });
        return target ?? null;
    }

    /** The name an address gave itself: its default name, if under the game's domain. */
    async function nameOf(owner: string): Promise<string | null> {
        const { data } = await client.core.defaultNameServiceName({ address: owner });
        const suffix = `.${deployment.names.domain}`;
        if (!data.name?.endsWith(suffix)) return null;
        const name = data.name.slice(0, -suffix.length);
        return name && !name.includes(".") ? name : null;
    }

    async function requireAccount(): Promise<string> {
        accountId ??= await accountIdOf(address);
        if (!accountId) throw new ActionError("no_account", "This agent has no account yet.");
        return accountId;
    }

    /** A dice roll's cost depends on its result (a kill does more), so it gets more headroom. */
    async function setBudget(tx: Transaction, headroom: bigint, floor: bigint): Promise<void> {
        const [simulation, { referenceGasPrice }] = await Promise.all([
            client.core.simulateTransaction({ transaction: tx, include: { effects: true } }),
            client.core.getReferenceGasPrice(),
        ]);
        if (simulation.FailedTransaction) throw refusal(simulation.FailedTransaction.status.error);

        const gas = simulation.Transaction.effects.gasUsed;
        const computation =
            BigInt(gas.computationCost) + GAS_SAFE_OVERHEAD * BigInt(referenceGasPrice);
        const net = computation + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
        const measured = ((net > computation ? net : computation) * headroom) / 100n;
        const budget = measured > floor ? measured : floor;
        if (budget > maxGas) {
            throw new ActionError(
                "over_budget",
                `This transaction needs a ${budget} MIST budget, above the ${maxGas} MIST limit.`,
            );
        }
        tx.setGasBudget(budget);
    }

    function refusal(error: unknown): ActionError {
        const failure = error as {
            message?: string;
            $kind?: string;
            MoveAbort?: { abortCode: string; location?: { module?: string } };
        } | null;
        if (failure?.$kind === "MoveAbort" && failure.MoveAbort) {
            const { abortCode, location } = failure.MoveAbort;
            const taken = location?.module === "commander_names";
            return new ActionError(
                taken ? "name_taken" : "rejected",
                abortMessage(location?.module, abortCode),
            );
        }
        if (failure?.$kind === "CongestedObjects") {
            return new ActionError("congested", "The object is congested: try again.", true);
        }
        // Anyone can complete a game, so the object can go between a read and a send.
        if (/deleted shared object|InputObjectDeleted/i.test(failure?.message ?? "")) {
            return new ActionError("rejected", "The game has moved on: read it again.", true);
        }
        return new ActionError("rejected", failure?.message ?? "The transaction was refused.");
    }

    /** Simulation doesn't check signatures, so catch a missing alias with a clear refusal. */
    async function confirmAlias(): Promise<void> {
        if (aliasConfirmed) return;
        const id = deriveObjectID(
            ALIAS_STATE,
            "0x2::address_alias::AliasKey",
            bcs.Address.serialize(address).toBytes(),
        );
        const set = await content(id).catch((error) => {
            if (isNotFound(error)) return null;
            throw error;
        });
        aliasConfirmed =
            !!set && AddressAliases.parse(set.content).aliases.contents.includes(signerAddress);
        if (!aliasConfirmed) {
            throw new ActionError(
                "not_aliased",
                `Key ${signerAddress} is not an alias of ${address}. The owner has to add it.`,
            );
        }
    }

    /** What the SDK throws while building or simulating, in terms an agent can act on. */
    function translated(error: unknown): unknown {
        if (error instanceof ActionError) return error;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`send failed: ${message}`);
        if (/insufficient SUI balance|gas selection/i.test(message)) {
            return new ActionError(
                "low_balance",
                `${address} doesn't have enough SUI for this transaction's gas. It needs a top up.`,
            );
        }
        if (isNotFound(error)) {
            return new ActionError("rejected", "The game has moved on: read it again.", true);
        }
        if (error instanceof SimulationError) {
            return error.executionError
                ? refusal(error.executionError)
                : new ActionError("rejected", message, true);
        }
        if (
            /unavailable|resource.?exhausted|too many|\b429\b|\b503\b|fetch failed/i.test(message)
        ) {
            return new ActionError("congested", "The network is busy: try again.", true);
        }
        return error;
    }

    async function send(tx: Transaction, headroom = 130n, floor = 0n): Promise<Receipt> {
        try {
            return await sendChecked(tx, headroom, floor);
        } catch (error) {
            throw translated(error);
        }
    }

    async function sendChecked(tx: Transaction, headroom: bigint, floor: bigint): Promise<Receipt> {
        await confirmAlias();
        tx.setSender(address);
        await setBudget(tx, headroom, floor);
        const result = await client.core.signAndExecuteTransaction({
            transaction: tx,
            signer,
            include: { effects: true },
        });
        if (result.FailedTransaction) throw refusal(result.FailedTransaction.status.error);

        const { digest, effects } = result.Transaction;
        // The next read must see this transaction, or the agent plans on a stale game.
        await client.core.waitForTransaction({ digest });

        const gas = effects.gasUsed;
        const gasMist =
            BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
        return { digest, gasMist: gasMist.toString(), records: [] };
    }

    async function readGame(id: string): Promise<GameState | null> {
        try {
            const object = await content(id);
            return decodeGame(object.content, object.version);
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    }

    /**
     * Everything of a type the `Account` owns, with the references that receive it. The
     * recruits at home are objects sent to the `Account`. `expected` is how many the
     * `Account` counts: a fresh listing can lag, so it is read again until it is whole.
     */
    async function listOwned<T>(
        owner: string,
        type: string,
        parse: (content: Uint8Array) => T,
        expected?: number,
    ): Promise<(T & { ref: ObjectRef })[]> {
        let owned: (T & { ref: ObjectRef })[] = [];
        for (let attempt = 0; attempt < LIST_ATTEMPTS; attempt++) {
            owned = [];
            let cursor: string | undefined;
            do {
                const page = await client.core.listOwnedObjects({
                    owner,
                    type: normalizeStructTag(type),
                    include: { content: true },
                    cursor,
                });
                for (const { objectId, version, digest, content } of page.objects) {
                    owned.push({ ...parse(content), ref: { objectId, version, digest } });
                }
                cursor = page.hasNextPage ? (page.cursor ?? undefined) : undefined;
            } while (cursor);
            if (expected === undefined || owned.length >= expected) break;
            await new Promise((resolve) => setTimeout(resolve, LIST_RETRY_MS));
        }
        return owned;
    }

    /** The recruits at home, armed or not. */
    async function homeRecruits() {
        const id = await requireAccount();
        const { recruits } = AccountBcs.parse((await content(id)).content);
        return listOwned(
            id,
            `${deployment.package}::recruit::Recruit`,
            (bytes) => {
                const recruit = RecruitBcs.parse(bytes);
                return { armed: recruit.weapon !== null };
            },
            Number(recruits),
        );
    }

    /** The seats waiting on an `Account` that is still on its search, the one a match answered. */
    async function seatsOf(accountId: string): Promise<PendingSeat[]> {
        const account = AccountBcs.parse((await content(accountId)).content);
        if (account.state.$kind !== "Searching") return [];
        const seats = await listOwned(accountId, `${deployment.package}::ghosts::Seat`, (bytes) =>
            SeatBcs.parse(bytes),
        );
        return seats.map(({ ref, game }) => ({ account: accountId, seat: ref, game }));
    }

    return {
        network,
        address,
        signer: signerAddress,

        async balanceMist() {
            const { balance } = await client.core.getBalance({ owner: address });
            return BigInt(balance.balance);
        },

        name: () => nameOf(address),

        async playerName(id) {
            return nameOf(decodeAccount((await content(id)).content).owner);
        },

        async setName(name) {
            const [target, current] = await Promise.all([leafTarget(name), nameOf(address)]);
            if (target && target !== address) {
                throw new ActionError("name_taken", "That name is taken: pick another.");
            }
            const earlier = current && current !== name ? current : null;
            // An old leaf can only be moved while it still resolves to this address.
            const movable = earlier !== null && (await leafTarget(earlier)) === address;
            return send(
                nameChangeTx(deployment.names, name, target === address, movable ? earlier : null),
            );
        },

        async account() {
            accountId ??= await accountIdOf(address);
            if (!accountId) return null;
            return decodeAccount((await content(accountId)).content);
        },

        game: readGame,

        createAccount: () => send(newAccountTx(deployment)),
        setRecovery: async (wallet) =>
            send(setRecoveryTx(deployment, await requireAccount(), wallet)),
        hireSquad: async () => send(hireRecruitsTx(deployment, await requireAccount()), 200n),
        findGame: async () =>
            send(findGameTx(deployment, await requireAccount()), 200n, FIND_GAME_MIN_BUDGET),
        cancelSearch: async () => send(cancelSearchTx(deployment, await requireAccount())),

        async armSquad() {
            const unarmed = (await homeRecruits()).filter((recruit) => !recruit.armed);
            if (unarmed.length === 0) return null;
            const tx = armSquadTx(
                deployment,
                await requireAccount(),
                unarmed.map((recruit) => recruit.ref),
            );
            return send(tx, 150n);
        },

        async acceptSeat() {
            const [seat] = await seatsOf(await requireAccount());
            return seat ? send(acceptSeatsTx(deployment, [seat])) : null;
        },

        async submit(game, actions) {
            const me = await requireAccount();
            const side = game.players.indexOf(me);
            const open = game.positions[side]?.length ?? 0;

            // the armed recruits go first: an unarmed one can't shoot
            const recruits = actions.some((action) => action.kind === "deploy")
                ? (await homeRecruits())
                      .sort((a, b) => Number(b.armed) - Number(a.armed))
                      .slice(0, open)
                      .map((recruit) => recruit.ref)
                : [];
            const resolved = actions.map((action) =>
                action.kind === "deploy" ? { ...action, recruits } : action,
            );

            // wrapping up or leaving needs both players in the game: accept a seat the
            // opponent never did
            const leaving = actions.some((a) => a.kind === "complete" || a.kind === "abandon");
            const seat = leaving
                ? (await seatsOf(game.players[1 - side])).find((s) => s.game === game.id)
                : undefined;
            const tx = actionsTx(deployment, game, me, resolved, seat ? [seat] : []);
            const receipt = await send(tx, actions.some(rollsDice) ? 200n : 130n);

            // There are no events: what happened is whatever the history gained.
            const after = await readGame(game.id);
            return { ...receipt, records: after?.history.slice(game.history.length) ?? [] };
        },
    };
}
