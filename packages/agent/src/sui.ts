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
import { TransactionDataBuilder, type Transaction } from "@mysten/sui/transactions";
import {
    deriveDynamicFieldID,
    deriveObjectID,
    normalizeStructTag,
    normalizeSuiAddress,
} from "@mysten/sui/utils";

import type { Backend, SeatView } from "./backend.ts";
import { requestTestnetSui } from "./faucet.ts";
import {
    AccountBcs,
    AccountRecord,
    decodeAccount,
    decodeGame,
    decodeRules,
    LobbyField,
    RecruitBcs,
    RegistryHead,
    SeatBcs,
} from "./bcs.ts";
import {
    abortMessage,
    acceptSeatsTx,
    actionsTx,
    armSquadTx,
    cancelRankedTx,
    cancelSearchTx,
    closeLobbyTx,
    closeLobbyWithGuestTx,
    dismissSeatTx,
    findGameTx,
    findRankedTx,
    hireRecruitsTx,
    joinLobbyTx,
    joinOpenTx,
    kickGuestTx,
    leaveLobbyTx,
    nameChangeTx,
    newAccountTx,
    openLobbyTx,
    resetRatingTx,
    revealSquadTx,
    setRecoveryTx,
    startFriendlyTx,
    takeSeatTx,
    type Deployment,
    type PendingSeat,
} from "./contract.ts";
import {
    classifySearch,
    findInviteHost,
    openLobbyId,
    protectedKey,
    protectedLobbyId,
    type InviteLobbyView,
    type LobbyView,
    type QueueKind,
    type SearchRole,
} from "./lobby.ts";
import { rankedSize, sizeOfQueue, type RankedRules } from "./ranked.ts";
import { executeSafely, isTransient, resilientFetch, urgent, type ResilientOptions } from "./rpc.ts";
import { deployLimit, rollsDice } from "./rules.ts";
import { ActionError, type GameState, type ObjectRef, type Receipt } from "./types.ts";

export interface SuiBackendOptions {
    /** `localnet` is a local node: `rpcUrl` and `faucetUrl` point at it, there is no name service. */
    network: "testnet" | "mainnet" | "localnet";
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
    /** The testnet faucet to ask for SUI, Mysten's by default; on `localnet`, the local faucet. */
    faucetUrl?: string;
    /** How requests reach the node: the process's limiter and retries unless a test sets them. */
    rpc?: ResilientOptions;
}

/**
 * How long the `Rules` read is reused: retunes are rare, every send checks them anyway, and a
 * search reads them fresh.
 */
const RULES_TTL_MS = 300_000;
/**
 * How long an object read is reused. It only folds the reads of one look at the game together
 * (`wait` reads the `Account` and its game several times over); any send clears it.
 */
const READ_TTL_MS = 1_000;
/** The reference gas price changes once an epoch (a day on testnet). */
const GAS_PRICE_TTL_MS = 600_000;
/** The local faucet `sui start --with-faucet` serves by default. */
const LOCAL_FAUCET = "http://127.0.0.1:9123";

/** Same safety margin the SDK uses in its own budget estimate. */
const GAS_SAFE_OVERHEAD = 1000n;
/** Hiring a squad or starting a game stores a lot, and a budget has to cover it up front. */
const DEFAULT_MAX_GAS_MIST = 200_000_000n;
/**
 * What `find_game` can need whatever a simulation saw. Finding a waiting player costs
 * less than joining the queue, and between simulating and executing that player can go.
 */
const FIND_GAME_MIN_BUDGET = 20_000_000n;
/** Starting a friendly game stores the whole `Game`, as a match does: the same floor. */
const START_GAME_MIN_BUDGET = FIND_GAME_MIN_BUDGET;
/** A ranked match places the finder's squad too; a reveal places the waiter's. */
const RANKED_MIN_BUDGET = 30_000_000n;
/** Dynamic fields read per page when listing lobbies, and objects per `getObjects` call. */
const LOBBY_PAGE = 100;
const LOBBY_CHUNK = 50;
const LIST_ATTEMPTS = 5;
const LIST_RETRY_MS = 500;

/** The `AddressAliasState` singleton, and the set of aliases derived from it per owner. */
const ALIAS_STATE = "0x000000000000000000000000000000000000000000000000000000000000000a";
const AddressAliases = bcs.struct("AddressAliases", {
    id: bcs.Address,
    aliases: bcs.struct("VecSet", { contents: bcs.vector(bcs.Address) }),
});

/** A fullnode by default: Mysten's for a public network, the local one on its default port. */
function defaultRpc(network: SuiBackendOptions["network"]): string {
    return network === "localnet" ? "http://127.0.0.1:9000" : `https://fullnode.${network}.sui.io:443`;
}

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
        baseUrl: options.rpcUrl ?? defaultRpc(network),
        fetch: resilientFetch(options.rpc),
    });
    let accountId: string | null = null;
    /** The game the `Account` was last seen in: read along with it, in one request. */
    let lastGame: string | null = null;
    let gasPrice: { price: string; atMs: number } | null = null;
    type Read = Exclude<
        Awaited<ReturnType<typeof client.core.getObjects<{ content: true }>>>["objects"][number],
        Error
    >;
    const reads = new Map<string, { atMs: number; read: Promise<Read> }>();
    let rulesRead: { rules: RankedRules; atMs: number } | null = null;
    let aliasConfirmed = address === signerAddress;

    /**
     * Objects by ID, in one request for those not read in the last `READ_TTL_MS`. A missing one
     * rejects as `getObject` would.
     */
    function contentsOf(objectIds: string[]): Promise<Read>[] {
        const now = Date.now();
        const key = (id: string) => normalizeSuiAddress(id);
        const missing = [...new Set(objectIds.map(key))].filter((id) => {
            const cached = reads.get(id);
            return !cached || now - cached.atMs > READ_TTL_MS;
        });
        if (missing.length > 0) {
            const batch = client.core.getObjects({ objectIds: missing, include: { content: true } });
            missing.forEach((id, i) => {
                const read = batch.then(({ objects }) => {
                    const object = objects[i];
                    if (object instanceof Error) throw object;
                    return object;
                });
                read.catch(() => reads.delete(id));
                reads.set(id, { atMs: now, read });
            });
        }
        return objectIds.map((id) => reads.get(key(id))!.read);
    }

    function content(objectId: string): Promise<Read> {
        return contentsOf([objectId])[0];
    }

    /** What a send changed is read afresh. */
    function forgetReads() {
        reads.clear();
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
            name: `${name}.${deployment.names!.domain}`,
        });
        return target ?? null;
    }

    /**
     * The name an address gave itself: its default name, if under the game's domain. Without a
     * name service (a local network) every player goes by a name made of its address.
     */
    async function nameOf(owner: string): Promise<string | null> {
        if (!deployment.names) return `player-${normalizeSuiAddress(owner).slice(2, 8)}`;
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

    async function referencePrice(): Promise<string> {
        if (gasPrice && Date.now() - gasPrice.atMs < GAS_PRICE_TTL_MS) return gasPrice.price;
        const { referenceGasPrice } = await client.core.getReferenceGasPrice();
        gasPrice = { price: referenceGasPrice, atMs: Date.now() };
        return referenceGasPrice;
    }

    /** A dice roll's cost depends on its result (a kill does more), so it gets more headroom. */
    async function setBudget(tx: Transaction, headroom: bigint, floor: bigint): Promise<void> {
        const [simulation, referenceGasPrice] = await Promise.all([
            client.core.simulateTransaction({ transaction: tx, include: { effects: true } }),
            referencePrice(),
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
            const abort = location?.module
                ? { module: location.module, code: Number(abortCode) }
                : undefined;
            return new ActionError(
                taken ? "name_taken" : "rejected",
                abortMessage(location?.module, abortCode),
                false,
                abort,
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
        if (isTransient(error)) {
            return new ActionError("congested", `The network is busy: try again. (${message})`, true);
        }
        return error;
    }

    async function send(tx: Transaction, headroom = 130n, floor = 0n): Promise<Receipt> {
        try {
            // a send is what a turn waits on: it goes ahead of the polls
            return await urgent(() => sendChecked(tx, headroom, floor));
        } catch (error) {
            throw translated(error);
        } finally {
            forgetReads();
        }
    }

    async function sendChecked(tx: Transaction, headroom: bigint, floor: bigint): Promise<Receipt> {
        await confirmAlias();
        tx.setSender(address);
        await setBudget(tx, headroom, floor);
        // Signed once: the same bytes are the same digest, so a send whose answer was lost is
        // looked up by it, and sent again only when the chain never saw it.
        const bytes = await tx.build({ client });
        const { signature } = await signer.signTransaction(bytes);
        const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
        const result = await executeSafely({
            execute: () =>
                client.core.executeTransaction({
                    transaction: bytes,
                    signatures: [signature],
                    include: { effects: true },
                }),
            lookup: async () => {
                try {
                    return await client.core.getTransaction({ digest, include: { effects: true } });
                } catch (error) {
                    if (isNotFound(error)) return null;
                    throw error;
                }
            },
            onRetry: ({ attempt, found }) =>
                console.error(`send ${digest}: answer lost, ${found ? "found it" : "not on chain yet"} (try ${attempt})`),
        });
        if (result.FailedTransaction) throw refusal(result.FailedTransaction.status.error);

        const { effects } = result.Transaction;
        // The next read must see this transaction, or the agent plans on a stale game. It ran
        // either way: a node too busy to say so only makes the next read a little early.
        await client.core.waitForTransaction({ digest }).catch(() => undefined);

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

    /** The recruits at home: what each carries, and what it still lacks. */
    async function homeRecruits() {
        const id = await requireAccount();
        const { recruits } = AccountBcs.parse((await content(id)).content);
        return listOwned(
            id,
            `${deployment.package}::recruit::Recruit`,
            (bytes) => {
                const recruit = RecruitBcs.parse(bytes);
                return { armed: recruit.weapon !== null, utilities: recruit.utilities.length };
            },
            Number(recruits),
        );
    }

    /**
     * The seats waiting on an `Account` that is still on its search: one in the game a match
     * started, or a notice (`game` null) that the queue dropped it. A seat in a ranked queue's
     * game is marked `ranked`: it is revealed into, or taken with `take_seat`.
     */
    async function seatsOf(accountId: string): Promise<PendingSeat[]> {
        const account = AccountBcs.parse((await content(accountId)).content);
        if (account.state.$kind !== "Searching") return [];
        const queue = await queueKind(account.state.Searching.queue);
        const seats = await listOwned(accountId, `${deployment.package}::ghosts::Seat`, (bytes) =>
            SeatBcs.parse(bytes),
        );
        return seats.map(({ ref, game }) => ({
            account: accountId,
            seat: ref,
            game: game ?? null,
            ranked: queue !== "lobby" && queue.mode === "ranked",
        }));
    }

    /** The live `Rules`, read again past `RULES_TTL_MS` or when `fresh`. */
    async function readRules(fresh = false): Promise<RankedRules> {
        if (!deployment.rules) {
            throw new ActionError(
                "no_rules",
                "This deployment names no Rules object, so ranked play is off: set GHOSTS_RULES " +
                    "(the package with ranked play must be published).",
            );
        }
        if (!fresh && rulesRead && Date.now() - rulesRead.atMs < RULES_TTL_MS) {
            return rulesRead.rules;
        }
        const rules = decodeRules((await content(deployment.rules)).content);
        for (const [units, queue] of Object.entries(deployment.rankedQueues ?? {})) {
            const size = rankedSize(rules, Number(units));
            if (size && normalizeSuiAddress(size.queue) !== normalizeSuiAddress(queue)) {
                throw new ActionError(
                    "no_rules",
                    `The ranked queue of ${units} configured (${queue}) is not the Rules' ` +
                        `(${size.queue}).`,
                );
            }
        }
        rulesRead = { rules, atMs: Date.now() };
        return rules;
    }

    /** What a `Searching.queue` names: the lobbies, the stakes queue or a ranked one. */
    async function queueKind(id: string): Promise<"lobby" | QueueKind> {
        const same = (a: string, b?: string) =>
            !!b && normalizeSuiAddress(a) === normalizeSuiAddress(b);
        if (same(id, deployment.lobbies)) return "lobby";
        if (same(id, deployment.matchmaker)) return { mode: "stakes" };
        for (const [units, queue] of Object.entries(deployment.rankedQueues ?? {})) {
            if (same(id, queue)) return { mode: "ranked", size: Number(units) };
        }
        if (!deployment.rules) return { mode: "unknown" };
        const size = sizeOfQueue(await readRules(), id);
        return size ? { mode: "ranked", size: size.units } : { mode: "unknown" };
    }

    /** The ranked size's queue and level, from the live `Rules`; refused while it has no level. */
    async function rankedTarget(units: number) {
        const rules = await readRules(true);
        const size = rankedSize(rules, units);
        if (!size) throw new ActionError("bad_action", `There are no ranked squads of ${units}.`);
        if (!size.level) {
            throw new ActionError(
                "rejected",
                `Ranked squads of ${units} have no level yet: that queue is closed.`,
                false,
                { module: "rules", code: 5 },
            );
        }
        return { rules: rules.id, queue: size.queue, level: size.level };
    }

    /** Where the lobbies of this deployment live. */
    function lobbyHome() {
        return { package: deployment.package, lobbies: deployment.lobbies };
    }

    /** The lobby field at `id`, decoded; null if it is gone. */
    async function lobbyAt(id: string) {
        try {
            return LobbyField.parse((await content(id)).content);
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    }

    async function lobbyOf(host: string): Promise<LobbyView | null> {
        const field = openLobbyId(lobbyHome(), host);
        const found = await lobbyAt(field);
        return found && lobbyView(found, field);
    }

    function lobbyView(found: ReturnType<typeof LobbyField.parse>, field: string): LobbyView {
        return {
            host: found.name,
            size: found.value.size,
            guest: found.value.guest,
            kicked: found.value.kicked,
            field,
        };
    }

    /** What the `Account` is doing on its search, or null when it is not searching. */
    async function roleOf(accountId: string): Promise<SearchRole | null> {
        const { state } = AccountBcs.parse((await content(accountId)).content);
        if (state.$kind !== "Searching") return null;
        const home = lobbyHome();
        const queue = await queueKind(state.Searching.queue);
        return classifySearch(accountId, state.Searching, {
            queue: () => queue,
            open: async (order) => {
                const found = await lobbyAt(openLobbyId(home, order));
                return found && { guest: found.value.guest };
            },
            protectedExists: async (order) => (await lobbyAt(protectedLobbyId(home, order))) !== null,
            seats: async () =>
                (await seatsOf(accountId)).map(({ game }) => ({ game: game ?? null })),
        });
    }

    /** The first seat of `accountId` in a game (or a notice, with `notice`). */
    async function seatOf(accountId: string, notice: boolean): Promise<PendingSeat | undefined> {
        const seats = await seatsOf(accountId);
        return seats.find((seat) => (notice ? seat.game === null : seat.game !== null));
    }

    /** My own lobby and its host `Account`, for the calls only a host makes. */
    async function myLobby(): Promise<{ me: string; lobby: LobbyView | null; role: SearchRole }> {
        const me = await requireAccount();
        const role = await roleOf(me);
        if (role?.kind !== "hosting_open" && role?.kind !== "hosting_invite") {
            throw new ActionError("no_lobby", "This account does not host a lobby.");
        }
        return { me, lobby: role.kind === "hosting_open" ? await lobbyOf(me) : null, role };
    }

    /** One request to a local network's faucet, resolved once the balance shows it. */
    async function localFaucet() {
        const balance = async () =>
            BigInt((await client.core.getBalance({ owner: address })).balance.balance);
        const before = await balance();
        const response = await fetch(`${options.faucetUrl ?? LOCAL_FAUCET}/v2/gas`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
        });
        if (!response.ok) {
            const message = `The local faucet answered ${response.status}.`;
            throw new ActionError("rejected", message, true);
        }
        for (let i = 0; i < 40; i++) {
            const now = await balance();
            if (now > before) return { digest: null, amount: now - before, arrived: true };
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return { digest: null, amount: 0n, arrived: false };
    }

    return {
        network,
        address,
        signer: signerAddress,
        packageId: deployment.package,
        nameService: deployment.names !== null,

        async balanceMist() {
            const { balance } = await client.core.getBalance({ owner: address });
            return BigInt(balance.balance);
        },

        async requestFaucet() {
            if (network === "localnet") return localFaucet();
            if (network !== "testnet") {
                throw new ActionError("rejected", "The faucet is testnet only.");
            }
            return requestTestnetSui({
                address,
                balance: async () => BigInt((await client.core.getBalance({ owner: address })).balance.balance),
                baseUrl: options.faucetUrl,
            });
        },

        name: () => nameOf(address),

        async playerName(id) {
            return nameOf(decodeAccount((await content(id)).content).owner);
        },

        async setName(name) {
            if (!deployment.names) {
                throw new ActionError(
                    "rejected",
                    "This network has no name service: names are made of addresses.",
                );
            }
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
            // the game it was last in comes along in the same request, for the read that follows
            const [read] = contentsOf(lastGame ? [accountId, lastGame] : [accountId]);
            const account = decodeAccount((await read).content);
            lastGame = account.search.kind === "playing" ? account.search.game : null;
            return account;
        },

        async accountById(id) {
            try {
                return decodeAccount((await content(id)).content);
            } catch (error) {
                if (isNotFound(error)) return null;
                throw error;
            }
        },

        game: readGame,

        createAccount: () => send(newAccountTx(deployment)),
        setRecovery: async (wallet) =>
            send(setRecoveryTx(deployment, await requireAccount(), wallet)),
        hireSquad: async () => send(hireRecruitsTx(deployment, await requireAccount()), 200n),
        findGame: async () =>
            send(findGameTx(deployment, await requireAccount()), 200n, FIND_GAME_MIN_BUDGET),
        async cancelSearch() {
            const me = await requireAccount();
            const { state } = AccountBcs.parse((await content(me)).content);
            if (state.$kind !== "Searching") {
                throw new ActionError("rejected", "This account is not searching.");
            }
            const queue = await queueKind(state.Searching.queue);
            if (queue === "lobby") {
                throw new ActionError(
                    "rejected",
                    "This account is in a lobby, not a queue: leave or close the lobby.",
                );
            }
            if (queue.mode === "ranked") {
                return send(cancelRankedTx(deployment, state.Searching.queue, me));
            }
            return send(cancelSearchTx(deployment, me));
        },

        rules: () => readRules(),

        async findRanked(size, squad, commitment) {
            const target = await rankedTarget(size);
            const tx = findRankedTx(deployment, await requireAccount(), target, squad, commitment);
            return send(tx, 200n, RANKED_MIN_BUDGET);
        },

        async seats(): Promise<SeatView[]> {
            const seats = await seatsOf(await requireAccount());
            return seats.map((seat) => ({ id: seat.seat.objectId, game: seat.game ?? null }));
        },

        async revealSquad(squad, salt) {
            const me = await requireAccount();
            const seat = await seatOf(me, false);
            if (!seat) return null;
            const rules = await readRules();
            const tx = revealSquadTx(deployment, rules.id, seat, squad, salt);
            return send(tx, 200n, RANKED_MIN_BUDGET);
        },

        async takeSeat() {
            const seat = await seatOf(await requireAccount(), false);
            return seat ? send(takeSeatTx(deployment, seat)) : null;
        },

        async dismissNotice() {
            const seat = await seatOf(await requireAccount(), true);
            return seat ? send(dismissSeatTx(deployment, seat)) : null;
        },

        async resetRating() {
            const rules = await readRules();
            return send(resetRatingTx(deployment, rules.id, await requireAccount()));
        },

        async openLobby(size, code) {
            return send(openLobbyTx(deployment, await requireAccount(), size, code), 130n);
        },

        async joinLobby(host, code) {
            const tx = joinLobbyTx(deployment, await requireAccount(), host, code);
            return send(tx, 200n, START_GAME_MIN_BUDGET);
        },

        async joinOpen(host) {
            return send(joinOpenTx(deployment, await requireAccount(), host));
        },

        leaveLobby: async () => send(leaveLobbyTx(deployment, await requireAccount())),

        async kickGuest() {
            const { me, lobby } = await myLobby();
            if (!lobby?.guest) throw new ActionError("no_lobby", "Your lobby has no guest.");
            return send(kickGuestTx(deployment, me, lobby.guest));
        },

        async startFriendly() {
            const { me, lobby } = await myLobby();
            if (!lobby?.guest) throw new ActionError("no_lobby", "Your lobby has no guest to start with.");
            return send(startFriendlyTx(deployment, me, lobby.guest), 200n, START_GAME_MIN_BUDGET);
        },

        async closeLobby() {
            const { me, lobby } = await myLobby();
            // a guest is kicked first, in the same transaction
            return send(
                lobby?.guest
                    ? closeLobbyWithGuestTx(deployment, me, lobby.guest)
                    : closeLobbyTx(deployment, me),
            );
        },

        async cleanUpLobby(host) {
            const lobby = await lobbyOf(host);
            if (!lobby) throw new ActionError("no_lobby", "That lobby is already gone.");
            // chain-side, `ELobbyNotExpired` refuses a stranger before the lifetime is out
            return send(
                lobby.guest
                    ? closeLobbyWithGuestTx(deployment, host, lobby.guest)
                    : closeLobbyTx(deployment, host),
            );
        },

        lobby: lobbyOf,

        async inviteLobby(code) {
            const home = lobbyHome();
            const key = protectedKey(code);
            const field = protectedLobbyId(home, key);
            const found = await lobbyAt(field);
            return found ? ({ size: found.value.size, field, key } satisfies InviteLobbyView) : null;
        },

        async inviteHost(code) {
            const accountType = normalizeStructTag(`${deployment.package}::account::Account`);
            return findInviteHost(code, {
                async fieldTransaction(key) {
                    const { objects } = await client.core.getObjects({
                        objectIds: [protectedLobbyId(lobbyHome(), key)],
                        include: { previousTransaction: true },
                    });
                    const field = objects[0];
                    if (!field || field instanceof Error) return null;
                    return field.previousTransaction ?? null;
                },
                async writtenAccounts(digest) {
                    const opened = await client.core.getTransaction({
                        digest,
                        include: { effects: true, objectTypes: true },
                    });
                    const tx = opened.Transaction ?? opened.FailedTransaction;
                    const written = (tx?.effects?.changedObjects ?? [])
                        .filter((change) => change.outputState === "ObjectWrite")
                        .map((change) => change.objectId)
                        .filter((id) => {
                            const type = tx?.objectTypes?.[id];
                            return type !== undefined && normalizeStructTag(type) === accountType;
                        });
                    if (written.length === 0) return [];
                    const { objects } = await client.core.getObjects({
                        objectIds: written,
                        include: { content: true },
                    });
                    return objects.flatMap((object) => {
                        if (object instanceof Error) return [];
                        const account = AccountBcs.parse(object.content);
                        return [
                            {
                                id: account.id,
                                order:
                                    account.state.$kind === "Searching"
                                        ? account.state.Searching.order
                                        : null,
                            },
                        ];
                    });
                },
            });
        },

        async listLobbies() {
            const home = lobbyHome();
            const fields: string[] = [];
            let cursor: string | null | undefined;
            do {
                const page = await client.core.listDynamicFields({
                    parentId: home.lobbies,
                    limit: LOBBY_PAGE,
                    cursor,
                });
                for (const entry of page.dynamicFields) {
                    if (entry.name.type.endsWith("::lobby::Open")) fields.push(entry.fieldId);
                }
                cursor = page.hasNextPage ? page.cursor : null;
            } while (cursor);

            const lobbies: LobbyView[] = [];
            for (let i = 0; i < fields.length; i += LOBBY_CHUNK) {
                const objectIds = fields.slice(i, i + LOBBY_CHUNK);
                const { objects } = await client.core.getObjects({
                    objectIds,
                    include: { content: true },
                });
                // a lobby can close between the listing and the read
                objects.forEach((object, j) => {
                    if (object instanceof Error) return;
                    lobbies.push(lobbyView(LobbyField.parse(object.content), objectIds[j]));
                });
            }
            return lobbies;
        },

        async searchRole() {
            return roleOf(await requireAccount());
        },

        async armSquad() {
            // a free utility slot too: the contract has one slot for now
            const lacking = (await homeRecruits())
                .map((recruit) => ({
                    recruit: recruit.ref,
                    rifle: !recruit.armed,
                    grenade: recruit.utilities === 0,
                }))
                .filter((fitting) => fitting.rifle || fitting.grenade);
            if (lacking.length === 0) return null;
            const tx = armSquadTx(deployment, await requireAccount(), lacking);
            return send(tx, 150n);
        },

        async acceptSeat() {
            // a stakes seat; a ranked one is revealed into, a notice dismissed
            const seat = (await seatsOf(await requireAccount())).find(
                (s) => s.game !== null && !s.ranked,
            );
            return seat ? send(acceptSeatsTx(deployment, [seat])) : null;
        },

        async submit(game, actions) {
            const me = await requireAccount();
            const side = game.players.indexOf(me);
            const open = deployLimit(game, side);

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
                ? (await seatsOf(game.players[1 - side])).find(
                      (s) => s.game && normalizeSuiAddress(s.game) === normalizeSuiAddress(game.id),
                  )
                : undefined;
            const tx = actionsTx(deployment, game, me, resolved, seat ? [seat] : []);
            const receipt = await send(tx, actions.some(rollsDice) ? 200n : 130n);

            // There are no events: what happened is whatever the history gained.
            const after = await readGame(game.id);
            return { ...receipt, records: after?.history.slice(game.history.length) ?? [] };
        },
    };
}
