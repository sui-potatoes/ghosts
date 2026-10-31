// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The asset catalog: the one roster of everything a level can place. Each
 * entry carries the asset's stable `uid` (what saves and exports reference —
 * never the kind name), its display name and palette group, where it sits
 * (cells, a cell edge, a surface, a wall), the tactical footprint, and its
 * durability. `environment.ts` derives the combat tables from it and the
 * level editor lists it, so adding an asset here is the whole registration.
 *
 * Two entries may share a `kind` (the short and tall fence variants share a
 * mesh family); the first one is the kind's primary. Uids are assigned once
 * and never renumbered or reused; `catalog.test.ts` pins them.
 */
import type { Cell } from "./map.ts";
import { officeCatalog, type OfficeKind } from "./office/catalog.ts";
import type { BlockKind, PropKind, StreetKind } from "./environment.ts";

/**
 * What an asset does to each cell it occupies: `cover` is a waist-high
 * barrier (units shelter against it), `solid` blocks movement and line of
 * sight at full height, `obstacle` blocks movement only, `none` is set
 * dressing on a walkable cell.
 */
export type Footprint = "cover" | "solid" | "obstacle" | "none";

export interface AssetSpec {
  /** Stable opaque id; saves and exports name assets by it, never by `kind`. */
  uid: string;
  kind: PropKind;
  name: string;
  /** Palette group in the editor. */
  category: string;
  footprint: Footprint;
  /** Occupied cells before rotation, origin first. Edge assets occupy none. */
  cells: readonly Cell[];
  /**
   * Where the authored mesh origin sits within the footprint, in cell
   * offsets. Defaults to the footprint centroid (most models are centered);
   * an asymmetric model names its authored cell, like the corner desk whose
   * origin is the main desk with the return running into the second cell.
   */
  anchor?: Cell;
  /**
   * Metres the mesh sits off its cell centre, pre-turn. Desk clutter carries
   * the demo's workstation arrangement — monitor at the back, keyboard in
   * front, tower to the side — instead of piling at the centre.
   */
  offset?: [number, number];
  /**
   * Walls, glazing, fences, low-cover barriers and doors sit on cell EDGES,
   * not on cells: the placement's turn names the side of its cell (0 north,
   * 1 east, 2 south, 3 west). A `solid` edge is high cover (blocks sight and
   * movement across it), `cover` and `obstacle` edges are low, and a `none`
   * edge (a door) is a passage.
   */
  place?: "edge";
  /** Metres the authored mesh runs along the edge; scaled to one cell. */
  span?: number;
  /**
   * `surface` items rest on whatever occupies their cell (a desk, a crate —
   * anything with `top`) and cannot sit on a bare floor; `wall` items mount
   * on an edge that already holds a wall or door.
   */
  mount?: "surface" | "wall";
  /** Height of this asset's usable top surface, for `surface` items on it. */
  top?: number;
  /** Fixed height above the floor for a wall-mounted item. */
  lift?: number;
  /** Hit points; 0 marks terrain that cannot be destroyed. */
  hp: number;
  /** Full-height masonry or steel: rifle fire cannot damage it. */
  gunproof?: boolean;
  /** Blast damage multiplier; light joinery fails readily under pressure. */
  blast?: number;
  /** A typed stand-in drawn as a plain mesh, not an authored model. */
  typed?: boolean;
}

type Entry = Omit<AssetSpec, "kind" | "name" | "category"> & { name?: string; category?: string };

const one: readonly Cell[] = [[0, 0]];
const none: readonly Cell[] = [];

/** Typed stand-ins: tactical semantics without picking a model. Cover walls
 * seat on edges like the real ones; area blockers and building fill take the
 * cell. */
const blocks: Record<BlockKind, Entry> = {
  "block-cover": { uid: "b01", footprint: "cover", cells: none, place: "edge", span: 1.16, hp: 140, typed: true },
  "block-high": { uid: "b02", footprint: "solid", cells: none, place: "edge", span: 1.16, hp: 160, gunproof: true, typed: true },
  "block-weak": { uid: "b03", footprint: "solid", cells: none, place: "edge", span: 1.16, hp: 60, typed: true },
  "block-obstacle": { uid: "b04", footprint: "obstacle", cells: one, hp: 80, typed: true },
  "block-solid": { uid: "b05", footprint: "obstacle", cells: one, hp: 0, typed: true },
  "block-fill": { uid: "b06", footprint: "solid", cells: one, hp: 0, typed: true },
};
const blockNames: Record<BlockKind, string> = {
  "block-cover": "Cover",
  "block-high": "High cover",
  "block-weak": "Weak high cover",
  "block-obstacle": "Destructible obstacle",
  "block-solid": "Solid obstacle",
  "block-fill": "Building block",
};

const street: readonly (Entry & { kind: StreetKind; name: string; category: string })[] = [
  { kind: "barrier", uid: "s01", name: "Concrete barrier", category: "Street", footprint: "cover", cells: none, place: "edge", span: 1.3, hp: 140 },
  { kind: "crate", uid: "s02", name: "Freight crate", category: "Street", footprint: "cover", cells: one, hp: 100, top: 0.93 },
  { kind: "cargo", uid: "s03", name: "Cargo box", category: "Street", footprint: "cover", cells: one, hp: 75, top: 0.9 },
  { kind: "barrels", uid: "s04", name: "Oil drums", category: "Street", footprint: "cover", cells: one, hp: 65 },
  { kind: "smoking-barrel", uid: "s05", name: "Burn barrel", category: "Street", footprint: "cover", cells: one, hp: 55 },
  { kind: "fence-sheet", uid: "s06", name: "Sheet fence · low", category: "Street", footprint: "cover", cells: none, place: "edge", span: 1.2, hp: 65 },
  { kind: "fence-chain", uid: "s07", name: "Chain-link · low", category: "Street", footprint: "cover", cells: none, place: "edge", span: 1.2, hp: 40 },
  { kind: "fence-picket", uid: "s08", name: "Picket fence · low", category: "Street", footprint: "cover", cells: none, place: "edge", span: 1.2, hp: 35 },
  { kind: "cone", uid: "s09", name: "Traffic cone", category: "Street", footprint: "none", cells: one, hp: 10 },
  { kind: "sign", uid: "s10", name: "Street sign", category: "Street", footprint: "none", cells: one, hp: 25 },
  { kind: "wall", uid: "s11", name: "Masonry wall", category: "Structure", footprint: "solid", cells: none, place: "edge", span: 2.3, hp: 140, gunproof: true },
  { kind: "window-wall", uid: "s12", name: "Window wall", category: "Structure", footprint: "solid", cells: none, place: "edge", span: 2.3, hp: 120, gunproof: true },
  { kind: "glass", uid: "s13", name: "Glass pane", category: "Structure", footprint: "obstacle", cells: none, place: "edge", span: 2.3, hp: 12 },
  { kind: "fence-sheet", uid: "s14", name: "Sheet fence · tall", category: "Structure", footprint: "obstacle", cells: none, place: "edge", span: 2.3, hp: 65 },
  { kind: "fence-chain", uid: "s15", name: "Chain-link · tall", category: "Structure", footprint: "obstacle", cells: none, place: "edge", span: 2.3, hp: 40 },
  { kind: "fence-picket", uid: "s16", name: "Picket fence · tall", category: "Structure", footprint: "obstacle", cells: none, place: "edge", span: 2.3, hp: 35 },
  { kind: "vending", uid: "s17", name: "Vending machine", category: "Street", footprint: "solid", cells: one, hp: 110 },
  { kind: "bicycle", uid: "s18", name: "Bicycle", category: "Street", footprint: "none", cells: one, hp: 25 },
  { kind: "pallet", uid: "s19", name: "Pallet stack", category: "Street", footprint: "cover", cells: one, hp: 70, top: 0.6 },
  { kind: "utility-pole", uid: "s20", name: "Utility pole", category: "Street", footprint: "none", cells: one, hp: 60 },
];

const tall: readonly Cell[] = [[0, 0], [0, 1]];
/** Placement and durability per office kind; names and groups come from the office roster. */
const office: Record<OfficeKind, Entry> = {
  desk: { uid: "o01", footprint: "cover", cells: one, hp: 100, blast: 2, top: 0.766 },
  "desk-tucked": { uid: "o02", footprint: "cover", cells: one, hp: 100, blast: 2, top: 0.766 },
  // The authored L (1.25×1.37m) is one cell's worth of desk; centred it fits
  // a single tile, return and all, instead of straddling a 2-cell claim.
  "corner-desk": { uid: "o03", footprint: "cover", cells: one, offset: [0, -0.3], hp: 100, blast: 2, top: 0.766 },
  "meeting-table": { uid: "o04", footprint: "cover", cells: tall, hp: 120, blast: 2, top: 0.8 },
  "task-chair": { uid: "o05", footprint: "obstacle", cells: one, hp: 45 },
  "visitor-chair": { uid: "o06", footprint: "obstacle", cells: one, hp: 45 },
  monitor: { uid: "o07", footprint: "none", cells: one, hp: 20, mount: "surface", offset: [0, -0.14] },
  computer: { uid: "o08", footprint: "none", cells: one, hp: 45, mount: "surface", offset: [0.39, -0.03] },
  laptop: { uid: "o09", footprint: "none", cells: one, hp: 20, mount: "surface", offset: [-0.2, 0] },
  keyboard: { uid: "o10", footprint: "none", cells: one, hp: 12, mount: "surface", offset: [-0.1, 0.19] },
  printer: { uid: "o11", footprint: "none", cells: one, hp: 55, mount: "surface" },
  papers: { uid: "o12", footprint: "none", cells: one, hp: 8, mount: "surface", offset: [0.12, 0.1] },
  folders: { uid: "o13", footprint: "none", cells: one, hp: 12, mount: "surface", offset: [-0.22, 0.14] },
  binders: { uid: "o14", footprint: "none", cells: one, hp: 20, mount: "surface", offset: [0.28, -0.14] },
  "desk-tray": { uid: "o15", footprint: "none", cells: one, hp: 20, mount: "surface", offset: [0.35, 0] },
  cubicle: { uid: "o16", footprint: "cover", cells: none, place: "edge", span: 1.3, hp: 55 },
  "glass-door": { uid: "o17", footprint: "none", cells: none, place: "edge", span: 1.12, hp: 12 },
  "steel-door": { uid: "o18", footprint: "none", cells: none, place: "edge", span: 1.35, hp: 140, gunproof: true, blast: 3 },
  keypad: { uid: "o19", footprint: "none", cells: none, place: "edge", mount: "wall", lift: 1.05, hp: 20 },
  // Modular office panels fail at their fixings under a nearby grenade.
  // Structural street masonry retains its tougher, unmultiplied blast HP.
  "steel-wall": { uid: "o20", footprint: "solid", cells: none, place: "edge", span: 1.35, hp: 180, gunproof: true, blast: 3 },
  "window-wall": { uid: "o21", footprint: "solid", cells: none, place: "edge", span: 1.35, hp: 160, gunproof: true, blast: 3 },
  "glass-wall": { uid: "o22", footprint: "obstacle", cells: none, place: "edge", span: 1.25, hp: 12 },
  "filing-cabinet": { uid: "o23", footprint: "cover", cells: one, hp: 100, top: 1.02 },
  shelf: { uid: "o24", footprint: "solid", cells: one, hp: 100 },
  locker: { uid: "o25", footprint: "solid", cells: one, hp: 140 },
  wastebasket: { uid: "o26", footprint: "obstacle", cells: one, hp: 20 },
  "recycling-bin": { uid: "o27", footprint: "obstacle", cells: one, hp: 35 },
  "pedal-bin": { uid: "o28", footprint: "obstacle", cells: one, hp: 55 },
  "wheelie-bin": { uid: "o29", footprint: "obstacle", cells: one, hp: 75 },
};

/** Every placeable asset, in palette order. */
export const assetCatalog: readonly AssetSpec[] = [
  ...(Object.keys(blocks) as BlockKind[]).map((kind): AssetSpec => ({
    kind, name: blockNames[kind], category: "Blocks", ...blocks[kind],
  })),
  ...street.map((entry): AssetSpec => ({ ...entry })),
  ...officeCatalog.map(([kind, name, group]): AssetSpec => ({
    kind: `office-${kind}`, name, category: `Office · ${group}`, ...office[kind],
  })),
];

const byKind = new Map<PropKind, AssetSpec>();
for (const a of assetCatalog) if (!byKind.has(a.kind)) byKind.set(a.kind, a);
const byUid = new Map(assetCatalog.map((a) => [a.uid, a]));

/** The primary spec behind a prop kind. Every kind has one; the catalog test pins it. */
export function assetSpec(kind: PropKind): AssetSpec {
  return byKind.get(kind)!;
}

/** The spec a save references, or undefined for an id this build does not know. */
export function assetByUid(uid: string): AssetSpec | undefined {
  return byUid.get(uid);
}

/** Assets that can stand in for `uid` without changing the tactics: same seat, same footprint. */
export function replacementsFor(uid: string): AssetSpec[] {
  const spec = byUid.get(uid);
  if (!spec) return [];
  return assetCatalog.filter(
    (a) =>
      a.uid !== uid &&
      (a.place === "edge") === (spec.place === "edge") &&
      a.mount === spec.mount &&
      a.footprint === spec.footprint,
  );
}

// ---------------------------------------------------------------------------
// Flooring: painted per cell, pure dressing for the renderer (a raised slab
// lifts what stands on it). Not props — nothing here enters the combat tables.

export interface FloorSpec {
  /** Stable opaque id, same contract as asset uids. */
  uid: string;
  name: string;
  /** The `officeFloorTexture` surface this tile reuses, tinted by `tone`. */
  texture?: "carpet" | "oak" | "vinyl" | "rubber";
  /** The street demo's KTX2 PBR set this tile reuses, tinted by `tone`. */
  street?: "asphalt" | "concrete";
  /** The street demo's jointed pavement slabs. */
  slabs?: boolean;
  /** Zebra paint strips over the tile, stepping along this world axis. */
  stripes?: "x" | "z";
  /** 0xRRGGBB material color (a tint over the texture when one is set). */
  tone: number;
  rough?: number;
  metal?: number;
  /** Metres the slab rises above grade: a curb-height platform. */
  raise?: number;
}

export const floorCatalog: readonly FloorSpec[] = [
  { uid: "f01", name: "Raised pavement", slabs: true, tone: 0x565b63, raise: 0.16 },
  { uid: "f02", name: "Concrete slab", street: "concrete", tone: 0x9c9fa3, rough: 0.9 },
  { uid: "f03", name: "Asphalt", street: "asphalt", tone: 0x737c88, rough: 0.72 },
  { uid: "f12", name: "Crosswalk · E–W", street: "asphalt", stripes: "x", tone: 0x737c88, rough: 0.72 },
  { uid: "f13", name: "Crosswalk · N–S", street: "asphalt", stripes: "z", tone: 0x737c88, rough: 0.72 },
  { uid: "f04", name: "Vinyl sheet", texture: "vinyl", tone: 0xffffff },
  { uid: "f05", name: "Carpet · sage", texture: "carpet", tone: 0xd3d6c7 },
  { uid: "f06", name: "Carpet · slate", texture: "carpet", tone: 0xbdcbd5 },
  { uid: "f07", name: "Carpet · charcoal", texture: "carpet", tone: 0x85959b },
  { uid: "f08", name: "Wood · oak", texture: "oak", tone: 0xffffff },
  { uid: "f09", name: "Wood · smoked", texture: "oak", tone: 0x8a7a68 },
  { uid: "f10", name: "Rubber mat", texture: "rubber", tone: 0xffffff },
  { uid: "f11", name: "Steel plate", tone: 0x454c52, rough: 0.4, metal: 0.7 },
];

const floors = new Map(floorCatalog.map((f) => [f.uid, f]));

/** The floor a save references, or undefined for an id this build does not know. */
export function floorByUid(uid: string): FloorSpec | undefined {
  return floors.get(uid);
}
