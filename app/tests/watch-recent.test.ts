// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The watch screen's event reads with fake readers: `GameStarted` and `GameEnded`
 * decoded from bytes the Move package printed, Recent games (the ends joined with
 * the starts of the same window, the creating transaction read for a game whose
 * start is older, invite-only games left out, 25 rows then 50, newest first), the
 * live list's starts, the ending a wrap-up's events announce, ranked modes named
 * by size and tier, a ranked replay's virtual units named by their loadouts, and
 * the drawn first mover (side 0 is whoever moves first, not the queue's finder).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fromHex } from "@mysten/sui/utils";

import { Game, GameEnded, GameStarted } from "../src/chain/bcs.ts";
import { endingFromEvents, type GameEnding } from "../src/chain/ending.ts";
import { unitsOnMap } from "../src/chain/match-rules.ts";
import { GAME_ENDED_TYPE, GAME_STARTED_TYPE } from "../src/chain/watch-layout.ts";
import { GHOSTS } from "../src/constants.ts";
import { endingText, modeText, recentRow, agoText } from "../src/features/watch/chain/list.ts";
import {
    decodeEnded,
    decodeStarted,
    latestStarts,
    eventsNewestFirst,
    recentGames,
    RECENT_CAP,
    RECENT_FIRST,
    type EndedEvent,
    type EventPage,
    type GameOrigin,
    type ListEvents,
    type RawEvent,
    type RecentReads,
    type StartedEvent,
} from "../src/features/watch/chain/recent.ts";
import { rankedDress, watchStart } from "../src/features/watch/chain/record.ts";
import { offlineLine } from "../src/features/watch/failure.ts";
import { forgetDeviceRecordings, OLD_RECORDINGS_KEY } from "../src/features/watch/forget.ts";
import { recentQaRows } from "../src/features/watch/qa.ts";
import { blackRain } from "../../packages/engine/src/scenario.ts";
import { FIXTURES } from "./ranked-fixtures.ts";

const hex = (h: string) => `0x${h}`;
const ALICE = hex(FIXTURES.aliceId);
const BOB = hex(FIXTURES.bobId);
const RANKED_GAME = Game.parse(fromHex(FIXTURES.gameRankedPlaying));

// === Decoding what the package printed ===

test("GameStarted and GameEnded decode from the package's bytes: players in turn order, mode, listing, ending", () => {
    const started = decodeStarted({
        eventType: GAME_STARTED_TYPE,
        bcs: fromHex(FIXTURES.gameStarted),
        transactionDigest: "T",
        checkpoint: "7",
    });
    assert.ok(started);
    assert.equal(started.gameId, RANKED_GAME.id);
    assert.deepEqual(started.players, [ALICE, BOB]);
    assert.deepEqual(started.mode, { $kind: "Ranked", Ranked: { size: 3, tier: 1 } });
    assert.equal(started.listed, true);
    assert.equal(started.checkpoint, 7n);

    const ended = decodeEnded({
        eventType: GAME_ENDED_TYPE,
        bcs: fromHex(FIXTURES.gameEnded),
        transactionDigest: "E",
        checkpoint: null,
    });
    assert.ok(ended);
    assert.equal(ended.gameId, RANKED_GAME.id);
    assert.deepEqual(ended.ending, { $kind: "Abandoned", Abandoned: ALICE });
    assert.equal(ended.endedMs, 5000, "when it ended, from the event itself");
    assert.equal(ended.digest, "E");
    assert.equal(ended.checkpoint, null);

    assert.equal(
        decodeStarted({
            eventType: "",
            bcs: new Uint8Array([1]),
            transactionDigest: "",
            checkpoint: null,
        }),
        null,
        "bytes that do not decode are skipped",
    );
    assert.equal(GAME_STARTED_TYPE, `${GHOSTS.package}::ghosts::GameStarted`);
    assert.equal(GAME_ENDED_TYPE, `${GHOSTS.package}::ghosts::GameEnded`);
});

test("the ending a wrap-up announces: the GameEnded of that game among the transaction's events", () => {
    const bytes = fromHex(FIXTURES.gameEnded);
    const other = GameEnded.serialize({
        game: hex("ab".repeat(32)),
        ending: { Draw: true },
        endedMs: 1n,
    } as never).toBytes();
    const events = [
        { eventType: `${GHOSTS.package}::ghosts::Something`, bcs: new Uint8Array() },
        { eventType: GAME_ENDED_TYPE, bcs: other },
        { eventType: GAME_ENDED_TYPE, bcs: bytes },
    ];
    assert.deepEqual(endingFromEvents(events, RANKED_GAME.id), {
        $kind: "Abandoned",
        Abandoned: ALICE,
    });
    assert.equal(endingFromEvents(events.slice(0, 2), RANKED_GAME.id), null);
    // the node may hand the type back with the package's short or long address: one type
    const short = GAME_ENDED_TYPE.replace(/^0x0+/, "0x");
    assert.deepEqual(endingFromEvents([{ eventType: short, bcs: bytes }], RANKED_GAME.id), {
        $kind: "Abandoned",
        Abandoned: ALICE,
    });
});

// === Recent games ===

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const P = (n: number) => `0x${(1000 + n).toString(16).padStart(64, "0")}`;
const STAKES = { $kind: "Stakes", Stakes: true } as StartedEvent["mode"];
const won = (account: string) => ({ $kind: "Won", Won: account }) as GameEnding;

/** A ledger of games: game n starts at checkpoint 10n and ends at 10n + 5 (newest last). */
function ledger(
    count: number,
    { unlisted = new Set<number>(), lasting = new Map<number, number>() } = {},
) {
    const starts: StartedEvent[] = [];
    const ends: EndedEvent[] = [];
    for (let n = 0; n < count; n++) {
        const start = 10 * n - (lasting.get(n) ?? 0);
        starts.push({
            gameId: id(n),
            players: [P(2 * n), P(2 * n + 1)],
            mode: STAKES,
            listed: !unlisted.has(n),
            checkpoint: BigInt(start),
        });
        ends.push({
            gameId: id(n),
            ending: won(P(2 * n)),
            digest: `d${n}`,
            checkpoint: BigInt(10 * n + 5),
        });
    }
    const byCheckpoint = <T extends { checkpoint: bigint | null }>(list: T[]) =>
        [...list].sort((a, b) => Number(b.checkpoint! - a.checkpoint!));
    return { starts: byCheckpoint(starts), ends: byCheckpoint(ends) };
}

/** Readers over a ledger, `size` events a page, newest first; counts what is read. */
function reads(
    events: { starts: StartedEvent[]; ends: EndedEvent[] },
    { size = 10, origins = new Map<string, GameOrigin | null>() } = {},
) {
    const log = { startPages: 0, endPages: 0, origins: [] as string[] };
    const page = <T>(list: T[], cursor: string | null): EventPage<T> => {
        const from = cursor ? Number(cursor) : 0;
        const items = list.slice(from, from + size);
        return { items, next: from + size < list.length ? String(from + size) : null };
    };
    const r: RecentReads = {
        ended: async (cursor) => (log.endPages++, page(events.ends, cursor)),
        started: async (cursor) => (log.startPages++, page(events.starts, cursor)),
        origin: async (gameId) => {
            log.origins.push(gameId);
            return origins.get(gameId) ?? null;
        },
    };
    return { r, log };
}

test("recent games: each end joined with its start, newest first", async () => {
    const { r, log } = reads(ledger(5));
    const { games, more } = await recentGames(r, RECENT_FIRST);
    assert.deepEqual(
        games.map((g) => g.gameId),
        [4, 3, 2, 1, 0].map(id),
    );
    assert.deepEqual(games[0].players, [P(8), P(9)]);
    assert.deepEqual(games[0].ending, won(P(8)));
    assert.equal(games[0].digest, "d4");
    assert.equal(more, false);
    assert.deepEqual(log.origins, [], "every start was in the window");
});

test("recent games: a game whose start is older than the window is read from its creating transaction", async () => {
    // game 3 lasted long: it started before every other game in the ledger
    const events = ledger(4, { lasting: new Map([[3, 100]]) });
    // the start window ends early: only the newest page of starts is ever served
    const served = { ...events, starts: events.starts.filter((s) => s.gameId !== id(3)) };
    const origins = new Map<string, GameOrigin | null>([
        [id(3), { players: [P(6), P(7)], mode: STAKES, listed: true }],
    ]);
    const { r, log } = reads(served, { origins });
    const { games } = await recentGames(r, RECENT_FIRST);
    assert.deepEqual(log.origins, [id(3)]);
    assert.deepEqual(
        games.map((g) => [g.gameId, g.players[0]]),
        [
            [id(3), P(6)],
            [id(2), P(4)],
            [id(1), P(2)],
            [id(0), P(0)],
        ],
    );

    // out of reach: the row is left out (its listing cannot be told)
    const { r: lost } = reads(served);
    assert.deepEqual(
        (await recentGames(lost, RECENT_FIRST)).games.map((g) => g.gameId),
        [2, 1, 0].map(id),
    );
});

test("recent games: an invite-only game is left out, by its start or by its creating transaction", async () => {
    const events = ledger(6, { unlisted: new Set([1, 4]) });
    const missing = { ...events, starts: events.starts.filter((s) => s.gameId !== id(2)) };
    const origins = new Map<string, GameOrigin | null>([
        [id(2), { players: [P(4), P(5)], mode: STAKES, listed: false }],
    ]);
    const { r } = reads(missing, { origins });
    const { games } = await recentGames(r, RECENT_FIRST);
    assert.deepEqual(
        games.map((g) => g.gameId),
        [5, 3, 0].map(id),
    );
});

test("recent games: 25 visible rows after the listing filter, then 50 with More, and no further", async () => {
    // 80 games, every fifth one from an invite code: more ends are read to fill the rows
    const unlisted = new Set(Array.from({ length: 16 }, (_, i) => i * 5));
    const events = ledger(80, { unlisted });
    const first = await recentGames(reads(events).r, RECENT_FIRST);
    assert.equal(first.games.length, 25);
    assert.equal(first.more, true);
    assert.ok(first.games.every((g) => !unlisted.has(parseInt(g.gameId, 16))));
    const order = first.games.map((g) => parseInt(g.gameId, 16));
    assert.deepEqual(
        order,
        [...order].sort((a, b) => b - a),
        "newest first",
    );
    assert.equal(order[0], 79);

    const second = await recentGames(reads(events).r, RECENT_CAP);
    assert.equal(second.games.length, 50);
    assert.deepEqual(
        second.games.slice(0, 25).map((g) => g.gameId),
        first.games.map((g) => g.gameId),
        "More extends the same list",
    );
    assert.equal(second.more, true, "there are more past the cap, but the cap holds");
    assert.equal((await recentGames(reads(events).r, 500)).games.length, RECENT_CAP);

    const few = await recentGames(reads(ledger(12)).r, RECENT_FIRST);
    assert.equal(few.games.length, 12);
    assert.equal(few.more, false);
});

test("recent games: empty pages from a bounded scan are read past; a game ended twice shows once", async () => {
    const events = ledger(3);
    let calls = 0;
    const r: RecentReads = {
        // the node's first two answers are empty pages with more to read
        ended: async (cursor) => {
            calls++;
            if (!cursor) return { items: [], next: "a" };
            if (cursor === "a") return { items: [], next: "b" };
            return { items: [...events.ends, events.ends[0]], next: null };
        },
        started: async () => ({ items: events.starts, next: null }),
        origin: async () => null,
    };
    const { games } = await recentGames(r, RECENT_FIRST);
    assert.equal(calls, 3);
    assert.deepEqual(
        games.map((g) => g.gameId),
        [2, 1, 0].map(id),
    );
});

test("the live list's starts: the newest listed ones, at most the count asked for", async () => {
    const events = ledger(30, { unlisted: new Set([29, 27]) });
    const { r } = reads(events);
    const starts = await latestStarts(r.started, 10);
    assert.equal(starts.length, 10);
    assert.equal(starts[0].gameId, id(28));
    assert.ok(starts.every((s) => s.listed));
});

// === Rows ===

test("modes in words: ranked with size and tier name, friendly with size, contract", () => {
    assert.equal(modeText(RANKED_GAME), "Ranked 3x3 · Contractor");
    assert.equal(
        modeText({ mode: { $kind: "Ranked", Ranked: { size: 4, tier: 0 } } as never }),
        "Ranked 4x4 · Rookie",
    );
    assert.equal(
        modeText({ mode: { $kind: "Ranked", Ranked: { size: 2, tier: 3 } } as never }),
        "Ranked 2x2 · Elite",
    );
    assert.equal(
        modeText({ mode: { $kind: "Ranked", Ranked: { size: 2, tier: 9 } } as never }),
        "Ranked 2x2 · Rank 10",
    );
    assert.equal(
        modeText({ mode: { $kind: "Friendly", Friendly: { size: 4 } } as never }),
        "Friendly 4x4",
    );
    assert.equal(modeText({ mode: STAKES }), "Contract");
});

test("a recent row: both players, the mode, how it ended in plain words and how long ago", () => {
    const now = 1_000_000_000;
    const game = {
        gameId: RANKED_GAME.id,
        players: [ALICE, BOB] as [string, string],
        mode: RANKED_GAME.mode,
        ending: { $kind: "Abandoned", Abandoned: ALICE } as GameEnding,
    };
    assert.deepEqual(recentRow(game, ["Alpha", "Bravo"], now - 12 * 60_000, now), {
        id: RANKED_GAME.id,
        name: "Alpha vs Bravo",
        kind: "Ranked 3x3 · Contractor · Bravo won · Alpha left the match",
        tag: "12 min ago",
        hint: "Bravo won · Alpha left the match · 12 min ago",
    });
    const win = recentRow({ ...game, ending: won(BOB) }, ["Alpha", "Bravo"], undefined, now);
    assert.equal(win.kind, "Ranked 3x3 · Contractor · Bravo won · by elimination");
    assert.equal(win.tag, "Bravo won", "no time read: the result stands in");

    const line = (ending: GameEnding) => endingText(ending, [ALICE, BOB], ["Alpha", "Bravo"]);
    assert.deepEqual(line({ $kind: "Forfeited", Forfeited: BOB } as GameEnding), {
        tag: "Alpha won",
        line: "Bravo missed 3 turns in a row",
    });
    assert.deepEqual(line({ $kind: "NoShow", NoShow: ALICE } as GameEnding), {
        tag: "Bravo won",
        line: "Alpha did not deploy in time",
    });
    assert.equal(
        line({ $kind: "Stalemate", Stalemate: true } as GameEnding).line,
        "Turn limit reached",
    );
    assert.equal(line({ $kind: "Draw", Draw: true } as GameEnding).tag, "Draw");
    assert.equal(
        line({ $kind: "NobodyShowed", NobodyShowed: true } as GameEnding).line,
        "Neither side deployed",
    );

    assert.equal(agoText(now - 30_000, now), "Just now");
    assert.equal(agoText(now - 3 * 3_600_000, now), "3 h ago");
    assert.equal(agoText(now - 26 * 3_600_000, now), "1 day ago");
    assert.equal(agoText(now - 50 * 3_600_000, now), "2 days ago");
});

test("the drawn first mover: names, results and squads go by turn order, not by who found the game", () => {
    // In the printed ranked game Bob found it (his squad was on the map first), but Alice moves first.
    const deploying = Game.parse(fromHex(FIXTURES.gameRankedDeploying));
    assert.deepEqual(
        [...new Set(unitsOnMap(deploying).map(({ unit }) => unit.owner))],
        [BOB],
        "the finder's squad is placed as the match is created",
    );
    assert.deepEqual(RANKED_GAME.players, [ALICE, BOB]);
    const row = recentRow(
        {
            gameId: RANKED_GAME.id,
            players: [ALICE, BOB],
            mode: RANKED_GAME.mode,
            ending: won(ALICE),
        },
        ["Alpha", "Bravo"],
        undefined,
        0,
    );
    assert.equal(row.name, "Alpha vs Bravo");
    assert.equal(row.tag, "Alpha won");

    const dress = rankedDress(RANKED_GAME, RANKED_GAME.id);
    const owner = new Map(unitsOnMap(RANKED_GAME).map(({ unit }) => [unit.recruit, unit.owner]));
    assert.ok(
        dress.squad.every((r) => owner.get(r.id) === ALICE),
        "side 0's figures are the first mover's units",
    );
    assert.ok([...dress.looks.keys()].every((unit) => owner.get(unit) === BOB));
    const start = watchStart(blackRain, RANKED_GAME, dress.names, dress.looks);
    assert.ok(
        start.scenario.units.every((u) => u.enemy === (owner.get(u.id) === BOB)),
        "the viewer's side 0 is the first mover",
    );
});

test("a ranked replay: virtual units named by their loadouts, unique on a side, figures from presets", () => {
    assert.equal(Number(RANKED_GAME.recruits.size), 0, "no recruit entries in a ranked match");
    const dress = rankedDress(RANKED_GAME, RANKED_GAME.id);
    const owner = new Map(unitsOnMap(RANKED_GAME).map(({ unit }) => [unit.recruit, unit.owner]));
    const namesOf = (account: string) =>
        [...dress.names.entries()]
            .filter(([unit]) => owner.get(unit) === account)
            .map(([, n]) => n)
            .sort();
    assert.deepEqual(namesOf(ALICE), ["Assault", "Recruit", "Sniper"]);
    assert.deepEqual(namesOf(BOB), ["Assault", "Assault-2", "Runner"]);
    assert.equal(dress.squad.length, 3);
    assert.deepEqual(dress.squad.map((r) => r.name).sort(), namesOf(ALICE));
    assert.ok(dress.squad.every((r) => r.appearance && r.equipment.armor));
    assert.equal(dress.looks.size, 3);
    for (const look of dress.looks.values()) assert.ok(look.appearance && look.armor);

    const again = rankedDress(RANKED_GAME, RANKED_GAME.id);
    assert.deepEqual(
        again.squad.map((r) => r.appearance),
        dress.squad.map((r) => r.appearance),
        "seeded by the match: the same match dresses the same",
    );
    const start = watchStart(blackRain, RANKED_GAME, dress.names, dress.looks);
    assert.deepEqual(
        start.scenario.units.map((u) => u.full).sort(),
        [...namesOf(ALICE), ...namesOf(BOB)].sort(),
    );
});

// === QA fixture ===

test("the QA fixture: 25 rows with More, 50 after, few without More, empty", () => {
    const now = Date.now();
    const first = recentQaRows("rows", RECENT_FIRST, now);
    assert.equal(first.rows.length, 25);
    assert.equal(first.more, true);
    assert.equal(recentQaRows("rows", RECENT_CAP, now).rows.length, 50);
    assert.deepEqual(recentQaRows("few", RECENT_FIRST, now).more, false);
    assert.equal(recentQaRows("empty", RECENT_FIRST, now).rows.length, 0);
    const copy = JSON.stringify(recentQaRows("rows", RECENT_CAP, now));
    assert.doesNotMatch(copy, /preview|mock|testnet|on chain|\bsoon\b|for now|!/i);
    assert.equal(new Set(first.rows.map((r) => r.id)).size, 25);
    void GameStarted;
});

// === The Spectate screen's copy ===

test("Spectate: three game panels, Refresh to read again, Play leads to /play, nothing about the device or the demo", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const list = read("../src/features/watch/WatchList.tsx");
    for (const title of ['"Live matches"', '"Recent matches"', '"My matches"', '"Spectate"'])
        assert.ok(list.includes(title), title);
    assert.ok(list.includes("Sign in to see your matches"));
    assert.ok(list.includes('"No matches yet"'));
    assert.ok(list.includes('navigate("/play")'));
    for (const title of [
        '"Could not load live matches"',
        '"Could not load recent matches"',
        '"Could not load your matches"',
    ])
        assert.ok(list.includes(title), title);
    assert.ok(read("../src/features/watch/ChainWatch.tsx").includes('"Could not load this match"'));
    // every empty state runs its one action on the first click: no armed second "Refresh" under it
    for (const file of [list, read("../src/features/watch/ChainWatch.tsx")])
        for (const block of file.split("<EmptyState").slice(1))
            assert.match(block.slice(0, block.indexOf(">")), /\binstant\b/);
    const copy = [
        list,
        read("../src/features/watch/ChainWatch.tsx"),
        read("../src/features/watch/Viewer.tsx"),
    ]
        .join("\n")
        .replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    assert.doesNotMatch(
        copy,
        /"Look again"|"Try again"|"\/demo"|\bdemo\b|this device|"Your matches"|could not be read|did not answer|not responding|try again later/i,
    );
});

test("the old device recordings are cleared once per load, and blocked storage is left alone", () => {
    const removed: string[] = [];
    forgetDeviceRecordings({ removeItem: (key) => void removed.push(key) });
    forgetDeviceRecordings({ removeItem: (key) => void removed.push(key) });
    assert.deepEqual(removed, [OLD_RECORDINGS_KEY]);
    assert.equal(OLD_RECORDINGS_KEY, "ghosts:watch:journals");
});

test("a failed read names no cause but being offline, and only when the device says so", () => {
    assert.equal(offlineLine(false), "You are offline");
    assert.equal(offlineLine(true), null);
    assert.equal(offlineLine(undefined), null);
});

// === Reading events against the node's retention floor ===

const outOfRange = Object.assign(new Error("requested data below earliest available"), {
    code: "OUT_OF_RANGE",
});

/**
 * A fake node for one event type: `all` oldest first, a page of 50, and the real quirk: a
 * descending scan that reaches the oldest event without filling its page fails
 * `OUT_OF_RANGE` (the retention floor), and finding events first does not save it.
 */
function fakeNode(all: RawEvent[], calls: string[] = []): ListEvents {
    return async ({ order, before, after }) => {
        calls.push(order);
        if (order === "descending") {
            const end = before ? Number(before) : all.length;
            const from = end - 50;
            if (from <= 0) throw outOfRange;
            return {
                events: all.slice(from, end).reverse(),
                hasNextPage: true,
                endCursor: String(from),
            };
        }
        const start = after ? Number(after) : 0;
        const events = all.slice(start, start + 50);
        const hasNextPage = start + 50 < all.length;
        return { events, hasNextPage, endCursor: String(start + events.length) };
    };
}

const gameAt = (i: number) => hex(i.toString(16).padStart(64, "0"));
const startedEvent = (i: number, listed = true): RawEvent => ({
    eventType: GAME_STARTED_TYPE,
    bcs: GameStarted.serialize({
        game: gameAt(i),
        players: [ALICE, BOB],
        mode: { Ranked: { size: 3, tier: 1 } },
        listed,
    } as never).toBytes(),
    transactionDigest: `S${i}`,
    checkpoint: String(1000 + i * 2),
});
const endedEvent = (i: number): RawEvent => ({
    eventType: GAME_ENDED_TYPE,
    bcs: GameEnded.serialize({
        game: gameAt(i),
        ending: { Draw: true },
        endedMs: BigInt(1_700_000_000_000 + i * 1000),
    } as never).toBytes(),
    transactionDigest: `E${i}`,
    checkpoint: String(1001 + i * 2),
});

/** `RecentReads` over fake nodes holding games 1..n (every `unlisted`-th one unlisted). */
function readsFor(n: number, unlisted = 0, calls: string[] = []): RecentReads {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const starts = fakeNode(
        ids.map((i) => startedEvent(i, !(unlisted && i % unlisted === 0))),
        calls,
    );
    const ends = fakeNode(ids.map(endedEvent), calls);
    const page = async <T>(
        list: ListEvents,
        decode: (e: RawEvent) => T | null,
        cursor: string | null,
    ): Promise<EventPage<T>> => {
        const { events, next } = await eventsNewestFirst(list, cursor);
        return { items: events.flatMap((e) => decode(e) ?? []), next };
    };
    return {
        ended: (cursor) => page(ends, decodeEnded, cursor),
        started: (cursor) => page(starts, decodeStarted, cursor),
        origin: async () => null,
    };
}

const idsOf = (games: { gameId: string }[]) => games.map((g) => g.gameId);

test("events newest first: no events at all is an empty page (descending fails, ascending is empty)", async () => {
    const calls: string[] = [];
    assert.deepEqual(await eventsNewestFirst(fakeNode([], calls), null), {
        events: [],
        next: null,
    });
    assert.deepEqual(calls, ["descending", "ascending"]);
    assert.deepEqual(await recentGames(readsFor(0), RECENT_FIRST), { games: [], more: false });
});

test("events newest first: a handful of events survive the descending scan that hits the floor", async () => {
    const ids = [1, 2, 3, 4, 5];
    const page = await eventsNewestFirst(fakeNode(ids.map(endedEvent)), null);
    assert.deepEqual(
        page.events.map((e) => e.transactionDigest),
        ["E5", "E4", "E3", "E2", "E1"],
    );
    assert.equal(page.next, null);
    const list = await recentGames(readsFor(5), RECENT_FIRST);
    assert.deepEqual(idsOf(list.games), [5, 4, 3, 2, 1].map(gameAt));
    assert.equal(list.more, false);
    assert.deepEqual(list.games[0].players, [ALICE, BOB]);
    assert.deepEqual(list.games[0].mode, { $kind: "Ranked", Ranked: { size: 3, tier: 1 } });
});

test("events newest first: many events page newest first, and the page that reaches the floor still yields its events", async () => {
    const calls: string[] = [];
    const list = await recentGames(readsFor(130, 0, calls), RECENT_CAP);
    assert.equal(list.games.length, RECENT_CAP);
    assert.equal(list.more, true);
    assert.deepEqual(
        idsOf(list.games),
        Array.from({ length: RECENT_CAP }, (_, i) => gameAt(130 - i)),
    );
    // reading to the very end: three descending pages then the floor falls back, no event lost or doubled
    const all = Array.from({ length: 130 }, (_, i) => endedEvent(i + 1));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
        const page: { events: RawEvent[]; next: string | null } = await eventsNewestFirst(
            fakeNode(all),
            cursor,
        );
        seen.push(...page.events.map((e) => e.transactionDigest));
        cursor = page.next;
    } while (cursor);
    assert.deepEqual(new Set(seen).size, 130);
    assert.ok(
        seen.length <= 130 + 2 * 50,
        "the floor's page is one page of the oldest, not the whole type",
    );
    assert.deepEqual(seen.slice(0, 3), ["E130", "E129", "E128"]);
});

test("recent games: 25 rows first, unlisted games left out, and 'more' says whether past them there are", async () => {
    const first = await recentGames(readsFor(70, 3), RECENT_FIRST);
    assert.equal(first.games.length, RECENT_FIRST);
    assert.equal(first.more, true);
    assert.ok(first.games.every((g) => Number(BigInt(g.gameId)) % 3 !== 0));
    assert.equal(first.games[0].gameId, gameAt(70));
    assert.equal(first.games[1].gameId, gameAt(68), "70 is listed, 69 is not");
    const few = await recentGames(readsFor(6, 2), RECENT_FIRST);
    assert.deepEqual(idsOf(few.games), [5, 3, 1].map(gameAt));
    assert.equal(few.more, false);
});

test("the live list's starts come through the same read: a few starts, newest first, unlisted left out", async () => {
    const reads = readsFor(8, 4);
    assert.deepEqual(
        (await latestStarts(reads.started, 10)).map((s) => s.gameId),
        [7, 6, 5, 3, 2, 1].map(gameAt),
    );
    assert.deepEqual(await latestStarts(readsFor(0).started, 10), []);
});

test("events newest first: any failure but OUT_OF_RANGE is an error, also from the second read", async () => {
    const unavailable = Object.assign(new Error("unavailable"), { code: "UNAVAILABLE" });
    const failing =
        (error: Error): ListEvents =>
        async () => {
            throw error;
        };
    await assert.rejects(eventsNewestFirst(failing(unavailable), null), unavailable);
    await assert.rejects(eventsNewestFirst(failing(new Error("boom")), null), /boom/);
    const flaky: ListEvents = async ({ order }) => {
        if (order === "descending") throw outOfRange;
        throw unavailable;
    };
    await assert.rejects(eventsNewestFirst(flaky, null), unavailable);
    const reads: RecentReads = {
        ended: async () => {
            throw unavailable;
        },
        started: async () => ({ items: [], next: null }),
        origin: async () => null,
    };
    await assert.rejects(recentGames(reads, RECENT_FIRST), unavailable);
});
