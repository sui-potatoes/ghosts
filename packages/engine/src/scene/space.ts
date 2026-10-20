import * as T from "three";
import { CELL, type Cell, type TacticalMap } from "../map";

/** Cells and world points on one map: the ground under a cell, the cell under a point. */
export class Space {
  constructor(readonly map: TacticalMap) {}

  /** The world point on the ground of `cell`, `y` metres above the street surface. */
  vec(cell: Cell, y = 0) {
    const x = cell[0] * CELL,
      z = cell[1] * CELL;
    return new T.Vector3(x, y + this.map.surfaceHeight(x, z), z);
  }

  /** Ground height at a world point. */
  ground(x: number, z: number) {
    return this.map.surfaceHeight(x, z);
  }

  /** The cell under a ground point, or null outside the map. */
  cellAt(point: T.Vector3): Cell | null {
    const cell: Cell = [Math.round(point.x / CELL), Math.round(point.z / CELL)];
    return this.map.inBounds(cell) ? cell : null;
  }
}

/** Something that runs eased tweens on the render loop. */
export interface Animator {
  tween(seconds: number, fn: (t: number) => void, smooth?: boolean): Promise<void>;
}

let seed = 44;
/** Seeded so rain and debris are the same on every load. */
export function sceneRandom() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** Remove and free everything in `group`. */
export function clearGroup(group: T.Group) {
  for (const o of [...group.children]) {
    group.remove(o);
    if (o instanceof T.Mesh || o instanceof T.Line) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  }
}
