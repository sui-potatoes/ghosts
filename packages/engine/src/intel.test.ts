// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter, key, type Cell } from "./game.ts";
import {
  baseIntel,
  inspectOrder,
  RANGE_FALLOFF,
  stepInspect,
  threatArea,
  threatSignature,
  unknownIntel,
  weaponLabel,
} from "./intel.ts";
import { shootingTargets } from "./targeting.ts";

test("intel from a local unit: condition, weapon, utility uses and the rules' stats, nothing the rules lack", () => {
  const game = new Encounter();
  const u = game.enemies[0];
  u.actions.push({ kind: "Grenade", uses: 1 });
  const intel = baseIntel(game, u, "Light Armor");
  assert.equal(intel.known, true);
  assert.equal(intel.hostile, true);
  assert.equal(intel.callsign, u.name);
  assert.deepEqual(intel.condition, {
    hp: u.hp,
    maxHp: u.maxHp,
    armor: u.armor,
    ap: u.ap,
    apMax: 2,
    active: false,
    ammo: u.ammo,
    clip: u.clip,
  });
  assert.ok(intel.weapon && intel.weapon.mods.length === 0);
  assert.deepEqual(intel.armor, { name: "Light Armor" });
  assert.deepEqual(intel.utility && { uses: intel.utility.uses }, { uses: 1 });
  assert.deepEqual(intel.stats.damage, [u.damage, u.damage]);
  assert.equal(intel.stats.range, u.range);
  // The bundled rules have no dodge or defense: the readout must not invent them.
  assert.equal(intel.stats.dodge, undefined);
  assert.equal(intel.stats.defense, undefined);
  assert.deepEqual(intel.effects, []);

  // A grenade already thrown reads as spent.
  u.actions.find((a) => a.kind === "Grenade")!.uses = 0;
  assert.equal(baseIntel(game, u).utility?.uses, 0);
  // AP count only on the unit's own side's turn.
  game.phase = "enemy";
  assert.equal(baseIntel(game, u).condition.active, true);
});

test("an unarmed unit reads unarmed, with no ammo; a unit with no utility has none", () => {
  const game = new Encounter();
  const u = game.allies[0];
  u.actions = u.actions.filter((a) => a.kind !== "Attack" && a.kind !== "Reload" && a.kind !== "Grenade");
  const intel = baseIntel(game, u);
  assert.equal(intel.weapon, null);
  assert.equal(intel.utility, null);
  assert.equal(intel.condition.clip, 0);
});

test("the no-data state carries nothing but the side", () => {
  const intel = unknownIntel({ id: "x", enemy: true, name: "WRAITH" });
  assert.equal(intel.known, false);
  assert.equal(intel.hostile, true);
  assert.equal(intel.weapon, null);
});

test("a modded weapon is named with a trailing plus", () => {
  assert.equal(weaponLabel({ name: "Standard Rifle", mods: [] }), "Standard Rifle");
  assert.equal(weaponLabel({ name: "Standard Rifle", mods: [{ kind: "scope", name: "Scope", tier: 1 }] }), "Standard Rifle +");
});

test("inspect walks hostiles first, each left to right, skipping the fallen and the off-screen", () => {
  const units = [
    { id: "a1", enemy: false, hp: 5 },
    { id: "h1", enemy: true, hp: 5 },
    { id: "a2", enemy: false, hp: 5 },
    { id: "h2", enemy: true, hp: 5 },
    { id: "h3", enemy: true, hp: 0 },
    { id: "h4", enemy: true, hp: 5 },
  ];
  const x: Record<string, number | undefined> = { a1: 100, h1: 600, a2: 50, h2: 200, h3: 10, h4: undefined };
  const order = inspectOrder(units, (id) => x[id]);
  assert.deepEqual(order, ["h2", "h1", "a2", "a1"]);
  assert.equal(stepInspect(order, "", 1), "h2");
  assert.equal(stepInspect(order, "", -1), "a1");
  assert.equal(stepInspect(order, "h1", 1), "a2");
  assert.equal(stepInspect(order, "a1", 1), "h2");
  assert.equal(stepInspect(order, "h2", -1), "a1");
  assert.equal(stepInspect([], "h2", 1), "");
});

test("threat: the move area is the rules' own paths, the fire area agrees with the shot rules", () => {
  const game = new Encounter();
  const hostile = game.enemies[0];
  const area = threatArea(game, hostile);
  const paths = game.paths(hostile);
  assert.equal(area.move.length, paths.size);
  for (const cell of area.move) assert.ok(paths.has(key(cell)));

  const fire = new Map(area.fire.map((f) => [key(f.cell), f.falloff]));
  for (const { cell, falloff } of area.fire) {
    const d = Math.abs(cell[0] - hostile.pos[0]) + Math.abs(cell[1] - hostile.pos[1]);
    assert.ok(d <= hostile.range + RANGE_FALLOFF);
    assert.equal(falloff, d > hostile.range);
    assert.equal(game.shotBlocked(hostile.pos, cell), false);
  }
  // Every unit its weapon can reach stands in its fire area, and every one that stands there is reachable.
  const reachable = new Set(shootingTargets(game, hostile).map((t) => key(t.pos)));
  for (const target of game.allies) {
    assert.equal(fire.has(key(target.pos)), reachable.has(key(target.pos)), target.id);
  }
});

test("threat: unarmed means no fire area; recomputed only when the board changes", () => {
  const game = new Encounter();
  const hostile = game.enemies[0];
  const before = threatSignature(game, hostile);
  assert.equal(threatSignature(game, hostile), before);
  game.allies[0].pos = [game.allies[0].pos[0] + 1, game.allies[0].pos[1]] as Cell;
  assert.notEqual(threatSignature(game, hostile), before);
  hostile.actions = hostile.actions.filter((a) => a.kind !== "Attack");
  assert.equal(threatArea(game, hostile).fire.length, 0);
});
