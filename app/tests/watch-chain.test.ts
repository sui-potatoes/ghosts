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
import {
    isGameId,
    listedBy,
    liveRow,
    modeText,
    offTheList,
    openingOf,
    resultFor,
    roundOf,
} from "../src/features/watch/chain/list.ts";
import { liveSource, type LiveReads } from "../src/features/watch/chain/live.ts";
import {
    EventFeed,
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
        winner: 0,
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
    assert.equal(one.turn, 0, "a chain game opens on turn 0, as its players see it");
    assert.equal(one.phase, "player", "the first player opens");
});

test("looks dress the other side's units; the first side is dressed by the squad the field is given", () => {
    const looks = new Map([[R2, { armor: "nyx-heavy" }]]);
    const start = watchStart(blackRain, parse("3"), new Map(), looks);
    assert.deepEqual(start.scenario.units.find((u) => u.id === R2)?.look, { armor: "nyx-heavy" });
    assert.equal(start.scenario.units.find((u) => u.id === R1)?.look, undefined);
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
        winner: 0,
        reason: "Bravo did not deploy a squad",
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
    assert.equal(live.first, now, "no history to rewind into: the game as it stands");
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
    assert.deepEqual(watchOutcome({ $kind: "Won", Won: B }, players, SIDES), { winner: 1 });
    assert.deepEqual(watchOutcome({ $kind: "Abandoned", Abandoned: A }, players, SIDES), {
        winner: 1,
        reason: "Alpha left the match",
    });
    assert.deepEqual(watchOutcome({ $kind: "Forfeited", Forfeited: B }, players, SIDES), {
        winner: 0,
        reason: "Bravo missed 3 turns in a row",
    });
    assert.deepEqual(watchOutcome({ $kind: "NoShow", NoShow: A }, players, SIDES), {
        winner: 1,
        reason: "Alpha did not deploy a squad",
    });
    assert.deepEqual(watchOutcome({ $kind: "NobodyShowed", NobodyShowed: true }, players, SIDES), {
        winner: null,
        reason: "Neither side deployed a squad",
    });
    assert.equal(
        watchOutcome({ $kind: "Stalemate", Stalemate: true }, players, SIDES)?.winner,
        null,
    );
    assert.equal(watchOutcome({ $kind: "Draw", Draw: true }, players, SIDES)?.reason, "Draw");
    assert.equal(watchOutcome(null, players, SIDES), null);
});

test("a game deleted in the transaction that ended it: the calls and the sender say how", () => {
    const owners = [OWNER_A, OWNER_B];
    const playing = parse("5");
    const end = (calls: string[], sender: string) =>
        storyOutcome(playing, { calls, sender }, owners, SIDES);
    assert.deepEqual(end([CALLS.abandon, CALLS.complete], OWNER_B), {
        winner: 0,
        reason: "Bravo left the match",
    });
    // turn 2 is the first player's: their clock ran out three times
    assert.deepEqual(end([CALLS.nextTurn, CALLS.complete], OWNER_B), {
        winner: 1,
        reason: "Alpha missed 3 turns in a row",
    });
    assert.deepEqual(end(["perform_attack", CALLS.complete], OWNER_A), { winner: 0 });
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
            winner: null,
            reason: "No winner by the turn limit",
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
        "joined mid-game: the past is there to rewind",
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
    assert.deepEqual(source.outcome?.(), { winner: 0 });
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
    assert.deepEqual(source.outcome?.(), { winner: 1, reason: "Alpha left the match" });
});

test("live: a game gone with nothing left to read still ends, plainly", async () => {
    const { reads, tick } = liveReads([null]);
    const source = liveSource(startedAt("4"), reads);
    source.subscribe(() => {});
    await tick();
    assert.equal(source.ended(), true);
    assert.deepEqual(source.outcome?.(), { winner: null, reason: "The match ended" });
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
    assert.deepEqual(over.outcome?.(), { winner: 0 });
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
