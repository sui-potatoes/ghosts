// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Recent games: the latest finished games of anyone, newest first, from the
 * `GameEnded` events. An end names the game and how it ended, not who played
 * or what for: that is in the game's `GameStarted`, read by type over the same
 * window and joined here by game id (starts come before ends, so the start
 * window is read back until it reaches the oldest end in hand). A game whose
 * start is older than that is read from its creating transaction instead (its
 * first version holds the players and the mode, its calls say whether it was
 * listed). A game from an invite code (`listed` false) is left out: it is
 * reachable by its link and in its players' own games. Also the live list's
 * read of `GameStarted`. The reads are passed in; tested with fakes in
 * `tests/watch-recent.test.ts`.
 */

import type { ChainMode } from "../../../chain/bcs.ts";
import type { GameEnding } from "../../../chain/ending.ts";
import { ENDED_EVENT, STARTED_EVENT } from "../../../chain/watch-layout.ts";

/** Rows on the first page of recent games, once unlisted games are left out. */
export const RECENT_FIRST = 25;
/** Rows "More" extends the list to; no more are read. */
export const RECENT_CAP = 50;

/** Pages of `GameEnded` read at most for one list (a page may come back empty: the node scans in bounded steps). */
const MAX_END_PAGES = 12;
/** Pages of `GameStarted` read at most for one list. */
const MAX_START_PAGES = 24;

/** A `GameStarted` event, decoded. */
export interface StartedEvent {
    gameId: string;
    /** In turn order: `players[0]` moves first (drawn), not the host or the queue's waiter. */
    players: string[];
    mode: ChainMode;
    listed: boolean;
    /** The checkpoint it is in; null when the reader does not say. */
    checkpoint: bigint | null;
}

/** A `GameEnded` event, decoded, with the transaction that emitted it (`complete_game`). */
export interface EndedEvent {
    gameId: string;
    ending: GameEnding;
    digest: string;
    checkpoint: bigint | null;
}

/** One page of events, newest first, and where the next (older) one starts. */
export interface EventPage<T> {
    items: T[];
    /** The cursor for the next page; null with nothing more. */
    next: string | null;
}

/** What a game is, read from its creating transaction when its start event is out of reach. */
export interface GameOrigin {
    players: string[];
    mode: ChainMode;
    listed: boolean;
}

export interface RecentReads {
    /** `GameEnded` events, newest first, from `cursor` (null: the newest). */
    ended(cursor: string | null): Promise<EventPage<EndedEvent>>;
    /** `GameStarted` events, newest first, from `cursor`. */
    started(cursor: string | null): Promise<EventPage<StartedEvent>>;
    /** A game's players, mode and listing from its first version and creating calls; null when out of reach. */
    origin(gameId: string): Promise<GameOrigin | null>;
}

/** What a `listEvents` read returns, as far as this file reads it. */
export interface RawEventsPage {
    events: RawEvent[];
    hasNextPage: boolean;
    endCursor: string | null;
}

/** A `listEvents` read of one event type: newest first from `before`, or oldest first from `after`. */
export type ListEvents = (query: {
    order: "descending" | "ascending";
    before?: string;
    after?: string;
}) => Promise<RawEventsPage>;

/** Events on a page (`limit` of the reads). */
export const EVENTS_PAGE = 50;
/** Pages of an ascending read at most (the node scans in bounded steps and may return a page short). */
const MAX_ASCENDING_PAGES = 20;

const isOutOfRange = (error: unknown) =>
    (error as { code?: string } | null)?.code === "OUT_OF_RANGE";

/**
 * One page of an event type, newest first, from `cursor` (null: the newest).
 *
 * A descending scan that runs past the oldest event down to the start of what the node
 * keeps fails `OUT_OF_RANGE` instead of ending, and takes the events it found with it. That
 * happens exactly when fewer than a page of events are left below the cursor (a full page
 * ends the scan before the floor), so then the type is read oldest first from the floor
 * until a page's worth is in hand: the oldest page of events holds every event below the
 * cursor. They are handed back newest first, with nothing after them. The oldest events
 * above the cursor may come with them: callers de-duplicate by game. No events at all is an empty page. Any other failure, or
 * a failure of that second read, is the read's own.
 */
export async function eventsNewestFirst(
    list: ListEvents,
    cursor: string | null,
): Promise<{ events: RawEvent[]; next: string | null }> {
    try {
        const page = await list({ order: "descending", ...(cursor ? { before: cursor } : {}) });
        return { events: page.events, next: page.hasNextPage ? page.endCursor : null };
    } catch (error) {
        if (!isOutOfRange(error)) throw error;
    }
    const events: RawEvent[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_ASCENDING_PAGES; page++) {
        const read = await list({ order: "ascending", ...(after ? { after } : {}) });
        events.push(...read.events);
        if (events.length > EVENTS_PAGE || !read.hasNextPage || !read.endCursor) break;
        after = read.endCursor;
    }
    return { events: events.reverse(), next: null };
}

/** A finished game for the list: who played, what for, and how it ended. */
export interface RecentGame {
    gameId: string;
    players: [string, string];
    mode: ChainMode;
    ending: GameEnding;
    /** The transaction that wrapped it up: when it ended. */
    digest: string;
}

export interface RecentList {
    games: RecentGame[];
    /** More finished games are there past the last row. */
    more: boolean;
}

/** An event as the reader hands it: its type, its BCS and where it is. */
export interface RawEvent {
    eventType: string;
    bcs: Uint8Array;
    transactionDigest: string;
    checkpoint: string | null;
}

const checkpointOf = (raw: RawEvent) => (raw.checkpoint === null ? null : BigInt(raw.checkpoint));

/** A raw `GameStarted`; null for bytes that do not decode. */
export function decodeStarted(raw: RawEvent): StartedEvent | null {
    try {
        const event = STARTED_EVENT.parse(raw.bcs);
        return {
            gameId: event.game,
            players: event.players,
            mode: event.mode,
            listed: event.listed,
            checkpoint: checkpointOf(raw),
        };
    } catch {
        return null;
    }
}

/** A raw `GameEnded`; null for bytes that do not decode. */
export function decodeEnded(raw: RawEvent): EndedEvent | null {
    try {
        const event = ENDED_EVENT.parse(raw.bcs);
        return {
            gameId: event.game,
            ending: event.ending,
            digest: raw.transactionDigest,
            checkpoint: checkpointOf(raw),
        };
    } catch {
        return null;
    }
}

/**
 * The `limit` most recent finished games anyone may watch, newest first (`limit` at most
 * `RECENT_CAP`). Ends are read a page at a time until `limit` rows are listed; starts are
 * read back until their window covers the oldest end read.
 */
export async function recentGames(reads: RecentReads, limit: number): Promise<RecentList> {
    const want = Math.min(limit, RECENT_CAP);
    const starts = new Map<string, StartedEvent>();
    let startCursor: string | null = null;
    let startsDone = false;
    let startPages = 0;
    /** The oldest checkpoint the starts read so far reach back to. */
    let startsFrom: bigint | null = null;

    async function readStartsTo(checkpoint: bigint | null) {
        // Without checkpoints to compare, one page of starts per page of ends.
        let pages = checkpoint === null ? 1 : Infinity;
        while (!startsDone && startPages < MAX_START_PAGES && pages-- > 0) {
            if (checkpoint !== null && startsFrom !== null && startsFrom <= checkpoint) return;
            const page = await reads.started(startCursor);
            startPages++;
            for (const event of page.items) {
                if (!starts.has(event.gameId)) starts.set(event.gameId, event);
                if (
                    event.checkpoint !== null &&
                    (startsFrom === null || event.checkpoint < startsFrom)
                )
                    startsFrom = event.checkpoint;
            }
            startCursor = page.next;
            if (!page.next) startsDone = true;
        }
    }

    const games: RecentGame[] = [];
    const seen = new Set<string>();
    let endCursor: string | null = null;
    for (let page = 0; page < MAX_END_PAGES; page++) {
        const ends = await reads.ended(endCursor);
        const fresh: EndedEvent[] = [];
        for (const e of ends.items) {
            if (seen.has(e.gameId)) continue;
            seen.add(e.gameId);
            fresh.push(e);
        }
        const oldest = fresh.reduce<bigint | null>(
            (low, e) =>
                e.checkpoint === null
                    ? low
                    : low === null || e.checkpoint < low
                      ? e.checkpoint
                      : low,
            null,
        );
        if (fresh.length) await readStartsTo(oldest);
        const origins = await Promise.all(
            fresh.map((e) =>
                starts.has(e.gameId) ? null : reads.origin(e.gameId).catch(() => null),
            ),
        );
        for (const [i, end] of fresh.entries()) {
            const origin = starts.get(end.gameId) ?? origins[i];
            if (!origin?.listed || origin.players.length < 2) continue;
            if (games.length >= want) return { games, more: true };
            games.push({
                gameId: end.gameId,
                players: [origin.players[0], origin.players[1]],
                mode: origin.mode,
                ending: end.ending,
                digest: end.digest,
            });
        }
        endCursor = ends.next;
        if (!endCursor) return { games, more: false };
        if (games.length >= want) return { games, more: true };
    }
    return { games, more: games.length >= want };
}

/**
 * The newest `GameStarted` events, up to `count`, for the live list: the games
 * started lately, each to be read for whether it is still being played.
 * Unlisted ones (an invite code) are left out here.
 */
export async function latestStarts(
    started: RecentReads["started"],
    count: number,
    maxPages = 8,
): Promise<StartedEvent[]> {
    const seen = new Set<string>();
    const out: StartedEvent[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages && out.length < count; page++) {
        const { items, next } = await started(cursor);
        for (const event of items) {
            if (seen.has(event.gameId)) continue;
            seen.add(event.gameId);
            if (event.listed) out.push(event);
        }
        if (!next) break;
        cursor = next;
    }
    return out.slice(0, count);
}
