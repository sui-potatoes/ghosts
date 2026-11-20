// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMBAT_ACTIONS } from "./keys.ts";
import { Encounter } from "./game.ts";
import { cycleUnit, observerAllows, rosters, sideOf, standing, turnLine } from "./observer.ts";

test("a viewer has the camera, the grid and the readouts, and no order", () => {
  const allowed = COMBAT_ACTIONS.filter(observerAllows);
  assert.deepEqual(allowed.sort(), ["camera", "cancel", "focus", "grid", "inspect", "next-operator", "rotate-left", "rotate-right"]);
  for (const order of ["move", "fire", "grenade", "flashbang", "smoke-grenade", "reload", "overwatch", "hunker", "secure", "confirm"] as const)
    assert.equal(observerAllows(order), false, order);
  assert.equal(observerAllows(null), false);
});

test("both squads are rosters of their own, side 0 first, and neither is the viewer's", () => {
  const game = new Encounter();
  const [zero, one] = rosters(game.units);
  assert.ok(zero.length && one.length);
  assert.ok(zero.every((u) => sideOf(u) === 0) && one.every((u) => sideOf(u) === 1));
  assert.equal(zero.length + one.length, game.units.length);
  one[0].hp = 0;
  const counts = standing(game.units);
  assert.deepEqual(counts[1], { alive: one.length - 1, total: one.length });
  assert.deepEqual(counts[0], { alive: zero.length, total: zero.length });
});

test("stepping through units walks the living of both sides, either way, and wraps", () => {
  const game = new Encounter();
  const [zero, one] = rosters(game.units);
  const order = [...zero, ...one].map((u) => u.id);
  assert.equal(cycleUnit(game.units, "", 1)?.id, order[0]);
  assert.equal(cycleUnit(game.units, "", -1)?.id, order.at(-1));
  assert.equal(cycleUnit(game.units, order[zero.length - 1], 1)?.id, one[0].id, "from side 0 into side 1");
  assert.equal(cycleUnit(game.units, order.at(-1)!, 1)?.id, order[0]);
  one[0].hp = 0;
  assert.equal(cycleUnit(game.units, order[zero.length - 1], 1)?.id, one[1].id, "the fallen are skipped");
  for (const u of game.units) u.hp = 0;
  assert.equal(cycleUnit(game.units, "", 1), undefined);
});

test("the turn line names the side whose turn it is", () => {
  assert.equal(turnLine(7, { name: "Vance" }), "TURN 07 / VANCE");
  assert.equal(turnLine(12, { name: "Hostiles" }), "TURN 12 / HOSTILES");
});
