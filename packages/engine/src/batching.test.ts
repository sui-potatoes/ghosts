import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { batchStaticScenery } from "./batching.ts";
test("batching preserves world bounds, transforms, lights, and shadow policy", () => {
  const scene = new T.Scene(),
    parent = new T.Group(),
    m = new T.MeshStandardMaterial();
  parent.position.set(4, 2, -3);
  parent.rotation.y = 0.7;
  scene.add(parent);
  for (let i = 0; i < 3; i++) {
    const mesh = new T.Mesh(new T.BoxGeometry(), m);
    mesh.position.x = i * 2;
    mesh.scale.set(1, 2, 3);
    mesh.castShadow = true;
    parent.add(mesh);
  }
  const light = new T.PointLight();
  scene.add(light);
  const before = new T.Box3().setFromObject(scene);
  batchStaticScenery(scene);
  const after = new T.Box3().setFromObject(scene);
  assert.ok(before.min.distanceTo(after.min) < 1e-5);
  assert.ok(before.max.distanceTo(after.max) < 1e-5);
  assert.ok(scene.children.includes(light));
  const meshes = [];
  scene.traverse((o) => {
    if (o instanceof T.Mesh) meshes.push(o);
  });
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].castShadow, true);
});
test("instanced windows retain per-instance transforms and colors", () => {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(),
    material = new T.MeshBasicMaterial(),
    matrix = new T.Matrix4();
  for (let x = 0; x < 2; x++) {
    const mesh = new T.InstancedMesh(geometry, material, 1);
    mesh.position.x = x * 5;
    mesh.setMatrixAt(0, matrix.makeTranslation(0, 2, 0));
    mesh.setColorAt(0, new T.Color(x ? "red" : "blue"));
    scene.add(mesh);
  }
  batchStaticScenery(scene);
  const mesh = scene.children.find((o) => o instanceof T.InstancedMesh);
  assert.equal(mesh.count, 2);
  mesh.getMatrixAt(1, matrix);
  assert.deepEqual(
    new T.Vector3().setFromMatrixPosition(matrix).toArray(),
    [5, 2, 0],
  );
  const color = new T.Color();
  mesh.getColorAt(1, color);
  assert.equal(color.getHex(), 0xff0000);
});
