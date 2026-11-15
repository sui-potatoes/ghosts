// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainGround, type GroundTile } from "../../packages/engine/src/chain-ground.ts";
import type { ChainGame } from "../src/chain/bcs.ts";
import {
    canStep,
    coverBonus,
    lineOfSight,
    lineOfThrow,
    terrainAt,
} from "../src/chain/match-rules.ts";

/**
 * A playtest plays an editor level by the engine's copy of the `ghosts::map`
 * rules (`chain-ground.ts`); a live match by the app's (`match-rules.ts`).
 * On the same random grids both must answer every question alike.
 */

let seed = 99;
const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
};

function randomGrid(rows: number, cols: number): GroundTile[][] {
    return Array.from({ length: rows }, () =>
        Array.from({ length: cols }, (): GroundTile => {
            const r = random();
            if (r < 0.08) return { t: "wall" };
            if (r < 0.12) return { t: "unwalkable" };
            if (r < 0.45) {
                // 0 none, 1 low, 2 high, 3 barrier (glass, a tall fence)
                const side = () =>
                    random() < 0.55 ? 0 : random() < 0.5 ? 1 : random() < 0.5 ? 2 : 3;
                return { t: "cover", sides: [side(), side(), side(), side()] };
            }
            return { t: "empty" };
        }),
    );
}

/** The grid as the app's BCS decoder hands it to `match-rules`. */
function chainGame(tiles: GroundTile[][]): ChainGame {
    const grid = tiles.map((row) =>
        row.map((tile) => ({
            unit: null,
            tileType:
                tile.t === "cover"
                    ? {
                          $kind: "Cover",
                          Cover: {
                              left: tile.sides[0],
                              top: tile.sides[1],
                              right: tile.sides[2],
                              bottom: tile.sides[3],
                          },
                      }
                    : {
                          $kind:
                              tile.t === "empty"
                                  ? "Empty"
                                  : tile.t === "wall"
                                    ? "Wall"
                                    : "Unwalkable",
                      },
        })),
    );
    return { map: { grid: { grid } } } as unknown as ChainGame;
}

test("the playtest's chain rules agree with the live match's on cover, sight, throws and ground", () => {
    for (let round = 0; round < 6; round++) {
        const [rows, cols] = [7 + round, 9 + round];
        const tiles = randomGrid(rows, cols);
        // The engine names cells [x, z] around an origin; the chain names tiles [row, col].
        const [minX, minZ] = [-4, -3];
        const ground = new ChainGround({ tiles, minX, minZ });
        const game = chainGame(tiles);
        const cell = (row: number, col: number): [number, number] => [col + minX, row + minZ];
        for (let i = 0; i < 400; i++) {
            const a: [number, number] = [Math.floor(random() * rows), Math.floor(random() * cols)];
            const b: [number, number] = [Math.floor(random() * rows), Math.floor(random() * cols)];
            const where = `${round}: ${a} -> ${b}`;
            assert.equal(
                ground.cover(cell(...a), cell(...b)),
                coverBonus(game, a, b),
                `cover ${where}`,
            );
            assert.equal(
                ground.clearShot(cell(...a), cell(...b)),
                lineOfSight(game, a, b),
                `sight ${where}`,
            );
            assert.equal(
                ground.clearThrow(cell(...a), cell(...b)),
                lineOfThrow(game, a, b),
                `throw ${where}`,
            );
            const terrain = terrainAt(game, b);
            assert.equal(
                ground.terrain(cell(...b)),
                terrain === "blocked" ? "blocked" : "open",
                where,
            );
            // a step to each neighbor, as `check_path` takes it
            for (const [dRow, dCol] of [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
            ]) {
                const to: [number, number] = [a[0] + dRow, a[1] + dCol];
                assert.equal(
                    ground.step(cell(...a), cell(...to)),
                    canStep(game, a, to),
                    `step ${round}: ${a} -> ${to}`,
                );
            }
        }
    }
});

/** One row: `[0, 1]` and `[0, 2]` with `value` on the edge between them, declared on `on`. */
function edgeRow(value: number, on: "near" | "far" | "both"): GroundTile[][] {
    const row: GroundTile[] = Array.from({ length: 5 }, () => ({ t: "empty" }));
    if (on !== "far") row[1] = { t: "cover", sides: [0, 0, value, 0] };
    if (on !== "near") row[2] = { t: "cover", sides: [value, 0, 0, 0] };
    const open: GroundTile[] = Array.from({ length: 5 }, () => ({ t: "empty" }));
    return [row, open];
}

test("a barrier (3) stops a step both ways, lets a shot and a throw through, and covers as low", () => {
    for (const on of ["near", "far", "both"] as const) {
        const tiles = edgeRow(3, on);
        const ground = new ChainGround({ tiles, minX: 0, minZ: 0 });
        const game = chainGame(tiles);
        // across the edge: refused either way, by both ports
        for (const [from, to] of [
            [
                [0, 1],
                [0, 2],
            ],
            [
                [0, 2],
                [0, 1],
            ],
        ] as [number, number][][]) {
            assert.equal(canStep(game, from, to), false, `${on}: ${from} -> ${to}`);
            assert.equal(ground.step([from[1], from[0]], [to[1], to[0]]), false);
        }
        // around it: open
        assert.equal(canStep(game, [0, 1], [1, 1]), true);
        assert.equal(canStep(game, [1, 1], [1, 2]), true);
        assert.equal(canStep(game, [1, 2], [0, 2]), true);
        // a shot along the row crosses it as an inner edge, and is clear
        assert.equal(lineOfSight(game, [0, 0], [0, 4]), true);
        assert.equal(ground.clearShot([0, 0], [4, 0]), true);
        assert.equal(lineOfThrow(game, [0, 0], [0, 4]), true);
        // low cover from behind it, not 75
        assert.equal(coverBonus(game, [0, 0], [0, 2]), 25);
        assert.equal(ground.cover([0, 0], [2, 0]), 25);
        // a blast clears it, and the step opens
        ground.blast([1, 0]);
        assert.equal(ground.step([1, 0], [2, 0]), true);
    }
    // high cover on the same edge: no step and no shot; low cover: both
    const high = chainGame(edgeRow(2, "near"));
    assert.equal(canStep(high, [0, 1], [0, 2]), false);
    assert.equal(lineOfSight(high, [0, 0], [0, 4]), false);
    assert.equal(coverBonus(high, [0, 0], [0, 2]), 50);
    const low = chainGame(edgeRow(1, "near"));
    assert.equal(canStep(low, [0, 1], [0, 2]), true);
    assert.equal(lineOfSight(low, [0, 0], [0, 4]), true);
    assert.equal(coverBonus(low, [0, 0], [0, 2]), 25);
});
