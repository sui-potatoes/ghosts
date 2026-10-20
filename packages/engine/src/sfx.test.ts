// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS, effectKey, effectUrl, pickTake } from "./sfx.ts";

test("recorded effects vary their takes and unrecorded kinds yield nothing", () => {
  assert.equal(effectUrl("rifle-burst-02"), "/sounds/rifle-burst-02.mp3");
  for (let i = 0; i < 30; i++) {
    const take = pickTake("rifle", "rifle-burst-01");
    assert.ok(take && EFFECTS.rifle!.includes(take));
    assert.notEqual(take, "rifle-burst-01");
  }
  assert.equal(pickTake("rifle", null, () => 0), "rifle-burst-01");
  assert.equal(pickTake("rifle", null, () => 0.999), "rifle-burst-04");
  assert.ok(EFFECTS.sniper!.includes(pickTake("sniper", null)!));
  assert.ok(EFFECTS.pistol!.includes(pickTake("pistol", null)!));
  assert.equal(pickTake("grenade", null), "grenade-explodes-01");
  assert.equal(pickTake("pin", null), "grenade-safety-01");
  assert.equal(pickTake(null, null), null);
});

test("weapon-specific keys win and fall back to the plain kind", () => {
  assert.equal(effectKey("reload", "pistol"), "reload-pistol");
  assert.equal(effectKey("reload", "rifle"), "reload-rifle");
  assert.deepEqual(EFFECTS["reload-sniper"], EFFECTS["reload-rifle"]);
  assert.equal(effectKey("reload"), null);
  assert.equal(effectKey("rifle", "rifle"), "rifle");
  assert.equal(effectKey("click"), null);
  assert.equal(effectKey("aim", "pistol"), "aim-pistol");
  assert.equal(effectKey("aim", "rifle"), null);
  assert.ok(EFFECTS["reload-pistol"]!.includes(pickTake(effectKey("reload", "pistol"), null)!));
});
