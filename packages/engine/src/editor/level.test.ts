// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canPlace, edgeKey, exportLevel, hostTop, importLevel, newLevel, placementCells, placementsAt,
  restHeight, swapAsset, toMoveMap, turnOffset, type Placement, type Turn,
} from "./level.ts";
import { assetByUid, assetSpec, replacementsFor } from "../catalog.ts";

const place = (kind: Parameters<typeof assetSpec>[0], at: [number, number], turn: Turn = 0): Placement => ({
  asset: assetSpec(kind).uid,
  at,
  turn,
});

test("quarter turns walk a footprint clockwise around its origin", () => {
  assert.deepEqual(turnOffset([0, 1], 0), [0, 1]);
  assert.deepEqual(turnOffset([0, 1], 1), [1, 0]);
  assert.deepEqual(turnOffset([0, 1], 2), [0, -1]);
  assert.deepEqual(turnOffset([0, 1], 3), [-1, 0]);
  const table = assetSpec("office-meeting-table");
  assert.deepEqual(placementCells(table, { asset: table.uid, at: [4, 4], turn: 1 }), [[4, 4], [5, 4]]);
});

test("cell placement claims cells; dressing stacks, footprints do not", () => {
  const level = newLevel(8, 8);
  const crate = place("crate", [2, 2]);
  assert.ok(canPlace(level, crate));
  level.placements.push(crate);
  assert.equal(canPlace(level, place("cargo", [2, 2])), false);
  assert.ok(canPlace(level, place("cone", [2, 2])));
  assert.equal(canPlace(level, crate), false);
  // A multi-cell footprint is refused when any cell leaves the grid or is taken.
  assert.equal(canPlace(level, place("office-meeting-table", [2, 1])), false);
  assert.equal(canPlace(level, place("office-meeting-table", [0, 7])), false);
  assert.ok(canPlace(level, place("office-meeting-table", [0, 6])));
  // Nothing with a footprint stands on an unwalkable tile.
  level.unwalkable.push([5, 5]);
  assert.equal(canPlace(level, place("crate", [5, 5])), false);
  assert.ok(canPlace(level, place("cone", [5, 5])));
  assert.equal(placementsAt(level, [2, 2]).length, 1);
});

test("edges are shared: one wall per edge, named from either side", () => {
  const level = newLevel(6, 6);
  assert.equal(edgeKey([1, 1], 0), edgeKey([1, 0], 2));
  assert.equal(edgeKey([1, 1], 3), edgeKey([0, 1], 1));
  const wall = place("wall", [1, 1]);
  assert.ok(canPlace(level, wall));
  level.placements.push(wall);
  // The same edge from the other side is taken; the opposite side is free.
  assert.equal(canPlace(level, place("office-steel-wall", [1, 0], 2)), false);
  assert.ok(canPlace(level, place("office-steel-wall", [1, 2], 2)));
  // Boundary edges exist; a fully outside edge does not.
  assert.ok(canPlace(level, place("wall", [0, 5], 2)));
  assert.equal(canPlace(level, { asset: assetSpec("wall").uid, at: [0, 7], turn: 0 }), false);
  // Low cover seats on edges under the same rules as walls.
  assert.equal(canPlace(level, place("barrier", [1, 1])), false);
  assert.ok(canPlace(level, place("barrier", [1, 1], 1)));
  // Walls claim no cells: the cell next to the wall still takes a crate.
  assert.ok(canPlace(level, place("crate", [1, 1])));
  // An edge wall is reachable for erasing from both adjacent cells.
  assert.equal(placementsAt(level, [1, 1]).length, 1);
  assert.equal(placementsAt(level, [1, 0]).length, 1);
});

test("surface items need a host; wall mounts need a wall", () => {
  const level = newLevel(6, 6);
  const laptop = place("office-laptop", [2, 2]);
  assert.equal(canPlace(level, laptop), false);
  level.placements.push(place("office-desk", [2, 2]));
  assert.ok(canPlace(level, laptop));
  level.placements.push(laptop);
  assert.equal(hostTop(level, [2, 2]), 0.766);
  assert.equal(restHeight(level, laptop), 0.766);
  // The keypad mounts only on an edge that already holds a wall or door.
  const keypad = place("office-keypad", [3, 3]);
  assert.equal(canPlace(level, keypad), false);
  level.placements.push(place("office-steel-door", [3, 3]));
  assert.ok(canPlace(level, keypad));
  level.placements.push(keypad);
  assert.equal(restHeight(level, keypad), 1.05);
  // The door's edge is still one door: no second leaf, but the pad fits.
  assert.equal(canPlace(level, place("office-glass-door", [3, 3])), false);
});

test("the Move grid ranks footprints and writes edge cover onto both sides", () => {
  const level = newLevel(4, 3);
  level.placements.push(
    place("crate", [0, 0]),
    place("block-fill", [1, 0]),
    place("block-solid", [2, 0]),
    place("cone", [3, 0]),
    place("wall", [1, 2]),
    place("office-glass-wall", [3, 2], 3),
    place("office-steel-door", [0, 2]),
  );
  level.unwalkable.push([3, 1]);
  const map = toMoveMap(level);
  assert.deepEqual(map.size, [3, 4]);
  assert.deepEqual(map.tiles[0][0], { t: "cover", sides: [1, 1, 1, 1] });
  assert.deepEqual(map.tiles[0][1], { t: "wall" });
  assert.deepEqual(map.tiles[0][2], { t: "unwalkable" });
  assert.deepEqual(map.tiles[0][3], { t: "empty" });
  assert.deepEqual(map.tiles[1][3], { t: "unwalkable" });
  // The wall on the north edge of [1,2]: high on its top, high on [1,1]'s bottom.
  assert.deepEqual(map.tiles[2][1], { t: "cover", sides: [0, 2, 0, 0] });
  assert.deepEqual(map.tiles[1][1], { t: "cover", sides: [0, 0, 0, 2] });
  // Glazing west of [3,2] is low cover; a door marks nothing.
  assert.deepEqual(map.tiles[2][3], { t: "cover", sides: [1, 0, 0, 0] });
  assert.deepEqual(map.tiles[2][2], { t: "cover", sides: [0, 0, 1, 0] });
  assert.deepEqual(map.tiles[2][0], { t: "empty" });
});

test("stand-ins swap for same-seat assets only", () => {
  const level = newLevel(6, 6);
  const fill = place("block-fill", [2, 2]);
  level.placements.push(fill);
  const cellOptions = replacementsFor(fill.asset).map((a) => a.uid);
  assert.ok(cellOptions.includes(assetSpec("office-locker").uid));
  assert.ok(!cellOptions.includes(assetSpec("office-steel-wall").uid), "edge seats never swap in");
  assert.ok(!cellOptions.includes(assetSpec("crate").uid), "cover is not high cover");
  // The typed high-cover edge redresses as a real wall.
  const high = place("block-high", [4, 4]);
  level.placements.push(high);
  const edgeOptions = replacementsFor(high.asset).map((a) => a.uid);
  assert.ok(edgeOptions.includes(assetSpec("office-steel-wall").uid));
  assert.ok(!edgeOptions.includes(assetSpec("office-locker").uid));
  const swapped = swapAsset(level, fill, assetSpec("office-locker").uid);
  assert.ok(swapped);
  assert.equal(swapped.placements[0].asset, assetSpec("office-locker").uid);
  assert.equal(swapAsset(level, fill, "zz99"), null);
});

test("an export names assets by uid and reimports losslessly", () => {
  const level = newLevel(6, 6);
  level.name = "Yard 9";
  level.spawns = [[0, 5], [1, 5]];
  level.objective = [5, 0];
  level.unwalkable = [[4, 1]];
  level.floors = [{ floor: "f08", at: [1, 1] }, { floor: "f01", at: [2, 1] }];
  level.lighting = { time: "evening", strength: 2.2, sky: 0x101418 };
  level.lights = [{ at: [3, 3], color: 0xffe4ad, intensity: 6, height: 2.6 }];
  level.placements.push(
    place("block-weak", [2, 2], 1),
    { ...place("office-desk", [4, 4], 2), finish: "sand" },
    place("office-monitor", [4, 4]),
    place("wall", [1, 3]),
    place("office-keypad", [1, 3]),
  );
  const file = exportLevel(level);
  // The office color scheme rides the placement tuple and survives the trip.
  const desk = file.render.placements.find(([uid]) => uid === assetSpec("office-desk").uid)!;
  assert.equal(desk[5], "sand");
  assert.equal(file["ghosts-level"], 1);
  assert.ok(!JSON.stringify(file.render).includes("office-desk"));
  // Mounted items carry their derived rest height for renderers.
  const monitor = file.render.placements.find(([uid]) => uid === assetSpec("office-monitor").uid)!;
  assert.equal(monitor[4], 0.766);
  const back = importLevel(JSON.parse(JSON.stringify(file)));
  assert.equal(back.dropped, 0);
  // The import seats mounted items after their hosts; order is not meaning.
  const sorted = (l: typeof level) =>
    [...l.placements].sort((a, b) => `${a.asset}${a.at}`.localeCompare(`${b.asset}${b.at}`));
  assert.deepEqual(sorted(back.level), sorted(level));
  assert.deepEqual({ ...back.level, placements: [] }, { ...level, placements: [] });
});

test("imports survive unknown uids and reject other files", () => {
  const level = newLevel(5, 5);
  level.placements.push(place("crate", [1, 1]));
  const file = exportLevel(level);
  file.render.placements.push(["zz99", 2, 2, 0]);
  file.render.floors.push(["f99", 3, 3]);
  file.render.lights.push([9, 9, 0xffffff, 4, 2]);
  const back = importLevel(file);
  assert.equal(back.dropped, 2);
  assert.equal(back.level.placements.length, 1);
  // Out-of-bounds lights are dropped; saves without the field still load.
  assert.equal(back.level.lights.length, 0);
  delete (file.render as Partial<typeof file.render>).lights;
  assert.deepEqual(importLevel(file).level.lights, []);
  assert.throws(() => importLevel({ name: "nope" }), /ghosts level/i);
  assert.ok(assetByUid("zz99") === undefined);
});
