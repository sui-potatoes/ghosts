// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The layout view's readouts and copied text, against Night Shift as shipped. */
import assert from "node:assert/strict";
import test from "node:test";
import { toMoveMap } from "./editor/level.ts";
import { nightShiftLevel } from "./night-shift/level.ts";
import { addRect, copyText, readout, rectCells, selectionRect, selectionRuns, tileInfo, toggleCell, type LayoutCell } from "./layout-readout.ts";

const level = nightShiftLevel();
const { tiles } = toMoveMap(level);

test("a tile reads as the rules see it", () => {
  const van = tileInfo(tiles, level, [8, 5])!;
  assert.equal(van.type, "unwalkable");
  assert.equal(tileInfo(tiles, level, [9, 10])?.type, "empty");
  assert.equal(tileInfo(tiles, level, [8, 7])?.type, "wall");
  assert.equal(tileInfo(tiles, level, [99, 0]), null);
});

test("an edge asset shows on both tiles it separates, with the edge it stands on", () => {
  const fence = tileInfo(tiles, level, [8, 18])!;
  assert.deepEqual(fence.sides.find((s) => s.side === "W"), { side: "W", level: "high" });
  assert.ok(fence.placed.some((p) => p.edge === "W"));
  const outside = tileInfo(tiles, level, [7, 18])!;
  assert.ok(outside.placed.some((p) => p.edge === "E"));
  assert.match(readout(fence), /^8,18 · cover · .*W high · .* on W edge/);
});

test("painted floor is named", () => {
  const info = tileInfo(tiles, level, [3, 10])!;
  assert.ok(info.floor, "the crosswalk is painted floor");
  assert.match(readout(info), /floor \w+ \(/);
  assert.ok(tileInfo(tiles, level, [0, 0])?.floor, "so is the pavement");
});

test("spawns are marked", () => {
  const a = level.spawns.a[0];
  assert.equal(tileInfo(tiles, level, a)?.spawn, "A");
  assert.match(readout(tileInfo(tiles, level, a)!), /spawn A/);
});

test("selecting: toggle, rectangle, runs", () => {
  let sel: readonly LayoutCell[] = [];
  sel = toggleCell(sel, [8, 5]);
  sel = toggleCell(sel, [9, 5]);
  assert.equal(sel.length, 2);
  assert.equal(toggleCell(sel, [8, 5]).length, 1);
  sel = addRect(sel, [8, 5], [10, 6]);
  assert.equal(sel.length, 6);
  assert.equal(selectionRect(sel), "8..10 × 5..6");
  assert.deepEqual(selectionRuns(sel), ["(8..10,5)", "(8..10,6)"]);
  assert.equal(selectionRect(toggleCell(sel, [10, 6])), null);
  assert.equal(rectCells([2, 3], [1, 4]).length, 4);
});

test("copied text for a rectangle and for a column of fence", () => {
  const van = copyText("Night Shift", tiles, level, rectCells([8, 5], [10, 6]));
  const lines = van.split("\n");
  assert.ok(lines[0].startsWith("Night Shift · tiles (8,5) (9,5) (10,5) (8,6) (9,6) (10,6) · rect 8..10 × 5..6"));
  assert.match(lines[1], /x east, y south/);
  assert.equal(lines.length, 2 + 6);
  assert.match(lines[2], /^\(8,5\) unwalkable · no sides · /);
  const fence = copyText("Night Shift", tiles, level, [[8, 17], [8, 18], [8, 19]]);
  assert.match(fence.split("\n")[0], /^Night Shift · tiles \(8,17\) \(8,18\) \(8,19\) · rect 8 × 17..19$/);
  assert.match(fence, /W high/);
});

test("a big selection is ranges and a type count, not a line per tile", () => {
  const text = copyText("Night Shift", tiles, level, rectCells([0, 0], [4, 4]));
  const lines = text.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /25 tiles \(0\.\.4,0\) .* rect 0\.\.4 × 0\.\.4$/);
  assert.match(lines[2], /^types: /);
  assert.equal(copyText("Night Shift", tiles, level, []), "Night Shift · no tiles selected");
});
