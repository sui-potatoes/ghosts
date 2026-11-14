// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { outlinePoints } from "./scene/threat.ts";

const segments = (points: number[]) => points.length / 6;

test("the move outline is the area's boundary: inner edges are not drawn", () => {
  const flat = () => 0;
  assert.equal(segments(outlinePoints([[0, 0]], flat)), 4);
  assert.equal(segments(outlinePoints([[0, 0], [1, 0]], flat)), 6);
  // A 3x3 block: twelve outer edges, none of the twelve inner ones.
  const block = [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => [x, z] as [number, number]));
  assert.equal(segments(outlinePoints(block, flat)), 12);
});

test("the outline follows the ground", () => {
  const points = outlinePoints([[0, 0]], (x) => (x > 0 ? 0.5 : 0.1));
  for (let i = 0; i < points.length; i += 3) assert.equal(points[i + 1], points[i] > 0 ? 0.5 : 0.1);
});
