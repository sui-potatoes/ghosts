// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter, replayEncounter } from "./game.ts";
import { koraPlan } from "./district-plan.ts";
import { districtProps } from "./district-props.ts";
import { CELL, TacticalMap } from "./map.ts";
import { propHealth } from "./environment.ts";

test("prop variation is reproducible and every tactical cover has one solid prop", () => {
  assert.deepEqual(koraPlan.props!.filter((p) => !p.storefront), districtProps(koraPlan.covers, CELL));
  assert.equal(new Set(koraPlan.props!.map((p) => p.id)).size, koraPlan.props!.length);
  for (const cover of koraPlan.covers)
    assert.equal(koraPlan.props!.filter((p) => p.cover?.join() === cover.join()).length, 1);
  assert.equal(new Set(koraPlan.props!.map((p) => p.kind)).size, 13);
});

test("damage is a decision until applied; destroyed cover opens movement and removes defense", () => {
  const game = new Encounter(), prop = game.map.props.find((p) => p.kind === "crate" && p.cover)!;
  const cell = prop.cover!;
  game.allies[0].pos = [cell[0], cell[1] + 1];
  assert.equal(game.cover(game.allies[0]), 25);
  const changes = game.map.blastProps(cell);
  assert.equal(game.map.health(prop.id), propHealth.crate);
  assert.equal(game.map.open(cell), false);
  game.map.applyPropDamage(changes);
  assert.equal(game.map.open(cell), true);
  assert.equal(game.map.isCover(cell), false);
  assert.equal(game.cover(game.allies[0]), 0);
  assert.equal(game.map.damageProp(prop.id, 100).length, 0);
});

test("masonry survives one direct blast, breaks on the second, and new encounters stay intact", () => {
  const a = new Encounter(), b = new Encounter();
  const prop = a.map.props.find((p) => p.kind === "barrier")!;
  a.map.applyPropDamage(a.map.blastProps(prop.cover!));
  assert.equal(a.map.health(prop.id), 40);
  assert.equal(a.map.isCover(prop.cover!), true);
  a.map.applyPropDamage(a.map.blastProps(prop.cover!));
  assert.equal(a.map.health(prop.id), 0);
  assert.equal(a.map.isCover(prop.cover!), false);
  assert.equal(b.map.health(prop.id), 140);
  assert.equal(new TacticalMap(koraPlan).health(prop.id), 140);
});

test("grenade environment damage is journaled and replays identically", () => {
  const game = new Encounter();
  const prop = game.map.props.find((p) => p.kind === "crate" && p.cover)!;
  const unit = game.allies.find((u) => Math.abs(u.pos[0] - prop.cover![0]) + Math.abs(u.pos[1] - prop.cover![1]) <= 5)!;
  const events = game.apply({ type: "grenade", unit: unit.id, at: prop.cover! });
  assert.equal(events[0].type, "grenade");
  assert(events[0].type === "grenade" && events[0].environment?.some((p) => p.id === prop.id && p.destroyed));
  const replay = replayEncounter(game.scenario, events);
  assert.deepEqual(replay.map.covers, game.map.covers);
  for (const p of game.map.props) assert.equal(replay.map.health(p.id), game.map.health(p.id));
});

test("misses damage intervening cover, never props behind the shooter", () => {
  const game = new Encounter(), a = game.allies[0], b = game.enemies[0];
  a.pos = [0, -1]; b.pos = [0, -5]; a.aim = -100;
  const prop = game.map.props.find((p) => p.cover?.join() === "0,-4")!;
  game.attack(a, b);
  assert.equal(game.map.health(prop.id), propHealth[prop.kind] - 28);
  const replay = replayEncounter(game.scenario, game.events);
  assert.equal(replay.map.health(prop.id), game.map.health(prop.id));
});

test("blast reach and building shielding leave remote props intact", () => {
  const map = new TacticalMap(koraPlan);
  assert.deepEqual(map.blastProps([99, 99]), []);
  // A prop behind the solid seven-store building cannot be hit through it.
  const plan = { ...koraPlan, props: [
    { id: "shielded", kind: "crate" as const, x: -9.45, z: -11, yaw: 0, seed: 1 },
  ] };
  assert.deepEqual(new TacticalMap(plan).blastProps([-7, -7]), []);
});

test("glass breaks independently, while collapsing masonry also removes supported panes", () => {
  const map = new TacticalMap(koraPlan), pane = map.props.find((p) => !!p.support)!;
  map.applyPropDamage(map.damageProp(pane.id, 30));
  assert.equal(map.health(pane.id), 0);
  assert.equal(map.health(pane.support!), propHealth["window-wall"]);
  const fresh = new TacticalMap(koraPlan);
  const collapse = fresh.damageProp(pane.support!, 200, "blast");
  assert(collapse.some((p) => p.id === pane.id && p.destroyed));
  fresh.applyPropDamage(collapse);
  assert.equal(fresh.health(pane.id), 0);
  assert.equal(fresh.health(pane.support!), 0);
});

test("full-height walls resist repeated gunfire even after blast damage, but two direct blasts collapse them", () => {
  for (const kind of ["wall", "window-wall"] as const) {
    const map = new TacticalMap({
      ...koraPlan, buildings: [], covers: [[0, 0]],
      props: [{ id: "wall", kind, x: 0, z: 0, yaw: 0, seed: 1, cover: [0, 0] }],
    });
    for (const damage of [8, 28, 45, 1000]) {
      assert.deepEqual(map.damageProp("wall", damage), []);
      assert.equal(map.health("wall"), propHealth[kind]);
    }
    map.applyPropDamage(map.blastProps([0, 0]));
    const damagedHp = propHealth[kind] - 100;
    assert.equal(map.health("wall"), damagedHp);
    for (let shot = 0; shot < 100; shot++) map.applyPropDamage(map.damageProp("wall", 45));
    assert.equal(map.health("wall"), damagedHp);
    assert.equal(map.isCover([0, 0]), true);
    map.applyPropDamage(map.blastProps([0, 0]));
    assert.equal(map.health("wall"), 0);
    assert.equal(map.isCover([0, 0]), false);
  }
});

test("every demo cover can be destroyed through grenade commands and is restored in a fresh encounter", () => {
  for (const cell of koraPlan.covers) {
    const game = new Encounter();
    const prop = game.map.props.find((p) => p.cover?.join() === cell.join())!;
    const { minX, maxX, minZ, maxZ } = game.map.bounds;
    const throwingCells: [number, number][] = [];
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const distance = Math.abs(x - cell[0]) + Math.abs(z - cell[1]);
      if (game.map.open([x, z]) && distance >= 3 && distance <= 5) throwingCells.push([x, z]);
    }
    assert(throwingCells.length >= 2);
    for (const [i, unit] of game.allies.slice(0, 2).entries()) {
      unit.pos = throwingCells[i];
      const events = game.apply({ type: "grenade", unit: unit.id, at: cell });
      assert.equal(events[0]?.type, "grenade", `${prop.kind}: grenade accepted`);
      if (!game.map.health(prop.id)) break;
    }
    assert.equal(game.map.health(prop.id), 0, `${prop.kind}: destroyed`);
    assert.equal(game.map.isCover(cell), false, `${prop.kind}: defense removed`);
    assert.equal(game.map.open(cell), true, `${prop.kind}: tile released`);
    const replay = replayEncounter(game.scenario, game.events);
    assert.equal(replay.map.isCover(cell), false, `${prop.kind}: replay preserves destruction`);
    assert.equal(new Encounter().map.isCover(cell), true, `${prop.kind}: restart restores cover`);
  }
});

test("stray rounds shatter only the intersected storefront pane on either street face", () => {
  for (const [from, toward, shop] of [
    [[-8, 0], [-8, -3], "seven"], [[5, 0], [5, -3], "lawson"],
    [[-2, -5], [-3, -5], "seven"], [[2, -5], [3, -5], "lawson"],
  ] as const) {
    const map = new TacticalMap(koraPlan);
    const changes = map.strayShotProps(from, toward, 28);
    assert.equal(changes.length, 1);
    assert(changes[0].id.startsWith(`${shop}-glass-`));
    assert(changes[0].destroyed);
    assert(changes[0].impact?.every(Number.isFinite));
    map.applyPropDamage(changes);
    assert.deepEqual(map.strayShotProps(from, toward, 28), [], "a broken pane does not expose more props through the shop");
    assert.equal(map.props.find((p) => p.id === changes[0].id)!.cover, undefined, "glass is not cover");
    assert.deepEqual(map.covers, koraPlan.covers, "glass destruction cannot remove adjacent solid cover");
  }
  const map = new TacticalMap(koraPlan);
  assert.deepEqual(map.strayShotProps([5, -3], [5, 0], 28), [], "no damage behind the shooter");
  assert.deepEqual(map.strayShotProps([-11, -5], [-10, -5], 28), [], "the solid side wall shields other glazing");
  assert.deepEqual(map.strayShotProps([5, 0], [5, 0], 28), []);
});

test("storefront damage is journaled in combat and replayed without opening building cells", () => {
  const game = new Encounter(), a = game.allies[0], b = game.enemies[0];
  a.pos = [5, 0]; b.pos = [5, -3]; a.aim = -100;
  assert(game.attack(a, b));
  const event = game.events.at(-1)!;
  assert.equal(event.type, "shot");
  assert(event.type === "shot" && !event.hit && event.environment?.[0].id.startsWith("lawson-glass-"));
  const replay = replayEncounter(game.scenario, game.events);
  for (const prop of game.map.props) assert.equal(game.map.health(prop.id), replay.map.health(prop.id));
  assert.equal(game.map.open([5, -4]), false);
  assert.equal(replay.map.open([5, -4]), false);
  assert.equal(new Encounter().map.health(event.environment![0].id), propHealth.glass);
});

test("exterior explosions reach inset storefront glass without opening movement or sight through the store", () => {
  const map = new TacticalMap(koraPlan);
  const changes = map.blastProps([5, -3]);
  assert(changes.some((p) => p.id.startsWith("lawson-glass-0-") && p.destroyed));
  assert(!changes.some((p) => p.id.startsWith("seven-glass-")));
  map.applyPropDamage(changes);
  assert.equal(map.open([5, -4]), false);
  assert.equal(map.clearBuildingShot([6.75, -4], [6.75, -11]), false);
});
