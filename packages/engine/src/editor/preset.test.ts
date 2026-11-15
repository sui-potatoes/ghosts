// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { assetSpec } from "../catalog.ts";
import { exportLevel, newLevel, toMoveMap, type MoveTile, type Placement } from "./level.ts";
import { toPreset } from "./preset.ts";

/** `ghosts::map::peel_without_units` plus the optional `units` check of `from_bytes`, in TypeScript. */
function decode(bytes: Uint8Array) {
  let at = 0;
  const u8 = () => bytes[at++];
  const u16 = () => u8() | (u8() << 8);
  const len = () => {
    let value = 0, shift = 0;
    for (;;) {
      const byte = u8();
      value |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
    }
  };
  const id = bytes.slice(0, 32);
  at = 32;
  const tiles: MoveTile[][] = [];
  const units: number[] = [];
  let index = 0;
  for (let r = len(), i = 0; i < r; i++) {
    const row: MoveTile[] = [];
    for (let c = len(), j = 0; j < c; j++) {
      const tag = u8();
      if (tag === 0) row.push({ t: "empty" });
      else if (tag === 1) row.push({ t: "cover", sides: [u8(), u8(), u8(), u8()] });
      else if (tag === 2) row.push({ t: "unwalkable" });
      else if (tag === 3) row.push({ t: "wall" });
      else throw new Error(`abort: tile tag ${tag}`);
      if (u8() === 1) units.push(index); // Option<Unit>: a preset never has one
      index++;
    }
    tiles.push(row);
  }
  const rows = u16(), cols = u16(), fallen = len();
  return { id, tiles, rows, cols, fallen, units, rest: bytes.length - at };
}

const put = (level: ReturnType<typeof newLevel>, kind: Parameters<typeof assetSpec>[0], at: [number, number], turn: Placement["turn"] = 0) =>
  level.placements.push({ asset: assetSpec(kind).uid, at, turn });

function sample() {
  const level = newLevel(7, 5);
  put(level, "block-fill", [3, 2]);
  put(level, "crate", [1, 1]);
  put(level, "block-cover", [4, 3], 0);
  put(level, "block-high", [2, 4], 3);
  level.unwalkable.push([6, 0]);
  level.spawns = { a: [[0, 0], [0, 4]], b: [[6, 4], [6, 2]] };
  return level;
}

test("a level's preset bytes decode to the move grid, row by row", () => {
  const level = sample();
  const preset = toPreset(level);
  const map = decode(preset.bytes);
  assert.deepEqual(map.tiles, toMoveMap(level).tiles);
  assert.equal(map.rows, 5);
  assert.equal(map.cols, 7);
  assert.equal(map.tiles.length, preset.rows);
  assert.ok(map.tiles.every((row) => row.length === preset.cols));
  assert.deepEqual([...map.id], new Array(32).fill(0));
  assert.equal(map.fallen, 0);
  assert.equal(map.rest, 0, "no byte past `fallen`: the unpublished `units` may be left out");
  assert.deepEqual(map.units, [], "a preset holds no unit");
  // [row, col] is [z, x]
  assert.equal(map.tiles[2][3].t, "wall");
  assert.equal(map.tiles[0][6].t, "unwalkable");
  // side A's cells, then side B's
  assert.deepEqual(preset.positions, [[0, 0], [4, 0], [4, 6], [2, 6]]);
});

test("cover sides are [left, top, right, bottom] on both tiles of an edge", () => {
  const level = newLevel(4, 4);
  put(level, "block-cover", [1, 1], 0); // low, north edge of [1,1]
  put(level, "block-high", [2, 2], 3); // high, west edge of [2,2]
  const { tiles } = decode(toPreset(level).bytes);
  assert.deepEqual(tiles[1][1], { t: "cover", sides: [0, 1, 0, 0] });
  assert.deepEqual(tiles[0][1], { t: "cover", sides: [0, 0, 0, 1] });
  assert.deepEqual(tiles[2][2], { t: "cover", sides: [2, 0, 0, 0] });
  assert.deepEqual(tiles[2][1], { t: "cover", sides: [0, 0, 2, 0] });
});

test("a free-standing cover claims low cover on all four sides, as the baked Black Rain does", () => {
  const level = newLevel(3, 3);
  put(level, "crate", [1, 1]);
  assert.deepEqual(decode(toPreset(level).bytes).tiles[1][1], { t: "cover", sides: [1, 1, 1, 1] });
});

test("lengths past 127 take two ULEB128 bytes", () => {
  const level = newLevel(200, 3);
  level.spawns = { a: [[0, 0]], b: [[199, 2]] };
  const preset = toPreset(level);
  assert.equal(preset.bytes[32], 3);
  assert.deepEqual([...preset.bytes.slice(33, 35)], [0xc8, 0x01]);
  const map = decode(preset.bytes);
  assert.equal(map.tiles[0].length, 200);
  assert.equal(map.cols, 200);
});

test("the chain's rules show as issues", () => {
  const issues = (mutate: (l: ReturnType<typeof sample>) => void) => {
    const level = sample();
    mutate(level);
    return toPreset(level).issues.filter((i) => i.level === "error").map((i) => i.text);
  };
  const sides = (a: [number, number][], b: [number, number][]) => (l: ReturnType<typeof sample>) =>
    (l.spawns = { a, b });
  assert.deepEqual(issues(() => {}), []);
  assert.deepEqual(issues(sides([], [])), ["No side A deployment", "No side B deployment"]);
  assert.match(issues(sides([[0, 0]], []))[0], /No side B/);
  assert.match(issues(sides([[0, 0], [1, 0]], [[2, 0]]))[0], /Side A deploys 2, side B 1/);
  assert.match(issues(sides([[0, 0], [0, 0]], [[1, 0], [2, 0]]))[0], /twice on side A/);
  assert.match(issues(sides([[0, 0]], [[0, 0]]))[0], /both sides/);
  assert.match(issues(sides([[0, 0]], [[3, 2]]))[0], /wall/);
  assert.match(issues(sides([[0, 0]], [[6, 0]]))[0], /unwalkable/);
  assert.match(issues(sides([[0, 0]], [[9, 9]]))[0], /outside/);
  assert.match(
    issues(sides([[0, 0], [1, 0], [2, 0], [4, 0], [5, 0]], [[0, 1], [1, 1], [2, 1], [4, 1], [5, 1]]))[0],
    /side A has 5 deployment cells: a squad is at most 4/,
  );
  // Cover is fine to deploy on: only walls and unwalkable tiles abort place_recruit.
  assert.deepEqual(issues(sides([[0, 0]], [[1, 1]])), []);
});

test("the editor's own export names the same grid the preset encodes", () => {
  const level = sample();
  assert.deepEqual(decode(toPreset(level).bytes).tiles, exportLevel(level).move.tiles);
});

test("glass and tall fences encode as barrier sides (3) and say what the deployed package would make of them", () => {
  const level = sample();
  level.placements.push({ asset: "s13", at: [5, 1], turn: 0 }, { asset: "s15", at: [5, 3], turn: 3 });
  const preset = toPreset(level);
  const { tiles } = decode(preset.bytes);
  assert.deepEqual(tiles[1][5], { t: "cover", sides: [0, 3, 0, 0] });
  assert.deepEqual(tiles[0][5], { t: "cover", sides: [0, 0, 0, 3] });
  assert.deepEqual(tiles[3][5], { t: "cover", sides: [3, 0, 0, 0] });
  assert.deepEqual(tiles[3][4], { t: "cover", sides: [0, 1, 3, 0] }); // the sample's low block on its north edge too
  // A warning, not an error: the source package plays them; only the deployed one would not.
  assert.deepEqual(preset.issues.filter((i) => i.level === "error"), []);
  assert.ok(preset.issues.some((i) => i.level === "warn" && /barrier/.test(i.text)));
  assert.ok(!toPreset(sample()).issues.some((i) => /barrier/.test(i.text)));
});
