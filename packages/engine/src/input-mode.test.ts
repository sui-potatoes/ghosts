// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { InputTracker, startMode, TOUCH_ECHO_MS } from "./input-mode.ts";

test("the device picks the starting mode", () => {
  assert.equal(startMode({ touch: true }), "touch");
  assert.equal(startMode({ touch: false }), "keyboard");
  assert.equal(startMode({ touch: true, pad: true }), "gamepad");
});

test("a key press switches to the keyboard, a pad input to the pad", () => {
  const t = new InputTracker("touch");
  assert.equal(t.note("key", 0), true);
  assert.equal(t.mode, "keyboard");
  assert.equal(t.note("key", 1), false);
  assert.equal(t.note("pad", 2), true);
  assert.equal(t.mode, "gamepad");
});

test("a touch switches to touch", () => {
  const t = new InputTracker("keyboard");
  assert.equal(t.note("touch", 0), true);
  assert.equal(t.mode, "touch");
});

test("a mouse event right after a touch is its echo and changes nothing", () => {
  const t = new InputTracker("keyboard");
  t.note("touch", 1000);
  assert.equal(t.note("mouse", 1000 + TOUCH_ECHO_MS - 1), false);
  assert.equal(t.mode, "touch");
});

test("a mouse that moves later is the mouse", () => {
  const t = new InputTracker("keyboard");
  t.note("touch", 1000);
  assert.equal(t.note("mouse", 1000 + TOUCH_ECHO_MS), true);
  assert.equal(t.mode, "mouse");
});

test("a key or pad right after a touch is not debounced", () => {
  const t = new InputTracker("keyboard");
  t.note("touch", 1000);
  assert.equal(t.note("key", 1001), true);
  assert.equal(t.mode, "keyboard");
  t.note("touch", 1002);
  assert.equal(t.note("pad", 1003), true);
  assert.equal(t.mode, "gamepad");
});

test("a mouse after a key or pad switches at once", () => {
  const t = new InputTracker("keyboard");
  assert.equal(t.note("mouse", 0), true);
  assert.equal(t.mode, "mouse");
  t.note("pad", 1);
  assert.equal(t.note("mouse", 2), true);
});
