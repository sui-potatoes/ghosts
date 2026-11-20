// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "three";

import { ChainGround, type GroundTile } from "../../packages/engine/src/chain-ground.ts";
import { Encounter, type Unit } from "../../packages/engine/src/game.ts";
import { blackRain } from "../../packages/engine/src/scenario.ts";
import { Overlays } from "../../packages/engine/src/scene/overlays.ts";
import { Space } from "../../packages/engine/src/scene/space.ts";
import { PresetMap, type ChainGame } from "../src/chain/bcs.ts";
import {
    checkPath,
    coverBonus,
    encodePath,
    reachable,
    terrainAt,
    toCell,
    toTile,
    type Cell,
} from "../src/chain/match-rules.ts";

/**
 * Black Rain as the 7th package bakes it (`map::black_rain`, ten `Obstacle` tiles), read
 * from the Move source with the app's decoder, and the tiles a unit alone at side 0's
 * first spawn reaches: the app's chain rules (`match-rules.ts`), the engine's copy
 * (`chain-ground.ts` behind `Encounter.paths`), the move range overlay and the offline
 * demo's own map must all give the contract's answer, `BLACK_RAIN_REACH_3` and
 * `BLACK_RAIN_REACH_7` of `tests/map/map.move` (`black_rain_reach`), tile for tile and
 * step for step.
 */

const MOVE = new URL("../../move/packages/ghosts/", import.meta.url);
const source = readFileSync(new URL("sources/map/map.move", MOVE), "utf8");
const moveTests = readFileSync(new URL("tests/map/map.move", MOVE), "utf8");

/** The preset bytes between `maps:begin` and `maps:end`. */
const presetHex = /fun black_rain\(id: ID\): Map \{[\s\S]*?from_bytes\(x"([0-9a-f]+)"\)/.exec(
    source,
)![1];
const MAP = PresetMap.parse(Uint8Array.from(Buffer.from(presetHex, "hex")));
const GAME = { map: MAP } as unknown as ChainGame;
const SPAWN = [11, 6] as const;
const { bounds } = blackRain.map;

const [UP, RIGHT, DOWN, LEFT] = [1, 2, 4, 8];

type Entry = [row: number, col: number, steps: number];

/** `BLACK_RAIN_REACH_3`, as the contract's test has it. */
const REACH_3: Entry[] = [
    [8, 6, 3], [9, 5, 3], [10, 4, 3], [10, 5, 2], [10, 6, 1], [10, 7, 2], [10, 8, 3],
    [11, 4, 2], [11, 5, 1], [11, 7, 1], [11, 8, 2], [11, 9, 3], [12, 4, 3], [12, 5, 2],
    [12, 6, 1], [12, 7, 2], [12, 8, 3], [13, 5, 3], [13, 6, 2], [13, 7, 3],
]; // prettier-ignore

/** `BLACK_RAIN_REACH_7`. */
const REACH_7: Entry[] = [
    [4, 6, 7], [5, 5, 7], [5, 6, 6], [5, 7, 7], [6, 4, 7], [6, 5, 6], [6, 6, 5], [6, 7, 6],
    [6, 8, 7], [7, 3, 7], [7, 4, 6], [7, 5, 5], [7, 6, 4], [7, 7, 5], [7, 8, 6], [7, 9, 7],
    [8, 2, 7], [8, 3, 6], [8, 4, 5], [8, 5, 4], [8, 6, 3], [8, 7, 4], [8, 8, 5], [8, 9, 6],
    [8, 10, 7], [9, 3, 5], [9, 4, 4], [9, 5, 3], [9, 8, 4], [9, 9, 5], [9, 10, 6], [10, 3, 4],
    [10, 4, 3], [10, 5, 2], [10, 6, 1], [10, 7, 2], [10, 8, 3], [10, 9, 4], [10, 10, 5],
    [10, 11, 6], [10, 12, 7], [11, 4, 2], [11, 5, 1], [11, 7, 1], [11, 8, 2], [11, 9, 3],
    [11, 10, 4], [11, 11, 5], [11, 12, 6], [12, 3, 4], [12, 4, 3], [12, 5, 2], [12, 6, 1],
    [12, 7, 2], [12, 8, 3], [12, 9, 4], [12, 10, 5], [12, 11, 6], [12, 12, 7], [13, 1, 7],
    [13, 2, 6], [13, 3, 5], [13, 4, 4], [13, 5, 3], [13, 6, 2], [13, 7, 3], [13, 8, 4],
    [13, 9, 5], [13, 10, 6], [13, 11, 7],
]; // prettier-ignore

const REACH: [mobility: number, entries: Entry[]][] = [
    [3, REACH_3],
    [7, REACH_7],
];

const OBSTACLES = [
    [2, 12], [3, 9], [4, 5], [6, 13], [6, 14], [9, 6], [9, 7], [9, 11], [9, 12], [11, 3],
]; // prettier-ignore

const sorted = (entries: Entry[]) =>
    [...entries].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

/** A `vector<vector<u16>>` constant of the contract's tests, as numbers. */
function moveConstant(name: string): number[][] {
    const body = new RegExp(`const ${name}: vector<vector<u16>> = vector\\[([\\s\\S]*?)\\];`).exec(
        moveTests,
    )![1];
    return [...body.matchAll(/vector\[([\d,\s]+)\]/g)].map((m) => m[1].split(",").map(Number));
}

/** The grid as the engine's ground. */
const groundTiles = (): GroundTile[][] =>
    MAP.grid.grid.map((row) =>
        row.map(({ tileType }): GroundTile => {
            switch (tileType.$kind) {
                case "Empty":
                    return { t: "empty" };
                case "Cover": {
                    const { left, top, right, bottom } = tileType.Cover;
                    return { t: "cover", sides: [left, top, right, bottom] };
                }
                case "Unwalkable":
                    return { t: "unwalkable" };
                case "Obstacle":
                    return { t: "obstacle" };
                default:
                    return { t: "wall" };
            }
        }),
    );

/** An encounter with one unit, alone, at the spawn: on the chain's ground, or the offline demo's own map. */
function alone(mobility: number, ground: "chain" | "demo" = "chain") {
    const game = new Encounter(
        ground === "chain"
            ? {
                  ...blackRain,
                  ground: { tiles: groundTiles(), minX: bounds.minX, minZ: bounds.minZ },
              }
            : blackRain,
    );
    const unit = game.allies[0];
    unit.pos = toCell(SPAWN, bounds);
    unit.mobility = mobility;
    game.units = [unit];
    return { game, unit };
}

/** What `Encounter.paths` offers, as `[row, col, steps]`, the start left out. */
const engineReach = (game: Encounter, unit: Unit): Entry[] =>
    [...game.paths(unit).values()]
        .filter((path) => path.length > 1)
        .map((path) => [...toTile(path[path.length - 1] as Cell, bounds), path.length - 1]);

test("the re-baked Black Rain decodes: ten obstacles where the props stand, 64 walls, no cover tiles", () => {
    assert.deepEqual(moveConstant("BLACK_RAIN_OBSTACLES"), OBSTACLES);
    const kinds = new Map<string, number>();
    const obstacles: number[][] = [];
    MAP.grid.grid.forEach((row, r) =>
        row.forEach(({ tileType, unit }, c) => {
            assert.equal(unit, null);
            kinds.set(tileType.$kind, (kinds.get(tileType.$kind) ?? 0) + 1);
            if (tileType.$kind === "Obstacle") obstacles.push([r, c]);
        }),
    );
    assert.deepEqual(Object.fromEntries(kinds), { Wall: 64, Empty: 178, Obstacle: 10 });
    assert.deepEqual(obstacles, OBSTACLES);
    // each obstacle is the 2 bytes `04 00`: tag 4, no fields, no unit
    assert.equal(presetHex.length / 2, 556);
    // the offline demo's map has its cover props on the same cells, and nothing else is cover
    const demo = new Encounter(blackRain);
    const covers = demo.map.covers
        .map((cell) => toTile(cell as Cell, bounds))
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(covers, OBSTACLES);
    for (const [row, col] of OBSTACLES) assert.equal(terrainAt(GAME, [row, col]), "obstacle");
});

test("reach from (11,6): the app's chain rules, the engine's and the contract's agree, tile for tile, step for step", () => {
    for (const [mobility, entries] of REACH) {
        assert.deepEqual(
            moveConstant(`BLACK_RAIN_REACH_${mobility}`),
            entries,
            "the contract's table",
        );
        const app = [...reachable(GAME, SPAWN, mobility).values()].map(({ tile, steps }): Entry => [
            ...tile,
            steps,
        ]);
        assert.deepEqual(sorted(app), entries, `match-rules, mobility ${mobility}`);
        const { game, unit } = alone(mobility);
        assert.deepEqual(
            sorted(engineReach(game, unit)),
            entries,
            `chain-ground, mobility ${mobility}`,
        );
    }
});

test("the offline demo, on its own map, reaches what the chain does", () => {
    for (const [mobility, entries] of REACH) {
        const { game, unit } = alone(mobility, "demo");
        assert.equal(game.authority, undefined, "the demo's own rules");
        assert.deepEqual(sorted(engineReach(game, unit)), entries, `demo, mobility ${mobility}`);
    }
});

test("every path the client builds is the contract's: its steps, and `check_path` takes it", () => {
    for (const [mobility, entries] of REACH) {
        const steps = new Map(entries.map(([r, c, s]) => [`${r},${c}`, s]));
        const { game, unit } = alone(mobility);
        for (const path of game.paths(unit).values()) {
            if (path.length < 2) continue;
            const end = toTile(path[path.length - 1] as Cell, bounds);
            const bytes = encodePath(path as Cell[], bounds);
            assert.equal(bytes.length - 2, steps.get(`${end}`), `steps to ${end}`);
            assert.deepEqual(checkPath(GAME, bytes), end, `check_path to ${end}`);
            // a path never ends on an obstacle and never crosses two in a row
            path.forEach((cell, i) => {
                const here = terrainAt(GAME, toTile(cell as Cell, bounds));
                if (i === path.length - 1) assert.equal(here, "open");
                if (i > 0 && here === "obstacle")
                    assert.notEqual(
                        terrainAt(GAME, toTile(path[i - 1] as Cell, bounds)),
                        "obstacle",
                    );
            });
        }
        for (const { tile, steps: n, path } of reachable(GAME, SPAWN, mobility).values()) {
            const bytes = encodePath(
                path.map((t) => toCell(t, bounds)),
                bounds,
            );
            assert.equal(bytes.length - 2, n);
            assert.deepEqual(checkPath(GAME, bytes), tile);
        }
    }
});

function overlays(t: TestContext, game: Encounter) {
    const scene = new T.Scene();
    const view = new Overlays(scene, new Space(game.map));
    t.after(() =>
        scene.traverse((object) => {
            if (object instanceof T.Mesh || object instanceof T.Line) {
                object.geometry.dispose();
                for (const m of [object.material].flat()) m.dispose();
            }
        }),
    );
    return view;
}

test("the move range overlay offers exactly the reach, never an obstacle", (t) => {
    for (const [mobility, entries] of REACH) {
        const { game, unit } = alone(mobility);
        unit.ap = 2;
        const view = overlays(t, game);
        view.showRange(game, unit, true);
        const offered: Entry[] = [];
        const { minX, maxX, minZ, maxZ } = game.map.plan.bounds;
        for (let x = minX - 1; x <= maxX + 1; x++)
            for (let z = minZ - 1; z <= maxZ + 1; z++) {
                const path = view.previewPath([x, z]);
                if (path && path.length > 1)
                    offered.push([...toTile([x, z], bounds), path.length - 1]);
            }
        assert.deepEqual(sorted(offered), entries, `overlay, mobility ${mobility}`);
        for (const [row, col] of OBSTACLES)
            assert.equal(
                view.previewPath(toCell([row, col], bounds)),
                undefined,
                `obstacle ${row},${col}`,
            );
    }
});

test("refused: ending on an obstacle, two in a row along each pair; one of a pair is vaulted down its column", () => {
    assert.equal(checkPath(GAME, [10, 6, UP]), null, "ends on (9,6)");
    assert.equal(checkPath(GAME, [11, 6, UP, UP]), null, "ends on (9,6)");
    // the worked example: over (9,6) to (8,6) in three steps
    assert.deepEqual(checkPath(GAME, [11, 6, UP, UP, UP]), [8, 6]);
    assert.equal(reachable(GAME, SPAWN, 2).has("8,6"), false, "three steps, not two");
    // the old example of the docs now crosses two in a row
    assert.equal(checkPath(GAME, [11, 6, UP, UP, RIGHT]), null);
    const pairs: [Entry, Entry][] = [
        [[9, 6, 0], [9, 7, 0]],
        [[9, 11, 0], [9, 12, 0]],
        [[6, 13, 0], [6, 14, 0]],
    ]; // prettier-ignore
    const ground = new ChainGround({ tiles: groundTiles(), minX: bounds.minX, minZ: bounds.minZ });
    const cell = (row: number, col: number) => toCell([row, col], bounds);
    for (const [[r, a], [, b]] of pairs) {
        assert.equal(checkPath(GAME, [r, a - 1, RIGHT, RIGHT, RIGHT]), null, `${r},${a - 1} right`);
        assert.equal(checkPath(GAME, [r, b + 1, LEFT, LEFT, LEFT]), null, `${r},${b + 1} left`);
        assert.equal(ground.step(cell(r, a), cell(r, b)), false, "the engine refuses the step too");
        assert.equal(ground.step(cell(r, b), cell(r, a)), false);
        // the pair is not crossed in three steps: the way round is longer
        const { game, unit } = alone(3);
        unit.pos = cell(r, a - 1);
        assert.equal(game.paths(unit).has(cell(r, b + 1).join(",")), false, `around ${r},${a}`);
        for (const col of [a, b]) {
            assert.deepEqual(
                checkPath(GAME, [r - 1, col, DOWN, DOWN]),
                [r + 1, col],
                `${r},${col} down`,
            );
            assert.deepEqual(checkPath(GAME, [r + 1, col, UP, UP]), [r - 1, col], `${r},${col} up`);
            unit.pos = cell(r - 1, col);
            assert.equal(
                game.paths(unit).get(cell(r + 1, col).join(","))?.length,
                3,
                `${r},${col} vaulted`,
            );
        }
    }
});

test("beside an obstacle: low cover against a shot from across it, none from a diagonal", () => {
    // (8,6) is north of the obstacle at (9,6); (8,5) is diagonal to it
    assert.equal(coverBonus(GAME, [13, 6], [8, 6]), 25);
    assert.equal(coverBonus(GAME, [8, 1], [8, 6]), 0, "from the side");
    assert.equal(coverBonus(GAME, [13, 5], [8, 5]), 0, "diagonal to it");
    const { game, unit } = alone(3);
    const hostile = new Encounter(blackRain).enemies[0];
    unit.pos = toCell([8, 6], bounds);
    hostile.pos = toCell([13, 6], bounds);
    game.units = [unit, hostile];
    assert.equal(game.cover(unit, hostile), 25);
    assert.equal(game.coverAt(unit.pos), true);
    // a frag at (9,7) turns (9,6) and (9,7) into ground: the cover goes, the tiles are destinations
    game.ingest({
        type: "grenade",
        unit: hostile.id,
        at: toCell([9, 7], bounds),
        casualties: [],
        environment: [],
    });
    assert.equal(game.cover(unit, hostile), 0);
    unit.pos = toCell([10, 6], bounds);
    unit.ap = 2;
    assert.equal(game.paths(unit).get(toCell([9, 6], bounds).join(","))?.length, 2);
    assert.equal(game.paths(unit).get(toCell([9, 7], bounds).join(","))?.length, 3);
});
