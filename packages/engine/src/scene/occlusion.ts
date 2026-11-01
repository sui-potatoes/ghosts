// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

export interface Occluder {
  group: T.Group;
  bounds: T.Box3;
}

/** Per-object copies keep a cutaway from changing other buildings sharing its materials. */
export class BuildingFade {
  private readonly copies = new Map<T.Mesh, { original: T.Material | T.Material[]; faded: T.Material[] }>();

  set(group: T.Group, opacity: number) {
    group.visible = opacity > 0;
    group.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      let entry = this.copies.get(object);
      const assigned = Array.isArray(object.material) ? object.material : [object.material];
      if (entry && assigned.some((material, i) => material !== entry!.faded[i])) {
        // A hit can replace glazing's finish while its building is fading.
        for (const material of entry.faded) material.dispose();
        this.copies.delete(object);
        entry = undefined;
      }
      if (!entry) {
        const sources = Array.isArray(object.material) ? object.material : [object.material];
        const faded = sources.map((source) => {
          const copy = source.clone();
          // Material.clone does not preserve shader hooks (e.g. damaged glazing).
          copy.onBeforeCompile = source.onBeforeCompile;
          copy.customProgramCacheKey = source.customProgramCacheKey.bind(source);
          // Damage materials may themselves have been cloned during a fade.
          copy.userData.cutawayBaseOpacity = source.userData.cutawayBaseOpacity ?? source.opacity;
          copy.userData.cutawayBaseDepthWrite = source.userData.cutawayBaseDepthWrite ?? source.depthWrite;
          copy.transparent = true;
          return copy;
        });
        entry = { original: object.material, faded };
        this.copies.set(object, entry);
        object.material = Array.isArray(object.material) ? faded : faded[0];
      }
      entry.faded.forEach((material) => {
        material.opacity = material.userData.cutawayBaseOpacity * opacity;
        material.depthWrite = opacity >= 1 && material.userData.cutawayBaseDepthWrite;
      });
    });
  }

  dispose() {
    for (const [mesh, entry] of this.copies) {
      mesh.material = entry.original;
      for (const material of entry.faded) material.dispose();
    }
    this.copies.clear();
  }
}

/**
 * Hides foreground buildings whose bounds intersect a ray from the camera
 * to one of the supplied points before reaching that point's 0.7-metre margin.
 */
export class Occlusion {
  readonly occluders: Occluder[] = [];
  private readonly ray = new T.Ray();
  private readonly hit = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly fade = new BuildingFade();
  private readonly opacity = new Map<T.Group, number>();
  active = false;

  amount(group: T.Group) { return this.opacity.get(group) ?? 1; }

  /** Fade cutaways toward their new visibility; returns how many obstruct the supplied points. */
  update(camera: T.Vector3, points: T.Vector3[], dt = 1 / 60): number {
    let hidden = 0;
    this.active = false;
    for (const { group, bounds } of this.occluders) {
      let blocked = false;
      for (const point of points) {
        this.direction.copy(point).sub(camera);
        const distance = this.direction.length();
        this.ray.set(camera, this.direction.normalize());
        const hit = this.ray.intersectBox(bounds, this.hit);
        if (hit && hit.distanceTo(camera) < distance - 0.7) {
          blocked = true;
          break;
        }
      }
      const previous = this.amount(group);
      const amount = T.MathUtils.clamp(previous + (blocked ? -1 : 1) * Math.max(0, dt) / 0.24, 0, 1);
      this.opacity.set(group, amount);
      if (amount !== previous) this.fade.set(group, amount);
      if (amount !== (blocked ? 0 : 1)) this.active = true;
      if (blocked) hidden++;
    }
    return hidden;
  }

  dispose() { this.fade.dispose(); this.opacity.clear(); this.active = false; }
}
