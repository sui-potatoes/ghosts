// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A level as the editor edits and exports it. The editable `Level` is plain
 * data: a grid, catalog placements by uid (on cells, cell edges, surfaces or
 * walls), painted flooring, unwalkable tiles, deployment markers and the
 * light. An export is twofold — `move` is the tile grid shaped after the Move
 * `Map` object (Empty / Cover-with-sides / Unwalkable / Wall; provisional
 * until the ghosts package lands, when BCS encoding happens at the chain
 * boundary), and `render` is the frontend's dressing: asset uid ↔ grid
 * points, floors, markers and lighting. The export file reimports losslessly.
 */
import { assetByUid, floorByUid, type AssetSpec } from "../catalog.ts";
import { CELL, type Cell } from "../map.ts";
import { officeFinishes, type OfficeFinish } from "../office/catalog.ts";
import type { TimeOfDay } from "../scene-weather.ts";

/** Quarter turns clockwise; for an edge asset, the side of its cell (0 N, 1 E, 2 S, 3 W). */
export type Turn = 0 | 1 | 2 | 3;

export interface Placement {
  /** Catalog uid of the asset. */
  asset: string;
  /** Origin cell, 0-based within the level grid. */
  at: Cell;
  turn: Turn;
  /** Office color scheme (sage, slate, sand); absent is the default. */
  finish?: OfficeFinish;
}

/** One painted floor tile; at most one per cell. */
export interface FloorTile {
  /** Floor catalog uid. */
  floor: string;
  at: Cell;
}

/** The office demo's indoor rig: no sun, neutral fill, no outdoor fog. */
export const interiorPreset = {
  sky: 0x10191f,
  fog: 0x252b3b,
  density: 0,
  sun: 0xffffff,
  strength: 0,
  ambient: 0.95,
  exposure: 1.25,
} as const;

/** A placed point light: a lamp, a sign glow, a fire barrel — render dressing. */
export interface LightSource {
  at: Cell;
  /** 0xRRGGBB. */
  color: number;
  /** three.js point-light intensity (physical falloff). */
  intensity: number;
  /** Metres above the cell floor. */
  height: number;
}

/** The scene's light: a time-of-day preset (or the indoor rig) plus the editor's deviations. */
export interface LevelLighting {
  time: TimeOfDay | "interior";
  /** 0xRRGGBB overrides of the preset's colors. */
  sky?: number;
  fog?: number;
  sun?: number;
  /** Absolute overrides of the preset's dials. */
  density?: number;
  strength?: number;
  ambient?: number;
  exposure?: number;
}

export interface Level {
  version: 1;
  name: string;
  /** Grid size in cells; cells are 0-based `[x, z]`. */
  width: number;
  depth: number;
  placements: Placement[];
  floors: FloorTile[];
  /** Pit / void tiles: walkable by nothing, targetable, no line-of-sight block. */
  unwalkable: Cell[];
  /** Deployment cells and the objective cell, when authored. */
  spawns: Cell[];
  objective?: Cell;
  lighting: LevelLighting;
  lights: LightSource[];
}

export function newLevel(width = 18, depth = 14): Level {
  return {
    version: 1,
    name: "untitled",
    width,
    depth,
    placements: [],
    floors: [],
    unwalkable: [],
    spawns: [],
    lighting: { time: "night" },
    lights: [],
  };
}

/** `offset` turned clockwise a quarter at a time (matches a yaw of `turn·π/2`). */
export function turnOffset([x, z]: Cell, turn: Turn): Cell {
  const turned: Cell = turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : turn === 3 ? [-z, x] : [x, z];
  // Adding zero keeps the negative-zero artifact out of keys and saves.
  return [turned[0] + 0, turned[1] + 0];
}

/** Where the authored mesh origin sits within the footprint, in cell offsets. */
export function anchorOf(spec: AssetSpec): Cell {
  if (spec.anchor) return spec.anchor;
  const n = spec.cells.length || 1;
  return [
    spec.cells.reduce((s, c) => s + c[0], 0) / n,
    spec.cells.reduce((s, c) => s + c[1], 0) / n,
  ];
}

/** The cells a cell-seated placement occupies on the grid. */
export function placementCells(spec: AssetSpec, p: Placement): Cell[] {
  return spec.cells.map((c) => {
    const [dx, dz] = turnOffset(c, p.turn);
    return [p.at[0] + dx, p.at[1] + dz];
  });
}

export function inLevel(level: Level, [x, z]: Cell): boolean {
  return x >= 0 && x < level.width && z >= 0 && z < level.depth;
}

// ---------------------------------------------------------------------------
// Edges. An edge is named from either side; the canonical form is the north
// ("n") or west ("w") side of one cell, so both namings collide correctly.

/** The canonical name of the edge a placement's `at`/`turn` points at. */
export function canonicalEdge(at: Cell, turn: Turn): { cell: Cell; side: "n" | "w" } {
  if (turn === 0) return { cell: at, side: "n" };
  if (turn === 2) return { cell: [at[0], at[1] + 1], side: "n" };
  if (turn === 1) return { cell: [at[0] + 1, at[1]], side: "w" };
  return { cell: at, side: "w" };
}

export function edgeKey(at: Cell, turn: Turn): string {
  const e = canonicalEdge(at, turn);
  return `${e.cell.join()}:${e.side}`;
}

/** The two cells an edge separates (one may be outside the grid). */
export function edgeCells(at: Cell, turn: Turn): [Cell, Cell] {
  const e = canonicalEdge(at, turn);
  const [x, z] = e.cell;
  return e.side === "n" ? [[x, z], [x, z - 1]] : [[x, z], [x - 1, z]];
}

// ---------------------------------------------------------------------------
// Occupancy.

const key = (c: Cell) => c.join();

/** The walls and doors standing on the same edge as `p` would. */
function edgeMates(level: Level, at: Cell, turn: Turn): Placement[] {
  const name = edgeKey(at, turn);
  return level.placements.filter((o) => {
    const spec = assetByUid(o.asset);
    return spec?.place === "edge" && edgeKey(o.at, o.turn) === name;
  });
}

/** Top surface height at `cell` from whatever stands there, or null for bare floor. */
export function hostTop(level: Level, cell: Cell): number | null {
  let top: number | null = null;
  for (const o of level.placements) {
    const spec = assetByUid(o.asset);
    if (!spec || spec.top === undefined || spec.place === "edge") continue;
    if (placementCells(spec, o).some((c) => key(c) === key(cell))) top = Math.max(top ?? 0, spec.top);
  }
  return top;
}

/** Metres the painted floor raises `cell` above grade. */
export function floorRaise(level: Level, cell: Cell): number {
  const tile = level.floors.find((f) => key(f.at) === key(cell));
  return (tile && floorByUid(tile.floor)?.raise) || 0;
}

/** Height above the cell floor the placement rests at (surface and wall mounts). */
export function restHeight(level: Level, p: Placement): number {
  const spec = assetByUid(p.asset);
  if (!spec) return 0;
  if (spec.mount === "wall") return spec.lift ?? 0;
  if (spec.mount === "surface") return hostTop(level, p.at) ?? 0;
  return 0;
}

/**
 * Whether `p` fits: inside the grid; an edge asset on a free edge (a wall
 * mount instead requires a wall there); a surface item on something with a
 * top; a footprint asset on cells no other footprint asset or unwalkable
 * tile claims. Set dressing stacks freely; exact duplicates never do.
 */
export function canPlace(level: Level, p: Placement): boolean {
  const spec = assetByUid(p.asset);
  if (!spec) return false;
  if (spec.place === "edge") {
    const [a, b] = edgeCells(p.at, p.turn);
    if (!inLevel(level, a) && !inLevel(level, b)) return false;
    const mates = edgeMates(level, p.at, p.turn);
    if (spec.mount === "wall")
      return mates.some((o) => assetByUid(o.asset)!.mount !== "wall") &&
        !mates.some((o) => o.asset === p.asset);
    return !mates.some((o) => assetByUid(o.asset)!.mount !== "wall");
  }
  const cells = placementCells(spec, p);
  if (!cells.every((cell) => inLevel(level, cell))) return false;
  if (level.placements.some((o) => o.asset === p.asset && key(o.at) === key(p.at))) return false;
  if (spec.mount === "surface") return hostTop(level, p.at) !== null;
  if (spec.footprint === "none") return true;
  if (cells.some((cell) => level.unwalkable.some((u) => key(u) === key(cell)))) return false;
  const taken = new Set(
    level.placements.flatMap((o) => {
      const other = assetByUid(o.asset)!;
      if (other.place === "edge" || other.footprint === "none") return [];
      return placementCells(other, o).map(key);
    }),
  );
  return !cells.some((cell) => taken.has(key(cell)));
}

/** A placement still fits the grid after a resize (occupancy aside). */
export function fitsBounds(level: Level, p: Placement): boolean {
  const spec = assetByUid(p.asset);
  if (!spec) return false;
  if (spec.place === "edge") {
    const [a, b] = edgeCells(p.at, p.turn);
    return inLevel(level, a) || inLevel(level, b);
  }
  return placementCells(spec, p).every((cell) => inLevel(level, cell));
}

/** Placements touching `cell` — edges count from both sides — in placement order. */
export function placementsAt(level: Level, cell: Cell): Placement[] {
  return level.placements.filter((p) => {
    const spec = assetByUid(p.asset);
    if (!spec) return false;
    if (spec.place === "edge") return edgeCells(p.at, p.turn).some((c) => key(c) === key(cell));
    return placementCells(spec, p).some((c) => key(c) === key(cell));
  });
}

/**
 * `p` redressed as another asset with the same seat and footprint
 * (`replacementsFor`), or null when the stand-in does not fit there.
 */
export function swapAsset(level: Level, p: Placement, uid: string): Level | null {
  const index = level.placements.indexOf(p);
  if (index < 0) return null;
  const next: Placement = { ...p, asset: uid };
  const without = { ...level, placements: level.placements.filter((o) => o !== p) };
  if (!canPlace(without, next)) return null;
  const placements = [...level.placements];
  placements[index] = next;
  return { ...level, placements };
}

// ---------------------------------------------------------------------------
// Export: the Move tile grid and the render dressing.

/** Cover side levels in the Move enum: 0 none, 1 low, 2 high. */
const LOW = 1, HIGH = 2;

/** One tile of the Move `Map` grid, JSON-shaped after the on-chain enum. */
export type MoveTile =
  | { t: "empty" }
  | { t: "cover"; sides: [left: number, top: number, right: number, bottom: number] }
  | { t: "unwalkable" }
  | { t: "wall" };

export interface MoveMapExport {
  /** `[rows, cols]` — a row is one line of constant z. */
  size: [number, number];
  turn: 0;
  /** `tiles[z][x]`; units deploy through transactions, so no tile holds one. */
  tiles: MoveTile[][];
}

export interface LevelExport {
  "ghosts-level": 1;
  name: string;
  move: MoveMapExport;
  render: {
    /** Metres per cell. */
    cell: number;
    size: [width: number, depth: number];
    /** Asset uid ↔ grid point, facing, metres above the cell floor, office finish. */
    placements: [uid: string, x: number, z: number, turn: Turn, rest?: number, finish?: string][];
    floors: [uid: string, x: number, z: number][];
    unwalkable: Cell[];
    spawns: Cell[];
    objective?: Cell;
    lighting: LevelLighting;
    lights: [x: number, z: number, color: number, intensity: number, height: number][];
  };
}

/**
 * The tile grid the rules see. Cell footprints: `cover` is a Cover tile with
 * low cover on every side (the free-standing barrier), `obstacle` is
 * Unwalkable, `solid` is Wall. Edge assets write cover levels onto the sides
 * of both adjacent tiles — high for a solid wall, low for glazing and low
 * partitions, nothing for a door. Painted unwalkable tiles stay Unwalkable;
 * where claims overlap a cell the strongest wins. Destructibility stays with
 * the render props for now.
 */
export function toMoveMap(level: Level): MoveMapExport {
  const walls = new Set<string>();
  const pits = new Set<string>(level.unwalkable.filter((c) => inLevel(level, c)).map(key));
  const sides = new Map<string, [number, number, number, number]>();
  const side = (cell: Cell, index: 0 | 1 | 2 | 3, value: number) => {
    if (!inLevel(level, cell)) return;
    const entry = sides.get(key(cell)) ?? [0, 0, 0, 0];
    entry[index] = Math.max(entry[index], value);
    sides.set(key(cell), entry);
  };
  for (const p of level.placements) {
    const spec = assetByUid(p.asset);
    if (!spec) continue;
    if (spec.place === "edge") {
      const value = spec.footprint === "solid" ? HIGH : spec.footprint === "none" ? 0 : LOW;
      if (!value) continue;
      const e = canonicalEdge(p.at, p.turn);
      const [near, far] = edgeCells(p.at, p.turn);
      // Sides order is [left, top, right, bottom]: west, north, east, south.
      if (e.side === "n") {
        side(near, 1, value);
        side(far, 3, value);
      } else {
        side(near, 0, value);
        side(far, 2, value);
      }
      continue;
    }
    if (spec.footprint === "none") continue;
    for (const cell of placementCells(spec, p)) {
      if (!inLevel(level, cell)) continue;
      if (spec.footprint === "solid") walls.add(key(cell));
      else if (spec.footprint === "obstacle") pits.add(key(cell));
      else for (const index of [0, 1, 2, 3] as const) side(cell, index, LOW);
    }
  }
  const tiles: MoveTile[][] = [];
  for (let z = 0; z < level.depth; z++) {
    const row: MoveTile[] = [];
    for (let x = 0; x < level.width; x++) {
      const name = key([x, z]);
      const cover = sides.get(name);
      if (walls.has(name)) row.push({ t: "wall" });
      else if (pits.has(name)) row.push({ t: "unwalkable" });
      else if (cover) row.push({ t: "cover", sides: cover });
      else row.push({ t: "empty" });
    }
    tiles.push(row);
  }
  return { size: [level.depth, level.width], turn: 0, tiles };
}

export function exportLevel(level: Level): LevelExport {
  return {
    "ghosts-level": 1,
    name: level.name,
    move: toMoveMap(level),
    render: {
      cell: CELL,
      size: [level.width, level.depth],
      placements: level.placements.map((p) => {
        const rest = Math.round(restHeight(level, p) * 1000) / 1000;
        if (p.finish) return [p.asset, p.at[0], p.at[1], p.turn, rest, p.finish];
        return rest ? [p.asset, p.at[0], p.at[1], p.turn, rest] : [p.asset, p.at[0], p.at[1], p.turn];
      }),
      floors: level.floors.map((f) => [f.floor, f.at[0], f.at[1]]),
      unwalkable: level.unwalkable,
      spawns: level.spawns,
      ...(level.objective ? { objective: level.objective } : {}),
      lighting: level.lighting,
      lights: level.lights.map((l) => [l.at[0], l.at[1], l.color, l.intensity, l.height]),
    },
  };
}

/**
 * A level read back from an export. Placements whose uid this build does not
 * know, or that no longer fit, are dropped and counted, so a save outlives
 * removed assets. Mounted items import after everything they rest on.
 */
export function importLevel(data: unknown): { level: Level; dropped: number } {
  const file = data as Partial<LevelExport>;
  if (file?.["ghosts-level"] !== 1 || !file.render) throw new Error("Not a ghosts level file");
  const r = file.render;
  const level = newLevel(r.size?.[0] ?? 18, r.size?.[1] ?? 14);
  level.name = typeof file.name === "string" ? file.name : "untitled";
  level.spawns = (r.spawns ?? []).filter((c) => inLevel(level, c));
  level.unwalkable = (r.unwalkable ?? []).filter((c) => inLevel(level, c));
  if (r.objective && inLevel(level, r.objective)) level.objective = r.objective;
  if (r.lighting?.time) level.lighting = r.lighting;
  level.lights = (r.lights ?? [])
    .filter(([x, z]) => inLevel(level, [x, z]))
    .map(([x, z, color, intensity, height]) => ({
      at: [x, z] as Cell,
      color: color ?? 0xffe4ad,
      intensity: intensity ?? 6,
      height: height ?? 2.6,
    }));
  let dropped = 0;
  const seen = new Set<string>();
  for (const [uid, x, z] of r.floors ?? []) {
    const at: Cell = [x, z];
    if (floorByUid(uid) && inLevel(level, at) && !seen.has(key(at))) {
      seen.add(key(at));
      level.floors.push({ floor: uid, at });
    } else dropped++;
  }
  const rows = (r.placements ?? []).map(([uid, x, z, turn, , finish]): Placement => ({
    asset: uid,
    at: [x, z],
    turn: ((turn ?? 0) % 4) as Turn,
    // A finish this build does not know falls back to the default scheme.
    ...(officeFinishes.includes(finish as OfficeFinish) ? { finish: finish as OfficeFinish } : {}),
  }));
  // Two passes: whatever carries a desk or a wall lands before what mounts on it.
  for (const mounted of [false, true])
    for (const p of rows) {
      const spec = assetByUid(p.asset);
      if (!spec) {
        if (!mounted) dropped++;
        continue;
      }
      if (!!spec.mount !== mounted) continue;
      if (canPlace(level, p)) level.placements.push(p);
      else dropped++;
    }
  return { level, dropped };
}
