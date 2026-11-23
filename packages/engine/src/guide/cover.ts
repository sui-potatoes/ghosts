// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The cover system as the simulation shows it, pure (tested in `cover.test.ts`
 * against `ChainGround`, the rules the encounter plays by):
 *
 * - `groundAfter`: the tile grid as it stands after the journal's grenades
 *   (`Map.explode` clears every Cover and Obstacle tile in reach), so the
 *   picture always shows the cover the rules still count;
 * - `coverPieces`: every piece of the grid by what it is in the rules (wall
 *   tiles, high and low cover edges with the side each protects, obstacles);
 * - `coverRelation`: which piece, if any, protects a unit from a shooter, and
 *   by how much (`cover_bonus`: the target's own side facing the shot, else
 *   the neighbour's side facing it).
 */
import { ChainGround, type Ground, type GroundTile } from "../chain-ground.ts";
import type { GameEvent } from "../events.ts";
import type { Cell } from "../map.ts";

/** A tile side, as the contract names them: west, north, east, south. */
export type Side = "left" | "top" | "right" | "bottom";

const SIDE_INDEX: Record<Side, 0 | 1 | 2 | 3> = { left: 0, top: 1, right: 2, bottom: 3 };
/** The neighbour a side faces, in scene cells (`[x, z]`; z grows south). */
const SIDE_STEP: Record<Side, Cell> = { left: [-1, 0], top: [0, -1], right: [1, 0], bottom: [0, 1] };

/** The grid after every grenade in `events` went off. */
export function groundAfter(ground: Ground, events: readonly GameEvent[]): ChainGround {
  const out = new ChainGround(ground);
  for (const e of events) if (e.type === "grenade") out.blast(e.at);
  return out;
}

/** A tile of `ground` by scene cell. */
export function tileAt(ground: ChainGround, cell: Cell): GroundTile | undefined {
  const [row, col] = ground.tileOf(cell);
  return ground.tiles[row]?.[col];
}

/** One piece of the simulation: what it is, where, and which tile side it protects. */
export type CoverPiece =
  | { kind: "wall"; cell: Cell }
  | { kind: "obstacle"; cell: Cell }
  /** One side of a Cover tile: 1 low, 2 high. A shared edge is two of these, one per tile. */
  | { kind: "edge"; cell: Cell; side: Side; level: 1 | 2 };

/** Every piece the grid holds now, in row order. */
export function coverPieces(ground: ChainGround, minX: number, minZ: number): CoverPiece[] {
  const out: CoverPiece[] = [];
  ground.tiles.forEach((row, r) =>
    row.forEach((tile, c) => {
      const cell: Cell = [c + minX, r + minZ];
      if (tile.t === "wall") out.push({ kind: "wall", cell });
      else if (tile.t === "obstacle") out.push({ kind: "obstacle", cell });
      else if (tile.t === "cover")
        (Object.keys(SIDE_INDEX) as Side[]).forEach((side) => {
          const level = tile.sides[SIDE_INDEX[side]];
          if (level === 1 || level === 2) out.push({ kind: "edge", cell, side, level });
        });
    }),
  );
  return out;
}

/** What protects `at` from a shot from `from`: the value and the piece that gives it, or nothing. */
export interface CoverRelation {
  /** Defense points off the shooter's hit chance (0, 25 or 50), as `cover_bonus` counts them. */
  value: number;
  /**
   * The protecting edge: the cell whose side it is and the side. For a wall or
   * an obstacle next door it is the neighbour's side facing the target.
   */
  edge: { cell: Cell; side: Side } | null;
}

const LEVEL: Record<string, number> = { wall: 2, obstacle: 1 };

/** A tile's cover on one side: a Cover tile's own level, a wall's 2 and an obstacle's 1 all round. */
function sideLevel(ground: ChainGround, cell: Cell, side: Side): number {
  const tile = tileAt(ground, cell);
  if (!tile) return 0;
  if (tile.t === "cover") return tile.sides[SIDE_INDEX[side]];
  return LEVEL[tile.t] ?? 0;
}

const opposite: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/**
 * `cover_bonus` with its reason: the shot's dominant axis (a diagonal only
 * when neither dominates), the target's sides facing the shooter first, else
 * the neighbours on the shooter's side, their sides facing the target.
 */
export function coverRelation(ground: ChainGround, from: Cell, at: Cell): CoverRelation {
  const [dx, dz] = [at[0] - from[0], at[1] - from[1]];
  if (!dx && !dz) return { value: 0, edge: null };
  const vertical = Math.abs(dz) >= Math.abs(dx) ? Math.sign(dz) : 0;
  const horizontal = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
  // The target's sides facing the shooter.
  const facing: Side[] = [];
  if (vertical) facing.push(vertical > 0 ? "top" : "bottom");
  if (horizontal) facing.push(horizontal > 0 ? "left" : "right");
  const own = facing.map((side) => ({ cell: at, side, level: sideLevel(ground, at, side) }));
  const best = (list: { cell: Cell; side: Side; level: number }[]) =>
    list.reduce((a, b) => (b.level > a.level ? b : a), { cell: at, side: facing[0], level: 0 });
  const mine = best(own);
  if (mine.level > 0) return { value: mine.level * 25, edge: { cell: mine.cell, side: mine.side } };
  // The neighbour on the shooter's side, its side facing the target.
  const next = facing.map((side) => {
    const [sx, sz] = SIDE_STEP[side];
    const cell: Cell = [at[0] + sx, at[1] + sz];
    return { cell, side: opposite[side], level: sideLevel(ground, cell, opposite[side]) };
  });
  const theirs = best(next);
  return theirs.level > 0 ? { value: theirs.level * 25, edge: { cell: theirs.cell, side: theirs.side } } : { value: 0, edge: null };
}
