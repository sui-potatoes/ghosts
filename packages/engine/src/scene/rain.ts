// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { sceneRandom } from "./space.ts";

const DROPS = 650,
  HEIGHT = 23,
  WIDTH = 65,
  DEPTH = 55;

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Streaks of rain falling through a box over the district. */
export class Rain {
  readonly mesh: T.LineSegments;
  private readonly positions = new Float32Array(DROPS * 6);

  constructor() {
    for (let i = 0; i < DROPS; i++) {
      const x = (sceneRandom() - 0.5) * WIDTH,
        y = sceneRandom() * HEIGHT,
        z = (sceneRandom() - 0.5) * DEPTH;
      this.positions.set([x, y, z, x - 0.12, y + 0.65, z + 0.03], i * 6);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(this.positions, 3));
    // The animated drops can occupy the entire volume, not just their initial bounds.
    geometry.boundingBox = new T.Box3(
      new T.Vector3(-WIDTH / 2 - 0.12, 0, -DEPTH / 2),
      new T.Vector3(WIDTH / 2, HEIGHT + 0.65, DEPTH / 2 + 0.03),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
    this.mesh = new T.LineSegments(
      geometry,
      new T.LineBasicMaterial({ color: 0xa7c3c9, transparent: true, opacity: 0.17, depthWrite: false }),
    );
  }

  get visible() {
    return this.mesh.visible;
  }

  set visible(on: boolean) {
    this.mesh.visible = on;
  }

  /** Wrap both falling and wind drift so toggling never reveals an empty rain volume. */
  update(dt: number) {
    if (!this.mesh.visible) return;
    const p = this.positions;
    for (let i = 0; i < p.length; i += 6) {
      p[i] = wrap(p[i] - dt * 2 + WIDTH / 2, WIDTH) - WIDTH / 2;
      p[i + 1] = wrap(p[i + 1] - dt * 15, HEIGHT);
      p[i + 3] = p[i] - 0.12;
      p[i + 4] = p[i + 1] + 0.65;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
