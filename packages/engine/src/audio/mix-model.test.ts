// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AIM_DUCK,
  DAZE_CUTOFF,
  DAZE_WIDTH,
  DIP_BACKSTOP,
  MixModel,
  mixInputsOf,
  NEUTRAL,
  OPEN_CUTOFF,
  RAMPS,
  SHOT_DIP,
  widthGains,
} from "./mix-model.ts";

test("aiming ducks and cancelling restores", () => {
  const m = new MixModel();
  assert.equal(m.set({ aiming: true, dazed: false }, 0), true);
  assert.equal(m.current.duck, AIM_DUCK);
  assert.equal(m.current.duckRamp, RAMPS.duck.attack);
  assert.equal(m.set({ aiming: false, dazed: false }, 1), true);
  assert.equal(m.current.duck, 1);
  assert.equal(m.current.duckRamp, RAMPS.duck.release);
  // Nothing changed, nothing to ramp.
  assert.equal(m.set({ aiming: false, dazed: false }, 2), false);
});

test("a shot dips below the aim duck and its impact releases it", () => {
  const m = new MixModel();
  m.set({ aiming: true, dazed: false }, 0);
  const token = m.beginShot(1);
  assert.equal(m.current.duck, SHOT_DIP);
  assert.equal(m.current.duckRamp, RAMPS.dip.attack);
  assert.equal(m.impact(token, 1.4), true);
  assert.equal(m.current.duck, AIM_DUCK);
  assert.equal(m.current.duckRamp, RAMPS.dip.release);
});

test("an earlier shot's impact does not release a later dip", () => {
  const m = new MixModel();
  const first = m.beginShot(0);
  m.beginShot(0.5);
  assert.equal(m.impact(first, 0.6), false);
  assert.equal(m.current.duck, SHOT_DIP);
});

test("a dip whose impact never comes is released by the backstop", () => {
  const m = new MixModel();
  m.beginShot(10);
  assert.equal(m.dipLeft(10), DIP_BACKSTOP);
  assert.equal(m.dipping(10 + DIP_BACKSTOP - 0.01), true);
  assert.equal(m.refresh(10 + DIP_BACKSTOP + 0.01), true);
  assert.equal(m.current.duck, 1);
  assert.equal(m.dipLeft(20), null);
});

test("daze low-passes and narrows; reset restores everything at once", () => {
  const m = new MixModel();
  m.set({ aiming: true, dazed: true }, 0);
  const token = m.beginShot(0);
  assert.equal(m.current.cutoff, DAZE_CUTOFF);
  assert.equal(m.current.width, DAZE_WIDTH);
  assert.equal(m.current.dazeRamp, RAMPS.daze.attack);
  assert.equal(m.reset(1), true);
  assert.equal(m.current.duck, NEUTRAL.duck);
  assert.equal(m.current.cutoff, OPEN_CUTOFF);
  assert.equal(m.current.width, 1);
  assert.equal(m.dipping(1), false);
  // The shot from before the reset lands afterwards: nothing changes.
  assert.equal(m.impact(token, 1.2), false);
});

test("width gains go from identity to mono", () => {
  assert.deepEqual(widthGains(1), { a: 1, b: 0 });
  assert.deepEqual(widthGains(0), { a: 0.5, b: 0.5 });
  const { a, b } = widthGains(DAZE_WIDTH);
  assert.ok(Math.abs(a + b - 1) < 1e-12, "mono content keeps its level");
});

test("the field's inputs: aiming needs a held unit out of move mode; a Daze on the held unit dazes", () => {
  const ready = { hp: 5, effects: [] };
  const dazed = { hp: 5, effects: [{ kind: "Daze" }] };
  assert.deepEqual(mixInputsOf("move", ready), { aiming: false, dazed: false });
  assert.deepEqual(mixInputsOf("fire", ready), { aiming: true, dazed: false });
  assert.deepEqual(mixInputsOf("flashbang", undefined), { aiming: false, dazed: false });
  assert.deepEqual(mixInputsOf("move", dazed), { aiming: false, dazed: true });
  assert.deepEqual(mixInputsOf("move", { hp: 0, effects: [{ kind: "Daze" }] }), { aiming: false, dazed: false });
  assert.deepEqual(mixInputsOf("move", { hp: 5, effects: [{ kind: "Smoke" }] }), { aiming: false, dazed: false });
});
