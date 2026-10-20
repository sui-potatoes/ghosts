// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
/** Only call on static scenery, before adding actors or interactive objects. */
export function batchStaticScenery(scene: T.Object3D) {
  scene.updateMatrixWorld(true);
  const batches = new Map<
    string,
    {
      material: T.Material;
      cast: boolean;
      receive: boolean;
      geometries: T.BufferGeometry[];
      objects: T.Mesh[];
    }
  >();
  const instances = new Map<string, T.InstancedMesh[]>();
  scene.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      Array.isArray(o.material) ||
      o instanceof T.SkinnedMesh
    )
      return;
    const key = `${o.material.uuid}:${o.castShadow}:${o.receiveShadow}`;
    if (o instanceof T.InstancedMesh) {
      const k = key + o.geometry.uuid;
      const list = instances.get(k) || [];
      list.push(o);
      instances.set(k, list);
      return;
    }
    const batch = batches.get(key) || {
      material: o.material,
      cast: o.castShadow,
      receive: o.receiveShadow,
      geometries: [] as T.BufferGeometry[],
      objects: [] as T.Mesh[],
    };
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometry.clearGroups();
    batch.geometries.push(geometry);
    batch.objects.push(o);
    batches.set(key, batch);
  });
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.geometries, false);
    if (!geometry) throw new Error("Incompatible scenery geometry");
    const mesh = new T.Mesh(geometry, batch.material);
    mesh.castShadow = batch.cast;
    mesh.receiveShadow = batch.receive;
    mesh.matrixAutoUpdate = false;
    mesh.name = "Static scenery batch";
    scene.add(mesh);
    for (const o of batch.objects) o.removeFromParent();
    for (const g of batch.geometries) g.dispose();
  }
  const matrix = new T.Matrix4(),
    color = new T.Color();
  for (const list of instances.values()) {
    const first = list[0],
      merged = new T.InstancedMesh(
        first.geometry,
        first.material,
        list.reduce((n, o) => n + o.count, 0),
      );
    let index = 0;
    for (const o of list) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, matrix);
        matrix.premultiply(o.matrixWorld);
        merged.setMatrixAt(index, matrix);
        if (o.instanceColor) {
          o.getColorAt(i, color);
          merged.setColorAt(index, color);
        }
        index++;
      }
      o.removeFromParent();
      o.dispose();
    }
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.matrixAutoUpdate = false;
    scene.add(merged);
  }
  const prune = (o: T.Object3D) => {
    for (const child of [...o.children]) {
      prune(child);
      if (child instanceof T.Group && !child.children.length)
        child.removeFromParent();
    }
  };
  prune(scene);
}
