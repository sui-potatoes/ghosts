// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { Rain } from "./scene/rain.ts";

test("rain stays over the map after prolonged wind drift, with intact streaks and valid culling bounds", () => {
  const rain = new Rain();
  try {
    // Fifteen minutes, including steps spanning more than one vertical wrap.
    for (let i = 0; i < 900; i++) rain.update(1);
    const positions = rain.mesh.geometry.attributes.position;
    const point = new T.Vector3();
    for (let i = 0; i < positions.count; i += 2) {
      const x = positions.getX(i), y = positions.getY(i);
      assert(x >= -32.5 && x <= 32.5);
      assert(y >= 0 && y <= 23);
      assert(Math.abs(positions.getX(i + 1) - x + 0.12) < 0.00001);
      assert(Math.abs(positions.getY(i + 1) - y - 0.65) < 0.00001);
      for (const index of [i, i + 1]) {
        point.fromBufferAttribute(positions, index);
        assert(rain.mesh.geometry.boundingSphere!.containsPoint(point));
      }
    }
  } finally {
    rain.mesh.geometry.dispose();
    (rain.mesh.material as T.Material).dispose();
  }
});

test("rain freezes when off and advances again on every re-enable", () => {
  const rain = new Rain();
  try {
    for (let cycle = 0; cycle < 5; cycle++) {
      rain.update(40);
      rain.visible = false;
      const before = Array.from(rain.mesh.geometry.attributes.position.array);
      rain.update(100);
      assert.deepEqual(Array.from(rain.mesh.geometry.attributes.position.array), before);
      assert.equal(rain.mesh.visible, false);
      rain.visible = true;
      rain.update(1 / 60);
      assert.equal(rain.mesh.visible, true);
      assert.notDeepEqual(Array.from(rain.mesh.geometry.attributes.position.array), before);
    }
  } finally {
    rain.mesh.geometry.dispose();
    (rain.mesh.material as T.Material).dispose();
  }
});
