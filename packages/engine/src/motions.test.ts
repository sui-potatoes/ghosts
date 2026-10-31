// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { reloadMotion, restMotion, reactionMotion, motions } from "./motions.ts";
test("reloads use distinct sidearm and covered-rifle motions", () => {
  assert.equal(reloadMotion("pistol", true), "pistol_reload");
  assert.equal(reloadMotion("rifle", true), "crouch_reload");
  assert.equal(reloadMotion("rifle", false), "reload");
});
test("protective and overwatch poses survive normal state synchronization", () => {
  const u = { weapon: "rifle" as const, hunkered: true, overwatch: false };
  assert.equal(restMotion(u, false), "hunker_down");
  assert.equal(
    restMotion({ ...u, hunkered: false, overwatch: true }, true),
    "overwatch_ready",
  );
  assert.equal(
    restMotion({ ...u, hunkered: false }, true),
    "rifle_crouch_idle",
  );
  assert.equal(
    restMotion({ ...u, hunkered: false, weapon: "pistol" }, false),
    "pistol_ready",
  );
});
test("hits and deaths respect crouched stance and heavy impacts", () => {
  assert.equal(reactionMotion(true, true, true), "crouch_death");
  assert.equal(reactionMotion(false, true, false), "crouch_hit");
  assert.equal(reactionMotion(true, false, true), "death_backward");
  assert.equal(reactionMotion(false, false, true), "heavy_hit");
});
test("the drill catalogue has 39 unique actions", () =>
  assert.equal(new Set(motions.map((m) => m[0])).size, 39));

test("ordinary rifle rest uses the captured ready idle", () =>
  assert.equal(
    restMotion({ weapon: "rifle", hunkered: false, overwatch: false }, false),
    "rifle_idle",
  ));
