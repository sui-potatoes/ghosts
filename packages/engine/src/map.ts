// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

type Point = readonly [number, number];
export type Cell = [number, number];

/** Metres per grid cell. */
export const CELL = 1.35;

/** A building's ground rectangle in metres, from its cell centre and size. */
export function footprint(b: { x: number; z: number; w: number; d: number }) {
  const minX = (b.x - Math.floor(b.w / 2) - 0.5) * CELL;
  const minZ = (b.z - Math.floor(b.d / 2) - 0.5) * CELL;
  return {
    minX,
    minZ,
    maxX: minX + b.w * CELL,
    maxZ: minZ + b.d * CELL,
    x: minX + (b.w * CELL) / 2,
    z: minZ + (b.d * CELL) / 2,
    w: b.w * CELL,
    d: b.d * CELL,
  };
}

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: string;
}

/** Street widths in metres; the crossing ramps sit at fixed offsets from them. */
export interface Street {
  avenueHalf: number;
  crossHalf: number;
  curb: number;
  reach: number;
}

/** A map as plain data: playable bounds in cells, buildings, low cover and the street. */
export interface MapPlan {
  id: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: readonly Building[];
  covers: readonly Cell[];
  street: Street;
}

const key = (p: Point) => `${p[0]},${p[1]}`;

/**
 * Every geometric question the rules and the scene ask about a map: where a
 * unit may stand, which cells are cover and of what kind, whether a shot
 * clears the buildings, how to peek around a wall corner, and how high the
 * ground is. Built once per plan.
 */
export class TacticalMap {
  readonly plan: MapPlan;
  readonly covers: readonly Cell[];
  private readonly boxes: ReturnType<typeof footprint>[];
  private readonly blocked = new Set<string>();
  private readonly coverKeys: Set<string>;

  constructor(plan: MapPlan) {
    this.plan = plan;
    this.covers = plan.covers;
    this.boxes = plan.buildings.map(footprint);
    for (const b of plan.buildings)
      for (let x = b.x - Math.floor(b.w / 2); x < b.x - Math.floor(b.w / 2) + b.w; x++)
        for (let z = b.z - Math.floor(b.d / 2); z < b.z - Math.floor(b.d / 2) + b.d; z++) this.blocked.add(key([x, z]));
    this.coverKeys = new Set(plan.covers.map(key));
    for (const c of plan.covers) this.blocked.add(key(c));
  }

  get bounds() {
    return this.plan.bounds;
  }

  inBounds(p: Point) {
    const b = this.plan.bounds;
    return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minZ && p[1] <= b.maxZ;
  }

  /** Inside the bounds and not a building or a barrier. Units are the rules' concern. */
  open(p: Point) {
    return this.inBounds(p) && !this.blocked.has(key(p));
  }

  isCover(p: Point) {
    return this.coverKeys.has(key(p));
  }

  /** Ground height at a world point: street level, curbs, and ramps at the crossings. */
  surfaceHeight = (x: number, z: number) => {
    const street = this.plan.street;
    const dx = Math.abs(x) - street.avenueHalf,
      dz = Math.abs(z) - street.crossHalf;
    if (dx <= 0 || dz <= 0) return 0;
    const rampX = Math.abs(Math.abs(z) - 3.25) < 0.7;
    const rampZ = Math.abs(Math.abs(x) - 3.85) < 0.7;
    return street.curb * Math.min(1, rampX ? dx / 0.75 : 1, rampZ ? dz / 0.75 : 1);
  };

  /** Test the entire shot segment (world metres) against solid building footprints. */
  clearBuildingShot(a: Point, b: Point) {
    return !this.boxes.some((box) => {
      let enter = 0,
        exit = 1;
      for (const [axis, min, max] of [
        [0, box.minX, box.maxX],
        [1, box.minZ, box.maxZ],
      ] as const) {
        const delta = b[axis] - a[axis];
        if (Math.abs(delta) < 1e-8) {
          if (a[axis] <= min || a[axis] >= max) return false;
          continue;
        }
        let t0 = (min - a[axis]) / delta,
          t1 = (max - a[axis]) / delta;
        if (t0 > t1) [t0, t1] = [t1, t0];
        enter = Math.max(enter, t0);
        exit = Math.min(exit, t1);
        if (exit <= enter) return false;
      }
      return enter < 0.999 && exit > 0.001;
    });
  }

  /** The building whose wall `cell` stands against, if any. */
  highCoverAt(cell: Point) {
    const x = cell[0] * CELL,
      z = cell[1] * CELL;
    return this.boxes.find(
      (b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)) < CELL * 0.72,
    );
  }

  /** A short step around an actual wall corner, never a shot through a wall. */
  coverPeek(cell: Point, target: Point) {
    const origin: [number, number] = [cell[0] * CELL, cell[1] * CELL],
      end: Point = [target[0] * CELL, target[1] * CELL],
      wall = this.highCoverAt(cell);
    if (!wall) return { high: false, position: origin, blocked: !this.clearBuildingShot(origin, end) };
    const candidates: [number, number][] = [];
    const margin = 0.38;
    if (origin[0] <= wall.minX || origin[0] >= wall.maxX)
      for (const z of [wall.minZ - margin, wall.maxZ + margin]) candidates.push([origin[0], z]);
    if (origin[1] <= wall.minZ || origin[1] >= wall.maxZ)
      for (const x of [wall.minX - margin, wall.maxX + margin]) candidates.push([x, origin[1]]);
    const clearStep = (p: Point) => {
      for (let i = 1; i <= 8; i++) {
        const x = origin[0] + ((p[0] - origin[0]) * i) / 8,
          z = origin[1] + ((p[1] - origin[1]) * i) / 8;
        if (this.covers.some((c) => Math.abs(x - c[0] * CELL) < 0.83 && Math.abs(z - c[1] * CELL) < 0.54))
          return false;
      }
      return true;
    };
    const distance = (p: Point) => Math.hypot(p[0] - origin[0], p[1] - origin[1]);
    const possible = candidates
      .filter(
        (p) =>
          clearStep(p) && distance(p) <= 1.65 && this.clearBuildingShot(origin, p) && this.clearBuildingShot(p, end),
      )
      .sort((a, b) => distance(a) - distance(b));
    return {
      high: true,
      position: possible[0] ?? origin,
      blocked: !possible.length && !this.clearBuildingShot(origin, end),
    };
  }

  /** Side is relative to the wall-facing stance, never to screen/world X. */
  coverStep(cell: Point, from: Point, to: Point) {
    const wall = this.highCoverAt(cell);
    if (!wall) throw new Error("Cover step requires an adjacent wall");
    const dx = to[0] - from[0],
      dz = to[1] - from[1];
    // Back against the wall, looking out. Travel stays tangent to that wall face.
    const facing: [number, number] =
      Math.abs(dx) > Math.abs(dz) ? [0, cell[1] * CELL < wall.z ? -1 : 1] : [cell[0] * CELL < wall.x ? -1 : 1, 0];
    const side = dx * -facing[1] + dz * facing[0] >= 0 ? "right" : "left";
    return {
      side,
      motion: side === "right" ? "wall_step_right" : "wall_step_left",
      heading: Math.atan2(-facing[0], -facing[1]),
    } as const;
  }

  /** Adjacent barriers work from either grid axis, including their narrow ends. */
  lowCoverAt(cell: Point) {
    return this.covers.filter((c) => Math.abs(c[0] - cell[0]) + Math.abs(c[1] - cell[1]) === 1);
  }

  physicalCover(cell: Point): "high" | "low" | "none" {
    // A wall behind the operator must not replace the crouch at a nearby barrier.
    if (this.lowCoverAt(cell).length) return "low";
    return this.highCoverAt(cell) ? "high" : "none";
  }

  /** Pose orientation is relative to the obstacle face, independent of arrival. */
  coverStance(cell: Point) {
    const low = this.lowCoverAt(cell)[0];
    if (low) return { kind: "low" as const, heading: Math.atan2(cell[0] - low[0], cell[1] - low[1]) };
    const wall = this.highCoverAt(cell);
    if (!wall) return { kind: "none" as const, heading: null };
    const x = cell[0] * CELL,
      z = cell[1] * CELL;
    const faces = [
      { gap: Math.abs(x - wall.minX), normal: [-1, 0] },
      { gap: Math.abs(x - wall.maxX), normal: [1, 0] },
      { gap: Math.abs(z - wall.minZ), normal: [0, -1] },
      { gap: Math.abs(z - wall.maxZ), normal: [0, 1] },
    ].sort((a, b) => a.gap - b.gap);
    const [nx, nz] = faces[0].normal;
    // Standing wall poses put the back to the wall; low poses face the barrier.
    return { kind: "high" as const, heading: Math.atan2(-nx, -nz) };
  }

  /** A step that slides along one wall rather than running in the open. */
  wallTravel(from: Point, to: Point) {
    if (this.physicalCover(from) !== "high" || this.physicalCover(to) !== "high") return false;
    const a = this.highCoverAt(from),
      b = this.highCoverAt(to);
    return !!a && a === b;
  }
}

const built = new Map<string, TacticalMap>();
/** One `TacticalMap` per plan id. */
export function tacticalMap(plan: MapPlan): TacticalMap {
  let map = built.get(plan.id);
  if (!map) built.set(plan.id, (map = new TacticalMap(plan)));
  return map;
}
