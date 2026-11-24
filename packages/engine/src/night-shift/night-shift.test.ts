// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Night Shift as shipped (`level.json`, `chain.ts`): the file
 * reads whole and its chain copy is pinned; buildings are sealed rings round
 * empty interiors; every door is an open edge; the ground has two levels, the
 * roadway and everything else; every walkable tile can be reached; and the
 * opening move gives nobody a shot.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assetByUid } from "../catalog.ts";
import { massDims } from "../shop/catalog.ts";
import { ChainGround, type GroundTile } from "../chain-ground.ts";
import { edgeCells, floorRaise, importLevel, placementCells, toMoveMap, type Level } from "../editor/level.ts";
import { toPreset } from "../editor/preset.ts";
import { Encounter, type Cell } from "../game.ts";
import { hasExtraction } from "../scenario.ts";
import file from "./level.json" with { type: "json" };
import { nightShiftLevel } from "./level.ts";
import { nightShiftScenario } from "./scenario.ts";
import {
  NIGHT_SHIFT_MAP, NIGHT_SHIFT_NAME, NIGHT_SHIFT_POSITIONS, NIGHT_SHIFT_SIZE,
} from "./chain.ts";

const level: Level = nightShiftLevel();
const tiles = toMoveMap(level).tiles;
const tile = ([x, z]: readonly number[]) => tiles[z]?.[x];
const key = (c: readonly number[]) => `${c[0]},${c[1]}`;
const inside = ([x, z]: readonly number[]) => x >= 0 && z >= 0 && x < level.width && z < level.depth;
const N4: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** The roadway: the only ground at road level. */
const ROAD = (x: number) => x >= 2 && x <= 5;

/** A placement that is a building mass: a per-tile piece (`u01`–`u04`) or a whole-building asset. */
const isMass = (p: Level["placements"][number]) => /^u0[1-4]$/.test(p.asset) || massDims(assetByUid(p.asset)!.kind) !== null;
/** Building masses by cell (a whole-building asset by the cells of its ring); the buildings are their 4-connected runs plus enclosed unwalkable interiors. */
const massCells = new Set(level.placements.filter(isMass).flatMap((p) => /^u0[1-4]$/.test(p.asset) ? [p.at] : placementCells(assetByUid(p.asset)!, p)).map(key));
const unwalkable = new Set(level.unwalkable.map(key));
const building = (c: readonly number[]) => massCells.has(key(c)) || unwalkable.has(key(c)) && N4.some(([dx, dz]) => massCells.has(key([c[0] + dx, c[1] + dz])));

test("the file reads whole and the chain's copy is pinned", () => {
  assert.equal(importLevel(file).dropped, 0);
  const preset = toPreset(level);
  assert.deepEqual(preset.issues.filter((i) => i.level === "error"), []);
  assert.equal(Buffer.from(preset.bytes).toString("hex"), NIGHT_SHIFT_MAP, "re-pin chain.ts only with a new preset on chain");
  assert.deepEqual([preset.rows, preset.cols], NIGHT_SHIFT_SIZE);
  assert.deepEqual(preset.positions, NIGHT_SHIFT_POSITIONS);
  assert.equal(level.name, NIGHT_SHIFT_NAME);
  assert.equal(NIGHT_SHIFT_POSITIONS.length, 8, "four a side: squads of three take the last three");
});

test("buildings: a ring of walls round an empty interior, nothing placed in them", () => {
  for (const cell of massCells) assert.equal(tile(cell.split(",").map(Number))?.t, "wall", `mass at ${cell} is a Wall`);
  for (const p of level.placements) {
    if (isMass(p)) continue;
    const spec = assetByUid(p.asset)!;
    // an edge piece may hang on a building's face (a noren, lanterns): never on an edge inside it
    if (spec.place === "edge") {
      const cells = edgeCells(p.at, p.turn).filter(inside);
      assert.ok(cells.some((c) => !building(c)), `${p.asset} at ${p.at} is inside a building`);
      continue;
    }
    for (const c of placementCells(spec, p)) assert.ok(!building(c), `${p.asset} at ${p.at} sits on building cell ${c}`);
  }
  for (const f of level.floors) assert.ok(!building(f.at), `floor ${f.floor} inside a building at ${f.at}`);
  for (const l of level.lights) assert.ok(!building(l.at), `light inside a building at ${l.at}`);
  // an interior is unreachable: every neighbour is the ring or another interior cell
  for (const c of level.unwalkable)
    if (building(c)) for (const [dx, dz] of N4) assert.ok(building([c[0] + dx, c[1] + dz]), `interior ${c} touches the outside`);
});

test("no line of sight slips through a building: its interior could be solid and nothing would change", () => {
  const sealed: GroundTile[][] = tiles.map((row, z) => row.map((t, x) => (unwalkable.has(key([x, z])) && building([x, z]) ? { t: "wall" } : t)));
  const real = new ChainGround({ tiles, minX: 0, minZ: 0 });
  const solid = new ChainGround({ tiles: sealed, minX: 0, minZ: 0 });
  const open: Cell[] = [];
  tiles.forEach((row, z) => row.forEach((t, x) => { if (t.t === "empty" || t.t === "cover") open.push([x, z]); }));
  let pairs = 0;
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++) {
      pairs++;
      assert.equal(real.clearShot(open[i], open[j]), solid.clearShot(open[i], open[j]), `${open[i]} to ${open[j]}`);
    }
  assert.ok(pairs > 40000);
});

test("every door is an open edge: no cover across it, a step through it", () => {
  const doors = level.placements.filter((p) => ["u05", "u21", "o17", "o18"].includes(p.asset));
  assert.ok(doors.length >= 4, "front, road side, back and staff doors");
  const ground = new ChainGround({ tiles, minX: 0, minZ: 0 });
  for (const p of doors) {
    const [a, b] = edgeCells(p.at, p.turn);
    for (const c of [a, b]) assert.ok(["empty", "cover"].includes(tile(c)!.t), `door ${p.asset} at ${p.at} opens onto ${c}`);
    assert.ok(ground.step(a, b) && ground.step(b, a), `a unit walks through ${p.asset} at ${p.at}`);
    // a door adds nothing: the edge carries no side but what the walls beside it give
    const sides = (c: Cell) => {
      const t = tile(c)!;
      return t.t === "cover" ? t.sides : [0, 0, 0, 0];
    };
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const out = dz < 0 ? 1 : dz > 0 ? 3 : dx < 0 ? 0 : 2; // [left, top, right, bottom]
    assert.equal(sides(a)[out], 0, `no cover on ${a} across ${p.asset}`);
    assert.equal(sides(b)[(out + 2) % 4], 0, `no cover on ${b} across ${p.asset}`);
  }
});

test("two ground levels: the roadway, and everything else at pavement height", () => {
  const pavement = 0.16;
  tiles.forEach((row, z) => row.forEach((t, x) => {
    if (t.t === "wall" || t.t === "unwalkable") return;
    assert.equal(floorRaise(level, [x, z]), ROAD(x) ? 0 : pavement, `ground at ${x},${z}`);
  }));
  // no edge run straddles the kerb: only the kerb itself stands on it, and dressing hung on a building's face
  for (const p of level.placements) {
    const spec = assetByUid(p.asset)!;
    if (spec.place !== "edge" || p.asset === "u64" || p.asset === "u65") continue;
    const [a, b] = edgeCells(p.at, p.turn).filter(inside) as [Cell, Cell?];
    if (!b || tile(a)!.t === "wall" || tile(b)!.t === "wall") continue;
    assert.equal(floorRaise(level, a), floorRaise(level, b), `${p.asset} at ${p.at} straddles a level change`);
  }
  // no kerb pieces: the raised pavement slab shows its own side face at the road edge
  assert.equal(level.placements.filter((p) => p.asset === "u64" || p.asset === "u65").length, 0);
});

test("every walkable tile can be reached from both deployments", () => {
  const scenario = nightShiftScenario(level);
  const ground = new ChainGround(scenario.ground!);
  const { minX, minZ } = scenario.ground!;
  const standable = (c: Cell) => ["empty", "cover"].includes(tile(c)?.t ?? "");
  for (const side of ["a", "b"] as const) {
    const seen = new Set([key(level.spawns[side][0])]);
    const queue: Cell[] = [level.spawns[side][0]];
    while (queue.length) {
      const c = queue.shift()!;
      for (const [dx, dz] of N4) {
        const n: Cell = [c[0] + dx, c[1] + dz];
        if (!inside(n) || seen.has(key(n)) || tile(n)!.t === "wall" || tile(n)!.t === "unwalkable") continue;
        if (!ground.step([c[0] + minX, c[1] + minZ], [n[0] + minX, n[1] + minZ])) continue;
        seen.add(key(n));
        queue.push(n);
      }
    }
    tiles.forEach((row, z) => row.forEach((_, x) => {
      if (standable([x, z])) assert.ok(seen.has(key([x, z])), `${x},${z} cannot be reached from side ${side}`);
    }));
  }
});

test("the opening move gives nobody a shot or a grenade, at four a side", () => {
  const scenario = nightShiftScenario(level);
  assert.equal(hasExtraction(scenario), false);
  const game = new Encounter(scenario);
  assert.equal(game.allies.length, 4);
  assert.equal(game.enemies.length, 4);
  const ground = new ChainGround(scenario.ground!);
  for (const [movers, targets] of [[game.allies, game.enemies], [game.enemies, game.allies]]) {
    for (const mover of movers) {
      const all = game.units;
      game.units = [mover, ...targets];
      for (const path of game.paths(mover).values()) {
        const end = path[path.length - 1];
        for (const target of targets) {
          const distance = Math.abs(end[0] - target.pos[0]) + Math.abs(end[1] - target.pos[1]);
          assert.ok(distance > 7, `${mover.id} at ${end} is in grenade reach of ${target.id}`);
          assert.ok(distance > 11 || !ground.clearShot(end, target.pos), `${mover.id} at ${end} has a shot at ${target.id}`);
        }
      }
      game.units = all;
    }
  }
});
