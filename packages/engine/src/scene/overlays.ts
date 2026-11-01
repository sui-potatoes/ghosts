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

// The ground speaks in the HUD's cold accent, brightest where the eye should
// land: the reach is a dim wash, the route a calm line over it, and the tile
// under the cursor (where the route ends) outshines both.
const REACH = 0x2c7f8a;
const ROUTE = 0x58b9c6;
const THROW = 0xd99a62;
const MARK = 0x8feaf5;
const MARK_RIM = 0xe6fdff;

/** How high the route floats over the street, and over the cover it vaults. */
const ROUTE_LIFT = 0.32;
const VAULT_LIFT = 1.15;
const ROUTE_RADIUS = 0.035;
/** How far into each corner the route starts to round it. */
const CORNER = CELL * 0.45;
/** Spacing of the route's samples along the ground, in metres. */
const ROUTE_STEP = 0.1;

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The tile under the cursor: a lit square inside a crisp rim, unfogged so it reads at any distance. */
function tileMark() {
  const half = CELL * 0.46,
    rim = CELL * 0.045;
  const square = (h: number) => new T.Path().moveTo(-h, -h).lineTo(h, -h).lineTo(h, h).lineTo(-h, h).closePath();
  const frame = new T.Shape(square(half).getPoints());
  frame.holes.push(square(half - rim));
  const fill = new T.Mesh(new T.PlaneGeometry(half * 2, half * 2), glow(MARK, 0.42));
  const edge = new T.Mesh(new T.ShapeGeometry(frame), glow(MARK_RIM, 0.95));
  fill.material.fog = edge.material.fog = false;
  edge.position.z = 0.002;
  return new T.Group().add(fill, edge);
}

/**
 * Everything drawn on the ground for the player: the tactical grid, the
 * movement or throw range, the planned path, the hovered tile and the ring
 * under the selected operator.
 */
export class Overlays {
  readonly grid: T.LineSegments;
  private readonly range = new T.Group();
  private readonly route = new T.Group();
  private readonly hover = tileMark();
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

  /** Tiles `u` can reach this action, or nothing (nobody selected, or `show` off). */
  showRange(game: Encounter, u: Unit | undefined, show: boolean) {
    this.hoverKey = "";
    clearGroup(this.range);
    this.movementPaths.clear();
    if (!u || !show || u.ap <= 0) return;
    const paths = game.paths(u);
    this.movementPaths = paths;
    const tiles = new T.InstancedMesh(new T.PlaneGeometry(CELL * 0.9, CELL * 0.9), glow(REACH, 0.22), paths.size);
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

  /** The planned route as a solid line in the air, or a throw arc with its blast ring when `grenade`. */
  showPath(path: Cell[] | undefined, grenade = false) {
    clearGroup(this.route);
    if (!path || path.length < 2) return;
    const pts = grenade ? this.throwArc(path[0], path[path.length - 1]) : this.routeLine(path);
    this.route.add(
      new T.Mesh(
        new T.TubeGeometry(new T.CatmullRomCurve3(pts), pts.length, ROUTE_RADIUS, 6),
        new T.MeshBasicMaterial({ color: grenade ? THROW : ROUTE }),
      ),
    );
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

  /**
   * The route through `path`'s cells as a line hung a little above the
   * street: corners rounded off, lifted off the operator's tile, arcing over
   * the cover it vaults, and settling onto the destination tile.
   */
  private routeLine(path: Cell[]): T.Vector3[] {
    const cells = path.map(([x, z]) => new T.Vector2(x * CELL, z * CELL));
    const plan = new T.Path().moveTo(cells[0].x, cells[0].y);
    for (let i = 1; i < cells.length - 1; i++) {
      const [a, p, b] = [cells[i - 1], cells[i], cells[i + 1]];
      const r = Math.min(CORNER, a.distanceTo(p) * 0.45, p.distanceTo(b) * 0.45);
      const enter = p.clone().addScaledVector(a.clone().sub(p).normalize(), r);
      const leave = p.clone().addScaledVector(b.clone().sub(p).normalize(), r);
      plan.lineTo(enter.x, enter.y);
      plan.quadraticCurveTo(p.x, p.y, leave.x, leave.y);
    }
    const end = cells[cells.length - 1];
    plan.lineTo(end.x, end.y);
    const length = plan.getLength();
    const flat = plan.getSpacedPoints(Math.max(8, Math.ceil(length / ROUTE_STEP)));
    // Ground under each sample, eased so a curb is a slope, not a step in the line.
    let ground = flat.map((q) => this.space.ground(q.x, q.y));
    for (let pass = 0; pass < 3; pass++)
      ground = ground.map((g, i) => (ground[Math.max(0, i - 1)] + g + ground[Math.min(ground.length - 1, i + 1)]) / 3);
    const vaults = path.filter((c) => this.space.map.isCover(c)).map(([x, z]) => new T.Vector2(x * CELL, z * CELL));
    const ends = CELL * 0.5;
    return flat.map((q, i) => {
      const along = (i / (flat.length - 1)) * length;
      let lift = ROUTE_LIFT * smoothstep(along / ends) * smoothstep((length - along) / ends);
      for (const v of vaults) lift = Math.max(lift, VAULT_LIFT * smoothstep(1 - q.distanceTo(v) / CELL));
      return new T.Vector3(q.x, ground[i] + 0.06 + lift, q.y);
    });
  }

  /** A grenade's flight from `from` to `to`, three metres high at the top. */
  private throwArc(from: Cell, to: Cell): T.Vector3[] {
    const a = this.space.vec(from, 0.13),
      b = this.space.vec(to, 0.13);
    return Array.from({ length: 30 }, (_, i) => {
      const t = i / 29;
      return a
        .clone()
        .lerp(b, t)
        .add(new T.Vector3(0, Math.sin(t * Math.PI) * 3, 0));
    });
  }

  /** Move the hover tile to `p`; false when it is already there. */
  hoverAt(p: Cell): boolean {
    if (key(p) === this.hoverKey) return false;
    this.hoverKey = key(p);
    this.hover.position.copy(this.space.vec(p, 0.07));
    return true;
  }

  get hoverVisible() {
    return this.hover.visible;
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
