// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGAGE_DISTANCE,
  hostileAction,
  hostileAdvance,
  nearestAlly,
  overwatchReactors,
} from "./ai.ts";
import { distance, Encounter, initialUnits } from "./game.ts";
import { blackRain, type Scenario } from "./scenario.ts";

const hostileTurn = () => {
  const g = new Encounter();
  g.beginEnemy();
  return g;
};

test("a far hostile advances to a reachable cell closer to the squad", () => {
  const g = hostileTurn(),
    enemy = g.enemies[0];
  const before = distance(enemy.pos, nearestAlly(g, enemy.pos)!.pos);
  assert.ok(before > ENGAGE_DISTANCE);
  const cell = hostileAdvance(g, enemy)!;
  assert.ok(cell);
  assert.ok(g.paths(enemy).has(cell.join(",")));
  assert.ok(distance(cell, nearestAlly(g, enemy.pos)!.pos) < before);
});

test("a hostile already engaged holds its ground", () => {
  const g = hostileTurn(),
    enemy = g.enemies[0];
  enemy.pos = [g.allies[0].pos[0], g.allies[0].pos[1] - 3];
  assert.equal(hostileAdvance(g, enemy), null);
});

test("hostiles reload an empty weapon, otherwise shoot the nearest ally", () => {
  const g = hostileTurn(),
    enemy = g.enemies[0];
  const next = hostileAction(g, enemy);
  assert.equal(next?.kind, "fire");
  assert.equal(next?.kind === "fire" && next.target, nearestAlly(g, enemy.pos));
  enemy.ammo = 0;
  assert.deepEqual(hostileAction(g, enemy), { kind: "reload" });
  enemy.hp = 0;
  assert.equal(hostileAction(g, enemy), null);
});

test("overwatch reacts once, out of turn, and only within reach", () => {
  const g = hostileTurn(),
    [ally] = g.allies,
    enemy = g.enemies[0];
  ally.overwatch = true;
  enemy.pos = [ally.pos[0], ally.pos[1] - (ally.range + 4)];
  assert.deepEqual(overwatchReactors(g, enemy), []);
  enemy.pos = [ally.pos[0], ally.pos[1] - 3];
  assert.deepEqual(overwatchReactors(g, enemy), [ally]);
  const ammo = ally.ammo;
  assert.ok(g.reactionFire(ally, enemy));
  assert.equal(ally.ammo, ammo - 1);
  assert.equal(ally.overwatch, false);
  assert.equal(ally.ap, 0);
  assert.equal(g.phase, "enemy");
  assert.equal(g.reactionFire(ally, enemy), null);
});

test("reaction fire needs the hostile turn and a watching ally", () => {
  const g = new Encounter(),
    [ally] = g.allies,
    enemy = g.enemies[0];
  ally.overwatch = true;
  assert.equal(g.reactionFire(ally, enemy), null);
  assert.equal(ally.overwatch, true);
});

test("an encounter deploys the scenario it is given", () => {
  const solo: Scenario = {
    ...blackRain,
    id: "solo",
    relay: [1, 1],
    lines: { ...blackRain.lines, opening: "Solo run." },
    units: blackRain.units.filter((u) => u.id === "v" || u.id === "h1"),
  };
  const g = new Encounter(solo);
  assert.deepEqual(g.units.map((u) => u.id), ["v", "h1"]);
  assert.deepEqual(g.relay, [1, 1]);
  assert.equal(g.hostileCount, 1);
  assert.deepEqual(g.log, ["Solo run."]);
  assert.notEqual(g.units[0].pos, solo.units[0].pos, "positions are copied, not shared");
  assert.equal(new Encounter().hostileCount, 3);
  assert.deepEqual(
    initialUnits().map((u) => [u.id, u.weapon, u.damage, u.range, u.ammo]),
    [
      ["v", "rifle", 6, 8, 3],
      ["g", "sniper", 9, 12, 3],
      ["b", "rifle", 6, 8, 3],
      ["e", "rifle", 6, 8, 3],
      ["h1", "rifle", 6, 8, 3],
      ["h2", "rifle", 6, 8, 3],
      ["h3", "sniper", 9, 12, 3],
    ],
  );
});
