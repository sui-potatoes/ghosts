// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game's past, read from the chain's history: every transaction that touched
 * the `Game` (with the version it left behind), the object at any of those
 * versions, and a player's finished games. A deleted game is still all there:
 * its versions can be read after `complete_game`. Two readers of the same
 * shape: the fullnode over gRPC (`ListTransactions`, `GetObject` at a version),
 * which keeps about two weeks, and GraphQL (`transactions`, `object` at a
 * version), which keeps far more; `archive` asks the first and falls back to
 * the second. Read only. Tested with fakes in `tests/watch-chain.test.ts`.
 */

import { fromBase64 } from "@mysten/sui/utils";

import { GHOSTS } from "../constants.ts";
import { CALLS, GAME_MODULE, isRecruitEntry } from "./watch-layout.ts";

/** One transaction that touched a game. */
export interface GameTx {
    digest: string;
    /** When it ran, epoch ms. */
    timestampMs: number;
    sender: string;
    /** The `ghosts::ghosts` calls it made, in order. */
    calls: string[];
    /** The game's version it read; absent for the transaction that created the game. */
    before?: string;
    /** The game's version it left; absent for the one that deleted it. */
    after?: string;
    /** The recruit entries it wrote into the game's table, at the version written. */
    recruits: { id: string; version: string }[];
}

/** A game a player finished: its id and its last version. */
export interface Finished {
    gameId: string;
    /** The game as it stood before it was wrapped up. */
    version: string;
    digest: string;
    timestampMs: number;
    /** Who sent the wrap-up, and the game calls in it (an abandon, a called clock). */
    sender: string;
    calls: string[];
}

export interface GameArchive {
    /** Every transaction that touched the game, oldest first (at most `limit`); null when this reader cannot say. */
    transactions(gameId: string, limit?: number): Promise<GameTx[] | null>;
    /** An object's Move contents (BCS) at a version; null when not served. */
    objectAt(id: string, version: string): Promise<Uint8Array | null>;
    /** The account's finished games, newest first; null when this reader cannot say. */
    finished(accountId: string, limit: number): Promise<Finished[] | null>;
}

const same = (a: string, b: string) => {
    try {
        return BigInt(a) === BigInt(b);
    } catch {
        return false;
    }
};

/** Whether a call is one of the game package's own. */
const ownCall = (pkg: string | undefined, module: string | undefined) =>
    !!pkg && module === GAME_MODULE && same(pkg, GHOSTS.package);

// === gRPC ===

/** The parts of `SuiGrpcClient` read here. */
export interface LedgerReader {
    ledgerService: {
        listTransactions(input: object): { responses: AsyncIterable<ListFrame> };
        getObject(
            input: object,
        ): Promise<{ response: { object?: { contents?: { value?: Uint8Array } } } }>;
    };
}

/** One frame of `ListTransactions`, as much of it as is read. */
export interface ListFrame {
    transaction?: GrpcTx;
    watermark?: { cursor?: Uint8Array };
    end?: { reason?: number };
}

export interface GrpcTx {
    digest?: string;
    timestamp?: { seconds?: bigint; nanos?: number };
    transaction?: {
        sender?: string;
        kind?: {
            data?: { oneofKind?: string; programmableTransaction?: { commands: GrpcCommand[] } };
        };
    };
    effects?: {
        changedObjects: {
            objectId?: string;
            objectType?: string;
            inputVersion?: bigint;
            outputVersion?: bigint;
            idOperation?: number;
        }[];
    };
}

type GrpcCommand = {
    command?: {
        oneofKind?: string;
        moveCall?: { package?: string; module?: string; function?: string };
    };
};

const TX_MASK = {
    paths: [
        "digest",
        "timestamp",
        "transaction.sender",
        "transaction.kind",
        "effects.changed_objects",
    ],
};

/** `QueryEndReason`: the page was full (1) or the scan budget ran out (2); there is more. */
const MORE = new Set([1, 2]);
/** `Ordering.DESCENDING`. */
const DESCENDING = 1;
/** Pages read at most for one game: a 60-turn game is a few hundred transactions. */
const MAX_PAGES = 12;

const affected = (objectId: string) => ({
    negated: false,
    predicate: { oneofKind: "affectedObject", affectedObject: { objectId } },
});

/** A gRPC transaction as a `GameTx` of `gameId`. */
export function grpcGameTx(tx: GrpcTx, gameId: string): GameTx {
    const changed = tx.effects?.changedObjects ?? [];
    const game = changed.find((o) => o.objectId && same(o.objectId, gameId));
    const commands = tx.transaction?.kind?.data?.programmableTransaction?.commands ?? [];
    const created = game?.inputVersion === undefined || game.inputVersion === 0n;
    const deleted = game?.outputVersion === undefined || game.outputVersion === 0n;
    return {
        digest: tx.digest ?? "",
        timestampMs:
            Number(tx.timestamp?.seconds ?? 0n) * 1000 +
            Math.floor((tx.timestamp?.nanos ?? 0) / 1e6),
        sender: tx.transaction?.sender ?? "",
        calls: commands.flatMap(({ command }) =>
            command?.oneofKind === "moveCall" &&
            ownCall(command.moveCall?.package, command.moveCall?.module) &&
            command.moveCall?.function
                ? [command.moveCall.function]
                : [],
        ),
        before: created ? undefined : String(game!.inputVersion),
        after: deleted ? undefined : String(game!.outputVersion),
        recruits: changed.flatMap((o) =>
            isRecruitEntry(o.objectType) && o.objectId && o.outputVersion
                ? [{ id: o.objectId, version: String(o.outputVersion) }]
                : [],
        ),
    };
}

async function listAll(
    client: LedgerReader,
    filter: object,
    { limit, descending = false }: { limit: number; descending?: boolean },
): Promise<GrpcTx[]> {
    const out: GrpcTx[] = [];
    let after: Uint8Array | undefined;
    for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
        const call = client.ledgerService.listTransactions({
            readMask: TX_MASK,
            filter,
            options: {
                limit: Math.min(limit - out.length, 100),
                ...(descending ? { ordering: DESCENDING } : {}),
                ...(after ? (descending ? { before: after } : { after }) : {}),
            },
        });
        let more = false;
        let cursor: Uint8Array | undefined;
        try {
            for await (const frame of call.responses) {
                if (frame.transaction) out.push(frame.transaction);
                if (frame.watermark?.cursor) cursor = frame.watermark.cursor;
                if (frame.end) more = MORE.has(frame.end.reason ?? 0);
            }
        } catch (error) {
            // A scan back in time runs into the start of what the node keeps: that is the end.
            if ((error as { code?: string }).code !== "OUT_OF_RANGE") throw error;
            break;
        }
        if (!more || !cursor) break;
        after = cursor;
    }
    return out.slice(0, limit);
}

/** The game a wrap-up deleted, and the version it had: the `Game` among the deleted objects. */
function deletedGame(tx: GrpcTx, gameType: string): { id: string; version: string } | null {
    const game = tx.effects?.changedObjects.find(
        (o) =>
            o.objectType === gameType && (o.outputVersion === undefined || o.outputVersion === 0n),
    );
    return game?.objectId && game.inputVersion
        ? { id: game.objectId, version: String(game.inputVersion) }
        : null;
}

export function grpcArchive(client: LedgerReader, gameType: string): GameArchive {
    return {
        async transactions(gameId, limit = 1000) {
            const txs = await listAll(
                client,
                { terms: [{ literals: [affected(gameId)] }] },
                { limit },
            );
            return txs.map((tx) => grpcGameTx(tx, gameId));
        },
        async objectAt(id, version) {
            try {
                const { response } = await client.ledgerService.getObject({
                    objectId: id,
                    version: BigInt(version),
                    readMask: { paths: ["contents"] },
                });
                return response.object?.contents?.value ?? null;
            } catch {
                return null;
            }
        },
        async finished(accountId, limit) {
            const complete = {
                negated: false,
                predicate: {
                    oneofKind: "moveCall",
                    moveCall: { function: `${GHOSTS.package}::${GAME_MODULE}::${CALLS.complete}` },
                },
            };
            const txs = await listAll(
                client,
                { terms: [{ literals: [affected(accountId), complete] }] },
                { limit, descending: true },
            );
            return txs.flatMap((tx) => {
                const game = deletedGame(tx, gameType);
                if (!game) return [];
                const { timestampMs, sender, calls } = grpcGameTx(tx, game.id);
                return [
                    {
                        gameId: game.id,
                        version: game.version,
                        digest: tx.digest ?? "",
                        timestampMs,
                        sender,
                        calls,
                    },
                ];
            });
        },
    };
}

// === GraphQL ===

/** The part of `SuiGraphQLClient` read here. */
export interface GraphReader {
    query(options: { query: string; variables?: Record<string, unknown> }): Promise<{
        data?: unknown;
        errors?: { message: string }[];
    }>;
}

const TX_FIELDS = `
    digest
    sender { address }
    effects {
        timestamp
        objectChanges(first: 50) {
            nodes {
                address
                idCreated
                idDeleted
                inputState { version asMoveObject { contents { type { repr } } } }
                outputState { version asMoveObject { contents { type { repr } } } }
            }
        }
    }
    kind {
        __typename
        ... on ProgrammableTransaction {
            commands(first: 50) {
                nodes { ... on MoveCallCommand { function { name module { name package { address } } } } }
            }
        }
    }`;

/** The transactions that touched an object, oldest first. */
export const GAME_TXS_QUERY = `query GameTxs($object: SuiAddress!, $after: String) {
    transactions(first: 50, after: $after, filter: { affectedObject: $object }) {
        pageInfo { hasNextPage endCursor }
        nodes { ${TX_FIELDS} }
    }
}`;

/** The transactions that touched an object, newest first (a player's `Account`). */
export const ACCOUNT_TXS_QUERY = `query AccountTxs($object: SuiAddress!, $before: String) {
    transactions(last: 50, before: $before, filter: { affectedObject: $object }) {
        pageInfo { hasPreviousPage startCursor }
        nodes { ${TX_FIELDS} }
    }
}`;

/** An object's Move contents at a version. */
export const OBJECT_AT_QUERY = `query ObjectAt($id: SuiAddress!, $version: UInt53!) {
    object(address: $id, version: $version) { asMoveObject { contents { bcs } } }
}`;

type Version = {
    version: number | string;
    asMoveObject?: { contents?: { type?: { repr: string } } } | null;
};

export interface GraphTx {
    digest: string;
    sender?: { address: string } | null;
    effects?: {
        timestamp?: string | null;
        objectChanges?: {
            nodes: {
                address: string;
                idCreated?: boolean | null;
                idDeleted?: boolean | null;
                inputState?: Version | null;
                outputState?: Version | null;
            }[];
        } | null;
    } | null;
    kind?: {
        commands?: {
            nodes: ({
                function?: { name: string; module: { name: string; package: { address: string } } };
            } | null)[];
        };
    } | null;
}

/** A GraphQL transaction as a `GameTx` of `gameId`. */
export function graphGameTx(tx: GraphTx, gameId: string): GameTx {
    const changes = tx.effects?.objectChanges?.nodes ?? [];
    const game = changes.find((c) => same(c.address, gameId));
    return {
        digest: tx.digest,
        timestampMs: tx.effects?.timestamp ? Date.parse(tx.effects.timestamp) : 0,
        sender: tx.sender?.address ?? "",
        calls: (tx.kind?.commands?.nodes ?? []).flatMap((node) =>
            node?.function &&
            ownCall(node.function.module.package.address, node.function.module.name)
                ? [node.function.name]
                : [],
        ),
        before: game?.inputState && !game.idCreated ? String(game.inputState.version) : undefined,
        after: game?.outputState && !game.idDeleted ? String(game.outputState.version) : undefined,
        recruits: changes.flatMap((c) =>
            c.outputState && isRecruitEntry(c.outputState.asMoveObject?.contents?.type?.repr)
                ? [{ id: c.address, version: String(c.outputState.version) }]
                : [],
        ),
    };
}

async function ask<T>(
    client: GraphReader,
    query: string,
    variables: Record<string, unknown>,
): Promise<T> {
    const { data, errors } = await client.query({ query, variables });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    return data as T;
}

export function graphArchive(client: GraphReader, gameType: string): GameArchive {
    return {
        async transactions(gameId, limit = 1000) {
            const out: GameTx[] = [];
            let after: string | null = null;
            for (let page = 0; page < MAX_PAGES * 2 && out.length < limit; page++) {
                const data: {
                    transactions: {
                        pageInfo: { hasNextPage: boolean; endCursor: string | null };
                        nodes: GraphTx[];
                    };
                } = await ask(client, GAME_TXS_QUERY, { object: gameId, after });
                out.push(...data.transactions.nodes.map((tx) => graphGameTx(tx, gameId)));
                if (!data.transactions.pageInfo.hasNextPage) break;
                after = data.transactions.pageInfo.endCursor;
            }
            return out.slice(0, limit);
        },
        async objectAt(id, version) {
            const data: { object?: { asMoveObject?: { contents?: { bcs: string } } } | null } =
                await ask(client, OBJECT_AT_QUERY, { id, version: Number(version) });
            const bcs = data.object?.asMoveObject?.contents?.bcs;
            return bcs ? fromBase64(bcs) : null;
        },
        async finished(accountId, limit) {
            const data: { transactions: { nodes: GraphTx[] } } = await ask(
                client,
                ACCOUNT_TXS_QUERY,
                {
                    object: accountId,
                    before: null,
                },
            );
            // GraphQL takes one of `affectedObject` and `function`: the wrap-ups are picked here.
            return data.transactions.nodes
                .slice()
                .reverse()
                .flatMap((tx) => {
                    const { calls, sender, timestampMs } = graphGameTx(tx, accountId);
                    if (!calls.includes(CALLS.complete)) return [];
                    const game = tx.effects?.objectChanges?.nodes.find(
                        (c) =>
                            c.idDeleted &&
                            c.inputState?.asMoveObject?.contents?.type?.repr === gameType,
                    );
                    return game?.inputState
                        ? [
                              {
                                  gameId: game.address,
                                  version: String(game.inputState.version),
                                  digest: tx.digest,
                                  timestampMs,
                                  sender,
                                  calls,
                              },
                          ]
                        : [];
                })
                .slice(0, limit);
        },
    };
}

// === Both ===

/** A game's list is whole when it starts with the transaction that created the game. */
const whole = (txs: GameTx[] | null): txs is GameTx[] =>
    !!txs?.length && txs[0].before === undefined;

/**
 * The fullnode first, GraphQL when the fullnode no longer has it (a game older
 * than its window) or fails: each read falls through on its own.
 */
export function archive(primary: GameArchive, fallback: GameArchive): GameArchive {
    const tryBoth = async <T>(
        first: () => Promise<T>,
        second: () => Promise<T>,
        good: (value: T) => boolean,
    ): Promise<T> => {
        try {
            const value = await first();
            if (good(value)) return value;
        } catch {
            // the fallback answers
        }
        return second();
    };
    return {
        transactions: (gameId, limit) =>
            tryBoth(
                () => primary.transactions(gameId, limit),
                () => fallback.transactions(gameId, limit),
                whole,
            ),
        objectAt: (id, version) =>
            tryBoth(
                () => primary.objectAt(id, version),
                () => fallback.objectAt(id, version).catch(() => null),
                (bytes) => !!bytes,
            ),
        finished: (accountId, limit) =>
            tryBoth(
                () => primary.finished(accountId, limit),
                () => fallback.finished(accountId, limit),
                (list) => list !== null,
            ),
    };
}
