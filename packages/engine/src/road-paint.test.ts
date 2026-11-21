// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { PAINT_HEIGHT, paintBox, ROAD_TOP } from "./road-paint.ts";

test("paint is a film a few millimetres over the road", () => {
  const { y, height } = paintBox();
  const top = y + height / 2,
    bottom = y - height / 2;
  assert.ok(Math.abs(top - (ROAD_TOP + PAINT_HEIGHT)) < 1e-12);
  assert.ok(bottom < ROAD_TOP, "sunk into the road: no edge shows underneath");
  assert.ok(PAINT_HEIGHT > 0 && PAINT_HEIGHT <= 0.006);
});

test("paint over another surface sits the same height over it", () => {
  const a = paintBox(0.006);
  assert.ok(Math.abs(a.y + a.height / 2 - (0.006 + PAINT_HEIGHT)) < 1e-12);
});
