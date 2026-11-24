// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The layout view's readouts and copied text, against Night Shift as shipped. */
import assert from "node:assert/strict";
import test from "node:test";
import { toMoveMap } from "./editor/level.ts";
import { nightShiftLevel } from "./night-shift/level.ts";
import { addRect, copyText, coverEdges, edgeCover, readout, rectCells, selectionRect, selectionRuns, tileInfo, toggleCell, type LayoutCell } from "./layout-readout.ts";

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
  assert.match(lines[2], /^\(8,5\) unwalkable · .*v04 \(Delivery van\)$/);
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

test("an edge beside an obstacle reads high from both tiles", () => {
  // The store's west glass: (7,13) is cover with its east side high; (8,13) is the magazine rack, an obstacle that holds no sides.
  assert.equal(tiles[13][8].t, "obstacle");
  assert.equal(edgeCover(tiles, [8, 13], "W"), 2);
  assert.equal(edgeCover(tiles, [7, 13], "E"), 2);
  const rack = tileInfo(tiles, level, [8, 13])!;
  assert.deepEqual(rack.sides.find((s) => s.side === "W"), { side: "W", level: "high" });
  assert.match(readout(rack), /obstacle · .*W high/);
  assert.deepEqual(tileInfo(tiles, level, [7, 13])!.sides.find((s) => s.side === "E"), { side: "E", level: "high" });
  // the door gap
  assert.equal(edgeCover(tiles, [8, 9], "W"), 0);
});

test("a wall or an obstacle next door covers a tile to stand on, shown as such", () => {
  const rows = [[{ t: "empty" }, { t: "obstacle" }, { t: "wall" }]] as Parameters<typeof tileInfo>[0];
  const info = tileInfo(rows, null, [1, 0])!;
  assert.deepEqual(info.sides, []);
  const empty = tileInfo([[{ t: "obstacle" }, { t: "empty" }, { t: "wall" }]] as typeof rows, null, [1, 0])!;
  assert.deepEqual(empty.sides, [
    { side: "E", level: "high", by: "wall" },
    { side: "W", level: "low", by: "obstacle" },
  ]);
});

test("each shared edge is drawn once", () => {
  const edges = coverEdges(tiles);
  const keys = edges.map((e) => `${e.cell}:${e.side}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(edges.filter((e) => e.cell[0] === 8 && e.cell[1] === 13 && e.side === "W").length, 1);
  // every x = 8 glass edge from y 10 to 14 except the door at 9 is there
  for (const y of [10, 11, 12, 13, 14]) assert.ok(edges.some((e) => e.cell[0] === 8 && e.cell[1] === y && e.side === "W" && e.level === 2), `edge at 8,${y}`);
});
