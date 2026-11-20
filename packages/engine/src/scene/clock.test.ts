// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { SceneClock } from "./clock.ts";

test("scene jobs run on frame time times the time scale; real jobs on frame time", () => {
  const clock = new SceneClock();
  const seen: number[] = [];
  const real: number[] = [];
  void clock.tween(1, (t) => seen.push(t), false);
  void clock.tween(1, (t) => real.push(t), false, true);
  clock.step(0.25);
  clock.timeScale = 2;
  clock.step(0.25);
  assert.deepEqual(seen, [0.25, 0.75], "a change of scale mid-tween takes effect from the next frame, no jump");
  assert.deepEqual(real, [0.25, 0.5]);
  clock.timeScale = 0.5;
  clock.step(0.5);
  assert.equal(seen.at(-1), 1);
  assert.equal(clock.pending, 0);
});

test("a time scale of 0 holds every scene job and stops counting it as motion; the camera's own keep going", () => {
  const clock = new SceneClock();
  const seen: number[] = [];
  void clock.tween(1, (t) => seen.push(t), false);
  clock.timeScale = 0;
  assert.equal(clock.moving, false, "a held field needs no frames");
  clock.step(0.5);
  clock.step(0.5);
  assert.deepEqual(seen, [], "held");
  const camera: number[] = [];
  void clock.tween(0.5, (t) => camera.push(t), false, true);
  assert.equal(clock.moving, true);
  clock.step(0.25);
  assert.deepEqual(camera, [0.5]);
  clock.timeScale = 1;
  clock.step(0.5);
  assert.deepEqual(seen, [0.5]);
});

test("4x plays a one-second animation in a quarter of a second", async () => {
  const clock = new SceneClock();
  clock.timeScale = 4;
  let done = false;
  const tween = clock.tween(1, () => {}).then(() => (done = true));
  for (let i = 0; i < 14; i++) clock.step(1 / 60);
  await Promise.resolve();
  assert.equal(done, false, "not before 15 frames");
  clock.step(1 / 60);
  clock.step(1 / 60);
  await tween;
  assert.equal(done, true);
});

test("finish runs a chain of animations to its end at once, held clock or not", async () => {
  const clock = new SceneClock();
  clock.timeScale = 0;
  const order: string[] = [];
  const chain = (async () => {
    await clock.tween(1, () => {});
    order.push("first");
    await clock.tween(2, () => {});
    order.push("second");
  })();
  let camera = 0;
  void clock.tween(1, (t) => (camera = t), true, true);
  await clock.finish(chain, () => new Promise((r) => setImmediate(r)));
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(clock.pending, 0);
  assert.equal(camera, 0, "the viewer's own camera move is not the event's to finish");
});
