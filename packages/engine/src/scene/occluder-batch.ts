// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { Occluder } from "./occlusion";

type Instance = { batch: T.BatchedMesh; id: number };
type Cell = { meshes: T.Mesh[]; instances: Instance[]; whole: boolean };

/** Meshes whose material has its own vertex patch may not know the batch's per-instance matrix: they stay as they are. */
function batchable(mesh: T.Object3D): mesh is T.Mesh<T.BufferGeometry, T.Material> {
  if (!(mesh instanceof T.Mesh) || mesh instanceof T.InstancedMesh || mesh instanceof T.SkinnedMesh) return false;
  if (mesh instanceof T.BatchedMesh || Array.isArray(mesh.material) || !mesh.visible) return false;
  const material = mesh.material as T.Material;
  if (material.transparent) return false;
  return material.onBeforeCompile === T.Material.prototype.onBeforeCompile || !!material.userData["lit-panes-v1"];
}

/** Attribute layout: a batch holds geometries with the same attributes only. */
function layout(geometry: T.BufferGeometry) {
  const names = Object.keys(geometry.attributes).sort();
  return names
    .map((name) => {
      const a = geometry.getAttribute(name) as T.BufferAttribute;
      return `${name}${a.itemSize}${a.normalized ? "n" : ""}${a.array.constructor.name}`;
    })
    .join(",") + (geometry.index ? ":i" : "");
}

/**
 * The cut-away scenery (`Occlusion`'s groups: a building's cells, a store's
 * roof) drawn as one `BatchedMesh` per material and shadow flags, so a street
 * of buildings costs a draw call per material instead of one per cell and
 * material, in the shadow pass too. A cell standing in full draws from the
 * batches; while it fades or is cut away its own meshes take over (with
 * `BuildingFade`'s per-object copies), and they hand back once it stands again.
 */
export class OccluderBatch {
  readonly batches: T.BatchedMesh[] = [];
  private readonly cells = new Map<T.Group, Cell>();

  constructor(occluders: readonly Occluder[]) {
    const buckets = new Map<string, { material: T.Material; cast: boolean; receive: boolean; meshes: T.Mesh[] }>();
    for (const { group } of occluders) {
      group.updateMatrixWorld(true);
      const meshes: T.Mesh[] = [];
      group.traverse((o) => {
        if (!batchable(o)) return;
        meshes.push(o);
        const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${layout(o.geometry)}`;
        const bucket = buckets.get(key) ?? { material: o.material, cast: o.castShadow, receive: o.receiveShadow, meshes: [] };
        bucket.meshes.push(o);
        buckets.set(key, bucket);
      });
      this.cells.set(group, { meshes, instances: [], whole: true });
    }
    const owner = new Map<T.Mesh, Cell>();
    for (const cell of this.cells.values()) for (const mesh of cell.meshes) owner.set(mesh, cell);
    for (const { material, cast, receive, meshes } of buckets.values()) {
      const vertices = meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0);
      const indices = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? 0), 0);
      const batch = new T.BatchedMesh(meshes.length, vertices, indices, material);
      batch.name = "Cut-away scenery batch";
      batch.castShadow = cast;
      batch.receiveShadow = receive;
      // Culling and sorting a few hundred instances every pass (and every shadow pass) costs more
      // CPU than drawing the low-poly cells off screen costs the GPU.
      batch.perObjectFrustumCulled = false;
      batch.sortObjects = false;
      for (const mesh of meshes) {
        const id = batch.addInstance(batch.addGeometry(mesh.geometry));
        batch.setMatrixAt(id, mesh.matrixWorld);
        owner.get(mesh)!.instances.push({ batch, id });
        mesh.visible = false;
      }
      this.batches.push(batch);
    }
  }

  /** Hand each cell to the batches (standing in full) or to its own meshes (fading or cut away). */
  sync(amount: (group: T.Group) => number) {
    for (const [group, cell] of this.cells) {
      const whole = amount(group) >= 1;
      if (whole === cell.whole) continue;
      cell.whole = whole;
      for (const mesh of cell.meshes) mesh.visible = !whole;
      for (const { batch, id } of cell.instances) batch.setVisibleAt(id, whole);
    }
  }

  dispose() {
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose();
    }
    this.batches.length = 0;
    this.cells.clear();
  }
}
