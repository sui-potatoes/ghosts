// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainGround, type Ground, type GroundTile } from "./chain-ground.ts";
import type { Cell } from "./map.ts";

/**
 * The corner peek of `Map.line_of_fire`: a shooter hugging the end of a cover
 * shoots from the tile past the corner. The same cases as `tests/map/map.move`.
 */

const wall: GroundTile = { t: "wall" };
const side = (left: number, top: number, right: number, bottom: number): GroundTile => ({
  t: "cover",
  sides: [left, top, right, bottom],
});

/** A 5x5 ground with the tiles set, `[row, col]`; cell `[x, z]` is tile `[z, x]`. */
function yard(edits: [number, number, GroundTile][] = []) {
  const tiles = Array.from({ length: 5 }, () => Array.from({ length: 5 }, (): GroundTile => ({ t: "empty" })));
  for (const [row, col, tile] of edits) tiles[row][col] = tile;
  const ground: Ground = { tiles, minX: 0, minZ: 0 };
  return new ChainGround(ground);
}
const cell = ([row, col]: [number, number]): Cell => [col, row];
const fire = (g: ChainGround, a: [number, number], b: [number, number], occupied: [number, number][] = []) =>
  g.clearFire(cell(a), cell(b), (c) => occupied.some((o) => o[1] === c[0] && o[0] === c[1]), true);

test("a corner peek clears the shot the straight line refuses, for the shooter only", () => {
  const g = yard([[3, 0, wall]]);
  assert.equal(g.clearShot(cell([4, 0]), cell([0, 0])), false);
  assert.equal(fire(g, [4, 0], [0, 0]), true);
  assert.equal(fire(g, [0, 0], [4, 0]), false);
  assert.equal(g.clearFire(cell([4, 0]), cell([0, 0]), () => false, false), false, "off: the line of sight");
  assert.equal(fire(yard(), [4, 0], [4, 4]), true);
  assert.equal(fire(yard([[1, 4, wall]]), [0, 4], [4, 4]), true);
  assert.equal(fire(yard([[0, 1, wall]]), [0, 0], [0, 4]), true);
  assert.equal(fire(yard([[4, 3, wall]]), [4, 4], [4, 0]), true);
});

test("no peek where the wall goes on, from the middle of a wall, or at the map's edge", () => {
  assert.equal(fire(yard([[3, 0, wall], [3, 1, wall]]), [4, 0], [0, 0]), false);
  const full = yard([0, 1, 2, 3, 4].map((c): [number, number, GroundTile] => [2, c, wall]));
  for (const from of [[3, 2], [4, 2], [3, 0], [3, 4]] as [number, number][]) {
    assert.equal(fire(full, from, [0, from[1]]), false, `${from}`);
  }
  assert.equal(fire(yard([[1, 0, wall]]), [4, 0], [0, 0]), false);
});

test("the peek tile must be free to stand on, with the step to it open", () => {
  const base: [number, number, GroundTile][] = [[3, 0, wall]];
  assert.equal(fire(yard(base), [4, 0], [0, 0], [[4, 1]]), false, "a unit on it");
  assert.equal(fire(yard([...base, [4, 1, { t: "obstacle" }]]), [4, 0], [0, 0]), false);
  assert.equal(fire(yard([...base, [4, 1, { t: "unwalkable" }]]), [4, 0], [0, 0]), false);
  assert.equal(fire(yard([...base, [4, 0, side(0, 0, 2, 0)]]), [4, 0], [0, 0]), false);
  assert.equal(fire(yard([...base, [4, 1, side(2, 0, 0, 0)]]), [4, 0], [0, 0]), false);
  assert.equal(fire(yard(base), [4, 0], [0, 0]), true);
});

test("a high side on the edge is a corner like a wall, and must end at the peek tile", () => {
  const behind: [number, number, GroundTile] = [2, 0, wall];
  assert.equal(fire(yard([behind, [4, 0, side(0, 2, 0, 0)]]), [4, 0], [0, 1]), true);
  assert.equal(fire(yard([behind, [3, 0, side(0, 0, 0, 2)]]), [4, 0], [0, 1]), true);
  assert.equal(fire(yard([behind, [4, 0, side(0, 2, 0, 0)], [4, 1, side(2, 0, 0, 0)]]), [4, 0], [0, 1]), false);
  assert.equal(fire(yard([behind, [4, 0, side(0, 2, 0, 0)], [3, 1, side(0, 0, 0, 2)]]), [4, 0], [0, 1]), false);
  assert.equal(fire(yard([behind]), [4, 0], [0, 1]), false);
});
