// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the layout view says about tiles, pure (tested in `layout-readout.test.ts`).
 * Everything here is in the level file's own coordinates: `[x, y]` as in a
 * placement's `[uid, x, y]`, 0-based from the north-west corner, x growing east
 * and y south, so `tiles[y][x]` is the rules' tile (the `ChainGround` grid) and
 * what is pasted into a chat can be matched against the file.
 *
 * - `tileInfo`: one tile as the rules read it (type, the side covers) and what
 *   the level places on it or on its edges;
 * - `readout`: that as the one line the hover shows;
 * - `toggleCell`, `addRect`, `rectCells`: the selection as a list of tiles;
 * - `copyText`: the selection as plain text to paste to an assistant.
 */
import { assetByUid, floorByUid } from "./catalog.ts";
import type { GroundTile } from "./chain-ground.ts";
import { canonicalEdge, edgeCells, placementsAt, type Level } from "./editor/level.ts";

/** A tile as the level file names it: `[x, y]`. */
export type LayoutCell = readonly [x: number, y: number];

export type CompassSide = "N" | "E" | "S" | "W";

export interface TileInfo {
  x: number;
  y: number;
  type: GroundTile["t"];
  /**
   * The cover on this tile's four edges as the rules test them, north first:
   * an edge is as covered as the higher of the two tiles' facing sides, so an
   * edge piece beside an obstacle, a wall or an unwalkable tile (which hold no
   * sides of their own) still shows. `by` marks a cover that is not an edge
   * piece but the neighbour itself: a wall (high) or an obstacle (low) next door.
   */
  sides: { side: CompassSide; level: "low" | "high"; by?: "wall" | "obstacle" }[];
  /** What the level places here: a cell asset, or an edge asset on one of this tile's edges. */
  placed: { uid: string; name: string; edge?: CompassSide }[];
  /** The painted floor here (the road, a crosswalk, the store floor), when there is one. */
  floor?: { uid: string; name: string };
  /** The side that deploys here, when one does. */
  spawn?: "A" | "B";
}

/** The ground's sides are `[left, top, right, bottom]`: west, north, east, south. */
const ORDER: [CompassSide, number][] = [
  ["N", 1],
  ["E", 2],
  ["S", 3],
  ["W", 0],
];

/** The step to the neighbour on each side, in `[x, y]`. */
const STEP: Record<CompassSide, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPPOSITE: Record<CompassSide, CompassSide> = { N: "S", E: "W", S: "N", W: "E" };
const INDEX: Record<CompassSide, number> = { W: 0, N: 1, E: 2, S: 3 };

type Tiles = readonly (readonly GroundTile[])[];

/** A tile's own side on `side`: only a Cover tile carries any (`side_cover!`). */
function ownSide(tiles: Tiles, [x, y]: LayoutCell, side: CompassSide): number {
  const tile = tiles[y]?.[x];
  return tile?.t === "cover" ? tile.sides[INDEX[side]] : 0;
}

/**
 * The cover on the edge of `cell` toward `side`, the way the rules test it:
 * the higher of this tile's side toward it and the neighbour's side toward
 * this tile (`is_edge_high_cover!`). 0 none, 1 low, 2 high.
 */
export function edgeCover(tiles: Tiles, cell: LayoutCell, side: CompassSide): number {
  const [dx, dy] = STEP[side];
  return Math.max(ownSide(tiles, cell, side), ownSide(tiles, [cell[0] + dx, cell[1] + dy], OPPOSITE[side]));
}

/**
 * Every edge with cover on the grid, once each: named by the tile whose north
 * or west side it is (that tile may be off the grid, on the far rim).
 */
export function coverEdges(tiles: Tiles): { cell: LayoutCell; side: "N" | "W"; level: 1 | 2 }[] {
  const out: { cell: LayoutCell; side: "N" | "W"; level: 1 | 2 }[] = [];
  const rows = tiles.length,
    cols = tiles[0]?.length ?? 0;
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= cols; x++)
      for (const side of ["N", "W"] as const) {
        const level = edgeCover(tiles, [x, y], side);
        if (level === 1 || level === 2) out.push({ cell: [x, y], side, level });
      }
  return out;
}

const same = (a: LayoutCell, b: LayoutCell) => a[0] === b[0] && a[1] === b[1];

/** The tile at `cell`, or null off the grid. `level` is optional: without it nothing is said about placements. */
export function tileInfo(tiles: readonly (readonly GroundTile[])[], level: Level | null | undefined, cell: LayoutCell): TileInfo | null {
  const tile = tiles[cell[1]]?.[cell[0]];
  if (!tile) return null;
  const sides: TileInfo["sides"] = [];
  const standable = tile.t === "empty" || tile.t === "cover";
  for (const [side] of ORDER) {
    const edge = edgeCover(tiles, cell, side);
    if (edge === 1 || edge === 2) {
      sides.push({ side, level: edge === 2 ? "high" : "low" });
      continue;
    }
    // A wall or an obstacle beside a tile to stand on covers it on that side (`tile_cover!`).
    if (!standable) continue;
    const [dx, dy] = STEP[side];
    const next = tiles[cell[1] + dy]?.[cell[0] + dx];
    if (next?.t === "wall") sides.push({ side, level: "high", by: "wall" });
    else if (next?.t === "obstacle") sides.push({ side, level: "low", by: "obstacle" });
  }
  const info: TileInfo = { x: cell[0], y: cell[1], type: tile.t, sides, placed: [] };
  if (!level) return info;
  for (const p of placementsAt(level, [cell[0], cell[1]])) {
    const spec = assetByUid(p.asset);
    if (!spec) continue;
    const entry: TileInfo["placed"][number] = { uid: p.asset, name: spec.name };
    if (spec.place === "edge") {
      const e = canonicalEdge(p.at, p.turn);
      const [near] = edgeCells(p.at, p.turn);
      // The edge is the canonical cell's north or west side, and the neighbour's south or east.
      const mine = same(near, cell);
      entry.edge = e.side === "n" ? (mine ? "N" : "S") : mine ? "W" : "E";
    }
    info.placed.push(entry);
  }
  const paint = level.floors.find((f) => same(f.at, cell));
  const floor = paint && floorByUid(paint.floor);
  if (floor) info.floor = { uid: floor.uid, name: floor.name };
  if (level.spawns.a.some((c) => same(c, cell))) info.spawn = "A";
  else if (level.spawns.b.some((c) => same(c, cell))) info.spawn = "B";
  return info;
}

const sidesText = (info: TileInfo) =>
  info.sides.length ? info.sides.map((s) => `${s.side} ${s.level}${s.by ? ` (${s.by})` : ""}`).join(", ") : "no sides";

const floorText = (info: TileInfo) => (info.floor ? `floor ${info.floor.uid} (${info.floor.name})` : "");

const placedText = (info: TileInfo) =>
  [floorText(info), ...info.placed.map((p) => `${p.uid} (${p.name})${p.edge ? ` on ${p.edge} edge` : ""}`)].filter(Boolean).join(", ") || "nothing placed";

/** The hover's line: `8,17 · cover · W high · fence-tall (Tall fence) on W edge`. */
export function readout(info: TileInfo): string {
  const parts = [`${info.x},${info.y}`, info.type];
  if (info.sides.length) parts.push(sidesText(info));
  if (info.spawn) parts.push(`spawn ${info.spawn}`);
  parts.push(placedText(info));
  return parts.join(" · ");
}

/** Every tile of the rectangle between two corners, row by row. */
export function rectCells(a: LayoutCell, b: LayoutCell): LayoutCell[] {
  const out: LayoutCell[] = [];
  for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) out.push([x, y]);
  return out;
}

/** The selection with `cell` added, or removed when it was in. */
export function toggleCell(selection: readonly LayoutCell[], cell: LayoutCell): LayoutCell[] {
  return selection.some((c) => same(c, cell)) ? selection.filter((c) => !same(c, cell)) : [...selection, cell];
}

/** The selection with every tile of the rectangle between `a` and `b` in it. */
export function addRect(selection: readonly LayoutCell[], a: LayoutCell, b: LayoutCell): LayoutCell[] {
  const out = [...selection];
  for (const c of rectCells(a, b)) if (!out.some((o) => same(o, c))) out.push(c);
  return out;
}

const span = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}..${hi}`);

/** The rectangle the selection exactly fills, as `x 8..10 × y 5..6`, or null when it is not one. */
export function selectionRect(selection: readonly LayoutCell[]): string | null {
  if (!selection.length) return null;
  const xs = selection.map((c) => c[0]),
    ys = selection.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) !== new Set(selection.map((c) => c.join())).size) return null;
  return `${span(x0, x1)} × ${span(y0, y1)}`;
}

/** Row-major order, the way a grid reads. */
const rowMajor = (a: LayoutCell, b: LayoutCell) => a[1] - b[1] || a[0] - b[0];

/** The selection as runs along a row: `(8..10,5)`. */
export function selectionRuns(selection: readonly LayoutCell[]): string[] {
  const out: string[] = [];
  let run: { y: number; x0: number; x1: number } | null = null;
  const close = () => run && out.push(`(${span(run.x0, run.x1)},${run.y})`);
  for (const [x, y] of [...selection].sort(rowMajor)) {
    if (run && run.y === y && x === run.x1 + 1) run.x1 = x;
    else {
      close();
      run = { y, x0: x, x1: x };
    }
  }
  close();
  return out;
}

/** Past this many tiles the text carries ranges and a type count, not a line per tile. */
export const DETAIL_CAP = 12;

/** The convention line, so the reader of a paste never has to guess the axes. */
export const CONVENTION = "x east, y south, 0-based from the north-west corner, as in the level file";

/**
 * The selection as text to paste to an assistant: a header with the tiles (or
 * their runs) and the rectangle they fill, the axes, and a line per tile with
 * its type, sides and placements while there are few enough of them.
 */
export function copyText(
  title: string,
  tiles: readonly (readonly GroundTile[])[],
  level: Level | null | undefined,
  selection: readonly LayoutCell[],
): string {
  const cells = [...selection].sort(rowMajor);
  if (!cells.length) return `${title} · no tiles selected`;
  const rect = selectionRect(cells);
  const few = cells.length <= DETAIL_CAP;
  const head = [title, few ? `tiles ${cells.map(([x, y]) => `(${x},${y})`).join(" ")}` : `${cells.length} tiles ${selectionRuns(cells).join(" ")}`];
  if (rect) head.push(`rect ${rect}`);
  const lines = [head.join(" · "), CONVENTION];
  const infos = cells.map((c) => tileInfo(tiles, level, c)).filter((i): i is TileInfo => !!i);
  if (few) for (const i of infos) lines.push(`(${i.x},${i.y}) ${i.type} · ${sidesText(i)}${i.spawn ? ` · spawn ${i.spawn}` : ""} · ${placedText(i)}`);
  else {
    const counts = new Map<string, number>();
    for (const i of infos) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    lines.push(`types: ${[...counts].map(([t, n]) => `${t} ×${n}`).join(", ")}`);
  }
  return lines.join("\n");
}
