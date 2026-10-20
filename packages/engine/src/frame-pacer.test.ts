import { test } from "node:test";
import assert from "node:assert/strict";
import { FramePacer } from "./frame-pacer.ts";
import { renderCadence } from "./render-policy.ts";
test("jittery 60/120/144 Hz vsync preserves both frame targets without accumulating delays", () => {
  for (const refresh of [60, 120, 144])
    for (const target of [30, 60]) {
      const pacer = new FramePacer();
      let frames = 0;
      for (let i = 0; i < refresh * 15; i++)
        if (
          pacer.step((i * 1000) / refresh + (i % 2 ? 0.35 : -0.35), target) !==
          null
        )
          frames++;
      assert.ok(
        Math.abs(frames - target * 15) <= 1,
        `${refresh} Hz: ${frames} frames`,
      );
    }
});
test("missed deadlines skip catch-up renders and suspend/resume cannot jump animations", () => {
  const p = new FramePacer();
  p.step(1000, 30);
  assert.equal(p.step(1010, 30), null);
  assert.equal(p.step(1300, 30), 0.1);
  assert.equal(p.step(1301, 30), null);
  p.reset();
  assert.equal(p.step(100000, 30), 1 / 30);
});
test("active play runs at 60 FPS without keeping idle or hidden battery sessions awake", () => {
  assert.equal(renderCadence("battery", true, true), 60);
  assert.equal(renderCadence("battery", true, false), null);
  assert.equal(renderCadence("battery", false, true), null);
});
