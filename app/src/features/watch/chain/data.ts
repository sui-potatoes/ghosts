// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The viewer's reads, in the app: the archive (gRPC, then GraphQL), the
 * players of a game (their `Account`s and assigned names), the live games
 * list (the latest `GameStarted` events and a read of each game; the shared
 * `Game` objects by type over GraphQL when the events cannot be read), the
 * recent games of anyone (`GameEnded` joined with `GameStarted`), the
 * signed-in player's finished games, and opening one game as a record source
 * the viewer plays. No wallet is needed for any of it.
 */

import {
    blackRain,
    recordedSource,
    replayEncounter,
    type IntelSource,
    type RecordSource,
    type WatchSide,
} from "@ghosts/engine";
import type { Recruit as LocalRecruit } from "@ghosts/squad/types";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { ObjectError } from "@mysten/sui/client";
import { fromBase64 } from "@mysten/sui/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
    archive,
    grpcArchive,
    graphArchive,
    type GameArchive,
    type GameTx,
    type LedgerReader,
} from "../../../chain/archive";
import { Account, Game, type ChainGame } from "../../../chain/bcs";
import { endingOf, fetchGameEnded, type GameEnding } from "../../../chain/ending";
import { fetchGameRecruits } from "../../../chain/game";
import { graphql, sharedOfType } from "../../../chain/graphql";
import { chainUnitIntel } from "../../../chain/intel";
import { deployUntil, isRanked, unitsOnMap } from "../../../chain/match-rules";
import type { UnitLook } from "../../../chain/match-scene";
import { assignedName } from "../../../chain/names";
import { GAME_ENDED_TYPE, GAME_STARTED_TYPE, GAME_TYPE } from "../../../chain/watch-layout";
import { defaultName } from "../../../player/name";
import { toLocalRecruits } from "../../headquarters/mapping";
import {
    isGameId,
    listedBy,
    liveRow,
    modeText,
    needsCreationCheck,
    offTheList,
    recentRow,
    resultFor,
    type LiveRow,
    type RecentRow,
    type PlayerLine,
} from "./list";
import { liveSource } from "./live";
import {
    decodeEnded,
    decodeStarted,
    latestStarts,
    recentGames,
    RECENT_FIRST,
    type EndedEvent,
    type EventPage,
    type GameOrigin,
    type RawEvent,
    type StartedEvent,
} from "./recent";
import {
    EventFeed,
    rankedDress,
    readStory,
    storyOutcome,
    watchOutcome,
    watchStart,
    type GameRecruit,
} from "./record";

type Client = ReturnType<typeof useCurrentClient>;

/** The game's past through the fullnode, GraphQL when the fullnode no longer has it. */
export function archiveOf(client: Client): GameArchive {
    return archive(
        grpcArchive(client as unknown as LedgerReader, GAME_TYPE),
        graphArchive(graphql(), GAME_TYPE),
    );
}

/** A player of a game: their `Account`, the address that owns it and the name it assigned itself. */
export interface Player extends PlayerLine {
    accountId: string;
    owner: string | null;
}

const names = new Map<string, Promise<string | null>>();

/** An address's assigned name, read once per session. */
function nameOf(client: Client, owner: string): Promise<string | null> {
    let name = names.get(owner);
    if (!name) {
        name = assignedName(client, owner).catch(() => null);
        names.set(owner, name);
    }
    return name;
}

/** The players behind `Account` ids, in order: names and ratings as the match screen shows them. */
export async function fetchPlayers(
    client: Client,
    accountIds: readonly string[],
): Promise<Player[]> {
    if (!accountIds.length) return [];
    const { objects } = await client.core.getObjects({
        objectIds: [...accountIds],
        include: { content: true },
    });
    return Promise.all(
        accountIds.map(async (accountId, i) => {
            const object = objects[i];
            if (!object || object instanceof Error)
                return { accountId, owner: null, name: "A player", rating: null };
            const account = Account.parse(object.content);
            const name = (await nameOf(client, account.owner)) ?? defaultName(account.owner);
            return { accountId, owner: account.owner, name, rating: Number(account.rating.rating) };
        }),
    );
}

/** The game now; null once it is deleted. Throws when the read fails. */
export async function readGameNow(client: Client, gameId: string): Promise<ChainGame | null> {
    try {
        const { object } = await client.core.getObject({
            objectId: gameId,
            include: { content: true },
        });
        return Game.parse(object.content);
    } catch (error) {
        if (error instanceof ObjectError && error.reason !== "unknown") return null;
        throw error;
    }
}

// === Events ===

/** Events of one type, newest first, a page from `cursor` (gRPC `ListEvents`, filtered by event type). */
async function eventPage<T>(
    client: Client,
    type: string,
    cursor: string | null,
    decode: (raw: RawEvent) => T | null,
): Promise<EventPage<T>> {
    const page = await client.core.listEvents({
        filter: { eventType: type },
        order: "descending",
        limit: 50,
        ...(cursor ? { before: cursor } : {}),
    });
    return {
        items: page.events.flatMap((event) => {
            const decoded = decode(event);
            return decoded ? [decoded] : [];
        }),
        next: page.hasNextPage ? page.endCursor : null,
    };
}

const startedPage = (client: Client, cursor: string | null): Promise<EventPage<StartedEvent>> =>
    eventPage(client, GAME_STARTED_TYPE, cursor, decodeStarted);
const endedPage = (client: Client, cursor: string | null): Promise<EventPage<EndedEvent>> =>
    eventPage(client, GAME_ENDED_TYPE, cursor, decodeEnded);

// === The live list ===

/** How often the live list is read again while it is open. */
const LIST_REFRESH_MS = 15_000;
/** How many of the latest started games are read for whether they are still played. */
const LIVE_STARTS = 150;

/** Whether a friendly game came from a listed lobby: its creating transaction, read once. */
const listedCache = new Map<string, Promise<boolean>>();

function listed(arch: GameArchive, gameId: string): Promise<boolean> {
    let known = listedCache.get(gameId);
    if (!known) {
        known = arch
            .transactions(gameId, 1)
            .then((txs) => (txs?.length ? listedBy(txs[0].calls) : false))
            .catch(() => false);
        listedCache.set(gameId, known);
    }
    return known;
}

type Shown = { id: string; game: ChainGame };

/**
 * The live games by their start events: the latest listed starts, each game read now;
 * one deleted (wrapped up) or off the list is not live. Throws when the events cannot
 * be read.
 */
async function liveByEvents(client: Client, now: number): Promise<Shown[]> {
    const starts = await latestStarts((cursor) => startedPage(client, cursor), LIVE_STARTS);
    if (!starts.length) return [];
    const { objects } = await client.core.getObjects({
        objectIds: starts.map((s) => s.gameId),
        include: { content: true },
    });
    return starts.flatMap((start, i) => {
        const object = objects[i];
        if (!object || object instanceof Error) return [];
        try {
            const game = Game.parse(object.content);
            return offTheList(game, now) ? [] : [{ id: start.gameId, game }];
        } catch {
            return [];
        }
    });
}

/** The live games by type over GraphQL, the shared `Game`s: a friendly one's listing from its creating call. */
async function liveByType(client: Client, now: number): Promise<Shown[]> {
    const arch = archiveOf(client);
    const shared = await sharedOfType(graphql(), GAME_TYPE);
    const games = shared.flatMap(({ address, bcs }) => {
        try {
            const game = Game.parse(fromBase64(bcs));
            return offTheList(game, now) ? [] : [{ id: address, game }];
        } catch {
            return [];
        }
    });
    return (
        await Promise.all(
            games.map(async (g) =>
                !needsCreationCheck(g.game) || (await listed(arch, g.id)) ? g : null,
            ),
        )
    ).filter((g) => g !== null);
}

/** The games being played now that anyone may watch, newest turn first. */
export function useLiveGames() {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["watch", "live"],
        refetchInterval: LIST_REFRESH_MS,
        refetchOnWindowFocus: true,
        queryFn: async (): Promise<LiveRow[]> => {
            const now = Date.now();
            const shown = await liveByEvents(client, now).catch(() => liveByType(client, now));
            const players = await fetchPlayers(client, [
                ...new Set(shown.flatMap((g) => g.game.players)),
            ]);
            const byId = new Map(players.map((p) => [p.accountId, p]));
            const line = (id: string): PlayerLine =>
                byId.get(id) ?? { name: "A player", rating: null };
            return shown
                .sort((a, b) => b.game.turn - a.game.turn)
                .map(({ id, game }) =>
                    liveRow(id, game, [line(game.players[0]), line(game.players[1])]),
                );
        },
    });
}

// === Recent games of anyone ===

/** How often the recent games are read again while the list is open. */
const RECENT_REFRESH_MS = 60_000;

export type { RecentRow };

export interface RecentRows {
    rows: RecentRow[];
    /** More finished games are there past the last row. */
    more: boolean;
}

/** A game's players and mode from its creating transaction: its first version, and its calls for the listing. */
async function originOf(arch: GameArchive, gameId: string): Promise<GameOrigin | null> {
    const txs = await arch.transactions(gameId, 1);
    const created = txs?.[0];
    if (!created || created.before !== undefined || !created.after) return null;
    const bytes = await arch.objectAt(gameId, created.after);
    if (!bytes) return null;
    const game = Game.parse(bytes);
    return { players: game.players, mode: game.mode, listed: listedBy(created.calls) };
}

/** When transactions ran, by digest: one batch read; a digest not served is left out. */
async function timesOf(client: Client, digests: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ledger = (client as unknown as BatchReader).ledgerService;
    for (let i = 0; i < digests.length; i += 50) {
        const batch = digests.slice(i, i + 50);
        try {
            const { response } = await ledger.batchGetTransactions({
                digests: batch,
                readMask: { paths: ["digest", "timestamp"] },
            });
            response.transactions.forEach((result, j) => {
                const tx =
                    result.result.oneofKind === "transaction" ? result.result.transaction : null;
                const seconds = tx?.timestamp?.seconds;
                if (seconds !== undefined)
                    out.set(
                        batch[j],
                        Number(seconds) * 1000 + Math.floor((tx?.timestamp?.nanos ?? 0) / 1e6),
                    );
            });
        } catch {
            // no times for this batch: the rows show without them
        }
    }
    return out;
}

/** The part of `SuiGrpcClient` the times are read through. */
interface BatchReader {
    ledgerService: {
        batchGetTransactions(input: { digests: string[]; readMask: { paths: string[] } }): Promise<{
            response: {
                transactions: {
                    result:
                        | {
                              oneofKind: "transaction";
                              transaction: { timestamp?: { seconds?: bigint; nanos?: number } };
                          }
                        | { oneofKind: "error" | undefined };
                }[];
            };
        }>;
    };
}

/**
 * The latest finished games anyone may watch, newest first: `limit` rows (25 at first,
 * 50 with More), refreshed while the list is open and when the window comes back.
 */
export function useRecentFinished(limit: number = RECENT_FIRST, enabled = true) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["watch", "recent-all", limit],
        enabled,
        refetchInterval: RECENT_REFRESH_MS,
        refetchOnWindowFocus: true,
        placeholderData: keepPreviousData,
        queryFn: async (): Promise<RecentRows> => {
            const arch = archiveOf(client);
            const { games, more } = await recentGames(
                {
                    ended: (cursor) => endedPage(client, cursor),
                    started: (cursor) => startedPage(client, cursor),
                    origin: (gameId) => originOf(arch, gameId),
                },
                limit,
            );
            const [players, times] = await Promise.all([
                fetchPlayers(client, [...new Set(games.flatMap((g) => g.players))]),
                timesOf(
                    client,
                    games.map((g) => g.digest),
                ),
            ]);
            const nameOf = new Map(players.map((p) => [p.accountId, p.name]));
            const now = Date.now();
            return {
                rows: games.map((game) =>
                    recentRow(
                        game,
                        [
                            nameOf.get(game.players[0]) ?? "A player",
                            nameOf.get(game.players[1]) ?? "A player",
                        ],
                        times.get(game.digest),
                        now,
                    ),
                ),
                more,
            };
        },
    });
}

// === The player's finished games ===

export interface FinishedRow {
    gameId: string;
    name: string;
    kind: string;
    tag: string;
    won: boolean;
}

const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

/** How many finished games the watch screen lists. */
const RECENT = 8;

/** The signed-in player's finished games, newest first: each one's opponent and how it ended for them. */
export function useYourGames(accountId: string | null | undefined, owner: string | undefined) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["watch", "recent", accountId],
        enabled: !!accountId,
        staleTime: 30_000,
        queryFn: async (): Promise<FinishedRow[]> => {
            const arch = archiveOf(client);
            const finished = (await arch.finished(accountId!, RECENT)) ?? [];
            const games = await Promise.all(
                finished.map(async (f) => {
                    const [bytes, announced] = await Promise.all([
                        arch.objectAt(f.gameId, f.version).catch(() => null),
                        fetchGameEnded(client, f.digest, f.gameId),
                    ]);
                    try {
                        return bytes ? { f, game: Game.parse(bytes), announced } : null;
                    } catch {
                        return null;
                    }
                }),
            );
            const known = games.filter((g) => g !== null);
            const opponents = await fetchPlayers(client, [
                ...new Set(
                    known.flatMap(({ game }) => game.players.filter((p) => p !== accountId)),
                ),
            ]);
            const nameOfAccount = new Map(opponents.map((p) => [p.accountId, p.name]));
            return known.map(({ f, game, announced }) => {
                const side = game.players.indexOf(accountId!);
                const sender =
                    owner && f.sender.toLowerCase() === owner.toLowerCase() ? side : 1 - side;
                // The ending `complete_game` announced; worked out from its calls when unread.
                const ending = announced ?? endingOf(game, f, sender);
                const result = resultFor(ending, game.players, side);
                const opponent = nameOfAccount.get(game.players[1 - side]) ?? "A player";
                return {
                    gameId: f.gameId,
                    name: `vs ${opponent}`,
                    kind: `${when(f.timestampMs)} · ${modeText(game)}`,
                    tag: result,
                    won: result === "Won",
                };
            });
        },
    });
}

// === One game in the viewer ===

/** A game opened for the viewer. */
export type ChainOpened =
    | {
          kind: "watch";
          gameId: string;
          source: RecordSource;
          live: boolean;
          /** The live game can be rewound to its first turn. */
          fromStart: boolean;
          sides: readonly [WatchSide, WatchSide];
          /** Side 0's recruits, dressed for the field; side 1's looks are in the scenario. */
          squad: LocalRecruit[];
          intel: IntelSource;
      }
    | { kind: "deploying"; gameId: string; until: number; sides: readonly [WatchSide, WatchSide] }
    | { kind: "unplayed"; gameId: string; title: string; line: string }
    | { kind: "unavailable"; gameId: string }
    | { kind: "missing" };

/**
 * Open a game for the viewer: live while it exists, else its replay
 * (`replay`: as a replay even while it still exists, once it is over).
 */
export async function openChainGame(
    client: Client,
    gameId: string,
    replay = false,
): Promise<ChainOpened> {
    if (!isGameId(gameId)) return { kind: "missing" };
    const arch = archiveOf(client);
    const current = replay ? null : await readGameNow(client, gameId);
    const story = await readStory(arch, gameId, current);
    if (story.kind === "unavailable") return { kind: "unavailable", gameId };

    const game = story.last;
    const players = await fetchPlayers(client, game.players);
    const sides = [0, 1].map((i) => ({
        name: players[i]?.name ?? "A player",
    })) as unknown as readonly [WatchSide, WatchSide];
    const owners = players.map((p) => p.owner);

    // How a deleted game ended, as its `GameEnded` says, by the deleting transaction;
    // worked out from that transaction's calls when the event cannot be read.
    const announced = new Map<string, GameEnding | null>();
    const readEnding = async (tx: GameTx | null) => {
        if (tx && !announced.has(tx.digest))
            announced.set(tx.digest, await fetchGameEnded(client, tx.digest, gameId));
    };
    const outcome = (last: ChainGame, tx: GameTx | null) => {
        const ending = tx ? announced.get(tx.digest) : null;
        return ending
            ? watchOutcome(ending, last.players, sides)
            : storyOutcome(last, tx, owners, sides);
    };

    if (story.kind === "deploying")
        return { kind: "deploying", gameId, until: deployUntil(game), sides };
    if (story.kind === "unplayed") {
        await readEnding(story.endTx);
        const ended = outcome(game, story.endTx);
        return {
            kind: "unplayed",
            gameId,
            title:
                ended?.winner != null ? `${sides[ended.winner].name} won` : "No match was played",
            line: ended?.reason ?? "The match ended before play started",
        };
    }

    // A ranked game has no recruits: its units are named and dressed from their loadouts.
    const ranked = isRanked(story.first);
    let recruits: GameRecruit[] = story.recruits;
    if (!ranked && !recruits.length && current)
        recruits = await fetchGameRecruits(
            client,
            current.recruits.id,
            Number(current.recruits.size),
        ).catch(() => []);
    const recruitById = new Map(recruits.map((r) => [r.objectId, r]));
    const leaderOf = (side: number) => recruits.filter((r) => r.leader === game.players[side]);
    const dress = ranked
        ? rankedDress(story.first, gameId)
        : {
              names: new Map(recruits.map((r) => [r.objectId, r.metadata.name])),
              squad: toLocalRecruits(leaderOf(0)),
              looks: new Map<string, UnitLook>(
                  toLocalRecruits(leaderOf(1)).map((r) => [
                      r.id,
                      { appearance: r.appearance, armor: r.equipment.armor },
                  ]),
              ),
          };
    const squad = dress.squad;
    const start = watchStart(blackRain, story.first, dress.names, dress.looks);
    const feed = new EventFeed(start, story.first, (scenario) => replayEncounter(scenario, []));
    const startUnits = new Map(unitsOnMap(story.first).map(({ unit }) => [unit.recruit, unit]));
    const intel: IntelSource = (unit, base) =>
        chainUnitIntel(base, recruitById.get(unit.id), startUnits.get(unit.id));

    if (!story.finished && current) {
        const source = liveSource(
            { start, sides, feed, current },
            {
                read: () => readGameNow(client, gameId),
                async vanished() {
                    // The node may index the deleting transaction a moment after the game is gone.
                    for (let attempt = 0; attempt < 4; attempt++) {
                        const gone = await readStory(arch, gameId, null);
                        const done = gone.kind === "played" || gone.kind === "unplayed";
                        if (done && (gone.endTx || attempt === 3)) {
                            await readEnding(gone.endTx);
                            return { last: gone.last, tx: gone.endTx };
                        }
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    return null;
                },
                outcome,
                wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            },
        );
        return {
            kind: "watch",
            gameId,
            source,
            live: true,
            fromStart: story.fromStart,
            sides,
            squad,
            intel,
        };
    }

    feed.take(story.last);
    await readEnding(story.endTx);
    const end = outcome(story.last, story.endTx);
    const source = recordedSource({
        scenario: start.scenario,
        sides,
        prepare: start.prepare,
        outcome: () => end,
        events: feed.events,
    });
    return { kind: "watch", gameId, source, live: false, fromStart: true, sides, squad, intel };
}
