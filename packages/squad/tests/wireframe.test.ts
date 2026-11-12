// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";

import {
  applyWireframe,
  formatMeshStats,
  meshStats,
  triangleCount,
} from "../src/studio/wireframe.ts";

const colors = { line: 0x7fe3ef, fill: 0x101215 };

test("triangles come from the index, else from the positions", () => {
  assert.equal(triangleCount(new T.BoxGeometry(1, 1, 1)), 12);
  const loose = new T.BufferGeometry();
  loose.setAttribute(
    "position",
    new T.BufferAttribute(new Float32Array(18), 3),
  );
  assert.equal(triangleCount(loose), 2);
  assert.equal(triangleCount(new T.BufferGeometry()), 0);
});

test("stats sum every mesh and format with separators", () => {
  const root = new T.Group();
  root.add(
    new T.Mesh(new T.BoxGeometry(1, 1, 1)),
    new T.Mesh(new T.SphereGeometry(1, 32, 16)),
  );
  const stats = meshStats(root);
  assert.equal(stats.meshes, 2);
  assert.equal(stats.triangles, 12 + (32 * 16 * 2 - 64));
  assert.equal(
    formatMeshStats({ triangles: 38924, meshes: 11 }),
    "38,924 tris · 11 meshes",
  );
  assert.equal(formatMeshStats({ triangles: 1, meshes: 1 }), "1 tri · 1 mesh");
});

test("wireframe swaps materials and restores the originals exactly", () => {
  const original = new T.MeshStandardMaterial();
  const list = [new T.MeshBasicMaterial(), new T.MeshBasicMaterial()];
  const a = new T.Mesh(new T.BoxGeometry(1, 1, 1), original);
  const b = new T.Mesh(new T.BoxGeometry(1, 1, 1), list);
  const root = new T.Group().add(a, b);
  const before = meshStats(root);
  const restore = applyWireframe(root, colors);
  assert.notEqual(a.material, original);
  const lines = a.children.filter(
    (c) => c instanceof T.LineSegments,
  ) as T.LineSegments[];
  assert.equal(lines.length, 1);
  // True topology: 12 box edges plus the 6 coplanar face diagonals, shared edges once.
  assert.equal(lines[0].geometry.getAttribute("position").count, 18 * 2);
  restore();
  restore();
  assert.equal(a.material, original);
  assert.equal(b.material, list);
  assert.equal(a.children.length, 0);
  assert.deepEqual(meshStats(root), before);
});

test("skinned meshes take a wireframe material instead of line geometry", () => {
  const skinned = new T.SkinnedMesh(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshBasicMaterial(),
  );
  const material = skinned.material;
  const restore = applyWireframe(skinned, colors);
  assert.equal((skinned.material as T.MeshBasicMaterial).wireframe, true);
  assert.equal(skinned.children.length, 0);
  restore();
  assert.equal(skinned.material, material);
});
