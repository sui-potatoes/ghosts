// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { PadTracker, type PadSnapshot } from "./gamepad.ts";

function snap(buttons: Partial<Record<number, boolean>> = {}, axes: number[] = []): PadSnapshot {
  const b = Array.from({ length: 17 }, (_, i) => !!buttons[i]);
  return { buttons: b, axes };
}

test("pressed fires on the edge only", () => {
  const t = new PadTracker();
  assert.equal(t.read(snap({ 0: true }), 0).pressed("a"), true);
  assert.equal(t.read(snap({ 0: true }), 16).pressed("a"), false);
  assert.equal(t.read(snap(), 32).pressed("a"), false);
  assert.equal(t.read(snap({ 0: true }), 48).pressed("a"), true);
});

test("held reports the level, not the edge", () => {
  const t = new PadTracker();
  t.read(snap({ 1: true }), 0);
  assert.equal(t.read(snap({ 1: true }), 16).held("b"), true);
  assert.equal(t.read(snap(), 32).held("b"), false);
});

test("nav fires at once, then repeats after the delay", () => {
  const t = new PadTracker();
  const down = snap({ 13: true });
  assert.equal(t.read(down, 0).nav("down"), true, "edge");
  assert.equal(t.read(down, 100).nav("down"), false, "inside the delay");
  assert.equal(t.read(down, 400).nav("down"), true, "first repeat");
  assert.equal(t.read(down, 450).nav("down"), false, "inside the repeat gap");
  assert.equal(t.read(down, 540).nav("down"), true, "second repeat");
  assert.equal(t.read(snap(), 560).nav("down"), false, "released");
  assert.equal(t.read(down, 600).nav("down"), true, "a new press starts over");
});

test("the left stick drives nav past the threshold", () => {
  const t = new PadTracker();
  assert.equal(t.read(snap({}, [0, -0.9]), 0).nav("up"), true);
  assert.equal(t.read(snap({}, [0, -0.3]), 16).nav("up"), false, "under the threshold");
  assert.equal(t.read(snap({}, [0.9, 0]), 32).nav("right"), true);
});

test("axis zeroes inside the dead zone", () => {
  const t = new PadTracker();
  const input = t.read(snap({}, [0.1, -0.8, 0.3, 0]), 0);
  assert.equal(input.axis(0), 0);
  assert.equal(input.axis(1), -0.8);
  assert.equal(input.axis(2), 0.3);
  assert.equal(input.axis(3), 0);
});
