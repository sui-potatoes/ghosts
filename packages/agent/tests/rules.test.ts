// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeGame,
    decodeStats,
    decodeTiles,
    encodeStats,
    GameBcs,
    gridSize,
    MapBcs,
} from "../src/bcs.ts";
import { BLACK_RAIN, BLACK_RAIN_POSITIONS, DEMO_1, DEMO_2 } from "../src/maps.ts";
import {
    checkPath,
    coverBonus,
    DOWN,
    hitChance,
    LEFT,
    legalActions,
    lineOfSight,
    manhattan,
    parseAction,
    actionId,
    refusal,
    RIGHT,
    UP,
    validateBatch,
} from "../src/rules.ts";
import { ActionError, type GameState, type Stats, type Tile } from "../src/types.ts";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

function board(hex: string): GameState {
    const map = MapBcs.parse(bytes(hex));
    return {
        id: "0x1",
        version: "1",
        ...gridSize(map),
        turn: 0,
        active: 0,
        players: ["0xa", "0xb"],
        squads: [["0x11"], ["0x22"]],
        fallen: [0, 0],
        positions: [[], []],
        history: [],
        missed: [0, 0],
        abandonedBy: null,
        deadlineMs: 1000,
        status: { kind: "active" },
        tiles: decodeTiles(map),
        units: [],
    };
}

const OPERATIVE: Stats = decodeStats(
    (7n | (65n << 8n) | (10n << 16n)) + (0x030400000100000204n << 48n),
);

function open(rows: number, cols: number): GameState {
    const tiles: Tile[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, (): Tile => ({ kind: "empty" })),
    );
    return { ...board(DEMO_1), rows, cols, tiles };
}

function place(state: GameState, side: number, x: number, y: number, ap = 2) {
    state.units.push({
        recruit: `0x${side}${x}${y}`,
        side,
        x,
        y,
        ap,
        apMax: 2,
        hp: 10,
        hpMax: 10,
        ammo: 3,
        ammoMax: 3,
        grenadeUsed: false,
        stats: OPERATIVE,
    });
}

test("real Move map bytes decode to the documented maps", () => {
    const one = board(DEMO_1);
    assert.deepEqual([one.rows, one.cols], [7, 7]);
    // From the schema in map.move: tile (0, 2) is `2002-`, (1, 0) is `XXX`.
    assert.deepEqual(one.tiles[0][2], { kind: "cover", left: 2, top: 0, right: 0, bottom: 2 });
    assert.equal(one.tiles[1][0].kind, "unwalkable");
    const two = board(DEMO_2);
    assert.deepEqual([two.rows, two.cols], [10, 10]);
});

test("the match preset decodes, and its spawn positions stand on walkable tiles", () => {
    const map = board(BLACK_RAIN);
    assert.deepEqual([map.rows, map.cols], [14, 18]);
    assert.equal(BLACK_RAIN_POSITIONS.length, 6, "three recruits a side");
    for (const [x, y] of BLACK_RAIN_POSITIONS) {
        const { kind } = map.tiles[x][y];
        assert.ok(kind === "empty" || kind === "cover", `(${x}, ${y}) is ${kind}`);
    }
});

test("check_path agrees with the Move test fixtures", () => {
    const map = board(DEMO_1);
    // tests/map/map_tests.move, `demo_maps`.
    assert.ok(checkPath(map, 1, 6, [DOWN, DOWN, LEFT]));
    assert.equal(checkPath(map, 0, 0, [RIGHT, RIGHT]), null);
    assert.ok(checkPath(map, 6, 5, [UP]));
    assert.equal(checkPath(map, 0, 0, [DOWN]), null);
    assert.equal(checkPath(map, 0, 3, [LEFT, DOWN]), null);
    // tests/bench_test.move, `do_move`: ends on the documented firing lane.
    assert.deepEqual(checkPath(map, 6, 5, [UP, UP, LEFT, LEFT, LEFT, LEFT, UP]), [3, 1]);
});

test("the demo's documented firing lane has a line of sight", () => {
    const map = board(DEMO_1);
    assert.ok(lineOfSight(map, 3, 1, 0, 3));
});

test("line of sight is symmetric on every pair of a real map", () => {
    const map = board(DEMO_2);
    const open = (x: number, y: number) => map.tiles[x][y].kind !== "wall";
    for (let x0 = 0; x0 < map.rows; x0++) {
        for (let y0 = 0; y0 < map.cols; y0++) {
            for (let x1 = 0; x1 < map.rows; x1++) {
                for (let y1 = 0; y1 < map.cols; y1++) {
                    if (!open(x0, y0) || !open(x1, y1)) continue;
                    assert.equal(
                        lineOfSight(map, x0, y0, x1, y1),
                        lineOfSight(map, x1, y1, x0, y0),
                        `(${x0},${y0}) <-> (${x1},${y1})`,
                    );
                }
            }
        }
    }
});

test("stats unpack in Move's order", () => {
    // `stats::default()` plus `stats::default_weapon()`.
    assert.equal(OPERATIVE.mobility, 7);
    assert.equal(OPERATIVE.aim, 65);
    assert.equal(OPERATIVE.health, 10);
    assert.equal(OPERATIVE.damage, 4);
    assert.equal(OPERATIVE.spread, 2);
    assert.equal(OPERATIVE.canBeDodged, 1);
    assert.equal(OPERATIVE.range, 4);
    assert.equal(OPERATIVE.ammo, 3);
    assert.deepEqual(decodeStats(encodeStats(OPERATIVE)), OPERATIVE);
});

test("hit chance follows unit::perform_attack", () => {
    assert.equal(hitChance(OPERATIVE, 4, 0), 65);
    assert.equal(hitChance(OPERATIVE, 2, 0), 75); // +5 per tile inside range
    assert.equal(hitChance(OPERATIVE, 7, 0), 35); // -10 per tile past range
    assert.equal(hitChance(OPERATIVE, 4, 25), 40);
    assert.equal(hitChance(OPERATIVE, 4, 100), 0);
    assert.equal(hitChance({ ...OPERATIVE, aim: 99 }, 0, 0), 100);
});

test("cover counts on the side facing the shooter only", () => {
    const state = open(5, 5);
    state.tiles[2][2] = { kind: "cover", left: 0, top: 1, right: 2, bottom: 0 };
    assert.equal(coverBonus(state, 0, 2, 2, 2), 25); // from above: top, low
    assert.equal(coverBonus(state, 2, 4, 2, 2), 50); // from the right: right, high
    assert.equal(coverBonus(state, 4, 2, 2, 2), 0); // from below: bottom, none
    assert.equal(coverBonus(state, 0, 4, 2, 2), 50); // diagonal: the better of top and right
    // Cover on the neighboring tile protects too.
    state.tiles[3][3] = { kind: "cover", left: 0, top: 1, right: 0, bottom: 0 };
    assert.equal(coverBonus(state, 4, 3, 2, 3), 25);
});

test("a game object round-trips through BCS and normalizes stale AP", () => {
    const map = MapBcs.parse(bytes(DEMO_1));
    const recruit = `0x${"11".repeat(32)}`;
    map.grid.grid[6][5].unit = {
        recruit,
        ap: { value: 0, maxValue: 2 },
        hp: { value: 7, maxValue: 10 },
        ammo: { value: 1, maxValue: 3 },
        grenadeUsed: true,
        stats: encodeStats(OPERATIVE).toString(),
        lastTurn: 2,
    };
    map.turn = 3;
    const [first, second] = [`0x${"0a".repeat(32)}`, `0x${"0b".repeat(32)}`];
    const tag = {
        id: `0x${"03".repeat(32)}`,
        rank: { Corporal: true },
        metadata: {
            name: "Jane Doe",
            visuals: { head: 1, face: 2, eyes: 3, body: 4, outfit: 5 },
            voice: 1,
        },
    };
    const encode = (overrides: object) =>
        GameBcs.serialize({
            id: `0x${"01".repeat(32)}`,
            map,
            players: [first, second],
            squads: [[recruit], [`0x${"22".repeat(32)}`]],
            // A dog tag sits ahead of the fields below, so reading them proves its layout.
            fallen: [[tag], []],
            positions: [[[8, 2]], []],
            history: [{ Miss: true }, { Damage: 3 }, { NextTurn: 3 }],
            recruits: { id: `0x${"02".repeat(32)}`, size: 1n },
            deploying: false,
            deployUntilMs: 2000n,
            turnStartedMs: 5000n,
            missed: [2, 0],
            abandonedBy: null,
            ...overrides,
        }).toBytes();

    const game = decodeGame(encode({}), "42");
    assert.equal(game.version, "42");
    assert.equal(game.turn, 3);
    assert.equal(game.active, 1, "the turn decides who acts");
    assert.equal(game.deadlineMs, 95_000, "a turn lasts 90s from when it started");
    assert.deepEqual(game.status, { kind: "active" });
    assert.deepEqual(game.positions, [[[8, 2]], []]);
    assert.deepEqual(game.missed, [2, 0]);
    assert.deepEqual(game.fallen, [1, 0]);
    assert.deepEqual(
        game.history.map((r) => r.kind),
        ["miss", "damage", "next_turn"],
    );

    // The endings of `ghosts::winner`.
    const status = (overrides: object) => decodeGame(encode(overrides), "1").status;
    assert.deepEqual(status({ squads: [[recruit], []] }), { kind: "finished", winner: first });
    assert.deepEqual(status({ squads: [[], [recruit]] }), { kind: "finished", winner: second });
    assert.deepEqual(status({ squads: [[], []] }), { kind: "finished", winner: null });
    assert.deepEqual(status({ abandonedBy: first }), { kind: "finished", winner: second });
    assert.deepEqual(status({ abandonedBy: second }), { kind: "finished", winner: first });
    assert.deepEqual(status({ map: { ...map, turn: 59 } }), { kind: "active" });
    assert.deepEqual(status({ map: { ...map, turn: 60 } }), { kind: "finished", winner: null });

    const deploying = decodeGame(encode({ deploying: true, squads: [[], []] }), "1");
    assert.deepEqual(deploying.status, { kind: "deploying" }, "empty squads don't count yet");
    assert.equal(deploying.deadlineMs, 2000);

    const [unit] = game.units;
    assert.deepEqual([unit.x, unit.y, unit.side], [6, 5, 0]);
    assert.equal(unit.ap, 2, "AP resets lazily: a unit that last acted on an old turn has full AP");
    assert.equal(unit.hp, 7);
    assert.equal(unit.stats.aim, 65);
});

test("action ids round-trip", () => {
    for (const id of [
        "move:3,4:urdl",
        "reload:1,2",
        "attack:1,2:3,4",
        "grenade:0,0:5,0",
        "next_turn",
        "deploy",
        "complete",
        "abandon",
    ]) {
        assert.equal(actionId(parseAction(id)), id);
    }
    assert.throws(() => parseAction("transfer:all"), ActionError);
});

test("the clock decides who may act, as in `ghosts::next_turn`", () => {
    const state = open(8, 8);
    place(state, 0, 1, 1);
    place(state, 1, 4, 2);
    const nextTurn = { kind: "next_turn" } as const;
    const reload = { kind: "reload", x: 1, y: 1 } as const;
    state.units[0].ammo = 1;

    // Side 0 acts: it can always pass, and side 1 only once the clock has run out.
    assert.equal(refusal(state, 0, reload, 1000), null);
    assert.equal(refusal(state, 0, nextTurn, 1000), null);
    assert.match(refusal(state, 1, nextTurn, 1000)!, /still running/);
    assert.equal(refusal(state, 1, nextTurn, 1001), null);
    assert.match(refusal(state, 0, reload, 1001)!, /ran out of time/);
    assert.equal(refusal(state, 0, nextTurn, 1001), null);

    // Deployment: nobody can pass until it is over, and nobody can deploy after.
    const deploying: typeof state = {
        ...state,
        status: { kind: "deploying" },
        squads: [[], ["0x22"]],
        positions: [[[8, 2]], []],
    };
    assert.equal(refusal(deploying, 0, { kind: "deploy" }, 1000), null);
    assert.match(refusal(deploying, 1, { kind: "deploy" }, 1000)!, /already deployed/);
    assert.match(refusal(deploying, 0, nextTurn, 1000)!, /still deploying/);
    assert.match(refusal(deploying, 0, { kind: "deploy" }, 1001)!, /over/);
    assert.equal(refusal(deploying, 1, nextTurn, 1001), null);

    // Over: only wrapping up is left.
    const over: typeof state = { ...state, status: { kind: "finished", winner: "0xa" } };
    assert.equal(refusal(over, 1, { kind: "complete" }, 0), null);
    assert.match(refusal(over, 0, nextTurn, 0)!, /send complete/);
    assert.match(refusal(over, 0, { kind: "abandon" }, 0)!, /send complete/);
    assert.match(refusal(state, 0, { kind: "complete" }, 0)!, /not over/);
    assert.equal(refusal(state, 1, { kind: "abandon" }, 0), null);
});

test("every listed action passes validation, and each is listed once", () => {
    const state = open(8, 8);
    place(state, 0, 1, 1);
    place(state, 0, 1, 3);
    place(state, 1, 5, 5);
    const legal = legalActions(state, 0, 0);
    assert.equal(new Set(legal.map((a) => a.id)).size, legal.length);
    for (const { id } of legal) assert.deepEqual(validateBatch(state, 0, [id], 0).length, 1);
    assert.ok(legal.some((a) => a.kind === "attack"));
    assert.ok(legal.some((a) => a.kind === "grenade"));
});

test("a batch is checked against the state each order would find", () => {
    const state = open(8, 8);
    place(state, 0, 1, 1);
    place(state, 1, 4, 2);
    // Two moves use both AP, so a third order has none left.
    assert.equal(validateBatch(state, 0, ["move:1,1:d", "move:2,1:d"], 0).length, 2);
    assert.throws(
        () => validateBatch(state, 0, ["move:1,1:d", "move:2,1:d", "move:3,1:d"], 0),
        /AP/,
    );
    // The unit is no longer on its old tile after moving.
    assert.throws(() => validateBatch(state, 0, ["move:1,1:d", "reload:1,1"], 0), /No unit/);
    // A dice roll has to come last, and so does a turn's end.
    assert.throws(() => validateBatch(state, 0, ["attack:1,1:4,2", "move:1,1:d"], 0), /last/);
    assert.throws(() => validateBatch(state, 0, ["next_turn", "move:1,1:d"], 0), /last/);
    assert.equal(validateBatch(state, 0, ["move:1,1:d", "attack:2,1:4,2"], 0).length, 2);
});

test("legal moves stay within mobility and never enter a unit's tile", () => {
    const state = open(12, 12);
    place(state, 0, 6, 6);
    place(state, 1, 6, 8);
    const moves = legalActions(state, 0, 0).filter((a) => a.kind === "move");
    for (const move of moves) {
        assert.ok(manhattan(6, 6, move.to![0], move.to![1]) <= OPERATIVE.mobility);
        assert.notDeepEqual(move.to, [6, 8]);
    }
});
