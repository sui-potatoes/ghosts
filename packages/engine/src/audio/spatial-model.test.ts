// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceGain, equalPower, pickVictim, toListener, WIDTH, type Vec3 } from "./spatial-model.ts";

/** A column-major camera matrix at `eye` looking at `target`, world up +y (three.js lookAt). */
function lookAt(eye: number[], target: number[]): number[] {
  const back = norm(sub(eye, target));
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  return [...right, 0, ...up, 0, ...back, 0, ...eye, 1];
}
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const norm = (a: number[]) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The tactics camera's default framing: high and far, looking down on the origin. */
const TACTICAL = lookAt([22, 25, 28], [0, 0, 0]);

test("a point ahead of the camera is centred at its true distance", () => {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  const az = toListener(TACTICAL, 0, 0, 0, out);
  assert.ok(Math.abs(az) < 1e-9);
  assert.ok(Math.abs(out.x) < 1e-9);
  assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - Math.hypot(22, 25, 28)) < 1e-9);
});

test("the screen's left is left and its right is right, and the pan is widened", () => {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  // The camera's right on the ground: perpendicular to the view, in the xz plane.
  const right = norm(cross([0, 1, 0], norm([22, 25, 28])));
  const at = (s: number) => [right[0] * s, 0, right[2] * s] as const;
  const azLeft = toListener(TACTICAL, ...at(-12), out);
  assert.ok(azLeft < 0 && out.x < 0, "left of the screen");
  const wideLeft = Math.atan2(out.x, -out.z);
  assert.ok(Math.abs(wideLeft - azLeft * WIDTH) < 1e-9);
  toListener(TACTICAL, ...at(12), out);
  assert.ok(out.x > 0, "right of the screen");
  // Equal power at the widened angle leans hard: halfway to the screen's edge, the far speaker is under a third of the near one.
  toListener(TACTICAL, ...at(-20), out);
  const { left, right: r } = equalPower((Math.atan2(out.x, -out.z) * 180) / Math.PI);
  assert.ok(left > 3 * r, `left ${left} right ${r}`);
});

test("rotating the camera half a turn swaps the sides", () => {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  toListener(TACTICAL, 10, 0, -8, out);
  const before = Math.sign(out.x);
  toListener(lookAt([-22, 25, -28], [0, 0, 0]), 10, 0, -8, out);
  assert.equal(Math.sign(out.x), -before);
});

test("the widened azimuth never passes the side: behind the camera stays a side", () => {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  toListener(TACTICAL, 60, 25, 28, out);
  assert.ok(out.z <= 1e-9);
});

test("the combat fall-off is gentle across a tactics field", () => {
  // The field's far corner from the default camera is about 80 m.
  assert.equal(distanceGain(20, 30, 0.5, 160), 1);
  assert.ok(distanceGain(80, 30, 0.5, 160) > 0.5);
  assert.equal(distanceGain(400, 30, 0.5, 160), distanceGain(160, 30, 0.5, 160));
});

test("equal power keeps the sum of squares", () => {
  for (const a of [-90, -45, 0, 30, 90]) {
    const { left, right } = equalPower(a);
    assert.ok(Math.abs(left * left + right * right - 1) < 1e-9);
  }
  assert.ok(equalPower(-90).right < 1e-9);
});

test("voice stealing takes the lowest priority first, then the furthest and oldest", () => {
  assert.equal(pickVictim([]), -1);
  const voices = [
    { priority: 1, distance: 100, age: 5 },
    { priority: 0, distance: 10, age: 0.1 },
    { priority: 0, distance: 60, age: 1 },
  ];
  assert.equal(pickVictim(voices), 2);
  assert.equal(pickVictim([voices[0], { priority: 1, distance: 10, age: 0.2 }]), 0);
});
