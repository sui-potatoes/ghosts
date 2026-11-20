// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { assetSpec } from "../catalog.ts";
import { Encounter } from "../game.ts";
import { blackRain } from "../scenario.ts";
import { paperTrail } from "../office/scenario.ts";
import { levelFromScenario } from "./from-plan.ts";
import { addSpawn, exportLevel, importLevel, newLevel, removeSpawn, SQUAD_SIZE, type Level, type Placement } from "./level.ts";
import { levelOrigin, playtestIssues, scenarioFromLevel } from "./playtest.ts";
import { toPreset } from "./preset.ts";

type Cell = [number, number];
const put = (level: Level, kind: Parameters<typeof assetSpec>[0], at: Cell, turn: Placement["turn"] = 0) =>
  level.placements.push({ asset: assetSpec(kind).uid, at, turn });

/** A 9×7 yard: a wall block, a crate, a low barrier and a high wall on edges, a pit, two a side. */
function yard() {
  const level = newLevel(9, 7);
  level.name = "yard";
  put(level, "block-fill", [4, 3]); // wall tile
  put(level, "crate", [2, 3]); // an obstacle: vaulted, never stood on, low cover beside it
  put(level, "block-cover", [6, 3], 0); // low edge north of [6,3]
  put(level, "block-high", [6, 5], 0); // high edge north of [6,5]
  level.unwalkable.push([8, 6]);
  level.spawns = { a: [[0, 6], [1, 6]], b: [[0, 0], [8, 0]] };
  level.objective = [4, 0];
  return level;
}

test("deployment: a side holds a squad at most, a full side refuses, a cell moves between sides", () => {
  let level = newLevel(6, 6);
  for (let x = 0; x < SQUAD_SIZE; x++) {
    const next = addSpawn(level, "a", [x, 5]);
    assert.notEqual(typeof next, "string");
    level = next as Level;
  }
  assert.equal(level.spawns.a.length, SQUAD_SIZE);
  // Nothing is dropped to make room: the fifth is refused with a reason.
  assert.match(addSpawn(level, "a", [5, 5]) as string, /Side A is full \(4/);
  assert.match(addSpawn(level, "b", [9, 9]) as string, /Outside/);
  // A side-A cell taken by side B leaves side A.
  const moved = addSpawn(level, "b", [0, 5]) as Level;
  assert.deepEqual(moved.spawns.a, [[1, 5], [2, 5], [3, 5]]);
  assert.deepEqual(moved.spawns.b, [[0, 5]]);
  assert.deepEqual(removeSpawn(moved, [0, 5]).spawns, { a: [[1, 5], [2, 5], [3, 5]], b: [] });
});

test("deployment travels with the export, both sides, and old single lists migrate to side A", () => {
  const level = yard();
  const back = importLevel(JSON.parse(JSON.stringify(exportLevel(level))));
  assert.deepEqual(back.level.spawns, level.spawns);
  assert.equal(back.migrated, false);
  // A save from before sides: one plain list.
  const old = JSON.parse(JSON.stringify(exportLevel(level)));
  old.render.spawns = [[0, 6], [1, 6], [2, 6], [3, 6]];
  const migrated = importLevel(old);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.level.spawns, { a: [[0, 6], [1, 6], [2, 6], [3, 6]], b: [] });
  // ...which leaves the level flagged: side B is still to place.
  assert.deepEqual(playtestIssues(migrated.level), ["No side B deployment"]);
  assert.ok(toPreset(migrated.level).issues.some((i) => i.level === "error" && /No side B/.test(i.text)));
  // A file with no deployment at all still loads.
  delete old.render.spawns;
  assert.deepEqual(importLevel(old).level.spawns, { a: [], b: [] });
});

test("a level becomes a scenario: centred grid, chain tiles, walls as footprints, sides deployed", () => {
  const level = yard();
  const scenario = scenarioFromLevel(level);
  const [minX, minZ] = levelOrigin(level);
  assert.deepEqual([minX, minZ], [-4, -3]);
  assert.deepEqual(scenario.map.bounds, { minX: -4, maxX: 4, minZ: -3, maxZ: 3 });
  // The rules play on exactly the grid the chain would get.
  assert.deepEqual(scenario.ground?.tiles, exportLevel(level).move.tiles);
  assert.deepEqual(scenario.ground && [scenario.ground.minX, scenario.ground.minZ], [-4, -3]);
  // The wall tile is a one-cell footprint in the scene; the pit is blocked; the crate's obstacle is the cover cell to vault.
  assert.deepEqual(scenario.map.buildings.map((b) => [b.x, b.z, b.w, b.d]), [[0, 0, 1, 1]]);
  assert.deepEqual(scenario.map.obstacles, [[4, 3]]);
  assert.deepEqual(scenario.map.covers, [[-2, 0]]);
  // Side A is the squad on its cells, side B one hostile per cell, all moved by the origin.
  const allies = scenario.units.filter((u) => !u.enemy), hostiles = scenario.units.filter((u) => u.enemy);
  assert.deepEqual(allies.map((u) => [u.id, u.pos]), [["v", [-4, 3]], ["g", [-3, 3]]]);
  assert.deepEqual(hostiles.map((u) => [u.id, u.role, u.pos]), [["h1", "ASSAULT", [-4, -3]], ["h2", "HEAVY", [4, -3]]]);
  assert.deepEqual(scenario.relay, [0, -3]);
  assert.equal(scenario.noObjective, undefined);
  // Every placement is drawn: the indestructible building block is scenery, the rest are props.
  assert.equal(scenario.map.props?.length, 3);
  const edge = scenario.map.props!.find((p) => p.kind === "block-high")!;
  assert.ok(Math.abs(edge.x - 2 * 1.35) < 1e-9 && Math.abs(edge.z - 1.5 * 1.35) < 1e-9, "edge prop on the edge midpoint");
  // Without an objective nothing is to secure and the relay leaves the grid.
  const open = scenarioFromLevel({ ...level, objective: undefined });
  assert.equal(open.noObjective, true);
  assert.ok(open.relay[0] < open.map.bounds.minX);
});

test("a level that cannot deploy is refused, every reason named", () => {
  const level = yard();
  assert.deepEqual(playtestIssues(level), []);
  // Uneven sides play (only the chain needs them even).
  assert.doesNotThrow(() => scenarioFromLevel({ ...level, spawns: { a: [[0, 6]], b: [[0, 0], [8, 0]] } }));
  assert.throws(() => scenarioFromLevel({ ...level, spawns: { a: [[0, 6]], b: [] } }), /No side B deployment/);
  assert.throws(
    () => scenarioFromLevel({ ...level, spawns: { a: [[4, 3]], b: [[8, 6]] } }),
    /4,3 stands on a wall.*8,6 stands on an unwalkable/,
  );
  assert.throws(() => scenarioFromLevel({ ...level, objective: [4, 3] }), /objective stands on a wall/);
});

test("the playtest moves, covers and sees by the chain's rules for its tiles", () => {
  const game = new Encounter(scenarioFromLevel(yard()));
  assert.ok(game.authority, "a level brings its ground");
  const cell = (x: number, z: number): Cell => [x - 4, z - 3];
  const unit = game.unit("v")!;
  unit.mobility = 12;
  unit.pos = cell(6, 4);
  const paths = game.paths(unit);
  // A step north from [6,4] to [6,3] crosses only low cover: allowed, no vault.
  assert.deepEqual(paths.get(cell(6, 3).join())?.length, 2);
  // [6,5] lies behind a high edge: reached around it, never through it.
  assert.ok(paths.get(cell(6, 5).join())!.length > 2);
  unit.pos = cell(6, 5);
  assert.ok(!game.paths(unit).has(cell(6, 4).join()) || game.paths(unit).get(cell(6, 4).join())!.length > 2);
  // The crate is an obstacle: never a destination, vaulted in two steps; walls and pits are not crossed.
  unit.pos = cell(2, 2);
  const around = game.paths(unit);
  assert.ok(!around.has(cell(2, 3).join()), "nobody stands on the crate");
  assert.deepEqual(around.get(cell(2, 4).join()), [cell(2, 2), cell(2, 3), cell(2, 4)], "vaulted straight over");
  assert.ok(!around.has(cell(4, 3).join()) && !around.has(cell(8, 6).join()));
  const [vault] = game.apply({ type: "move", unit: "v", to: cell(2, 4) });
  assert.ok(vault.type === "move" && vault.vault, "the move over the crate is a vault");
  // The crate gives low cover against a shot from across it, none from the side; the wall blocks the line through it.
  const hostile = game.unit("h1")!;
  hostile.pos = cell(2, 0);
  assert.equal(game.cover(unit, hostile), 25);
  hostile.pos = cell(6, 4);
  assert.equal(game.cover(unit, hostile), 0);
  hostile.pos = cell(2, 0);
  assert.equal(game.coverAt(cell(2, 4)), true);
  assert.equal(game.shotBlocked(cell(3, 3), cell(5, 3)), true);
  assert.equal(game.shotBlocked(cell(2, 0), cell(2, 4)), false, "an obstacle blocks no line");
  // A grenade clears every cover tile and obstacle within two: the crate is gone, its tile is bare ground.
  game.ingest({ type: "grenade", unit: "h1", at: cell(2, 2), casualties: [], environment: [] });
  assert.equal(game.cover(unit, hostile), 0);
  assert.equal(game.coverAt(cell(2, 4)), false);
  unit.pos = cell(2, 2);
  assert.equal(game.paths(unit).get(cell(2, 3).join())?.length, 2, "the cleared tile is a destination");
});

test("glass and tall fences stop a step and a shot like any high edge", () => {
  const level = yard();
  level.placements.push({ asset: "s13", at: [1, 4], turn: 0 }); // glass pane north of [1,4]
  level.placements.push({ asset: "s15", at: [0, 4], turn: 0 }); // tall chain-link north of [0,4]
  level.placements.push({ asset: "s06", at: [3, 4], turn: 0 }); // low sheet fence north of [3,4]
  const game = new Encounter(scenarioFromLevel(level));
  const cell = (x: number, z: number): Cell => [x - 4, z - 3];
  const unit = game.unit("v")!;
  unit.mobility = 12;
  unit.pos = cell(1, 4);
  const paths = game.paths(unit);
  assert.ok(paths.get(cell(1, 3).join())!.length > 2, "around the glass, not through it");
  assert.ok(paths.get(cell(0, 3).join())!.length > 2, "around the fence, not through it");
  // The low fence beside them is still a step.
  unit.pos = cell(3, 4);
  assert.equal(game.paths(unit).get(cell(3, 3).join())?.length, 2);
  // An order straight through the glass is refused.
  unit.pos = cell(1, 4);
  unit.mobility = 1;
  assert.deepEqual(game.apply({ type: "move", unit: "v", to: cell(1, 3) }), []);
  assert.deepEqual(unit.pos, cell(1, 4));
  // Sight, as for any high edge: it blocks a line only as an inner edge, so a shot that
  // crosses it mid-line is stopped, while one that starts or ends beside it is not.
  assert.equal(game.shotBlocked(cell(1, 0), cell(1, 5)), true, "glass");
  assert.equal(game.shotBlocked(cell(0, 0), cell(0, 5)), true, "tall fence");
  assert.equal(game.shotBlocked(cell(3, 0), cell(3, 5)), false, "the low fence stays clear");
  assert.equal(game.shotBlocked(cell(6, 0), cell(6, 6)), true, "the high block, same rule");
  assert.equal(game.shotBlocked(cell(1, 3), cell(1, 4)), false, "adjacent across the glass");
});

test("the shipped demos round-trip: Black Rain and Paper Trail playtest where the demo deploys", () => {
  for (const shipped of [blackRain, paperTrail]) {
    const { level } = levelFromScenario(shipped);
    const scenario = scenarioFromLevel(level);
    assert.deepEqual(scenario.map.bounds, shipped.map.bounds, shipped.id);
    assert.deepEqual(
      scenario.units.map((u) => [u.id, u.enemy ?? false, u.pos]),
      shipped.units.map((u) => [u.id, u.enemy ?? false, u.pos]),
      shipped.id,
    );
    assert.deepEqual(scenario.relay, shipped.relay);
    // Four against three: playable, but the chain would want even sides.
    assert.deepEqual(playtestIssues(level), []);
    assert.ok(toPreset(level).issues.some((i) => i.level === "error" && /Side A deploys 4, side B 3/.test(i.text)));
  }
  // The demos themselves keep the scene's own rules.
  assert.equal(new Encounter(blackRain).authority, undefined);
  assert.equal(new Encounter(paperTrail).authority, undefined);
});
