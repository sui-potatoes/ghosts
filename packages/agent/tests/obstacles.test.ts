// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Obstacles and the daze, against Move. The Black Rain level (`BLACK_RAIN`, baked into
 * `map::black_rain`) holds ten obstacles; `BLACK_RAIN_REACH_3` and `BLACK_RAIN_REACH_7` are the
 * reach tables of `tests/map/map.move::black_rain_reach`, the tiles a unit alone on spawn (11, 6)
 * can stand on after one move, each with its number of steps. The SDK's `reachable` has to give
 * the identical sets and step counts, and every path it builds has to pass `checkPath`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeStats, decodeTiles, gridSize, MapPresetBcs } from "../src/bcs.ts";
import type { Backend } from "../src/backend.ts";
import { abortMessage } from "../src/contract.ts";
import { BLACK_RAIN } from "../src/maps.ts";
import {
    checkPath,
    coverBonus,
    DOWN,
    effectiveStats,
    isStandable,
    LEFT,
    legalActions,
    parseAction,
    reachable,
    refusal,
    RIGHT,
    tracePath,
    UP,
} from "../src/rules.ts";
import { createSandbox } from "../src/sandbox.ts";
import { ActionError, isAbort, type GameState, type Stats, type Unit } from "../src/types.ts";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

/** `black_rain` as the contract's grid, `#` wall, `o` obstacle, `.` empty (spawns included). */
const GRID = [
    "#####........#####",
    "#####........#####",
    "#####.......o#####",
    "#####....o...#####",
    ".....o............",
    "..................",
    ".............oo...",
    "..................",
    "..................",
    "###...oo...oo.....",
    "###...............",
    "###o.........####.",
    "###..........####.",
    ".............####.",
];

/** `tests/map/map.move::BLACK_RAIN_REACH_3`: `[row, col, steps]` from (11, 6), mobility 3. */
const BLACK_RAIN_REACH_3 = [[8,6,3],[9,5,3],[10,4,3],[10,5,2],[10,6,1],[10,7,2],[10,8,3],[11,4,2],[11,5,1],[11,7,1],[11,8,2],[11,9,3],[12,4,3],[12,5,2],[12,6,1],[12,7,2],[12,8,3],[13,5,3],[13,6,2],[13,7,3]]; // prettier-ignore
/** `BLACK_RAIN_REACH_7`: the same with mobility 7. */
const BLACK_RAIN_REACH_7 = [[4,6,7],[5,5,7],[5,6,6],[5,7,7],[6,4,7],[6,5,6],[6,6,5],[6,7,6],[6,8,7],[7,3,7],[7,4,6],[7,5,5],[7,6,4],[7,7,5],[7,8,6],[7,9,7],[8,2,7],[8,3,6],[8,4,5],[8,5,4],[8,6,3],[8,7,4],[8,8,5],[8,9,6],[8,10,7],[9,3,5],[9,4,4],[9,5,3],[9,8,4],[9,9,5],[9,10,6],[10,3,4],[10,4,3],[10,5,2],[10,6,1],[10,7,2],[10,8,3],[10,9,4],[10,10,5],[10,11,6],[10,12,7],[11,4,2],[11,5,1],[11,7,1],[11,8,2],[11,9,3],[11,10,4],[11,11,5],[11,12,6],[12,3,4],[12,4,3],[12,5,2],[12,6,1],[12,7,2],[12,8,3],[12,9,4],[12,10,5],[12,11,6],[12,12,7],[13,1,7],[13,2,6],[13,3,5],[13,4,4],[13,5,3],[13,6,2],[13,7,3],[13,8,4],[13,9,5],[13,10,6],[13,11,7]]; // prettier-ignore

const STATS = (over: Partial<Stats> = {}): Stats => ({
    ...decodeStats(7n | (100n << 8n) | (10n << 16n)),
    damage: 1,
    spread: 0,
    plusOne: 0,
    critChance: 0,
    canBeDodged: 1,
    areaSize: 0,
    envDamage: 0,
    range: 4,
    ammo: 9,
    ...over,
});

function blackRain(): GameState {
    const map = MapPresetBcs.parse(bytes(BLACK_RAIN));
    return {
        id: "0x1",
        version: "1",
        ...gridSize(map),
        turn: 0,
        active: 0,
        players: ["0xa", "0xb"],
        squads: [["0x11"], ["0x22"]],
        fallen: [],
        positions: [[], []],
        history: [],
        missed: [0, 0],
        abandonedBy: null,
        deadlineMs: 1000,
        status: { kind: "active" },
        mode: { kind: "stakes" },
        tiles: decodeTiles(map),
        units: [],
    };
}

/** A unit of side 0 alone on the level at `(x, y)`, with `mobility`. */
function alone(x: number, y: number, mobility: number): { state: GameState; unit: Unit } {
    const state = blackRain();
    const unit: Unit = {
        recruit: "0x11",
        owner: "0xa",
        side: 0,
        x,
        y,
        ap: 2,
        apMax: 2,
        hp: 10,
        hpMax: 10,
        ammo: 3,
        ammoMax: 3,
        stats: STATS({ mobility }),
        actions: [{ kind: "move", uses: null }],
        effects: [],
    };
    state.units.push(unit);
    return { state, unit };
}

const LETTER = { u: UP, r: RIGHT, d: DOWN, l: LEFT };
const path = (text: string) => [...text].map((letter) => LETTER[letter as keyof typeof LETTER]);

test("the re-baked Black Rain decodes tile by tile to the contract's grid", () => {
    const { tiles, rows, cols } = blackRain();
    assert.deepEqual([rows, cols], [14, 18]);
    const glyph = (kind: string) =>
        ({ empty: ".", wall: "#", obstacle: "o", cover: "c", unwalkable: "~" })[kind]!;
    assert.deepEqual(
        tiles.map((row) => row.map((tile) => glyph(tile.kind)).join("")),
        GRID,
    );
    const kinds = tiles.flat().map((tile) => tile.kind);
    assert.deepEqual(
        ["empty", "wall", "obstacle", "cover", "unwalkable"].map(
            (kind) => kinds.filter((k) => k === kind).length,
        ),
        [178, 64, 10, 0, 0],
    );
});

test("reach from the spawn on Black Rain is Move's: the same tiles at the same step counts", () => {
    for (const [mobility, table] of [
        [3, BLACK_RAIN_REACH_3],
        [7, BLACK_RAIN_REACH_7],
    ] as const) {
        const { state, unit } = alone(11, 6, mobility);
        const reach = reachable(state, unit);
        const got = [...reach]
            .map(([key, steps]) => [...key.split(",").map(Number), steps.length])
            .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        assert.deepEqual(got, table, `mobility ${mobility}`);

        // every path it builds is one the contract takes, to the tile it names
        for (const [key, steps] of reach) {
            const [row, col] = key.split(",").map(Number);
            assert.deepEqual(checkPath(state, 11, 6, steps), [row, col]);
            assert.ok(isStandable(state.tiles[row][col]), `${key} is standable`);
            const order = { kind: "move", x: 11, y: 6, path: steps } as const;
            assert.equal(refusal(state, 0, order, 0), null, `move to ${key}`);
        }
        // and a tile one step further than the mobility is refused
        const edge = table.find(([, , steps]) => steps === mobility)!;
        const longer = reach.get(`${edge[0]},${edge[1]}`)!;
        const past = { kind: "move" as const, x: 11, y: 6, path: [...longer, UP] };
        assert.match(refusal(state, 0, past, 0) ?? "", /mobility/);

        // the legal moves are the reach: no obstacle among the destinations
        const moves = legalActions(state, 0, 0).filter((a) => a.kind === "move");
        assert.equal(moves.length, table.length);
        for (const move of moves) {
            const [row, col] = move.to!;
            assert.notEqual(GRID[row][col], "o");
        }
    }
});

test("a vault over one obstacle costs its steps: three with mobility 3, refused with 2", () => {
    const vault = path("uuu");
    const three = alone(11, 6, 3);
    assert.deepEqual(checkPath(three.state, 11, 6, vault), [8, 6]);
    assert.equal(refusal(three.state, 0, { kind: "move", x: 11, y: 6, path: vault }, 0), null);
    const two = alone(11, 6, 2);
    const refused = refusal(two.state, 0, { kind: "move", x: 11, y: 6, path: vault }, 0);
    assert.match(refused ?? "", /mobility/);
});

test("a path ending on an obstacle is refused, as the contract aborts with 11", () => {
    const { state } = alone(11, 6, 7);
    // up to (9, 6), and over (9, 6) then back onto it from the side: both end on an obstacle
    for (const steps of ["uu", "uur"]) {
        const traced = tracePath(state, 11, 6, path(steps));
        assert.deepEqual(traced, steps === "uu" ? { abort: 11 } : { abort: 12 }, steps);
    }
    for (const steps of ["uu"]) {
        assert.equal(checkPath(state, 11, 6, path(steps)), null);
        const reason = refusal(state, 0, { kind: "move", x: 11, y: 6, path: path(steps) }, 0);
        assert.match(reason ?? "", /ends on an obstacle/);
    }
    // a lone obstacle with ground after it is crossed
    assert.deepEqual(tracePath(state, 11, 6, path("uuu")), { end: [8, 6] });
});

test("two obstacles in a row cannot be crossed along the pairs, from both ends", () => {
    // (row, col) of the first tile before a pair, the direction into it, the pair's length 2
    const pairs: [number, number, string][] = [
        [9, 5, "rrr"], // (9,6)/(9,7), from the left
        [9, 8, "lll"], // from the right
        [9, 10, "rrr"], // (9,11)/(9,12)
        [9, 13, "lll"],
        [6, 12, "rrr"], // (6,13)/(6,14)
        [6, 15, "lll"],
    ];
    for (const [row, col, steps] of pairs) {
        const { state } = alone(row, col, 7);
        assert.deepEqual(tracePath(state, row, col, path(steps)), { abort: 12 }, `${row},${col}`);
        const reason = refusal(state, 0, { kind: "move", x: row, y: col, path: path(steps) }, 0);
        assert.match(reason ?? "", /one obstacle onto another/);
        // stopping between them is the other refusal: the first tile of the pair is an obstacle
        assert.deepEqual(tracePath(state, row, col, path(steps.slice(0, 1))), { abort: 11 });
    }
});

test("the aborts 11 and 12 of the map module read as the obstacle rules", () => {
    assert.match(abortMessage("map", "11"), /obstacle/);
    assert.match(abortMessage("map", "12"), /one obstacle onto another/);
});

test("each obstacle of a pair is vaulted perpendicular to it, both ways", () => {
    const tiles: [number, number][] = [
        [9, 6],
        [9, 7],
        [9, 11],
        [9, 12],
        [6, 13],
        [6, 14],
    ];
    for (const [row, col] of tiles) {
        const down = alone(row - 1, col, 7);
        assert.deepEqual(
            tracePath(down.state, row - 1, col, [DOWN, DOWN]),
            { end: [row + 1, col] },
            `over ${row},${col} downward`,
        );
        const up = alone(row + 1, col, 7);
        assert.deepEqual(
            tracePath(up.state, row + 1, col, [UP, UP]),
            { end: [row - 1, col] },
            `over ${row},${col} upward`,
        );
    }
    // an obstacle is not a landing: a unit on the far side blocks the vault
    const { state } = alone(11, 6, 7);
    state.units.push({ ...state.units[0], recruit: "0x22", owner: "0xb", side: 1, x: 8, y: 6 });
    assert.deepEqual(tracePath(state, 11, 6, path("uuu")), { abort: 3 });
});

test("an obstacle is low cover against a shot from across it, nothing diagonally", () => {
    const state = blackRain();
    // the obstacle at (4, 5): the unit below it at (5, 5), shot from above
    assert.equal(coverBonus(state, 1, 5, 5, 5), 25);
    // from below and from the side it has no cover
    assert.equal(coverBonus(state, 9, 5, 5, 5), 0);
    assert.equal(coverBonus(state, 5, 9, 5, 5), 0);
    // the unit to its right at (4, 6), shot from the right side: the near side is the open one
    assert.equal(coverBonus(state, 4, 9, 4, 6), 0);
    assert.equal(coverBonus(state, 4, 2, 4, 6), 25, "from the left, across the obstacle");
    // diagonally beside it at (5, 6)
    assert.equal(coverBonus(state, 3, 4, 5, 6), 0);
    // a shot that is more across than along still reads the neighbour: from the upper left of (5, 5)
    assert.equal(coverBonus(state, 1, 4, 5, 5), 25);
    // the same for the pair on row 9: (8, 6) is shot from below, across (9, 6)
    assert.equal(coverBonus(state, 12, 6, 8, 6), 25);
    assert.equal(coverBonus(state, 5, 6, 8, 6), 0);
});

test("a throw may land on an obstacle: only a wall is refused as a target", () => {
    const { state, unit } = alone(8, 3, 7);
    unit.actions.push({ kind: "grenade", uses: 1 });
    // (9, 7) is an obstacle five tiles away; a wall is not a target
    const throwAt = (tx: number, ty: number) =>
        refusal(state, 0, { kind: "grenade", x: 8, y: 3, tx, ty }, 0);
    assert.equal(throwAt(9, 7), null);
    assert.match(throwAt(9, 2) ?? "", /wall/);
});

// === The sandbox ===

/** A one-unit-a-side game on `tiles`, Alice to move after `deploy`, Bob passing every turn. */
async function duel(
    tiles: GameState["tiles"],
    positions: [[number, number], [number, number]],
    alice: Unit["actions"],
    bob: Stats,
    aliceStats = STATS(),
) {
    const backend: Backend = createSandbox({
        seated: true,
        firstMover: "you",
        squads: [
            [{ stats: aliceStats, actions: alice }],
            [{ stats: bob, actions: [{ kind: "move", uses: null }] }],
        ],
        positions,
        tiles,
        now: () => 1000,
        opponent: () => ["next_turn"],
    });
    await backend.createAccount();
    await backend.hireSquad();
    await backend.findGame();
    await backend.acceptSeat();
    const account = (await backend.account())!;
    assert.equal(account.search.kind, "playing");
    const id = account.search.kind === "playing" ? account.search.game : "";
    return {
        game: async () => (await backend.game(id))!,
        play: async (...ids: string[]) => {
            const game = (await backend.game(id))!;
            const receipt = await backend.submit(game, ids.map(parseAction));
            return { receipt, game: (await backend.game(id))! };
        },
    };
}

test("the sandbox refuses a deploy onto an obstacle with the contract's abort 11", async () => {
    const { tiles } = blackRain();
    // Alice's spawn is the obstacle at (9, 6)
    const { play } = await duel(
        tiles,
        [
            [9, 6],
            [13, 0],
        ],
        [{ kind: "move", uses: null }],
        STATS(),
    );
    await assert.rejects(
        play("deploy"),
        (error: unknown) => error instanceof ActionError && isAbort(error, "map", 11),
    );
});

test("a frag turns the obstacles in its blast into ground a unit then stands on", async () => {
    const { tiles } = blackRain();
    const { play, game } = await duel(
        tiles,
        [
            [8, 3],
            [13, 0],
        ],
        [
            { kind: "move", uses: null },
            { kind: "grenade", uses: 1 },
        ],
        STATS(),
    );
    await play("deploy");
    const before = await game();
    // (9, 7) is no place to stand until the blast
    const toBlast = path("rrrrd");
    assert.equal(checkPath(before, 8, 3, toBlast), null);
    assert.deepEqual(before.tiles[9][7], { kind: "obstacle" });

    await play("grenade:8,3:9,7");
    const after = await game();
    // within 2 of (9, 7): (9, 6) and (9, 7). The pair on the right and the rest stay
    assert.deepEqual([after.tiles[9][6], after.tiles[9][7]], [{ kind: "empty" }, { kind: "empty" }]);
    assert.equal(after.tiles[9][11].kind, "obstacle");
    assert.equal(after.tiles[9][12].kind, "obstacle");
    assert.equal(after.tiles[4][5].kind, "obstacle");
    assert.deepEqual(checkPath(after, 8, 3, toBlast), [9, 7]);
    // the cover the neighbour had is gone
    assert.equal(coverBonus(after, 12, 6, 8, 6), 0);

    const moved = await play("move:8,3:rrrrd");
    assert.deepEqual(
        moved.game.units.find((unit) => unit.side === 0)!.x * 100 +
            moved.game.units.find((unit) => unit.side === 0)!.y,
        907,
    );
});

test("a daze takes the dodge as well as the aim: no dodge while it lasts, one again after", async () => {
    const open = blackRain().tiles.map((row) => row.map(() => ({ kind: "empty" as const })));
    // the target dodges everything it can: dodge 100 against a shooter that never misses
    const dodger = STATS({ dodge: 100 });
    const { play, game } = await duel(
        open,
        [
            [0, 0],
            [0, 3],
        ],
        [
            { kind: "move", uses: null },
            { kind: "attack", uses: null },
            { kind: "flashbang", uses: 1 },
        ],
        dodger,
    );
    await play("deploy");

    const dazed = await play("flashbang:0,0:0,3");
    assert.ok(dazed.receipt.records.some((r) => r.kind === "effect_start"));
    const target = (state: GameState) => state.units.find((unit) => unit.side === 1)!;
    assert.equal(effectiveStats(target(dazed.game)).dodge, 0);
    assert.equal(target(dazed.game).stats.dodge, 100, "the base stat stays");

    const hit = await play("attack:0,0:0,3");
    assert.deepEqual(
        hit.receipt.records.map((r) => r.kind),
        ["attack", "damage"],
        "hit, not dodged",
    );

    // both turns change: the daze is over, and the same shot is dodged
    const over = await play("next_turn");
    assert.equal(effectiveStats(target(over.game)).dodge, 100);
    assert.equal((await game()).active, 0);
    const dodged = await play("attack:0,0:0,3");
    assert.deepEqual(
        dodged.receipt.records.map((r) => r.kind),
        ["attack", "dodged"],
    );
});
