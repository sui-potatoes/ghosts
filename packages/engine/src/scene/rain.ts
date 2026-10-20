import * as T from "three";
import { sceneRandom } from "./space";

const DROPS = 650,
  HEIGHT = 23;

/** Streaks of rain falling through a box over the district. */
export class Rain {
  readonly mesh: T.LineSegments;
  private readonly positions = new Float32Array(DROPS * 6);

  constructor() {
    for (let i = 0; i < DROPS; i++) {
      const x = (sceneRandom() - 0.5) * 65,
        y = sceneRandom() * HEIGHT,
        z = (sceneRandom() - 0.5) * 55;
      this.positions.set([x, y, z, x - 0.12, y + 0.65, z + 0.03], i * 6);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(this.positions, 3));
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

  /** Advance every drop by `dt` seconds, wrapping at the ground. */
  update(dt: number) {
    if (!this.mesh.visible) return;
    const p = this.positions;
    for (let i = 0; i < p.length; i += 6) {
      p[i + 1] -= dt * 15;
      p[i + 4] -= dt * 15;
      p[i] -= dt * 2;
      p[i + 3] -= dt * 2;
      if (p[i + 1] < 0) {
        p[i + 1] += HEIGHT;
        p[i + 4] += HEIGHT;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
