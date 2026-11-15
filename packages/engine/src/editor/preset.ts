// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A level as the chain stores it: the BCS bytes of a `ghosts::map::Map` (what
 * `map::from_bytes` takes, and what `ghosts::Preset.map` holds) plus the spawn
 * positions of `ghosts::Preset`. Nothing here sends anything: it is the byte
 * layer a publish step would use, and the rules the contract enforces on it.
 *
 * The bytes are the DEPLOYED layout: id, the rows of tiles, `rows`, `cols`,
 * `fallen`. The unpublished source adds a trailing `units` vector to `Map`;
 * `from_bytes` accepts it left out and rebuilds it from the grid, so these
 * bytes are valid for both.
 */
import type { Cell } from "../map.ts";
import { inLevel, toMoveMap, type Level, type MoveTile } from "./level.ts";

/** Cells are `u8` in `Preset.positions`, so a side is at most this long. */
export const MAX_CHAIN_SIDE = 255;
/** `Map.units` (unpublished source) holds `x * cols + y` as a `u16`. */
export const MAX_CHAIN_TILES = 65535;

export interface PresetIssue {
  /** `error`: the chain would reject or break on it; `warn`: it is dropped or changes meaning. */
  level: "error" | "warn";
  text: string;
}

export interface PresetExport {
  rows: number;
  cols: number;
  /** BCS of `ghosts::map::Map` (deployed layout, `units` left out). */
  bytes: Uint8Array;
  /** `[row, col]` per spawn, first half for the first player, second half for the second. */
  positions: [row: number, col: number][];
  issues: PresetIssue[];
}

/** ULEB128, the length prefix of every BCS vector. */
function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

const u16 = (value: number) => [value & 0xff, value >> 8];

function tileBytes(tile: MoveTile): number[] {
  // `TileType` by declaration order, then an empty `Option<Unit>`.
  switch (tile.t) {
    case "empty": return [0, 0];
    case "cover": return [1, ...tile.sides, 0];
    case "unwalkable": return [2, 0];
    case "wall": return [3, 0];
  }
}

/** `[row, col]` of a level cell: a row is one line of constant z. */
const chainCell = ([x, z]: Cell): [number, number] => [z, x];

/**
 * What the contract would refuse or mangle for `level`, without encoding it.
 * Spawns follow `ghosts::deploy_squad`: a recruit goes on `position[0], [1]`
 * through `place_recruit`, which aborts on a wall, an unwalkable tile or an
 * occupied tile; the first half of the list is the first player's.
 */
export function presetIssues(level: Level): PresetIssue[] {
  const issues: PresetIssue[] = [];
  const err = (text: string) => issues.push({ level: "error", text });
  const warn = (text: string) => issues.push({ level: "warn", text });
  if (level.width < 1 || level.depth < 1) err("The grid is empty: the chain cannot read an empty grid");
  if (level.width > MAX_CHAIN_SIDE || level.depth > MAX_CHAIN_SIDE)
    err(`A side past ${MAX_CHAIN_SIDE} cells does not fit the u8 spawn positions`);
  if (level.width * level.depth > MAX_CHAIN_TILES)
    err(`${level.width * level.depth} tiles do not fit the u16 unit index (max ${MAX_CHAIN_TILES})`);

  const tiles = toMoveMap(level).tiles;
  const seen = new Set<string>();
  for (const cell of level.spawns) {
    const name = cell.join();
    if (!inLevel(level, cell)) {
      err(`Deployment ${name} is outside the grid`);
      continue;
    }
    if (seen.has(name)) err(`Deployment ${name} is listed twice`);
    seen.add(name);
    const tile = tiles[cell[1]]?.[cell[0]];
    if (tile?.t === "wall") err(`Deployment ${name} stands on a wall: place_recruit aborts there`);
    else if (tile?.t === "unwalkable") err(`Deployment ${name} stands on an unwalkable tile: place_recruit aborts there`);
  }
  if (level.spawns.length === 0) err("No deployment cells: nobody could be placed");
  else if (level.spawns.length % 2) err("Deployment count is odd: the first half is one side's, the second half the other's");
  if (level.objective) warn("The objective is not on chain: the contract has no objective tile");
  if (level.lights.length || level.floors.length || level.placements.length)
    warn("Floors, lights, props and lighting are scene dressing: the chain only keeps the tile grid and spawns");
  return issues;
}

/** BCS of a `ghosts::map::Map` with these rows of tiles (deployed layout, `units` left out). */
export function encodeMap(tiles: readonly (readonly MoveTile[])[]): Uint8Array {
  const rows = tiles.length, cols = tiles[0]?.length ?? 0;
  const bytes: number[] = new Array(32).fill(0);
  bytes.push(...uleb(rows));
  for (const row of tiles) {
    bytes.push(...uleb(cols));
    for (const tile of row) bytes.push(...tileBytes(tile));
  }
  bytes.push(...u16(rows), ...u16(cols));
  // `Map.fallen`: nobody has fallen on a preset.
  bytes.push(0);
  return Uint8Array.from(bytes);
}

/**
 * The `Map` bytes and `Preset.positions` for `level`. Encoding never throws on
 * a level the chain would reject: read `issues`, a level with an `error` must
 * not be published.
 */
export function toPreset(level: Level): PresetExport {
  const { tiles } = toMoveMap(level);
  const rows = tiles.length, cols = tiles[0]?.length ?? 0;
  return {
    rows,
    cols,
    bytes: encodeMap(tiles),
    positions: level.spawns.map(chainCell),
    issues: presetIssues(level),
  };
}
