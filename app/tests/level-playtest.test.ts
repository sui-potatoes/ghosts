// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainGround, type GroundTile } from "../../packages/engine/src/chain-ground.ts";
import type { ChainGame } from "../src/chain/bcs.ts";
import { coverBonus, lineOfSight, lineOfThrow, terrainAt } from "../src/chain/match-rules.ts";

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
                const side = () => (random() < 0.6 ? 0 : random() < 0.6 ? 1 : 2);
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
        }
    }
});
