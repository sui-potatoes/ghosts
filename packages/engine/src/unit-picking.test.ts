// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { pickUnit } from "./scene/unit-picking.ts";

const rayAt = (x = 0) => new T.Raycaster(new T.Vector3(x, 1.4, 5), new T.Vector3(0, 0, -1));
function body(id: string, z = 0, hp = 12) {
  const root = new T.Group();
  const torso = new T.Mesh(new T.BoxGeometry(0.5, 0.7, 0.3), new T.MeshBasicMaterial());
  torso.position.y = 1.4;
  root.position.z = z;
  root.add(torso);
  return { id, hp, root };
}

test("body picking selects the nearest torso from either side and misses empty space", () => {
  const back = body("back"), front = body("front", 2);
  assert.equal(pickUnit(rayAt(), [back, front]), "front");
  assert.equal(pickUnit(new T.Raycaster(new T.Vector3(0, 1.4, -5), new T.Vector3(0, 0, 1)), [front, back]), "back");
  assert.equal(pickUnit(rayAt(2), [front, back]), undefined);
});

test("dead bodies and hidden equipment do not steal unit clicks", () => {
  const live = body("live"), dead = body("dead", 2, 0), hidden = body("hidden", 3);
  hidden.root.visible = false;
  assert.equal(pickUnit(rayAt(), [dead, hidden, live]), "live");
  live.root.children[0].visible = false;
  assert.equal(pickUnit(rayAt(), [live]), undefined);
});

test("picking follows skeletal deformation even when cached bounds describe an old pose", () => {
  const geometry = new T.BoxGeometry(0.5, 0.7, 0.3);
  geometry.translate(0, 1.4, 0);
  const count = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
  const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  const bone = new T.Bone();
  mesh.add(bone); mesh.bind(new T.Skeleton([bone]));
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  bone.position.x = 3;
  const root = new T.Group(); root.add(mesh);
  assert.equal(pickUnit(rayAt(3), [{ id: "leaning", hp: 12, root }]), "leaning");
  assert.equal(pickUnit(rayAt(), [{ id: "leaning", hp: 12, root }]), undefined);
});
