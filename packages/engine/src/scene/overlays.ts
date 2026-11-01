// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { key, type Encounter, type Unit } from "../game.ts";
import { CELL, type Cell } from "../map.ts";
import { clearGroup, type Space } from "./space.ts";
import { shootingTargets } from "../targeting.ts";

const flat = (color: number, opacity: number) =>
  new T.MeshBasicMaterial({ color, transparent: true, opacity, side: T.DoubleSide, depthWrite: false });

/** A flat tile that adds light instead of tinting: readable on dark ground. */
const glow = (color: number, opacity: number) => {
  const material = flat(color, opacity);
  material.blending = T.AdditiveBlending;
  return material;
};

// The ground speaks in the HUD's cold accent, brightest where the eye should
// land: the reach is a wash that fades away from the operator, the route a
// thin line over it, and the tile under the cursor (where the route ends)
// outshines both.
const REACH = 0x2c7f8a;
const ROUTE = 0x5fd0dd;
const THROW = 0xd99a62;
const MARK = 0x8feaf5;
const MARK_RIM = 0xe6fdff;

/** The route's height over the street, and its width in screen pixels. */
const ROUTE_LIFT = 0.13;
const ROUTE_WIDTH = 3;
/** Spacing of the route's ground samples, and how far ahead it starts climbing a step, in metres. */
const ROUTE_STEP = 0.05;
const STEP_REACH = 0.35;
/** How far to each side the route feels the ground: kerb stones straddle the tiles along a curb. */
const ROUTE_SIDE = 0.14;

/** Each value as the mean of its neighbours within `r` samples, the ends held. */
function blur(values: number[], r: number) {
  const at = (i: number) => values[Math.min(values.length - 1, Math.max(0, i))];
  return values.map((_, i) => {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += at(i + k);
    return sum / (2 * r + 1);
  });
}

/** A constant-width, antialiased line through `points`, however far the camera is. */
function screenLine(points: T.Vector3[], color: number) {
  return new Line2(
    new LineGeometry().setPositions(points.flatMap((p) => [p.x, p.y, p.z])),
    new LineMaterial({ color, linewidth: ROUTE_WIDTH, alphaToCoverage: true }),
  );
}

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
  private readonly targets = new T.Group();
  private targeting: { game: Encounter; unit: Unit } | null = null;
  private targetKey = "";
  private readonly hover = tileMark();
  private readonly selector = new T.Mesh(
    new T.RingGeometry(0.48, 0.54, 48),
    new T.MeshBasicMaterial({ color: 0xe9c58a, side: T.DoubleSide }),
  );
  private movementPaths = new Map<string, Cell[]>();
  private hoverKey = "";
  private readonly space: Space;

  constructor(scene: T.Scene, space: Space) {
    this.space = space;
    this.targets.name = "Shooting range";
    this.grid = this.tacticalGrid();
    this.selector.rotation.x = -Math.PI / 2;
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.visible = false;
    scene.add(this.range, this.route, this.targets, this.grid, this.selector, this.hover);
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

  get reflectionExcluded(): T.Object3D[] {
    return [this.range, this.route, this.targets, this.grid, this.selector, this.hover];
  }

  setGrid(visible: boolean) {
    this.grid.visible = visible;
  }

  /** Tiles `u` can reach this action, brightest beside them; nothing with nobody selected or `show` off. */
  showRange(game: Encounter, u: Unit | undefined, show: boolean) {
    this.hoverKey = "";
    clearGroup(this.range);
    this.movementPaths.clear();
    this.targeting = u && show ? { game, unit: u } : null;
    this.targetKey = "";
    this.showTargets(u?.pos);
    if (!u || !show || u.ap <= 0) return;
    const paths = game.paths(u);
    this.movementPaths = paths;
    const tiles = new T.InstancedMesh(new T.PlaneGeometry(CELL * 0.9, CELL * 0.9), glow(REACH, 0.3), paths.size);
    const d = new T.Object3D();
    const fade = new T.Color();
    let i = 0;
    for (const path of paths.values()) {
      d.position.copy(this.space.vec(path[path.length - 1], 0.055));
      d.rotation.x = -Math.PI / 2;
      d.updateMatrix();
      tiles.setMatrixAt(i, d.matrix);
      // Additive light: a darker instance color is a fainter tile.
      tiles.setColorAt(i++, fade.setScalar(Math.min(1, 2 / path.length)));
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

  /** The planned route just over the tiles, or a throw arc with its blast ring when `grenade`. */
  showPath(path: Cell[] | undefined, grenade = false) {
    clearGroup(this.route);
    this.showTargets(grenade ? undefined : path?.[path.length - 1] ?? this.targeting?.unit.pos);
    if (!path || path.length < 2) return;
    const pts = grenade ? this.throwArc(path[0], path[path.length - 1]) : this.routeLine(path);
    this.route.add(screenLine(pts, grenade ? THROW : ROUTE));
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

  /** Red rings show weapon range and line of sight from the current or proposed position. */
  private showTargets(from?: Cell) {
    const context = this.targeting;
    const signature = context && from ? key(from) : "hidden";
    if (signature === this.targetKey) return;
    this.targetKey = signature;
    clearGroup(this.targets);
    if (!context || !from) return;
    for (const target of shootingTargets(context.game, context.unit, from)) {
      const ring = new T.Mesh(new T.RingGeometry(0.57, 0.65, 48), flat(0xff403d, 0.95));
      ring.name = target.id;
      ring.material.fog = false;
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(this.space.vec(target.pos, 0.09));
      ring.renderOrder = 3;
      this.targets.add(ring);
    }
  }

  /**
   * The route through `path`'s cell centres, a low-tension curve that only
   * softens the corners, held a little over the ground along its whole run:
   * it rises ahead of a curb and settles after it, never cutting the edge.
   */
  private routeLine(path: Cell[]): T.Vector3[] {
    const plan = new T.CatmullRomCurve3(
      path.map(([x, z]) => new T.Vector3(x * CELL, 0, z * CELL)),
      false,
      "catmullrom",
      0.05,
    );
    const points = plan.getSpacedPoints(Math.max(2, Math.ceil(plan.getLength() / ROUTE_STEP)));
    const ground = points.map((p) => this.groundNear(p.x, p.z));
    // The highest ground within reach, eased by two blurs whose span stays
    // inside that reach, so the ramps clear every step they smooth over.
    const reach = Math.round(STEP_REACH / ROUTE_STEP);
    const clear = ground.map((_, i) => Math.max(...ground.slice(Math.max(0, i - reach), i + reach + 1)));
    const height = blur(blur(clear, reach >> 1), reach >> 1);
    return points.map((p, i) => p.setY(height[i] + ROUTE_LIFT));
  }

  /** The highest ground within `ROUTE_SIDE` of a point: what a line passing there must clear. */
  private groundNear(x: number, z: number) {
    let top = -Infinity;
    for (const dx of [-ROUTE_SIDE, 0, ROUTE_SIDE])
      for (const dz of [-ROUTE_SIDE, 0, ROUTE_SIDE]) top = Math.max(top, this.space.ground(x + dx, z + dz));
    return top;
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
    const changed = this.hover.visible || !!this.hoverKey || this.route.children.length > 0;
    this.hover.visible = false;
    this.hoverKey = "";
    this.showPath(undefined);
    return changed;
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
