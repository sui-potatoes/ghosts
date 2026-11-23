// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { measure } from "./loudness.ts";

const RATE = 48000;
const sine = (hz: number, amp: number, seconds: number) =>
  Float32Array.from({ length: RATE * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

test("a full-scale 997 Hz sine in one channel reads −3.01 LUFS (BS.1770's calibration)", () => {
  const m = measure([sine(997, 1, 3), new Float32Array(RATE * 3)], RATE);
  assert.ok(Math.abs(m.integrated - -3.01) < 0.1, `${m.integrated}`);
  assert.ok(Math.abs(m.momentary - -3.01) < 0.1, `${m.momentary}`);
  assert.ok(Math.abs(m.peak) < 0.01);
});

test("20 dB less level is 20 LU less loudness", () => {
  const a = measure([sine(997, 1, 2)], RATE), b = measure([sine(997, 0.1, 2)], RATE);
  assert.ok(Math.abs(a.integrated - b.integrated - 20) < 0.05);
});

test("the laptop stand-in keeps the midrange and loses a low rumble", () => {
  const mid = measure([sine(1000, 0.5, 2)], RATE);
  assert.ok(Math.abs(mid.laptop - mid.momentary) < 0.5);
  const low = measure([sine(60, 0.5, 2)], RATE);
  assert.ok(low.momentary - low.laptop > 15, `${low.momentary} vs ${low.laptop}`);
});

test("a short click is measured over one block and silence is −∞", () => {
  const click = new Float32Array(RATE * 0.05).fill(0.5);
  assert.ok(Number.isFinite(measure([click], RATE).momentary));
  assert.equal(measure([new Float32Array(RATE)], RATE).integrated, -Infinity);
});
