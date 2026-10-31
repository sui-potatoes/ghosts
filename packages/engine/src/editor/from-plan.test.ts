// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLevels, levelFromScenario } from "./from-plan.ts";
import { exportLevel, importLevel, placementsAt, toMoveMap } from "./level.ts";
import { assetByUid, assetSpec } from "../catalog.ts";
import { blackRain } from "../scenario.ts";

test("Black Rain reconstructs: covers seated, buildings as stand-ins, squad deployed", () => {
  const { level } = levelFromScenario(blackRain);
  assert.equal(level.name, "black-rain");
  assert.equal(level.width, 18);
  assert.equal(level.depth, 14);
  // Every tactical cover cell carries exactly one cover-footprint asset.
  for (const cell of blackRain.map.covers) {
    const at: [number, number] = [cell[0] + 9, cell[1] + 7];
    const covers = placementsAt(level, at).filter(
      (p) => assetByUid(p.asset)!.footprint === "cover",
    );
    assert.equal(covers.length, 1, `cover at ${cell.join()}`);
  }
  // The four solid buildings became swappable building blocks: 5·4+5·4+3·4+4·3.
  const blocks = level.placements.filter((p) => p.asset === assetSpec("block-fill").uid);
  assert.equal(blocks.length, 64);
  assert.equal(level.spawns.length, 4);
  assert.deepEqual(level.objective, [9, 5]);
  // The tile grid holds the buildings as walls.
  const map = toMoveMap(level);
  assert.deepEqual(map.tiles[2][2], { t: "wall" });
  const flat = map.tiles.flat();
  assert.ok(flat.some((t) => t.t === "cover"));
});

test("Paper Trail reconstructs: walls on edges, clutter re-mounted, floors painted", () => {
  const demo = demoLevels.find((d) => d.id === "paper-trail")!;
  const { level } = demo.build();
  assert.equal(level.width, 15);
  assert.equal(level.depth, 13);
  // The records wall line landed on edges: high cover sides, not wall tiles.
  const map = toMoveMap(level);
  const sides = map.tiles.flat().filter((t) => t.t === "cover");
  assert.ok(sides.length >= 10);
  // Desks host their clutter; nothing floats on a bare floor.
  const desks = level.placements.filter((p) => assetByUid(p.asset)!.top !== undefined);
  assert.ok(desks.length >= 8);
  for (const p of level.placements) {
    const spec = assetByUid(p.asset)!;
    if (spec.mount === "surface")
      assert.ok(
        placementsAt(level, p.at).some((o) => assetByUid(o.asset)!.top !== undefined),
        `${spec.name} floats`,
      );
  }
  // The plan's office color schemes survive the conversion (desks in sand).
  assert.ok(level.placements.some((p) => p.finish === "sand"));
  // Floor zones painted the office; the save round-trips (the import seats
  // mounted items after their hosts, so order is not meaning).
  assert.ok(level.floors.length > 100);
  const back = importLevel(JSON.parse(JSON.stringify(exportLevel(level))));
  assert.equal(back.dropped, 0);
  const sorted = (l: typeof level) =>
    [...l.placements].sort((a, b) => `${a.asset}${a.at}${a.turn}`.localeCompare(`${b.asset}${b.at}${b.turn}`));
  assert.deepEqual(sorted(back.level), sorted(level));
  assert.deepEqual({ ...back.level, placements: [] }, { ...level, placements: [] });
});

test("conversion drops out-of-bounds dressing without failing", () => {
  const { level, dropped } = demoLevels.find((d) => d.id === "black-rain")!.build();
  assert.ok(dropped > 0, "street dressing outside the grid is counted");
  for (const p of level.placements) {
    const spec = assetByUid(p.asset)!;
    if (spec.place === "edge") continue;
    assert.ok(p.at[0] >= 0 && p.at[0] < level.width && p.at[1] >= 0 && p.at[1] < level.depth);
  }
});
