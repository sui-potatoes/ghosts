// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createPuddleExposure } from "./scene/puddles.ts";

function sample(exposure: ReturnType<typeof createPuddleExposure>, x: number, z: number) {
  const { data, width, height } = exposure.texture.image;
  const t = exposure.transform;
  const col = Math.floor((x - t.x) * t.z * width);
  const row = Math.floor((z - t.y) * t.w * height);
  return data[row * width + col];
}

test("building footprints and overhanging entrances stay dry while open streets remain exposed", () => {
  const material = new T.MeshBasicMaterial();
  const wallGeometry = new T.BoxGeometry(4, 4, 4);
  const awningGeometry = new T.BoxGeometry(4, 0.1, 1.5);
  const building = new T.Group();
  building.position.set(5, 0, 4);
  building.add(new T.Mesh(wallGeometry, material));
  const awning = new T.Mesh(awningGeometry, material);
  awning.position.set(0, 2, 2.5);
  building.add(awning);
  const exposure = createPuddleExposure([building], 20);
  try {
    assert.equal(sample(exposure, 5, 4), 0, "inside the building");
    assert.equal(sample(exposure, 5, 6.8), 0, "under the entrance canopy outside the wall");
    assert.equal(sample(exposure, 0, 0), 255, "open intersection");
    assert.equal(sample(exposure, 5, 8), 255, "open pavement beyond the canopy");
    building.visible = false;
    const cutaway = createPuddleExposure([building], 20);
    assert.deepEqual(cutaway.texture.image.data, exposure.texture.image.data,
      "camera cutaways cannot expose a sheltered floor to rain");
    cutaway.texture.dispose();
  } finally {
    exposure.texture.dispose(); wallGeometry.dispose(); awningGeometry.dispose(); material.dispose();
  }
});

test("shelter uses transformed roof bounds rather than unrotated building dimensions", () => {
  const material = new T.MeshBasicMaterial();
  const geometry = new T.BoxGeometry(6, 3, 2);
  const building = new T.Group();
  building.add(new T.Mesh(geometry, material));
  building.position.set(-5, 0, 3);
  building.rotation.y = Math.PI / 2;
  const exposure = createPuddleExposure([building], 20);
  try {
    assert.equal(sample(exposure, -5, 5.5), 0);
    assert.equal(sample(exposure, -2.5, 3), 255);
  } finally {
    exposure.texture.dispose(); geometry.dispose(); material.dispose();
  }
});
