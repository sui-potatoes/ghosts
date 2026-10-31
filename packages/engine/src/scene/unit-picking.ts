// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

export interface PickableUnit {
  id: string;
  hp: number;
  root: T.Object3D;
}

/** Raycast posed bodies and equipment on clicks only, never in the render loop. */
export function pickUnit(ray: T.Raycaster, units: Iterable<PickableUnit>): string | undefined {
  let nearest = Infinity, selected: string | undefined;
  const hits: T.Intersection[] = [];
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    unit.root.updateWorldMatrix(true, true);
    unit.root.traverseVisible((object) => {
      if (!(object instanceof T.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some((material) => material.visible && material.opacity > 0)) return;
      if (object instanceof T.SkinnedMesh) {
        // Cached bind-pose bounds can miss a crouched, leaning or animated body.
        object.computeBoundingSphere();
        if (object.boundingBox !== null) object.computeBoundingBox();
      }
      hits.length = 0;
      ray.intersectObject(object, false, hits);
      if (hits[0] && hits[0].distance < nearest) {
        nearest = hits[0].distance;
        selected = unit.id;
      }
    });
  }
  return selected;
}
