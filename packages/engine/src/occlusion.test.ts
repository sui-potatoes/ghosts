// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { Occlusion } from "./scene/occlusion.ts";
import { OccluderBatch } from "./scene/occluder-batch.ts";

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

test("standing cut-away cells draw from one batch per material and hand over to their own meshes while they fade", () => {
  const occlusion = new Occlusion();
  const wall = new T.MeshStandardMaterial(), glass = new T.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
  const geometry = new T.BoxGeometry(1, 1, 1);
  const cell = (x: number) => {
    const group = new T.Group();
    const a = new T.Mesh(geometry, wall), pane = new T.Mesh(geometry, glass);
    a.position.x = x; pane.position.x = x;
    group.add(a, pane);
    occlusion.occluders.push({ group, bounds: new T.Box3(new T.Vector3(x - 0.5, -1, 3), new T.Vector3(x + 0.5, 1, 5)) });
    return { group, a, pane };
  };
  const near = cell(0), far = cell(4);
  const batch = new OccluderBatch(occlusion.occluders);
  try {
    assert.equal(batch.batches.length, 1, "one batch for the shared opaque material; glass stays out");
    assert.equal(batch.batches[0].instanceCount, 2);
    assert.equal(near.a.visible, false);
    assert.equal(near.pane.visible, true);
    const matrix = new T.Matrix4();
    batch.batches[0].getMatrixAt(1, matrix);
    assert.equal(new T.Vector3().setFromMatrixPosition(matrix).x, 4, "instances keep their cell's world transform");
    occlusion.update(new T.Vector3(0, 0, 10), [new T.Vector3()], 0.06);
    batch.sync((group) => occlusion.amount(group));
    assert.equal(near.a.visible, true, "a fading cell draws its own meshes");
    assert.equal(batch.batches[0].getVisibleAt(0), false);
    assert.equal(far.a.visible, false);
    assert.equal(batch.batches[0].getVisibleAt(1), true);
    occlusion.update(new T.Vector3(0, 0, 10), [], 1);
    batch.sync((group) => occlusion.amount(group));
    assert.equal(near.a.visible, false, "back in full: the batch draws it again");
    assert.equal(batch.batches[0].getVisibleAt(0), true);
  } finally {
    batch.dispose();
    occlusion.dispose();
    geometry.dispose(); wall.dispose(); glass.dispose();
  }
});
