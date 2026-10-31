// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { propBlastMultiplier, propHealth, resistsGunfire, type MapProp, type PropDamage } from "./environment.ts";

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
  /** Optional destructible owner; its footprint disappears with that prop. */
  prop?: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: string;
}

/** Street widths in metres. */
export interface Street {
  avenueHalf: number;
  crossHalf: number;
  curb: number;
  reach: number;
  /**
   * Zebra-crossing curb cuts: `avenue` is |z| of the cuts through the avenue
   * sidewalk, `cross` is |x| of the cuts through the cross-street sidewalk,
   * `half` their band half-width and `run` the ramp run, all in metres.
   * Hard curbs all around when absent.
   */
  cuts?: { avenue: number; cross: number; half: number; run: number };
}

/** A map as plain data: playable bounds in cells, buildings, low cover and the street. */
export interface MapPlan {
  id: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: readonly Building[];
  covers: readonly Cell[];
  /** Movement-only furniture / glazing footprints; no cover or line-of-sight defense. */
  obstacles?: readonly Cell[];
  props?: readonly MapProp[];
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
  readonly props: readonly MapProp[];
  private readonly propHp = new Map<string, number>();
  private readonly boxes: (ReturnType<typeof footprint> & { prop?: string })[];
  private readonly propBlocks = new Map<string, string[]>();
  private readonly blocked = new Set<string>();
  private readonly coverKeys: Set<string>;

  constructor(plan: MapPlan) {
    this.plan = plan;
    this.props = plan.props ?? [];
    for (const prop of this.props) this.propHp.set(prop.id, propHealth[prop.kind]);
    this.boxes = plan.buildings.map(b => ({ ...footprint(b), prop: b.prop }));
    for (const prop of this.props) for (const cell of prop.blocks ?? []) {
      const ids = this.propBlocks.get(key(cell)) ?? []; ids.push(prop.id); this.propBlocks.set(key(cell), ids);
    }
    for (const cell of plan.obstacles ?? []) this.blocked.add(key(cell));
    for (const b of plan.buildings.filter(b => !b.prop))
      for (let x = b.x - Math.floor(b.w / 2); x < b.x - Math.floor(b.w / 2) + b.w; x++)
        for (let z = b.z - Math.floor(b.d / 2); z < b.z - Math.floor(b.d / 2) + b.d; z++) this.blocked.add(key([x, z]));
    this.coverKeys = new Set(plan.covers.map(key));
  }

  get covers(): readonly Cell[] {
    return this.plan.covers.filter((cell) => this.coverKeys.has(key(cell)));
  }

  health(id: string) {
    return this.propHp.get(id) ?? 0;
  }

  /** Decide damage without mutation; the event reducer commits the result. */
  damageProp(id: string, damage: number, source: "shot" | "blast" = "shot"): PropDamage[] {
    const before = this.health(id);
    if (!before || !Number.isFinite(damage) || damage <= 0) return [];
    const prop = this.props.find((p) => p.id === id);
    if (!prop || (source === "shot" && resistsGunfire(prop.kind))) return [];
    const hp = Math.max(0, before - damage * (source === "blast" ? propBlastMultiplier(prop.kind) : 1));
    const changes: PropDamage[] = [{ id, hp, destroyed: hp === 0 }];
    const seen = new Set([id]);
    for (let i = 0; i < changes.length; i++) {
      if (!changes[i].destroyed) continue;
      for (const prop of this.props) {
        if (prop.support !== changes[i].id || seen.has(prop.id) || !this.health(prop.id)) continue;
        seen.add(prop.id);
        changes.push({ id: prop.id, hp: 0, destroyed: true });
      }
    }
    return changes;
  }

  applyPropDamage(changes: readonly PropDamage[]) {
    for (const change of changes) {
      const prop = this.props.find((p) => p.id === change.id);
      if (!prop) continue;
      this.propHp.set(prop.id, change.hp);
    }
    for (const change of changes) {
      const prop = this.props.find(p => p.id === change.id);
      for (const cell of prop?.covers ?? (prop?.cover ? [prop.cover] : []))
        if (!this.props.some(p => this.health(p.id) > 0 && (p.covers ?? (p.cover ? [p.cover] : [])).some(c => key(c) === key(cell))))
          this.coverKeys.delete(key(cell));
    }
  }

  /** Diamond-shaped reach to the prop surface. Intact buildings shield props;
   * all shielding is evaluated before this explosion removes any walls. */
  blastProps(at: Point): PropDamage[] {
    const x = at[0] * CELL, z = at[1] * CELL;
    const changes = this.props.flatMap((prop) => {
      // Store glazing is slightly inset into its footprint. Test visibility at
      // the outside face, while still allowing other buildings to shield it.
      const offset = prop.storefront ? 0.1 : 0;
      let face: Point = [prop.x + Math.sin(prop.yaw) * offset, prop.z + Math.cos(prop.yaw) * offset];
      if (prop.hitbox) {
        const box = prop.hitbox, c = Math.cos(prop.yaw), s = Math.sin(prop.yaw);
        const localX = (x - prop.x) * c - (z - prop.z) * s;
        const localZ = (x - prop.x) * s + (z - prop.z) * c;
        const nearX = Math.max(-box.width / 2, Math.min(box.width / 2, localX - (box.x ?? 0))) + (box.x ?? 0);
        const nearZ = Math.max(-box.depth / 2, Math.min(box.depth / 2, localZ - (box.z ?? 0))) + (box.z ?? 0);
        face = [prop.x + nearX * c + nearZ * s, prop.z - nearX * s + nearZ * c];
      }
      const distance = (Math.abs(face[0] - x) + Math.abs(face[1] - z)) / CELL;
      if (distance > 2 + 1e-8 || !this.clearBuildingShot([x, z], face, prop.pane ? prop.support : prop.id)) return [];
      return this.damageProp(prop.id, Math.round(100 - distance * 20), "blast");
    });
    const unique = new Map<string, PropDamage>();
    for (const change of changes)
      if (!unique.has(change.id) || unique.get(change.id)!.hp > change.hp) unique.set(change.id, change);
    return [...unique.values()];
  }

  /** Missed rounds can strike the first storefront along their continued path.
   * Broken glazing never opens a firing lane through the solid building. */
  strayShotProps(from: Point, toward: Point, damage: number): PropDamage[] {
    const x = from[0] * CELL, z = from[1] * CELL;
    const dx = (toward[0] - from[0]) * CELL, dz = (toward[1] - from[1]) * CELL;
    const length = Math.hypot(dx, dz);
    if (!length) return [];
    const ux = dx / length, uz = dz / length;
    const y = this.surfaceHeight(x, z) + 1.2;
    let nearest: { prop: MapProp; distance: number; impact: [number, number, number] } | undefined;
    for (const prop of this.props) {
      if (prop.hitbox) {
        if (!this.health(prop.id)) continue;
        const box = prop.hitbox, c = Math.cos(prop.yaw), s = Math.sin(prop.yaw);
        const bottom = this.surfaceHeight(prop.x, prop.z) + (prop.y ?? 0) + (box.y ?? 0);
        if (y < bottom || y > bottom + box.height) continue;
        const ox = (x - prop.x) * c - (z - prop.z) * s - (box.x ?? 0);
        const oz = (x - prop.x) * s + (z - prop.z) * c - (box.z ?? 0);
        const vx = ux * c - uz * s, vz = ux * s + uz * c;
        let enter = 0, exit = length + 12;
        for (const [o, v, half] of [[ox, vx, box.width / 2], [oz, vz, box.depth / 2]]) {
          if (Math.abs(v) < 1e-8) { if (Math.abs(o) > half) exit = -1; continue; }
          const a = (-half - o) / v, b = (half - o) / v;
          enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
        }
        if (exit < enter || enter <= .001 || (nearest && enter >= nearest.distance)) continue;
        const localX = ox + vx * enter, localZ = oz + vz * enter;
        if (prop.kind === "office-window-wall" && y > .93 && y < 2.39 && Math.abs(localX) < .61) continue;
        if (prop.kind === "office-steel-door" && y > 1.69 && y < 2.05 &&
          Math.abs(prop.office?.open ? localZ : localX) < .165) continue;
        const hx = x + ux * enter, hz = z + uz * enter;
        if (!this.clearBuildingShot([x, z], [hx, hz], prop.pane ? prop.support : prop.id)) continue;
        nearest = { prop, distance: enter, impact: [hx, y, hz] };
        continue;
      }
      if (!prop.storefront) continue;
      const nx = Math.sin(prop.yaw), nz = Math.cos(prop.yaw);
      const approach = ux * nx + uz * nz;
      if (approach >= -0.0001) continue;
      const distance = ((prop.x - x) * nx + (prop.z - z) * nz) / approach;
      if (distance <= 0 || distance > length + 12 || (nearest && distance >= nearest.distance)) continue;
      const hx = x + ux * distance, hz = z + uz * distance;
      const localX = (hx - prop.x) * nz - (hz - prop.z) * nx;
      const bottom = this.surfaceHeight(prop.x, prop.z) + (prop.y ?? 0);
      if (Math.abs(localX) > prop.storefront.width / 2 || y < bottom || y > bottom + prop.storefront.height) continue;
      if (!this.clearBuildingShot([x, z], [hx + nx * 0.1, hz + nz * 0.1])) continue;
      nearest = { prop, distance, impact: [hx, y, hz] };
    }
    if (!nearest) return [];
    return this.damageProp(nearest.prop.id, damage).map((change) => ({ ...change, impact: nearest.impact }));
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
    return this.inBounds(p) && !this.blocked.has(key(p)) && !this.coverKeys.has(key(p)) &&
      !(this.propBlocks.get(key(p)) ?? []).some(id => this.health(id) > 0);
  }

  isCover(p: Point) {
    return this.coverKeys.has(key(p));
  }

  /** Ground height at a world point: street level, curbs, and ramps at the crossings. */
  surfaceHeight = (x: number, z: number) => {
    const { avenueHalf, crossHalf, curb, cuts } = this.plan.street;
    const dx = Math.abs(x) - avenueHalf,
      dz = Math.abs(z) - crossHalf;
    if (dx <= 0 || dz <= 0) return 0;
    if (!cuts) return curb;
    const rampX = Math.abs(Math.abs(z) - cuts.avenue) < cuts.half;
    const rampZ = Math.abs(Math.abs(x) - cuts.cross) < cuts.half;
    return curb * Math.min(1, rampX ? dx / cuts.run : 1, rampZ ? dz / cuts.run : 1);
  };

  /** Test the entire shot segment (world metres) against solid building footprints. */
  clearBuildingShot(a: Point, b: Point, ignoreProp?: string) {
    return !this.boxes.some((box) => {
      if (box.prop && (box.prop === ignoreProp || !this.health(box.prop))) return false;
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
      (b) => (!b.prop || this.health(b.prop) > 0) && Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)) < CELL * 0.72,
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
