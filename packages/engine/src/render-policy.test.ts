import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCadence, renderPixelRatio } from "./render-policy.ts";
test("battery saver stops idle rendering while keeping active play responsive", () => {
  assert.equal(renderCadence("battery", true, false), null);
  assert.equal(renderCadence("battery", true, true), 60);
});
test("both quality modes stop in background even during combat", () => {
  for (const mode of ["battery", "smooth"] as const)
    for (const active of [false, true])
      assert.equal(renderCadence(mode, false, active), null);
});
test("smooth mode is explicit and remains capped", () => {
  assert.equal(renderCadence("smooth", true, true), 60);
  assert.equal(renderCadence("smooth", true, false), 30);
});
test("retina and large external displays cannot exceed the pixel budget", () => {
  for (const [w, h, dpr] of [
    [1280, 740, 2],
    [3024, 1964, 2],
    [5120, 2880, 2],
    [390, 844, 3],
  ]) {
    const ratio = renderPixelRatio(w, h, dpr, "battery");
    assert.ok(w * h * ratio * ratio <= 1_000_001);
    assert.ok(ratio <= 1);
    const smooth = renderPixelRatio(w, h, dpr, "smooth");
    assert.ok(w * h * smooth * smooth <= 2_000_001);
    assert.ok(smooth <= 1.5);
  }
});
