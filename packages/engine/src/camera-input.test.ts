// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { isCameraCommand, padCameraFree } from "./camera-input.ts";

test("only the four camera commands pass the busy gate", () => {
  for (const c of ["rotate-left", "rotate-right", "focus", "camera"] as const) assert.equal(isCameraCommand(c), true, c);
  for (const c of ["move", "fire", "grenade", "reload", "confirm", "cancel", "grid", "next-operator"] as const)
    assert.equal(isCameraCommand(c), false, c);
  assert.equal(isCameraCommand(undefined), false);
});

test("the pad camera is free with nobody selected", () => {
  assert.equal(padCameraFree({ selected: "", wheel: false, busy: false, phase: "player" }), true);
});

test("a selected operator holds the stick on the player's idle turn", () => {
  assert.equal(padCameraFree({ selected: "a1", wheel: false, busy: false, phase: "player" }), false);
});

test("the camera frees up through the opponent's phase and any animation, selected or not", () => {
  assert.equal(padCameraFree({ selected: "a1", wheel: false, busy: false, phase: "enemy" }), true);
  assert.equal(padCameraFree({ selected: "a1", wheel: false, busy: true, phase: "player" }), true);
  assert.equal(padCameraFree({ selected: "a1", wheel: false, busy: true, phase: "enemy" }), true);
});

test("the wheel always keeps the stick", () => {
  assert.equal(padCameraFree({ selected: "", wheel: true, busy: true, phase: "enemy" }), false);
});
