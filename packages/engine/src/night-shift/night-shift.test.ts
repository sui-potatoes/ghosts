// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Night Shift as shipped: the file reads whole, the chain's copy is pinned,
 * the props say on chain what they look like, and the opening is fair.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assetByUid } from "../catalog.ts";
import { ChainGround } from "../chain-ground.ts";
import { importLevel, placementCells, toMoveMap } from "../editor/level.ts";
import { toPreset } from "../editor/preset.ts";
import { Encounter, type Cell } from "../game.ts";
import { hasExtraction } from "../scenario.ts";
import file from "./level.json" with { type: "json" };
import { nightShiftLevel } from "./level.ts";
import { nightShiftScenario, NIGHT_SHIFT_ID } from "./scenario.ts";
import { NIGHT_SHIFT_MAP, NIGHT_SHIFT_NAME, NIGHT_SHIFT_POSITIONS, NIGHT_SHIFT_SIZE } from "./chain.ts";

const level = nightShiftLevel();
const tiles = toMoveMap(level).tiles;
const tile = ([x, z]: readonly number[]) => tiles[z]?.[x];

test("the file reads whole and the chain would take it", () => {
  assert.equal(importLevel(file).dropped, 0);
  assert.deepEqual([level.width, level.depth], [19, 24]);
  const preset = toPreset(level);
  assert.deepEqual(preset.issues.filter((i) => i.level === "error"), []);
  assert.equal(level.name, NIGHT_SHIFT_NAME);
});

test("the chain's copy is pinned: map bytes, size and positions", () => {
  const preset = toPreset(level);
  assert.equal(Buffer.from(preset.bytes).toString("hex"), NIGHT_SHIFT_MAP, "re-pin chain.ts only with a new preset on chain");
  assert.deepEqual([preset.rows, preset.cols], NIGHT_SHIFT_SIZE);
  assert.deepEqual(preset.positions, NIGHT_SHIFT_POSITIONS);
  // four a side: one preset serves squads of three (the last three of a side) and four
  assert.equal(NIGHT_SHIFT_POSITIONS.length, 8);
});

test("every prop is on chain what it looks like", () => {
  const uids = new Set(level.placements.map((p) => p.asset));
  // a cell prop with the obstacle footprint is an Unwalkable tile no frag clears
  for (const uid of uids) {
    const spec = assetByUid(uid)!;
    assert.ok(spec.place === "edge" || spec.footprint !== "obstacle", `${uid} would be Unwalkable`);
  }
  assert.equal(tiles.flat().filter((t) => t.t === "unwalkable").length, 0);
  // the tall gondola draws 1.8 m over a tile units see across
  for (const uid of ["k20", "k21", "k22"]) assert.ok(!uids.has(uid), `${uid} is not used`);
});

test("tall wall-backed units stand against a wall, one deep", () => {
  // back on the cell's north edge at turn 0; a turn yaws the mesh a quarter clockwise from above
  const behind: Record<number, Cell> = { 0: [0, -1], 1: [-1, 0], 2: [0, 1], 3: [1, 0] };
  const runs = level.placements.filter((p) => /^k(0[1-9]|1[0-6])$/.test(p.asset));
  assert.equal(runs.length, 9, "four fridges, two chillers, three wall shelves");
  for (const p of runs) {
    const [dx, dz] = behind[p.turn];
    const back = tile([p.at[0] + dx, p.at[1] + dz]);
    const front = tile([p.at[0] - dx, p.at[1] - dz]);
    assert.equal(back?.t, "wall", `${p.asset} at ${p.at} has a wall behind it`);
    assert.notEqual(front?.t, "obstacle", `${p.asset} at ${p.at} is one deep`);
    assert.equal(tile(p.at)?.t, "obstacle", `${p.asset} at ${p.at} is a vaultable, frag-cleared tile`);
  }
});

test("the store's walls are walls: no shot through the stockroom or the partition", () => {
  const ground = new ChainGround({ tiles, minX: 0, minZ: 0 });
  // back lane against the back wall, to the stockroom against it
  assert.equal(ground.clearShot([11, 6], [11, 8]), false);
  // stockroom to sales floor, through the partition
  assert.equal(ground.clearShot([11, 9], [11, 11]), false);
  // alley to sales floor through the east wall
  assert.equal(ground.clearShot([16, 12], [13, 12]), false);
  // storefront glass: a shooter against it sees out
  assert.equal(ground.clearShot([9, 15], [9, 17]), true);
});

test("the scenario: four a side, no extraction, nobody in reach of a shot or a grenade on the opening move", () => {
  const scenario = nightShiftScenario();
  assert.equal(scenario.id, NIGHT_SHIFT_ID);
  assert.equal(hasExtraction(scenario), false);
  const game = new Encounter(scenario);
  assert.equal(game.allies.length, 4);
  assert.equal(game.enemies.length, 4);
  const ground = new ChainGround(scenario.ground!);
  for (const [movers, targets] of [[game.allies, game.enemies], [game.enemies, game.allies]]) {
    for (const mover of movers) {
      // alone on the map, so nobody stands in the way of a move
      game.units = [mover];
      for (const path of game.paths(mover).values()) {
        const end = path[path.length - 1];
        for (const target of targets) {
          const distance = Math.abs(end[0] - target.pos[0]) + Math.abs(end[1] - target.pos[1]);
          // a grenade flies 5 and bursts 2; the longest rifle reaches 11
          assert.ok(distance > 7, `${mover.id} at ${end} is in grenade reach of ${target.id}`);
          assert.ok(distance > 11 || !ground.clearShot(end, target.pos), `${mover.id} at ${end} has a shot at ${target.id}`);
        }
      }
    }
  }
});

test("both deployments are clear of each other and of the props", () => {
  for (const side of ["a", "b"] as const) {
    for (const cell of level.spawns[side]) assert.equal(tile(cell)?.t, "empty", `${side} ${cell}`);
    const cells = level.placements.flatMap((p) => {
      const spec = assetByUid(p.asset)!;
      return spec.place === "edge" || spec.footprint === "none" ? [] : placementCells(spec, p);
    });
    for (const cell of level.spawns[side])
      assert.ok(!cells.some((c) => c[0] === cell[0] && c[1] === cell[1]), `${side} ${cell} is free`);
  }
});

test("a frag clears the scene's shelves and fridges on the tiles the rules clear", () => {
  const scenario = nightShiftScenario();
  const game = new Encounter(scenario);
  const { minX, minZ } = scenario.ground!;
  const cell = ([x, z]: Cell): Cell => [x + minX, z + minZ];
  // a frag in the first operator's kit, as a deployed loadout gives it
  const thrower = game.allies[0];
  if (!thrower.actions.some((a) => a.kind === "Grenade")) thrower.actions.push({ kind: "Grenade", uses: 1 });
  // in the aisle, four tiles from the fridge run on the east wall
  thrower.pos = cell([11, 13]);
  const fridges: Cell[] = [[14, 11], [14, 12], [14, 13], [14, 14]];
  const standing = () => game.map.props.filter((p) => p.cover && game.map.health(p.id) > 0).map((p) => `${p.cover}`);
  for (const at of fridges) assert.ok(standing().includes(`${cell(at)}`), `a fridge stands at ${at}`);
  assert.equal(game.throwGrenade(thrower, cell([14, 12])), true);
  for (const at of fridges) {
    assert.equal(game.authority!.terrain(cell(at)), "open", `the rules clear ${at}`);
    assert.ok(!standing().includes(`${cell(at)}`), `the scene clears ${at}`);
  }
  // the chillers three tiles off stand, in the rules and in the scene
  assert.equal(game.authority!.terrain(cell([12, 11])), "obstacle");
  assert.ok(standing().includes(`${cell([12, 11])}`));
});
