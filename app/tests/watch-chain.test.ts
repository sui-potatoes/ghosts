// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The viewer's chain sources with fake readers: a game's past read from its
 * versions (the version play started at, the last one, the recruits deployed,
 * the deleting transaction), the fullnode-then-GraphQL fallbacks, a live game
 * followed as its history grows (cursor, mid-game join, the end seen `Over` or
 * gone), how every ending reads, the live list's filters and rows, and whether
 * a link opens live or as a replay. The games are built here in `Game`'s field
 * order and go through the real BCS schemas.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { blackRain } from "../../packages/engine/src/scenario.ts";
import { replayEncounter } from "../../packages/engine/src/game.ts";
import { rebuildEncounter } from "../../packages/engine/src/replay/timeline.ts";
import { pack, stats } from "../../packages/squad/src/stats.ts";
import type { GameEvent } from "../../packages/engine/src/events.ts";
import {
    archive,
    graphGameTx,
    grpcGameTx,
    type GameArchive,
    type GameTx,
} from "../src/chain/archive.ts";
import { Game, type ChainGame } from "../src/chain/bcs.ts";
import { CALLS, RecruitField, GAME_TYPE, isRecruitEntry } from "../src/chain/watch-layout.ts";
import { GHOSTS } from "../src/constants.ts";
import { terrainAt, toCell } from "../src/chain/match-rules.ts";
import { scenarioFor } from "../src/chain/match-scene.ts";
import { lookFor } from "../../packages/engine/src/scene-look.ts";
import {
    endingText,
    isGameId,
    listedBy,
    liveRow,
    modeText,
    offTheList,
    openingOf,
    recentRow,
    resultFor,
    roundOf,
} from "../src/features/watch/chain/list.ts";
import { banner, matchCard, resultText } from "../src/features/watch/model.ts";
import { liveSource, type LiveReads } from "../src/features/watch/chain/live.ts";
import {
    EventFeed,
    missedByTurn,
    readStory,
    senderSide,
    storyOutcome,
    watchOutcome,
    watchStart,
} from "../src/features/watch/chain/record.ts";

const addr = (byte: string) => `0x${byte.repeat(32)}`;
const [A, B] = [addr("aa"), addr("bb")];
const [OWNER_A, OWNER_B] = [addr("0a"), addr("0b")];
const [R1, R2] = [addr("01"), addr("02")];
const GAME = addr("9a");
const TABLE = addr("7a");
const SIDES = [{ name: "Alpha" }, { name: "Bravo" }] as const;

const param = (value: number) => ({ value, maxValue: value });
const mapUnit = (recruit: string, owner: string) => ({
    recruit,
    owner,
    ap: param(2),
    hp: param(10),
    ammo: param(3),
    stats: { value: 0n },
    actions: [
        { uses: null, kind: { Move: true } },
        { uses: null, kind: { Attack: true } },
        { uses: null, kind: { Reload: true } },
    ],
    effects: [],
});

type Placed = { row: number; col: number; recruit: string; owner: string };

/** A 4 x 4 open ground with `units` on it, in `Game`'s field order. */
function game({
    units,
    history = [],
    turn = 0,
    state = { Playing: { startedMs: 1_000n, missed: [0, 0] } },
    mode = { Stakes: true },
}: {
    units: Placed[];
    history?: unknown[];
    turn?: number;
    state?: unknown;
    mode?: unknown;
}): Uint8Array {
    const grid = Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 4 }, (_, col) => {
            const u = units.find((p) => p.row === row && p.col === col);
            return { tileType: { Empty: true }, unit: u ? mapUnit(u.recruit, u.owner) : null };
        }),
    );
    return Game.serialize({
        id: GAME,
        map: {
            id: addr("3a"),
            grid: { grid, rows: 4, cols: 4 },
            fallen: [],
            units: units.map((u) => u.row * 4 + u.col),
        },
        players: [A, B],
        state,
        turn,
        positions: [[], []],
        history,
        recruits: { id: TABLE, size: BigInt(units.length) },
        mode,
    } as never).toBytes();
}

const PLACED_A: Placed = { row: 0, col: 0, recruit: R1, owner: A };
const PLACED_B: Placed = { row: 3, col: 3, recruit: R2, owner: B };
const DEPLOYING = { Deploying: { untilMs: 5_000n } };

const tile = (row: number, col: number) => [row, col];
const DOWN = 4;
/** Placed, then A moves down and hits B for 4, B misses, A kills B. */
const RECORDS = {
    placed: [{ RecruitPlaced: [0, 0] }, { RecruitPlaced: [3, 3] }],
    aMoves: [
        { Move: [0, 0, DOWN] },
        { Attack: { origin: tile(1, 0), target: tile(3, 3) } },
        { Damage: 4 },
    ],
    aEnds: [{ NextTurn: 1 }],
    bMisses: [
        { Attack: { origin: tile(3, 3), target: tile(1, 0) } },
        { Miss: true },
        { NextTurn: 2 },
    ],
    aKills: [
        { Attack: { origin: tile(1, 0), target: tile(3, 3) } },
        { Damage: 6 },
        { UnitKIA: [R2, 3, 3] },
    ],
};
const A_MOVED: Placed = { ...PLACED_A, row: 1 };
const all = (...parts: unknown[][]) => parts.flat();

const VERSIONS: Record<string, Uint8Array> = {
    "1": game({ units: [], state: DEPLOYING }),
    "2": game({ units: [PLACED_A], state: DEPLOYING, history: RECORDS.placed.slice(0, 1) }),
    // the second squad deployed: play starts
    "3": game({ units: [PLACED_A, PLACED_B], history: RECORDS.placed }),
    "4": game({
        units: [A_MOVED, PLACED_B],
        history: all(RECORDS.placed, RECORDS.aMoves, RECORDS.aEnds),
        turn: 1,
    }),
    "5": game({
        units: [A_MOVED, PLACED_B],
        history: all(RECORDS.placed, RECORDS.aMoves, RECORDS.aEnds, RECORDS.bMisses),
        turn: 2,
    }),
    "6": game({
        units: [A_MOVED],
        history: all(
            RECORDS.placed,
            RECORDS.aMoves,
            RECORDS.aEnds,
            RECORDS.bMisses,
            RECORDS.aKills,
        ),
        turn: 2,
        state: { Over: { Won: A } },
    }),
};

const recruitEntry = (recruit: string, leader: string, name: string) =>
    RecruitField.serialize({
        id: addr(recruit.slice(2, 4) === "01" ? "f1" : "f2"),
        name: recruit,
        value: {
            id: recruit,
            metadata: {
                name,
                visuals: { head: 0n, face: 0n, eyes: 0n, body: 0n, outfit: 0n },
                voice: 0,
            },
            rank: { Rookie: true },
            xp: 0,
            stats: { value: 0n },
            weapon: null,
            armor: null,
            utilities: [],
            leader,
        },
    } as never).toBytes();

const OBJECTS: Record<string, Uint8Array> = {
    ...Object.fromEntries(Object.entries(VERSIONS).map(([v, bytes]) => [`${GAME}@${v}`, bytes])),
    [`${addr("f1")}@2`]: recruitEntry(R1, A, "Ash Corder"),
    [`${addr("f2")}@3`]: recruitEntry(R2, B, "Rook Halden"),
};

const tx = (patch: Partial<GameTx>): GameTx => ({
    digest: "d",
    timestampMs: 0,
    sender: OWNER_A,
    calls: [],
    recruits: [],
    ...patch,
});

/** Every transaction of the finished game, oldest first: the last one deletes it. */
const TXS: GameTx[] = [
    tx({ calls: [CALLS.findGame], after: "1" }),
    tx({
        calls: [CALLS.deploy],
        before: "1",
        after: "2",
        recruits: [{ id: addr("f1"), version: "2" }],
    }),
    tx({
        calls: [CALLS.deploy],
        before: "2",
        after: "3",
        recruits: [{ id: addr("f2"), version: "3" }],
        sender: OWNER_B,
    }),
    tx({ calls: ["move_unit", "perform_attack", CALLS.nextTurn], before: "3", after: "4" }),
    tx({ calls: ["perform_attack", CALLS.nextTurn], before: "4", after: "5", sender: OWNER_B }),
    tx({ calls: ["perform_attack"], before: "5", after: "6" }),
    tx({ calls: [CALLS.complete], before: "6" }),
];

function fakeArchive(
    txs: GameTx[] | null,
    objects: Record<string, Uint8Array> = OBJECTS,
): GameArchive & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        transactions: async (_id, limit = 1000) => txs && txs.slice(0, limit),
        objectAt: async (id, version) => {
            reads.push(`${id}@${version}`);
            return objects[`${id}@${version}`] ?? null;
        },
        finished: async () => [],
    };
}

const parse = (v: string) => Game.parse(VERSIONS[v]);
const blank = (scenario: Parameters<typeof replayEncounter>[0]) => replayEncounter(scenario, []);

const kinds = (events: readonly GameEvent[]) =>
    events.map((e) =>
        e.type === "shot" ? `shot:${e.hit ? e.damage : "miss"}${e.killed ? ":kia" : ""}` : e.type,
    );

// === A finished game's story ===

test("a finished game: play starts at the second deployment, the history is the last version's, recruits from the deployments", async () => {
    const arch = fakeArchive(TXS);
    const story = await readStory(arch, GAME, null);
    assert.equal(story.kind, "played");
    if (story.kind !== "played") return;
    assert.equal(story.first.state.$kind, "Playing");
    assert.equal(story.first.history.length, 2, "only the placements before play");
    assert.equal(story.last.state.$kind, "Over");
    assert.equal(story.finished, true);
    assert.equal(story.fromStart, true);
    assert.deepEqual(story.endTx?.calls, [CALLS.complete]);
    assert.deepEqual(
        story.recruits.map((r) => [r.objectId, r.metadata.name, r.leader]),
        [
            [R1, "Ash Corder", A],
            [R2, "Rook Halden", B],
        ],
    );
    assert.ok(
        !arch.reads.includes(`${GAME}@1`),
        "versions before the last deployment are not read",
    );

    const names = new Map(story.recruits.map((r) => [r.objectId, r.metadata.name]));
    const start = watchStart(blackRain, story.first, names);
    assert.deepEqual(
        start.scenario.units.map((u) => [u.id, u.enemy, u.full]),
        [
            [R1, false, "Ash Corder"],
            [R2, true, "Rook Halden"],
        ],
        "side 0 is the first player, both squads named",
    );
    const feed = new EventFeed(start, story.first, blank);
    assert.equal(feed.take(story.last), 6);
    assert.deepEqual(kinds(feed.events), [
        "move",
        "shot:4",
        "hostile-phase",
        "shot:miss",
        "turn",
        "shot:6:kia",
    ]);
    assert.deepEqual(
        feed.events[4],
        { type: "turn", turn: 1 },
        "the turn a player sees: rounds, from 0",
    );
    assert.deepEqual(storyOutcome(story.last, story.endTx, [OWNER_A, OWNER_B], SIDES), {
        kind: "won",
        winner: 0,
        reason: "by elimination",
    });
});

test("the start prepares fresh rules the same way every time: positions, health, whose turn and its number", () => {
    const first = parse("3");
    const start = watchStart(blackRain, first, new Map());
    const one = blank(start.scenario);
    start.prepare(one);
    const two = blank(start.scenario);
    start.prepare(two);
    const view = (r: typeof one) => [
        r.turn,
        r.phase,
        r.units.map((u) => [u.id, u.pos, u.hp, u.ap, u.ammo]),
    ];
    assert.deepEqual(view(one), view(two));
    assert.equal(one.turn, 0, "a chain match opens on turn 0, as its players see it");
    assert.equal(one.phase, "player", "the first player opens");
});

test("looks dress the other side's units; the first side is dressed by the squad the field is given", () => {
    const looks = new Map([[R2, { armor: "nyx-heavy" }]]);
    const start = watchStart(blackRain, parse("3"), new Map(), looks);
    assert.deepEqual(start.scenario.units.find((u) => u.id === R2)?.look, { armor: "nyx-heavy" });
    assert.equal(start.scenario.units.find((u) => u.id === R1)?.look, undefined);
});

test("both players and the viewer show a game in the look its ID's first two bytes give", () => {
    const first = parse("3");
    assert.equal(first.id, GAME);
    const expected = lookFor(0x9a, 0x9a);
    assert.deepEqual(expected, { time: "dawn", weather: "fog", seed: 0x9a9a });
    for (const side of [0, 1])
        assert.deepEqual(
            scenarioFor(blackRain, first, side, new Map()).look,
            expected,
            `player ${side}`,
        );
    assert.deepEqual(watchStart(blackRain, first, new Map()).scenario.look, expected, "the viewer");
    // Later versions of the same game keep it: only the ID counts.
    assert.deepEqual(watchStart(blackRain, parse("6"), new Map()).scenario.look, expected);
    const other = { ...first, id: `0x0000${"9a".repeat(30)}` };
    assert.deepEqual(scenarioFor(blackRain, other, 0, new Map()).look, {
        time: "night",
        weather: "heavy-rain",
        seed: 0,
    });
});

test("a game that never reached play reads as unplayed, with who did not show", async () => {
    const txs = [
        TXS[0],
        TXS[1],
        tx({ calls: [CALLS.nextTurn, CALLS.complete], before: "2", sender: OWNER_A }),
    ];
    const story = await readStory(fakeArchive(txs), GAME, null);
    assert.equal(story.kind, "unplayed");
    if (story.kind !== "unplayed") return;
    assert.deepEqual(storyOutcome(story.last, story.endTx, [OWNER_A, OWNER_B], SIDES), {
        kind: "no-show",
        winner: 0,
        reason: "Bravo did not deploy in time",
    });
});

test("a game whose versions are gone is unavailable; a live one is watched from where it stands", async () => {
    assert.deepEqual(await readStory(fakeArchive([]), GAME, null), { kind: "unavailable" });
    assert.deepEqual(await readStory(fakeArchive(null), GAME, null), { kind: "unavailable" });
    const lost = await readStory(fakeArchive(TXS, {}), GAME, null);
    assert.equal(lost.kind, "unavailable", "the transactions are there, the versions are not");

    const now = parse("4");
    const live = await readStory(fakeArchive(null), GAME, now);
    assert.equal(live.kind, "played");
    if (live.kind !== "played") return;
    assert.equal(live.first, now, "no history to rewind into: the match as it stands");
    assert.equal(live.fromStart, false);
    assert.equal(live.finished, false);
});

test("a live game still picking squads waits; one in play starts from its first turn", async () => {
    assert.equal((await readStory(fakeArchive(TXS), GAME, parse("2"))).kind, "deploying");
    const story = await readStory(fakeArchive(TXS.slice(0, 5)), GAME, parse("5"));
    assert.equal(story.kind, "played");
    if (story.kind !== "played") return;
    assert.equal(story.fromStart, true);
    assert.equal(story.first.history.length, 2);
    assert.equal(story.finished, false);
    assert.equal(story.endTx, null);
});

// === Every ending ===

test("every ending reads with who won and why", () => {
    const players = [A, B];
    assert.deepEqual(watchOutcome({ $kind: "Won", Won: B }, players, SIDES), {
        kind: "won",
        winner: 1,
        reason: "by elimination",
    });
    assert.deepEqual(watchOutcome({ $kind: "Abandoned", Abandoned: A }, players, SIDES), {
        kind: "abandoned",
        winner: 1,
        reason: "Alpha left the match",
    });
    assert.deepEqual(watchOutcome({ $kind: "Forfeited", Forfeited: B }, players, SIDES), {
        kind: "forfeited",
        winner: 0,
        reason: "Bravo missed 3 turns in a row",
    });
    assert.deepEqual(watchOutcome({ $kind: "NoShow", NoShow: A }, players, SIDES), {
        kind: "no-show",
        winner: 1,
        reason: "Alpha did not deploy in time",
    });
    assert.deepEqual(watchOutcome({ $kind: "NobodyShowed", NobodyShowed: true }, players, SIDES), {
        kind: "nobody-showed",
        winner: null,
        reason: "Neither side deployed",
    });
    assert.deepEqual(watchOutcome({ $kind: "Stalemate", Stalemate: true }, players, SIDES), {
        kind: "stalemate",
        winner: null,
        reason: "Turn limit reached",
    });
    assert.deepEqual(watchOutcome({ $kind: "Draw", Draw: true }, players, SIDES), {
        kind: "draw",
        winner: null,
        reason: "Both squads fell",
    });
    assert.equal(watchOutcome(null, players, SIDES), null);
});

test("a game deleted in the transaction that ended it: the calls and the sender say how", () => {
    const owners = [OWNER_A, OWNER_B];
    const playing = parse("5");
    const end = (calls: string[], sender: string) =>
        storyOutcome(playing, { calls, sender }, owners, SIDES);
    assert.deepEqual(end([CALLS.abandon, CALLS.complete], OWNER_B), {
        kind: "abandoned",
        winner: 0,
        reason: "Bravo left the match",
    });
    // turn 2 is the first player's: their clock ran out three times
    assert.deepEqual(end([CALLS.nextTurn, CALLS.complete], OWNER_B), {
        kind: "forfeited",
        winner: 1,
        reason: "Alpha missed 3 turns in a row",
    });
    assert.deepEqual(end(["perform_attack", CALLS.complete], OWNER_A), {
        kind: "won",
        winner: 0,
        reason: "by elimination",
    });
    assert.equal(
        end([CALLS.abandon, CALLS.complete], addr("ee")),
        null,
        "a stranger's wrap-up says nothing",
    );
    assert.equal(senderSide(OWNER_B.toUpperCase().replace("0X", "0x"), owners), 1);
    assert.equal(senderSide(addr("ee"), owners), null);
    const stale = Game.parse(game({ units: [A_MOVED, PLACED_B], turn: 59 }));
    assert.deepEqual(
        storyOutcome(stale, { calls: [CALLS.nextTurn], sender: OWNER_A }, owners, SIDES),
        {
            kind: "stalemate",
            winner: null,
            reason: "Turn limit reached",
        },
    );
});

// === Following a live game ===

function liveReads(
    sequence: (ChainGame | null | Error)[],
    gone: ReturnType<LiveReads["vanished"]> = Promise.resolve(null),
) {
    const waits: (() => void)[] = [];
    const reads: LiveReads = {
        read: async () => {
            const next = sequence.length > 1 ? sequence.shift()! : sequence[0];
            if (next instanceof Error) throw next;
            return next;
        },
        vanished: () => gone,
        outcome: (last, endTx) => storyOutcome(last, endTx, [OWNER_A, OWNER_B], SIDES),
        wait: () => new Promise<void>((resolve) => waits.push(resolve)),
    };
    /** Let one poll run: the wait it is in ends, and its read settles. */
    const tick = async () => {
        waits.shift()?.();
        for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    return { reads, tick };
}

const startedAt = (v: string) => {
    const first = parse("3");
    const start = watchStart(blackRain, first, new Map());
    return { start, sides: SIDES, feed: new EventFeed(start, first, blank), current: parse(v) };
};

test("live: events past the cursor as the history grows, a failed read tried again, the clock, the end seen Over", async () => {
    const { reads, tick } = liveReads([
        parse("4"),
        new Error("network"),
        parse("5"),
        parse("5"),
        parse("6"),
    ]);
    const source = liveSource(startedAt("4"), reads);
    assert.deepEqual(
        kinds(source.events()),
        ["move", "shot:4", "hostile-phase"],
        "joined mid-match: the past is there to rewind",
    );
    assert.equal(source.ended(), false);
    assert.equal(source.deadline(), 1_000 + 90_000);
    let told = 0;
    const off = source.subscribe(() => told++);
    await tick(); // 4 again: nothing new
    assert.equal(told, 0);
    await tick(); // a failed read
    await tick(); // 5
    assert.deepEqual(kinds(source.events()).slice(3), ["shot:miss", "turn"]);
    assert.equal(told, 1);
    await tick(); // 5 again
    assert.equal(told, 1, "a read with nothing new tells nobody");
    await tick(); // 6: over
    assert.equal(source.ended(), true);
    assert.deepEqual(source.outcome?.(), { kind: "won", winner: 0, reason: "by elimination" });
    assert.equal(source.events().at(-1)?.type, "shot");
    assert.equal(source.deadline(), undefined);
    assert.equal(told, 2);
    off();
});

test("live: a game gone between two reads ends with its last version's records and the deleting transaction's ending", async () => {
    const vanished = Promise.resolve({
        last: parse("5"),
        tx: tx({ calls: [CALLS.abandon, CALLS.complete], before: "5", sender: OWNER_A }),
    });
    const { reads, tick } = liveReads([parse("4"), null], vanished);
    const source = liveSource(startedAt("4"), reads);
    source.subscribe(() => {});
    await tick();
    await tick();
    assert.equal(source.ended(), true);
    assert.deepEqual(
        kinds(source.events()).slice(3),
        ["shot:miss", "turn"],
        "the records the last poll missed",
    );
    assert.deepEqual(source.outcome?.(), {
        kind: "abandoned",
        winner: 1,
        reason: "Alpha left the match",
    });
});

test("live: a game gone with nothing left to read still ends, plainly", async () => {
    const { reads, tick } = liveReads([null]);
    const source = liveSource(startedAt("4"), reads);
    source.subscribe(() => {});
    await tick();
    assert.equal(source.ended(), true);
    assert.deepEqual(source.outcome?.(), { winner: null, reason: "The ending was not recorded" });
});

test("live: nobody reads while nobody follows, and a game already over opens ended", async () => {
    let read = 0;
    const { reads, tick } = liveReads([parse("4")]);
    const counting = { ...reads, read: () => (read++, reads.read()) };
    const source = liveSource(startedAt("4"), counting);
    await tick();
    assert.equal(read, 0, "no subscriber, no reads");
    const off = source.subscribe(() => {});
    await tick();
    assert.equal(read, 1);
    off();
    await tick();
    await tick();
    assert.equal(read, 1, "let go: the reads stop");

    const over = liveSource(startedAt("6"), liveReads([parse("6")]).reads);
    assert.equal(over.ended(), true);
    assert.deepEqual(over.outcome?.(), { kind: "won", winner: 0, reason: "by elimination" });
});

// === The archive: fullnode first, GraphQL past its window ===

test("archive: the fullnode's answer when it has the whole game, GraphQL when it starts mid-way or fails", async () => {
    const whole = fakeArchive(TXS);
    const partial = fakeArchive(TXS.slice(3));
    const failing: GameArchive = {
        transactions: async () => {
            throw new Error("out of range");
        },
        objectAt: async () => {
            throw new Error("out of range");
        },
        finished: async () => {
            throw new Error("out of range");
        },
    };
    assert.equal((await archive(whole, failing).transactions(GAME))?.length, TXS.length);
    assert.equal(
        (await archive(partial, whole).transactions(GAME))?.length,
        TXS.length,
        "a list that misses the creation",
    );
    assert.equal((await archive(failing, whole).transactions(GAME))?.length, TXS.length);
    assert.ok(
        await archive(fakeArchive(TXS, {}), whole).objectAt(GAME, "3"),
        "a version the node no longer has",
    );
    assert.equal(await archive(failing, failing).objectAt(GAME, "3"), null);
    assert.deepEqual(await archive(failing, whole).finished(A, 5), []);
});

test("archive: a gRPC transaction as the game sees it: versions, own calls only, recruit entries", () => {
    const recruitType = `0x2::dynamic_field::Field<0x2::object::ID, ${GHOSTS.package}::recruit::Recruit>`;
    const deploy = grpcGameTx(
        {
            digest: "D",
            timestamp: { seconds: 10n, nanos: 5_000_000 },
            transaction: {
                sender: OWNER_A,
                kind: {
                    data: {
                        oneofKind: "programmableTransaction",
                        programmableTransaction: {
                            commands: [
                                { command: { oneofKind: "makeMoveVector" } },
                                {
                                    command: {
                                        oneofKind: "moveCall",
                                        moveCall: {
                                            package: GHOSTS.package,
                                            module: "ghosts",
                                            function: CALLS.deploy,
                                        },
                                    },
                                },
                                {
                                    command: {
                                        oneofKind: "moveCall",
                                        moveCall: {
                                            package: "0x2",
                                            module: "coin",
                                            function: "split",
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            },
            effects: {
                changedObjects: [
                    { objectId: GAME, objectType: GAME_TYPE, inputVersion: 7n, outputVersion: 9n },
                    { objectId: addr("f1"), objectType: recruitType, outputVersion: 9n },
                ],
            },
        },
        GAME,
    );
    assert.deepEqual(deploy, {
        digest: "D",
        timestampMs: 10_005,
        sender: OWNER_A,
        calls: [CALLS.deploy],
        before: "7",
        after: "9",
        recruits: [{ id: addr("f1"), version: "9" }],
    });
    const created = grpcGameTx(
        { effects: { changedObjects: [{ objectId: GAME, outputVersion: 1n }] } },
        GAME,
    );
    assert.equal(created.before, undefined);
    const deleted = grpcGameTx(
        { effects: { changedObjects: [{ objectId: GAME, inputVersion: 9n }] } },
        GAME,
    );
    assert.equal(deleted.after, undefined);
    assert.ok(isRecruitEntry(recruitType));
    assert.ok(
        !isRecruitEntry(
            `0x2::dynamic_field::Field<0x2::object::ID, ${GHOSTS.package}::lobby::Lobby>`,
        ),
    );
});

test("archive: a GraphQL transaction reads the same", () => {
    const repr = `0x2::dynamic_field::Field<0x2::object::ID,${GHOSTS.package}::recruit::Recruit>`;
    const graph = graphGameTx(
        {
            digest: "D",
            sender: { address: OWNER_B },
            effects: {
                timestamp: "2026-11-20T17:06:37.658Z",
                objectChanges: {
                    nodes: [
                        {
                            address: GAME,
                            idCreated: false,
                            idDeleted: false,
                            inputState: { version: 7 },
                            outputState: { version: 9 },
                        },
                        {
                            address: addr("f2"),
                            idCreated: true,
                            outputState: {
                                version: 9,
                                asMoveObject: { contents: { type: { repr } } },
                            },
                        },
                    ],
                },
            },
            kind: {
                commands: {
                    nodes: [
                        null,
                        {
                            function: {
                                name: CALLS.deploy,
                                module: { name: "ghosts", package: { address: GHOSTS.package } },
                            },
                        },
                        {
                            function: {
                                name: CALLS.deploy,
                                module: { name: "ghosts", package: { address: addr("dd") } },
                            },
                        },
                    ],
                },
            },
        },
        GAME,
    );
    assert.deepEqual(graph, {
        digest: "D",
        timestampMs: Date.parse("2026-11-20T17:06:37.658Z"),
        sender: OWNER_B,
        calls: [CALLS.deploy],
        before: "7",
        after: "9",
        recruits: [{ id: addr("f2"), version: "9" }],
    });
});

// === The live list ===

test("the live list drops games that are over, deserted at the table, or past their deploy deadline", () => {
    const at = (bytes: Uint8Array) => Game.parse(bytes);
    const playing = at(game({ units: [PLACED_A, PLACED_B] }));
    assert.equal(offTheList(playing, 1_000 + 60_000), false);
    assert.equal(
        offTheList(playing, 1_000 + 3 * 90_000 + 1),
        true,
        "nobody has moved for three turns' clocks",
    );
    assert.equal(offTheList(parse("6"), 0), true, "over, waiting to be wrapped up");
    assert.equal(offTheList(parse("2"), 5_000 + 1_000), false);
    assert.equal(offTheList(parse("2"), 5_000 + 90_001), true);
});

test("a friendly game from an invite code is not listed; queue games and listed-lobby games are", () => {
    assert.equal(listedBy([CALLS.findGame]), true);
    assert.equal(listedBy([CALLS.findRanked]), true);
    assert.equal(listedBy(["move_unit", CALLS.nextTurn]), false, "creates nothing");
    assert.equal(listedBy([CALLS.startListed]), true);
    assert.equal(listedBy([CALLS.joinProtected]), false);
    assert.equal(listedBy([]), false, "unknown: kept off the list");
});

test("a live row: both players with ratings, the mode, the turn a player sees and whose it is", () => {
    const friendly = Game.parse(
        game({ units: [PLACED_A, PLACED_B], turn: 5, mode: { Friendly: { size: 3 } } }),
    );
    const row = liveRow(GAME, friendly, [
        { name: "Alpha", rating: 1512 },
        { name: "Bravo", rating: null },
    ]);
    assert.deepEqual(row, {
        id: GAME,
        name: "Alpha vs Bravo",
        kind: "Friendly 3x3 · Turn 02 · Bravo to move",
        hint: "Alpha rating 1512 · Bravo, no rating",
        tag: "Live",
    });
    assert.equal(roundOf({ turn: 0 }), 0);
    assert.equal(modeText(parse("3")), "Contract");
    assert.equal(
        liveRow(
            GAME,
            parse("2"),
            [SIDES[0], SIDES[1]].map((s) => ({ ...s, rating: 1500 })) as never,
        ).tag,
        "Starting",
    );
});

test("a finished game's result, for the player who asks", () => {
    assert.equal(resultFor({ $kind: "Won", Won: A }, [A, B], 0), "Won");
    assert.equal(resultFor({ $kind: "Won", Won: A }, [A, B], 1), "Lost");
    assert.equal(resultFor({ $kind: "Abandoned", Abandoned: A }, [A, B], 0), "Left");
    assert.equal(resultFor({ $kind: "Abandoned", Abandoned: A }, [A, B], 1), "Won");
    assert.equal(resultFor({ $kind: "Forfeited", Forfeited: B }, [A, B], 1), "Forfeited");
    assert.equal(resultFor({ $kind: "Stalemate", Stalemate: true }, [A, B], 1), "Draw");
    assert.equal(resultFor({ $kind: "NoShow", NoShow: B }, [A, B], 1), "No show");
    assert.equal(resultFor(null, [A, B], 0), "Ended");
});

test("a link opens live while the game exists, else its replay; only a game id is a game", () => {
    assert.equal(openingOf(parse("4")), "live");
    assert.equal(openingOf(parse("6")), "live", "over but not wrapped up: still there");
    assert.equal(openingOf(null), "replay");
    assert.ok(isGameId(GAME));
    assert.ok(!isGameId("local"));
    assert.ok(!isGameId("0x12"));
    assert.ok(!isGameId(undefined));
});

// === The ground a blast leaves: the chain's obstacle tiles, as the viewer shows them ===

/** `blackRain`'s tiles in the chain's grid (14 rows by 18 columns): its cover props, `Obstacle` tiles. */
const COVER_TILES: [number, number][] = [
    [2, 12],
    [3, 9],
    [4, 5],
    [6, 13],
    [6, 14],
    [9, 6],
    [9, 7],
    [9, 11],
    [9, 12],
    [11, 3],
];
const BOUNDS = blackRain.map.bounds;
const cellKey = (cell: readonly number[]) => cell.join(",");
const tileCell = (tile: number[]) => toCell(tile, BOUNDS);

/** The obstacle tiles left once the blasts at `centers` (radius 2) have gone off: `Map.explode`. */
function coverAfter(centers: [number, number][]) {
    return COVER_TILES.filter(
        ([row, col]) => !centers.some(([r, c]) => Math.abs(row - r) + Math.abs(col - c) <= 2),
    );
}

/** A game on `blackRain`'s grid with the obstacles `covers` left, side 0's unit at `a`, side 1's far off. */
function field({
    covers,
    a,
    history,
    turn = 0,
    stats = 0n,
}: {
    covers: [number, number][];
    a: [number, number];
    history: unknown[];
    turn?: number;
    stats?: bigint;
}): ChainGame {
    const b: [number, number] = [13, 17];
    const grid = Array.from({ length: 14 }, (_, row) =>
        Array.from({ length: 18 }, (_, col) => {
            const at = (p: [number, number]) => p[0] === row && p[1] === col;
            const unit = at(a)
                ? { ...mapUnit(R1, A), stats: { value: stats } }
                : at(b)
                  ? mapUnit(R2, B)
                  : null;
            const cover = covers.some(at);
            return {
                tileType: cover ? { Obstacle: true } : { Empty: true },
                unit,
            };
        }),
    );
    return Game.parse(
        Game.serialize({
            id: GAME,
            map: { id: addr("3a"), grid: { grid, rows: 14, cols: 18 }, fallen: [], units: [] },
            players: [A, B],
            state: { Playing: { startedMs: 1_000n, missed: [0, 0] } },
            turn,
            positions: [[], []],
            history,
            recruits: { id: TABLE, size: 2n },
            mode: { Stakes: true },
        } as never).toBytes(),
    );
}

const UP = 1;
const blastAt = (origin: number[], target: number[], radius = 2) => [
    { Grenade: { origin, target } },
    { Explosion: [target[0], target[1], radius] },
];
/**
 * A game's records: A vaults the obstacle at (9,6), from (10,6) to (8,6), a frag lands
 * at (9,10) (taking the obstacles at (9,11) and (9,12), the second two tiles off), A
 * vaults back, a frag lands at (9,7) (taking (9,6) and (9,7)), A crosses the same tile
 * again, now open ground.
 */
const BLASTS = {
    placed: [{ RecruitPlaced: [10, 6] }, { RecruitPlaced: [13, 17] }],
    run: [{ Move: [10, 6, UP, UP] }],
    first: blastAt([8, 6], [9, 10]),
    back: [{ Move: [8, 6, DOWN, DOWN] }],
    second: blastAt([10, 6], [9, 7]),
    again: [{ Move: [10, 6, UP, UP] }],
};
const turnOver = (n: number) => [{ NextTurn: n }, { NextTurn: n + 1 }];
const RUN = [
    ...BLASTS.placed,
    ...BLASTS.run, // 0 move
    ...turnOver(1), // 1 hostile-phase, 2 turn
    ...BLASTS.first, // 3 grenade
    ...turnOver(3), // 4, 5
    ...BLASTS.back, // 6 move
    ...BLASTS.second, // 7 grenade
    ...turnOver(5), // 8, 9
    ...BLASTS.again, // 10 move
];
/** After how many events each blast has gone off. */
const AFTER_FIRST = 4;
const AFTER_SECOND = 8;
const BLAST_CENTERS: [number, number][] = [
    [9, 10],
    [9, 7],
];
const COUNT = 11;

/** The chain's cover after the first `n` events, by the rule that decides it. */
const chainCover = (n: number) =>
    coverAfter(BLAST_CENTERS.slice(0, +(n >= AFTER_FIRST) + +(n >= AFTER_SECOND)));

test("blasts take the cover the chain takes, tile by tile, at every point of the replay and either way round", () => {
    const first = field({ covers: COVER_TILES, a: [10, 6], history: BLASTS.placed });
    const last = field({
        covers: chainCover(COUNT),
        a: [8, 6],
        history: RUN,
        turn: 6,
    });
    const start = watchStart(blackRain, first, new Map());
    const feed = new EventFeed(start, first, blank);
    assert.equal(feed.take(last), COUNT);
    assert.deepEqual(
        feed.events.map((e) => e.type),
        [
            "move",
            "hostile-phase",
            "turn",
            "grenade",
            "hostile-phase",
            "turn",
            "move",
            "grenade",
            "hostile-phase",
            "turn",
            "move",
        ],
    );
    // the vault is the obstacle there was when the unit moved, not what the last version holds
    assert.deepEqual(
        [0, 6, 10].map((i) => (feed.events[i] as Extract<GameEvent, { type: "move" }>).vault),
        [true, true, false],
    );

    const covers = (n: number) => {
        const rules = rebuildEncounter(start.scenario, feed.events, n, start.prepare);
        return rules.map.covers.map(cellKey).sort();
    };
    const expected = (n: number) =>
        chainCover(n)
            .map((t) => cellKey(tileCell(t)))
            .sort();
    // forward, back to the start, then in no order: the same cover for the same cursor
    const order = [
        ...Array.from({ length: COUNT + 1 }, (_, i) => i),
        ...Array.from({ length: COUNT + 1 }, (_, i) => COUNT - i),
        5,
        2,
        11,
        4,
        3,
        8,
        7,
        0,
        9,
    ];
    for (const n of order) assert.deepEqual(covers(n), expected(n), `cover after ${n} events`);
    assert.notDeepEqual(covers(AFTER_FIRST - 1), covers(AFTER_FIRST), "the first blast took cover");
    assert.equal(covers(AFTER_FIRST).length, COVER_TILES.length - 2);
    assert.equal(covers(COUNT).length, COVER_TILES.length - 4);

    // the rules' view of every tile, against the chain's own map at that point
    for (const n of [0, AFTER_FIRST - 1, AFTER_FIRST, AFTER_SECOND, COUNT]) {
        const rules = rebuildEncounter(start.scenario, feed.events, n, start.prepare);
        const chain = field({ covers: chainCover(n), a: [9, 4], history: [] });
        for (const tile of COVER_TILES)
            assert.equal(
                rules.map.isCover(tileCell(tile)),
                terrainAt(chain, tile) === "obstacle",
                `tile ${tile} after ${n} events`,
            );
    }
});

test("an area weapon takes cover only when its stats break the ground", () => {
    const history = [
        ...BLASTS.placed,
        { Attack: { origin: [9, 4], target: [9, 10] } },
        { Explosion: [9, 10, 2] },
    ];
    for (const [envDamage, gone] of [
        [0, 0],
        [1, 2],
    ]) {
        const packed = pack(stats({ areaSize: 2, envDamage }));
        const first = field({
            covers: COVER_TILES,
            a: [9, 4],
            history: BLASTS.placed,
            stats: packed,
        });
        const last = field({
            covers: coverAfter(gone ? [[9, 10]] : []),
            a: [9, 4],
            history,
            stats: packed,
        });
        const start = watchStart(blackRain, first, new Map());
        const feed = new EventFeed(start, first, blank);
        assert.equal(feed.take(last), 1);
        const rules = rebuildEncounter(start.scenario, feed.events, 1, start.prepare);
        assert.equal(rules.map.covers.length, COVER_TILES.length - gone, `env_damage ${envDamage}`);
    }
});

test("joining a game under way shows the cover it has left, then follows the blasts that come", () => {
    // seen from the second blast on: the first is in the history, its cover already gone
    const joined = field({
        covers: chainCover(AFTER_FIRST),
        a: [8, 6],
        history: RUN.slice(0, RUN.indexOf(BLASTS.back[0]) + 0),
        turn: 4,
    });
    assert.ok(joined.history.some((r) => r.$kind === "Explosion"));
    const start = watchStart(blackRain, joined, new Map());
    const opening = blank(start.scenario);
    start.prepare(opening);
    assert.deepEqual(
        opening.map.covers.map(cellKey).sort(),
        chainCover(AFTER_FIRST)
            .map((t) => cellKey(tileCell(t)))
            .sort(),
        "what the chain has now",
    );
    for (const tile of COVER_TILES)
        assert.equal(opening.map.isCover(tileCell(tile)), terrainAt(joined, tile) === "obstacle");

    // the game goes on: the next blast takes its own, and a rewind to the opening gives the join back
    const later = field({ covers: chainCover(COUNT), a: [8, 6], history: RUN, turn: 6 });
    const feed = new EventFeed(start, joined, blank);
    assert.ok(feed.take(later) > 0);
    const end = rebuildEncounter(start.scenario, feed.events, feed.events.length, start.prepare);
    assert.deepEqual(
        end.map.covers.map(cellKey).sort(),
        chainCover(COUNT)
            .map((t) => cellKey(tileCell(t)))
            .sort(),
    );
    const rewound = rebuildEncounter(start.scenario, feed.events, 0, start.prepare);
    assert.deepEqual(
        rewound.map.covers.map(cellKey).sort(),
        opening.map.covers.map(cellKey).sort(),
    );
});

// === The ending on every surface ===

test("one phrase per ending across the card, the banner and the list rows", () => {
    const players = [A, B];
    const endings = [
        { $kind: "Won", Won: B },
        { $kind: "Draw", Draw: true },
        { $kind: "Stalemate", Stalemate: true },
        { $kind: "Abandoned", Abandoned: A },
        { $kind: "Forfeited", Forfeited: A },
        { $kind: "NoShow", NoShow: B },
        { $kind: "NobodyShowed", NobodyShowed: true },
    ] as const;
    const names = ["Alpha", "Bravo"] as const;
    for (const ending of endings) {
        const outcome = watchOutcome(ending, players, SIDES)!;
        const list = endingText(ending, players, names);
        const end = banner({ finished: true, outcome, turns: [] }, SIDES)!;
        assert.equal(end.title, list.tag, `${ending.$kind}: banner title is the row's tag`);
        assert.equal(end.reason, list.line, `${ending.$kind}: banner reason is the row's line`);
        const card = matchCard({
            live: false,
            sides: SIDES,
            turns: [],
            outcome,
            over: true,
            now: 0,
        });
        assert.equal(
            card.facts.find(([label]) => label === "Result")![1],
            resultText(outcome, SIDES),
        );
        assert.equal(resultText(outcome, SIDES), `${list.tag} \u00b7 ${list.line}`);
        const row = recentRow(
            { gameId: GAME, players: [A, B], mode: { $kind: "Contract" } as never, ending },
            names,
            undefined,
            0,
        );
        assert.match(row.kind, new RegExp(`${list.tag} \u00b7 ${list.line}$`), "the Recent row");
        assert.doesNotMatch(`${list.tag}${list.line}`, /\.$/, "no trailing full stop");
    }
    // the match from the report: the winner's name and the cause in one row
    const forfeit = recentRow(
        { gameId: GAME, players: [A, B], mode: { $kind: "Contract" } as never, ending: endings[4] },
        ["ai-pia", "ai-wanda"],
        undefined,
        0,
    );
    assert.match(forfeit.kind, /ai-wanda won \u00b7 ai-pia missed 3 turns in a row$/);
});

test("a forfeit's missed turns, counted as the chain counts them", () => {
    const [a, b] = [OWNER_A, OWNER_B];
    const tx = (sender: string, ...calls: string[]) => ({ sender, calls });
    const act = "perform_attack";
    // turn 0 is A's: A acts and ends it, B acts and ends its own, then A acts in turn 2 but B calls
    // the clock (miss 1), B takes turn 3, A does nothing in turn 4 (miss 2), B plays turn 5, and
    // turn 6, A's, is called a third time: the forfeit, which adds no turn of its own
    const later = [
        tx(a, act, act),
        tx(a, CALLS.nextTurn),
        tx(b, act),
        tx(b, CALLS.nextTurn),
        tx(a, act),
        tx(b, CALLS.nextTurn),
        tx(b, act),
        tx(b, CALLS.nextTurn),
        tx(b, CALLS.nextTurn),
        tx(b, act),
        tx(b, CALLS.nextTurn),
        tx(b, CALLS.nextTurn, CALLS.complete),
    ];
    assert.deepEqual(missedByTurn(later, [a, b], 0), [0, 0, 1, 0, 2, 0, 3]);
    assert.deepEqual(
        missedByTurn(later.slice(0, 6), [a, b], 0),
        [0, 0, 1],
        "only the turns that have ended so far",
    );
    // the other side to open: the same calls read the other way round
    assert.deepEqual(missedByTurn([tx(a, CALLS.nextTurn)], [a, b], 1), [1]);
    assert.deepEqual(missedByTurn([tx(a, CALLS.nextTurn)], [a, b], 0), [0]);
    assert.deepEqual(missedByTurn([tx(a, CALLS.nextTurn)], [null, null], 0), [1], "owners unknown");
});
