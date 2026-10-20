// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

export interface Occluder {
  group: T.Group;
  bounds: T.Box3;
}

/**
 * Hides foreground buildings that stand between the camera and anything the
 * player must see: the camera focus, every living unit and the aim point.
 */
export class Occlusion {
  readonly occluders: Occluder[] = [];
  private readonly ray = new T.Ray();
  private readonly hit = new T.Vector3();
  private readonly direction = new T.Vector3();

  /** Toggle each occluder's visibility; returns how many are hidden. */
  update(camera: T.Vector3, points: T.Vector3[]): number {
    let hidden = 0;
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
      group.visible = !blocked;
      if (blocked) hidden++;
    }
    return hidden;
  }
}
