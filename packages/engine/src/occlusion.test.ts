// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { Occlusion } from "./scene/occlusion.ts";

test("building cutaways fade, reverse mid-transition and leave shared materials untouched", () => {
  const occlusion = new Occlusion();
  const material = new T.MeshStandardMaterial({ opacity: 0.8 });
  const geometry = new T.BoxGeometry(2, 2, 2);
  const mesh = new T.Mesh(geometry, material);
  const group = new T.Group().add(mesh);
  occlusion.occluders.push({ group, bounds: new T.Box3(new T.Vector3(-1, -1, 3), new T.Vector3(1, 1, 5)) });
  const camera = new T.Vector3(0, 0, 10), focus = [new T.Vector3()];
  try {
    assert.equal(occlusion.update(camera, focus, 0.06), 1);
    assert.equal(group.visible, true);
    assert.equal(occlusion.amount(group), 0.75);
    assert(Math.abs(mesh.material.opacity - 0.6) < 1e-6);
    assert.equal(material.opacity, 0.8);
    assert.notEqual(mesh.material, material);
    mesh.material = mesh.material.clone(); // Surface damage replaces a finish during the fade.
    occlusion.update(camera, [], 0.03);
    assert.equal(occlusion.amount(group), 0.875, "reverses from the current fade amount");
    assert(Math.abs(mesh.material.opacity - 0.7) < 1e-6, "replacement finish retains its unfaded opacity");
    occlusion.update(camera, focus, 0.24);
    assert.equal(group.visible, false);
    assert.equal(occlusion.active, false);
    occlusion.update(camera, [], 0.06);
    assert.equal(group.visible, true);
    assert.equal(occlusion.amount(group), 0.25);
    occlusion.update(camera, [], 0.24);
    assert.equal(mesh.material.opacity, 0.8);
    assert.equal(occlusion.active, false);
  } finally {
    occlusion.dispose();
    geometry.dispose(); material.dispose();
  }
});
