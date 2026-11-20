// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter } from "./game.ts";
import { leadIn } from "./throw-lead.ts";

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    // The camera is only ever moved through these two; `focus` and `view` are named so a regression shows.
    battlefield: {
      aimAt: async () => void calls.push("aimAt"),
      readyThrow: async () => void calls.push("readyThrow"),
      focus: () => calls.push("focus"),
      view: () => calls.push("view"),
    },
  };
}

test("a viewer's grenades of every kind leave the camera alone", async () => {
  const game = new Encounter();
  const u = game.units[0];
  for (const _kind of ["grenade", "flashbang", "smoke-grenade"]) {
    const { battlefield, calls } = recorder();
    await leadIn(battlefield, true, u, [3, 3]);
    assert.deepEqual(calls, ["readyThrow"], _kind);
  }
});

test("a player's own grenades still frame the throw over the shoulder", async () => {
  const game = new Encounter();
  const { battlefield, calls } = recorder();
  await leadIn(battlefield, false, game.units[0], [3, 3]);
  assert.deepEqual(calls, ["aimAt"]);
});
