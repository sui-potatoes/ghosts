// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { key } from "../game.ts";
import type { ThreatArea } from "../intel.ts";
import { CELL, type Cell } from "../map.ts";
import type { Space } from "./space.ts";

/**
 * The inspected unit's reach on the ground, kept apart from the player's own
 * overlays: where it can shoot is a field of small crosses (fainter in the
 * fall-off band), where one move takes it is a hard outline around the area —
 * no wash, so the player's cyan move reach and its route stay readable on top.
 * Two draws at most; materials live as long as the overlay, geometry is
 * rebuilt only when `show` gets a new area.
 */
export class ThreatOverlay {
  private readonly group = new T.Group();
  private readonly marks: T.MeshBasicMaterial;
  private readonly edge: T.LineBasicMaterial;
  private readonly mark: T.BufferGeometry;
  private crosses: T.InstancedMesh | null = null;
  private outline: T.LineSegments | null = null;
  private readonly tones: Record<"hostile" | "friendly", T.Color>;

  private readonly space: Space;

  constructor(scene: T.Scene, space: Space, tones: { hostile: string; friendly: string }) {
    this.space = space;
    this.group.name = "Threat";
    this.tones = { hostile: new T.Color(tones.hostile), friendly: new T.Color(tones.friendly) };
    this.marks = new T.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide, fog: false });
    this.edge = new T.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    // A small cross per tile: thin bars, so the ground and the player's own marks show between them.
    const bar = (w: number, h: number) => new T.PlaneGeometry(w, h);
    const a = bar(CELL * 0.22, CELL * 0.035),
      b = bar(CELL * 0.035, CELL * 0.22);
    this.mark = mergePlanes(a, b);
    a.dispose();
    b.dispose();
    scene.add(this.group);
  }

  get object(): T.Object3D {
    return this.group;
  }

  /** Draw `area` in the side's tone; null clears. */
  show(area: ThreatArea | null, hostile = true) {
    this.clear();
    if (!area) return;
    const tone = this.tones[hostile ? "hostile" : "friendly"];
    this.marks.color.copy(tone);
    this.edge.color.copy(tone);
    if (area.fire.length) {
      const crosses = new T.InstancedMesh(this.mark, this.marks, area.fire.length);
      const d = new T.Object3D();
      const shade = new T.Color();
      area.fire.forEach(({ cell, falloff }, i) => {
        d.position.copy(this.space.vec(cell, 0.06));
        d.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
        d.updateMatrix();
        crosses.setMatrixAt(i, d.matrix);
        crosses.setColorAt(i, shade.setScalar(falloff ? 0.45 : 1));
      });
      crosses.renderOrder = 2;
      this.crosses = crosses;
      this.group.add(crosses);
    }
    if (area.move.length) {
      const points = outlinePoints(area.move, (x, z) => this.space.ground(x, z) + 0.07);
      const geometry = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3));
      this.outline = new T.LineSegments(geometry, this.edge);
      this.outline.renderOrder = 3;
      this.group.add(this.outline);
    }
  }

  private clear() {
    if (this.crosses) {
      this.group.remove(this.crosses);
      this.crosses.dispose();
      this.crosses = null;
    }
    if (this.outline) {
      this.group.remove(this.outline);
      this.outline.geometry.dispose();
      this.outline = null;
    }
  }

  dispose() {
    this.clear();
    this.mark.dispose();
    this.marks.dispose();
    this.edge.dispose();
    this.group.removeFromParent();
  }
}

/** Two plane geometries as one (the cross), without pulling in the addons' merge utilities. */
function mergePlanes(a: T.BufferGeometry, b: T.BufferGeometry): T.BufferGeometry {
  const pa = a.getAttribute("position").array as Float32Array,
    pb = b.getAttribute("position").array as Float32Array;
  const ia = [...(a.getIndex()?.array ?? [])],
    ib = [...(b.getIndex()?.array ?? [])].map((i) => i + pa.length / 3);
  const merged = new T.BufferGeometry();
  merged.setAttribute("position", new T.Float32BufferAttribute([...pa, ...pb], 3));
  merged.setIndex([...ia, ...ib]);
  return merged;
}

/**
 * The boundary of a set of cells as line segments: every cell edge with an
 * outside cell beyond it, following the ground. `height` is the line's height
 * at a world point.
 */
export function outlinePoints(cells: readonly Cell[], height: (x: number, z: number) => number): number[] {
  const inside = new Set(cells.map(key));
  const out: number[] = [];
  const h = CELL / 2;
  const push = (x1: number, z1: number, x2: number, z2: number) =>
    out.push(x1, height(x1, z1), z1, x2, height(x2, z2), z2);
  for (const [x, z] of cells) {
    const cx = x * CELL,
      cz = z * CELL;
    if (!inside.has(key([x, z - 1]))) push(cx - h, cz - h, cx + h, cz - h);
    if (!inside.has(key([x, z + 1]))) push(cx - h, cz + h, cx + h, cz + h);
    if (!inside.has(key([x - 1, z]))) push(cx - h, cz - h, cx - h, cz + h);
    if (!inside.has(key([x + 1, z]))) push(cx + h, cz - h, cx + h, cz + h);
  }
  return out;
}
