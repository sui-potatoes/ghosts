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
import { deriveDynamicFieldID, deriveObjectID, normalizeSuiAddress } from "@mysten/sui/utils";

import type { Backend } from "./backend.ts";
import { AccountBcs, AccountRecord, decodeAccount, decodeGame, RegistryHead } from "./bcs.ts";
import {
    abortMessage,
    actionsTx,
    cancelSearchTx,
    findGameTx,
    hireRecruitsTx,
    nameChangeTx,
    newAccountTx,
    releaseGameTx,
    setRecoveryTx,
    startGameTx,
    type Deployment,
} from "./contract.ts";
import { rollsDice } from "./rules.ts";
import { ActionError, type GameState, type Receipt } from "./types.ts";

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

    /** The recruits stored in the `Account`. A fresh listing can lag, so re-list until it's whole. */
    async function listRecruits(): Promise<string[]> {
        const account = await content(await requireAccount());
        const { id, size } = AccountBcs.parse(account.content).recruits;
        let ids: string[] = [];
        for (let attempt = 0; attempt < LIST_ATTEMPTS; attempt++) {
            ids = [];
            let cursor: string | undefined;
            do {
                const page = await client.core.listDynamicFields({ parentId: id, cursor });
                for (const field of page.dynamicFields) {
                    if (field.$kind === "DynamicObject") ids.push(field.childId);
                }
                cursor = page.hasNextPage ? (page.cursor ?? undefined) : undefined;
            } while (cursor);
            if (ids.length >= Number(size)) break;
            await new Promise((resolve) => setTimeout(resolve, LIST_RETRY_MS));
        }
        return ids;
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

        async releaseGame(opponent) {
            const theirs = await accountIdOf(opponent);
            if (!theirs) throw new ActionError("rejected", "The opponent has no account.");
            return send(releaseGameTx(deployment, await requireAccount(), theirs));
        },

        async startGame(opponent) {
            const theirs = await accountIdOf(opponent);
            if (!theirs) throw new ActionError("rejected", "The opponent has no account.");
            return send(startGameTx(deployment, await requireAccount(), theirs));
        },

        async submit(game, actions) {
            const me = await requireAccount();
            const open = game.positions[game.players.indexOf(me)]?.length ?? 0;
            const resolved = await Promise.all(
                actions.map(async (action) =>
                    action.kind === "deploy"
                        ? { ...action, recruits: (await listRecruits()).slice(0, open) }
                        : action,
                ),
            );
            const tx = actionsTx(deployment, game, me, resolved);
            const receipt = await send(tx, actions.some(rollsDice) ? 200n : 130n);

            // There are no events: what happened is whatever the history gained.
            const after = await readGame(game.id);
            return { ...receipt, records: after?.history.slice(game.history.length) ?? [] };
        },
    };
}
