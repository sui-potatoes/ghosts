// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";

import { Encounter, type Unit } from "../../packages/engine/src/game.ts";
import { blackRain } from "../../packages/engine/src/scenario.ts";
import {
    NIGHT_SHIFT_MAP,
    NIGHT_SHIFT_POSITIONS,
    NIGHT_SHIFT_SIZE,
} from "../../packages/engine/src/night-shift/chain.ts";
import { nightShiftScenario } from "../../packages/engine/src/night-shift/scenario.ts";
import { GHOSTS, LEVELS } from "../src/constants.ts";
import { PresetMap, type ChainGame } from "../src/chain/bcs.ts";
import { isListedLevel, sceneOfLevel } from "../src/chain/match-scene.ts";
import {
    coverBonus,
    reachable,
    terrainAt,
    toCell,
    toTile,
    type Cell,
} from "../src/chain/match-rules.ts";

/**
 * Night Shift's scene against the map the chain will hold: the bytes `new_level`
 * takes (`chain.ts`), read with the app's decoder, must be the ground the scene
 * plays by, tile for tile; the spawn positions must be the scene's deployment;
 * and from every deployment cell the app's chain rules and the engine's must
 * reach the same tiles in the same steps. A match on the level shows its scene
 * once its preset ID is known (`LEVELS.nightShift`), and only then.
 */

const MAP = PresetMap.parse(Uint8Array.from(Buffer.from(NIGHT_SHIFT_MAP, "hex")));
const GAME = { map: MAP } as unknown as ChainGame;
const scenario = nightShiftScenario();
const { bounds } = scenario.map;
const [ROWS, COLS] = NIGHT_SHIFT_SIZE;

type Entry = [row: number, col: number, steps: number];
const sorted = (entries: Entry[]) =>
    [...entries].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

test("the chain's bytes are the scene's ground, tile for tile", () => {
    assert.equal(MAP.grid.grid.length, ROWS);
    const ground = scenario.ground!;
    assert.deepEqual([ground.minX, ground.minZ], [bounds.minX, bounds.minZ]);
    MAP.grid.grid.forEach((row, r) => {
        assert.equal(row.length, COLS);
        row.forEach(({ tileType, unit }, c) => {
            assert.equal(unit, null);
            const scene = ground.tiles[r][c];
            const kind = {
                empty: "Empty",
                cover: "Cover",
                unwalkable: "Unwalkable",
                wall: "Wall",
                obstacle: "Obstacle",
            }[scene.t];
            assert.equal(tileType.$kind, kind, `tile ${r},${c}`);
            if (tileType.$kind === "Cover" && scene.t === "cover") {
                const { left, top, right, bottom } = tileType.Cover;
                assert.deepEqual([left, top, right, bottom], scene.sides, `sides of ${r},${c}`);
            }
        });
    });
});

test("the spawn positions are the scene's deployment, side A first", () => {
    const half = NIGHT_SHIFT_POSITIONS.length / 2;
    const cells = (list: typeof NIGHT_SHIFT_POSITIONS) =>
        list.map((tile) => `${toCell(tile, bounds)}`).sort();
    const game = new Encounter(scenario);
    assert.deepEqual(
        cells(NIGHT_SHIFT_POSITIONS.slice(0, half)),
        game.allies.map((u) => `${u.pos}`).sort(),
    );
    assert.deepEqual(
        cells(NIGHT_SHIFT_POSITIONS.slice(half)),
        game.enemies.map((u) => `${u.pos}`).sort(),
    );
    for (const tile of NIGHT_SHIFT_POSITIONS)
        assert.equal(terrainAt(GAME, tile), "open", `${tile}`);
});

test("from every deployment cell, the app's chain rules and the engine's reach alike", () => {
    for (const tile of NIGHT_SHIFT_POSITIONS) {
        const app = [...reachable(GAME, tile, 7).values()].map(({ tile, steps }): Entry => [
            ...tile,
            steps,
        ]);
        const game = new Encounter(scenario);
        const unit: Unit = game.allies[0];
        unit.pos = toCell(tile, bounds);
        unit.mobility = 7;
        game.units = [unit];
        const engine = [...game.paths(unit).values()]
            .filter((path) => path.length > 1)
            .map((path): Entry => [
                ...toTile(path[path.length - 1] as Cell, bounds),
                path.length - 1,
            ]);
        assert.ok(app.length > 20, `${tile} reaches out`);
        assert.deepEqual(sorted(engine), sorted(app), `reach from ${tile}`);
    }
});

test("cover, shot by shot, is the chain's: the storefront glass is high, a gondola low", () => {
    const game = new Encounter(scenario);
    const at = (tile: [number, number]) => toCell(tile, bounds);
    // [row, col]: a shooter in an empty forecourt bay at a unit against the inside of the front glass
    assert.equal(coverBonus(GAME, [18, 14], [15, 14]), 50);
    assert.equal(
        game.authority!.cover({ pos: at([18, 14]) } as Unit, { pos: at([15, 14]) } as Unit),
        50,
    );
    // a unit in the aisle beside the west gondola run, shot from the east aisle
    assert.equal(coverBonus(GAME, [13, 13], [13, 9]), 25);
    assert.equal(
        game.authority!.cover({ pos: at([13, 13]) } as Unit, { pos: at([13, 9]) } as Unit),
        25,
    );
});

test("a game shows its own level's scene, once the level has an ID", () => {
    const id = "0x" + "ab".repeat(32);
    const levels = [[id, () => scenario]] as const;
    assert.equal(sceneOfLevel(id, levels, blackRain), scenario);
    assert.equal(sceneOfLevel(id.toUpperCase().replace("0X", ""), levels, blackRain), scenario);
    assert.equal(sceneOfLevel("0x" + "cd".repeat(32), levels, blackRain), blackRain);
    // not on chain yet: an empty ID matches nothing, not even an empty map ID
    assert.equal(sceneOfLevel("", [["", () => scenario]], blackRain), blackRain);
});

test("on testnet, a game on Night Shift shows Night Shift and one on Black Rain shows Black Rain", () => {
    assert.match(LEVELS.nightShift, /^0x[0-9a-f]{64}$/);
    assert.notEqual(LEVELS.nightShift, GHOSTS.preset);
    const levels = [[LEVELS.nightShift, () => scenario]] as const;
    assert.equal(sceneOfLevel(LEVELS.nightShift, levels, blackRain), scenario);
    assert.equal(sceneOfLevel(GHOSTS.preset, levels, blackRain), blackRain);
    // a retired revision is told apart, so its replays show the unavailable plate
    assert.ok(!LEVELS.retired.some((id) => isListedLevel(id, [LEVELS.nightShift])));
    assert.equal(
        isListedLevel(LEVELS.nightShift.toUpperCase().slice(2), [LEVELS.nightShift]),
        true,
    );
    assert.equal(isListedLevel(GHOSTS.preset, LEVELS.retired), false);
    assert.equal(isListedLevel("", [""]), false);
});
