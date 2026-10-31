// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { key, type Encounter, type Unit } from "../game";
import { CELL, type Cell } from "../map";
import { clearGroup, type Space } from "./space";

const flat = (color: number, opacity: number) =>
  new T.MeshBasicMaterial({ color, transparent: true, opacity, side: T.DoubleSide, depthWrite: false });

/** A flat tile that adds light instead of tinting: readable on dark ground. */
const glow = (color: number, opacity: number) => {
  const material = flat(color, opacity);
  material.blending = T.AdditiveBlending;
  return material;
};

/**
 * Everything drawn on the ground for the player: the tactical grid, the
 * movement or throw range, the planned path, the hovered tile and the ring
 * under the selected operator.
 */
export class Overlays {
  readonly grid: T.LineSegments;
  private readonly range = new T.Group();
  private readonly route = new T.Group();
  private readonly hover = new T.Mesh(new T.PlaneGeometry(CELL * 0.92, CELL * 0.92), flat(0xe8c17d, 0.24));
  private readonly selector = new T.Mesh(
    new T.RingGeometry(0.48, 0.54, 48),
    new T.MeshBasicMaterial({ color: 0xe9c58a, side: T.DoubleSide }),
  );
  private movementPaths = new Map<string, Cell[]>();
  private hoverKey = "";

  constructor(
    scene: T.Scene,
    private readonly space: Space,
  ) {
    this.grid = this.tacticalGrid();
    this.selector.rotation.x = -Math.PI / 2;
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.visible = false;
    scene.add(this.range, this.route, this.grid, this.selector, this.hover);
  }

  /** Cell edges over the whole map, following the ground (curbs, ramps). */
  private tacticalGrid() {
    const points: number[] = [];
    const { minX, maxX, minZ, maxZ } = this.space.map.bounds;
    const lift = (x: number, z: number) => this.space.ground(x, z) + 0.025;
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++) {
        const a = (x - 0.5) * CELL,
          b = (z - 0.5) * CELL;
        for (const [sx, sz, ex, ez] of [
          [a, b, a + CELL, b],
          [a, b, a, b + CELL],
        ])
          for (let n = 0; n < 3; n++) {
            const x1 = sx + ((ex - sx) * n) / 3,
              z1 = sz + ((ez - sz) * n) / 3,
              x2 = sx + ((ex - sx) * (n + 1)) / 3,
              z2 = sz + ((ez - sz) * (n + 1)) / 3;
            points.push(x1, lift(x1, z1), z1, x2, lift(x2, z2), z2);
          }
      }
    return new T.LineSegments(
      new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3)),
      new T.LineBasicMaterial({ color: 0xa4b5bc, transparent: true, opacity: 0.15, depthWrite: false }),
    );
  }

  get gridVisible() {
    return this.grid.visible;
  }

  setGrid(visible: boolean) {
    this.grid.visible = visible;
  }

  /** Tiles `u` can reach this action, or nothing. */
  showRange(game: Encounter, u: Unit, show: boolean) {
    this.hoverKey = "";
    clearGroup(this.range);
    this.movementPaths.clear();
    if (!show || u.ap <= 0) return;
    const paths = game.paths(u);
    this.movementPaths = paths;
    const tiles = new T.InstancedMesh(new T.PlaneGeometry(CELL * 0.9, CELL * 0.9), glow(0x9fd9dd, 0.34), paths.size);
    const d = new T.Object3D();
    let i = 0;
    for (const path of paths.values()) {
      d.position.copy(this.space.vec(path[path.length - 1], 0.055));
      d.rotation.x = -Math.PI / 2;
      d.updateMatrix();
      tiles.setMatrixAt(i++, d.matrix);
    }
    this.range.add(tiles);
  }

  /** The path to `p` from the range last shown. */
  previewPath(p: Cell) {
    return this.movementPaths.get(key(p));
  }

  /** Tiles within throwing distance of `u`. */
  showGrenadeRange(u: Unit) {
    clearGroup(this.range);
    if (u.ap <= 0 || u.grenade) return;
    const points: Cell[] = [];
    const b = this.space.map.bounds;
    for (let x = b.minX; x <= b.maxX; x++)
      for (let z = b.minZ; z <= b.maxZ; z++)
        if (Math.abs(x - u.pos[0]) + Math.abs(z - u.pos[1]) <= 5) points.push([x, z]);
    const tiles = new T.InstancedMesh(
      new T.PlaneGeometry(CELL * 0.93, CELL * 0.93),
      flat(0xe7ac66, 0.16),
      points.length,
    );
    const dummy = new T.Object3D();
    points.forEach((p, i) => {
      dummy.position.copy(this.space.vec(p, 0.08));
      dummy.rotation.x = -Math.PI / 2;
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);
    });
    this.range.add(tiles);
  }

  /** A dashed route, or a throw arc with its blast ring when `grenade`. */
  showPath(path: Cell[] | undefined, grenade = false) {
    clearGroup(this.route);
    if (!path || path.length < 2) return;
    let pts = path.map((p) => this.space.vec(p, 0.13));
    if (grenade) {
      const a = pts[0],
        b = pts[pts.length - 1];
      pts = Array.from({ length: 30 }, (_, i) => {
        const t = i / 29;
        return a
          .clone()
          .lerp(b, t)
          .add(new T.Vector3(0, Math.sin(t * Math.PI) * 3, 0));
      });
    }
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineDashedMaterial({ color: grenade ? 0xefad75 : 0xf1d29c, dashSize: 0.16, gapSize: 0.09 }),
    );
    line.computeLineDistances();
    this.route.add(line);
    if (grenade) {
      const ring = new T.Mesh(
        new T.RingGeometry(CELL * 1.9, CELL * 2, 64),
        new T.MeshBasicMaterial({ color: 0xf4a275, transparent: true, opacity: 0.45, side: T.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pts[pts.length - 1]);
      this.route.add(ring);
    }
  }

  /** Move the hover tile to `p`; false when it is already there. */
  hoverAt(p: Cell): boolean {
    if (key(p) === this.hoverKey) return false;
    this.hoverKey = key(p);
    this.hover.position.copy(this.space.vec(p, 0.07));
    return true;
  }

  setHover(visible: boolean) {
    this.hover.visible = visible;
  }

  /** The pointer left the field. */
  leave() {
    this.hover.visible = false;
    this.hoverKey = "";
  }

  /** Keep the selection ring under `at`, turning slowly; hidden when null. */
  updateSelector(at: T.Vector3 | null, time: number) {
    this.selector.visible = !!at;
    if (!at) return;
    this.selector.position.copy(at);
    this.selector.position.y = this.space.ground(at.x, at.z) + 0.04;
    this.selector.rotation.z = time * 0.3;
  }
}
