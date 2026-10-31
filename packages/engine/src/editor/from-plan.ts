// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Shipped maps reconstructed as editable levels. The conversion is a
 * best-effort re-seating of a `MapPlan` into the editor's model: props become
 * catalog placements (walls and glazing snap to the nearest cell edge,
 * desktop clutter re-mounts on whatever it stood on), solid buildings become
 * typed high-cover blocks to redress asset by asset, office floor zones
 * become painted tiles, and out-of-bounds street dressing is dropped and
 * counted. The result is a faithful tactical layout, not a pixel match.
 */
import { assetCatalog, type AssetSpec } from "../catalog.ts";
import type { MapProp } from "../environment.ts";
import { CELL, type Cell, type MapPlan } from "../map.ts";
import { blackRain, type Scenario } from "../scenario.ts";
import { paperTrail } from "../office/scenario.ts";
import { officeFloorZones } from "../office/flooring.ts";
import { anchorOf, canPlace, newLevel, turnOffset, type Level, type Placement, type Turn } from "./level.ts";

export interface FloorZone {
  /** Floor catalog uid painted over the zone. */
  uid: string;
  /** World metres, as the plans measure. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlanExtras {
  spawns?: readonly Cell[];
  relay?: Cell;
  time?: Level["lighting"]["time"];
  floorZones?: readonly FloorZone[];
}

const uidOf = (kind: string, cover: boolean) => {
  const variants = assetCatalog.filter((a) => a.kind === kind);
  if (!variants.length) return undefined;
  return (
    variants.find((a) => (cover ? a.footprint === "cover" : a.footprint !== "cover")) ?? variants[0]
  );
};

const yawTurn = (yaw: number): Turn =>
  (((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4) as Turn;

/** The nearest edge seats for a prop, closest first (walls sit at half-cells). */
function edgeSeats(prop: MapProp, shift: (c: Cell) => Cell): { at: Cell; turn: Turn; off: number }[] {
  const fx = prop.x / CELL,
    fz = prop.z / CELL;
  const horizontal = {
    at: shift([Math.round(fx), Math.round(fz + 0.5)]),
    turn: 0 as Turn,
    off: Math.abs(fz + 0.5 - Math.round(fz + 0.5)),
  };
  const vertical = {
    at: shift([Math.round(fx + 0.5), Math.round(fz)]),
    turn: 3 as Turn,
    off: Math.abs(fx + 0.5 - Math.round(fx + 0.5)),
  };
  const alongZ = Math.abs(Math.sin(prop.yaw)) > 0.5;
  return alongZ ? [vertical, horizontal] : [horizontal, vertical];
}

/** `plan` re-seated as an editable level; `dropped` counts what found no seat. */
export function levelFromPlan(plan: MapPlan, extras: PlanExtras = {}): { level: Level; dropped: number } {
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  const level = newLevel(maxX - minX + 1, maxZ - minZ + 1);
  const shift = ([x, z]: Cell): Cell => [x - minX, z - minZ];
  let dropped = 0;
  const put = (p: Placement) => {
    if (canPlace(level, p)) level.placements.push(p);
    else dropped++;
  };

  if (extras.floorZones)
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++) {
        const wx = x * CELL,
          wz = z * CELL;
        const zone = extras.floorZones.find(
          (f) => wx >= f.minX && wx <= f.maxX && wz >= f.minZ && wz <= f.maxZ,
        );
        if (zone) level.floors.push({ floor: zone.uid, at: shift([x, z]) });
      }

  for (const cell of plan.obstacles ?? []) level.unwalkable.push(shift(cell));

  // Solid buildings with no destructible owner become typed building blocks —
  // stand-ins to redress with real assets in the editor.
  const fill = assetCatalog.find((a) => a.kind === "block-fill")!;
  for (const b of plan.buildings.filter((b) => !b.prop))
    for (let x = b.x - Math.floor(b.w / 2); x < b.x - Math.floor(b.w / 2) + b.w; x++)
      for (let z = b.z - Math.floor(b.d / 2); z < b.z - Math.floor(b.d / 2) + b.d; z++)
        put({ asset: fill.uid, at: shift([x, z]), turn: 0 });

  // Props re-seat in dependency order: cells, then edges, then what mounts on them.
  const props = (plan.props ?? []).filter((p) => !p.storefront && !p.pane);
  const seat = (prop: MapProp, spec: AssetSpec) => {
    // The plan's office color scheme survives the conversion.
    const finish = prop.office?.finish ? { finish: prop.office.finish } : {};
    if (spec.place === "edge") {
      for (const candidate of edgeSeats(prop, shift)) {
        const p: Placement = { asset: spec.uid, at: candidate.at, turn: candidate.turn, ...finish };
        if (canPlace(level, p)) {
          level.placements.push(p);
          return;
        }
      }
      dropped++;
      return;
    }
    const turn = yawTurn(prop.yaw);
    const [ax, az] = turnOffset(anchorOf(spec), turn);
    put({
      asset: spec.uid,
      at: shift([Math.round(prop.x / CELL - ax), Math.round(prop.z / CELL - az)]),
      turn,
      ...finish,
    });
  };
  const staged = props
    .map((prop) => ({ prop, spec: uidOf(prop.kind, !!prop.cover) }))
    .filter((entry): entry is { prop: MapProp; spec: AssetSpec } => {
      if (!entry.spec) dropped++;
      return !!entry.spec;
    });
  const order = (spec: AssetSpec) => (spec.mount ? 2 : spec.place === "edge" ? 1 : 0);
  for (const { prop, spec } of staged.sort((a, b) => order(a.spec) - order(b.spec))) seat(prop, spec);

  // Tactical cover cells nothing above claimed get the typed cover block.
  const coverBlock = assetCatalog.find((a) => a.kind === "block-cover")!;
  const owned = new Set(
    props.flatMap((p) => (p.covers ?? (p.cover ? [p.cover] : [])).map((c) => c.join())),
  );
  for (const cell of plan.covers)
    if (!owned.has(cell.join())) put({ asset: coverBlock.uid, at: shift(cell), turn: 0 });

  level.spawns = (extras.spawns ?? [])
    .map(shift)
    .filter((c) => c[0] >= 0 && c[0] < level.width && c[1] >= 0 && c[1] < level.depth);
  if (extras.relay) level.objective = shift(extras.relay);
  level.lighting = { time: extras.time ?? "night" };
  return { level, dropped };
}

/** A scenario as the editor loads it: its map, its squad's deployment, its relay. */
export function levelFromScenario(scenario: Scenario, extras: PlanExtras = {}) {
  const result = levelFromPlan(scenario.map, {
    spawns: scenario.units.filter((u) => !u.enemy).map((u) => u.pos),
    relay: scenario.relay,
    ...extras,
  });
  result.level.name = scenario.id;
  return result;
}

const officeFloors: Record<(typeof officeFloorZones)[number]["finish"], string> = {
  vinyl: "f04",
  oak: "f08",
  "carpet-sage": "f05",
  "carpet-slate": "f06",
  "carpet-charcoal": "f07",
};

/** The demos, reconstructible in the editor and overridable locally. */
export const demoLevels: readonly { id: string; name: string; build: () => { level: Level; dropped: number } }[] = [
  { id: "black-rain", name: "Black Rain · Kōra", build: () => levelFromScenario(blackRain) },
  {
    id: "paper-trail",
    name: "Paper Trail · Office",
    build: () =>
      levelFromScenario(paperTrail, {
        time: "interior",
        floorZones: officeFloorZones.map((zone) => ({ ...zone, uid: officeFloors[zone.finish] })),
      }),
  },
];
