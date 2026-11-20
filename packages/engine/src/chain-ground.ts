// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ground as `ghosts::map` rules it, for an encounter that should play the
 * way a chain match on the same tile grid would (an editor level under
 * playtest). Tiles are the Move `Map` grid: Empty, Cover with a level per side
 * (`[left, top, right, bottom]`: west, north, east, south), Unwalkable, Wall,
 * Obstacle.
 *
 * - Moving (`trace_path`): walls and unwalkable tiles cannot be entered; a step
 *   across an edge with high cover on either side is refused; low cover never
 *   stops a step. Empty and Cover tiles are ground to stand on. An Obstacle is
 *   passed over, never stood on: a path may step onto one only to step off it
 *   onto ground to stand on, so two in a row cannot be crossed and no path ends
 *   on one. Every step counts one tile, the step onto an obstacle included.
 * - Cover: the side of the target facing the shot, else the neighbour's side
 *   facing it, 25 a level (`cover_bonus`); a wall counts as high all round, an
 *   obstacle as low all round.
 * - Sight: walls block, high cover on an inner edge blocks (`trace_line`);
 *   obstacles block neither sight nor throws.
 * - Grenades: only walls stop a throw, it cannot land on one, and the blast
 *   turns every Cover and Obstacle tile in reach to Empty (`explode`).
 *
 * The same rules the app's `chain/match-rules.ts` ports for a live match; the
 * engine keeps its own copy as it never imports the app.
 */
import type { Cell } from "./map.ts";

export type GroundTile =
  | { t: "empty" }
  | { t: "cover"; sides: [left: number, top: number, right: number, bottom: number] }
  | { t: "unwalkable" }
  | { t: "wall" }
  | { t: "obstacle" };

/** A Move tile grid placed in scene cells: `tiles[row][col]` is cell `[col + minX, row + minZ]`. */
export interface Ground {
  tiles: GroundTile[][];
  minX: number;
  minZ: number;
}

type Tile = readonly [row: number, col: number];
type Sides = { left: number; top: number; right: number; bottom: number };

const LOW = 1;
const HIGH = 2;
/** `DEFENSE_BONUS` in `ghosts::map`. */
const DEFENSE_BONUS = 25;
/** `GRENADE_RADIUS` in `ghosts::map`. */
const BLAST_RADIUS = 2;
/** `MAX_RANGE_OFFSET`, `DISTANCE_BONUS` and `DISTANCE_PENALTY` in `ghosts::unit`. */
const MAX_RANGE_OFFSET = 3;
const DISTANCE_BONUS = 5;
const DISTANCE_PENALTY = 10;

export class ChainGround {
  /** A private copy: blasts clear cover tiles as the encounter goes. */
  readonly tiles: GroundTile[][];
  private readonly minX: number;
  private readonly minZ: number;

  constructor(ground: Ground) {
    this.tiles = ground.tiles.map((row) =>
      row.map((tile) => (tile.t === "cover" ? { t: "cover", sides: [...tile.sides] } : { ...tile }) as GroundTile),
    );
    this.minX = ground.minX;
    this.minZ = ground.minZ;
  }

  tileOf([x, z]: Cell): Tile {
    return [z - this.minZ, x - this.minX];
  }

  private at([row, col]: Tile): GroundTile | undefined {
    return this.tiles[row]?.[col];
  }

  /** `tile_cover!`: the cover on each side of a tile; a wall is high all round, an obstacle low. */
  private sides(tile: Tile): Sides {
    const type = this.at(tile);
    if (type?.t === "cover") {
      const [left, top, right, bottom] = type.sides;
      return { left, top, right, bottom };
    }
    const level = type?.t === "wall" ? HIGH : type?.t === "obstacle" ? LOW : 0;
    return { left: level, top: level, right: level, bottom: level };
  }

  /** `side_cover!`: a Cover tile's side; anything else has none (a wall is a wall first, an obstacle has no edges). */
  private side(tile: Tile, name: keyof Sides) {
    return this.at(tile)?.t === "cover" ? this.sides(tile)[name] : 0;
  }

  /**
   * What a cell is to a unit on the move: ground to stand on (Empty, Cover:
   * `is_standable!`), an obstacle to pass over, or blocked (a wall, an
   * unwalkable tile, off the grid). Units are the rules' concern.
   */
  terrain(cell: Cell): "open" | "obstacle" | "blocked" {
    const tile = this.at(this.tileOf(cell));
    if (!tile || tile.t === "wall" || tile.t === "unwalkable") return "blocked";
    return tile.t === "obstacle" ? "obstacle" : "open";
  }

  /** `is_edge_high_cover!` between two neighbouring tiles. */
  private highEdge(from: Tile, to: Tile) {
    const [dRow, dCol] = [to[0] - from[0], to[1] - from[1]];
    const out = dRow < 0 ? "top" : dRow > 0 ? "bottom" : dCol < 0 ? "left" : "right";
    const back = dRow < 0 ? "bottom" : dRow > 0 ? "top" : dCol < 0 ? "right" : "left";
    return this.side(from, out) === HIGH || this.side(to, back) === HIGH;
  }

  /**
   * One step of `trace_path` between neighbouring cells, units aside: onto a
   * cell that is not blocked, across no high side, never from an obstacle
   * onto another. Where the path may end is `terrain(...) === "open"`.
   */
  step(from: Cell, to: Cell): boolean {
    const target = this.terrain(to);
    if (target === "blocked" || (target === "obstacle" && this.terrain(from) === "obstacle")) return false;
    return !this.highEdge(this.tileOf(from), this.tileOf(to));
  }

  /** `cover_bonus`: the defense `at` has against a shot from `from`, in percent points. */
  cover(from: Cell, at: Cell): number {
    const [a, b] = [this.tileOf(from), this.tileOf(at)];
    const [dRow, dCol] = [b[0] - a[0], b[1] - a[1]];
    if (dRow === 0 && dCol === 0) return 0;
    const [row, col] = b;
    // `direction!`: the axis that dominates, a diagonal only when neither does
    const vertical = Math.abs(dRow) >= Math.abs(dCol) ? Math.sign(dRow) : 0;
    const horizontal = Math.abs(dCol) >= Math.abs(dRow) ? Math.sign(dCol) : 0;
    const own = this.sides(b);
    const sideRow = vertical < 0 ? own.bottom : vertical > 0 ? own.top : 0;
    const sideCol = horizontal < 0 ? own.right : horizontal > 0 ? own.left : 0;
    const onTarget = Math.max(sideRow, sideCol);
    if (onTarget !== 0) return onTarget * DEFENSE_BONUS;
    const nearRow = vertical < 0 ? this.sides([row + 1, col]).top : 0;
    const farRow = vertical > 0 ? this.sides([row - 1, col]).bottom : 0;
    const nearCol = horizontal < 0 ? this.sides([row, col + 1]).left : 0;
    const farCol = horizontal > 0 ? this.sides([row, col - 1]).right : 0;
    return Math.max(nearRow, farRow, nearCol, farCol) * DEFENSE_BONUS;
  }

  /** The best cover `at` has from any of the four sides: what the HUD shows before a shot is aimed. */
  shelter(at: Cell): number {
    const [x, z] = at;
    return Math.max(...([[x + 4, z], [x - 4, z], [x, z + 4], [x, z - 4]] as Cell[]).map((from) => this.cover(from, at)));
  }

  /** `step_blocks`: a wall always; high cover on an edge touching neither end of the line. */
  private stepBlocks(from: Tile, to: Tile, inner: boolean, highCoverBlocks: boolean) {
    if (this.at(to)?.t === "wall") return true;
    if (!highCoverBlocks || !inner) return false;
    return this.highEdge(from, to);
  }

  /** `trace_line`: the segment between two tile centres, one edge at a time. */
  private trace(from: Tile, to: Tile, highCoverBlocks: boolean): boolean {
    const [dx, dy] = [Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1])];
    const edges = dx + dy;
    const [stepX, stepY] = [to[0] > from[0] ? 1 : -1, to[1] > from[1] ? 1 : -1];
    let [x, y] = from;
    let [i, j] = [0, 0];
    while (i + j < edges) {
      const k = i + j;
      const [tRow, tCol] = [(2 * i + 1) * dy, (2 * j + 1) * dx];
      const inner = k > 0 && k + 1 < edges;
      if (tRow < tCol) {
        if (this.stepBlocks([x, y], [x + stepX, y], inner, highCoverBlocks)) return false;
        x += stepX;
        i++;
      } else if (tCol < tRow) {
        if (this.stepBlocks([x, y], [x, y + stepY], inner, highCoverBlocks)) return false;
        y += stepY;
        j++;
      } else {
        // a corner: clear if either route around the vertex is
        const a: Tile = [x + stepX, y], b: Tile = [x, y + stepY], c: Tile = [x + stepX, y + stepY];
        const [first, second] = [k > 0, k + 2 < edges];
        const viaRow = !this.stepBlocks([x, y], a, first, highCoverBlocks) && !this.stepBlocks(a, c, second, highCoverBlocks);
        const viaCol = !this.stepBlocks([x, y], b, first, highCoverBlocks) && !this.stepBlocks(b, c, second, highCoverBlocks);
        if (!viaRow && !viaCol) return false;
        x += stepX;
        y += stepY;
        i++;
        j++;
      }
    }
    return true;
  }

  /** `line_of_sight`: walls and high covers block a shot; units and unwalkable tiles don't. */
  clearShot(from: Cell, to: Cell): boolean {
    return this.trace(this.tileOf(from), this.tileOf(to), true);
  }

  /** `line_of_throw`: only walls stop a throw, and it can't land on one. */
  clearThrow(from: Cell, to: Cell): boolean {
    const target = this.tileOf(to);
    return !!this.at(target) && this.at(target)!.t !== "wall" && this.trace(this.tileOf(from), target, false);
  }

  /** `explode` with environment damage: every Cover and Obstacle tile within the blast becomes Empty. */
  blast(at: Cell) {
    const [row, col] = this.tileOf(at);
    for (let r = row - BLAST_RADIUS; r <= row + BLAST_RADIUS; r++)
      for (let c = col - BLAST_RADIUS; c <= col + BLAST_RADIUS; c++) {
        if (Math.abs(r - row) + Math.abs(c - col) > BLAST_RADIUS) continue;
        const t = this.tiles[r]?.[c]?.t;
        if (t === "cover" || t === "obstacle") this.tiles[r][c] = { t: "empty" };
      }
  }

  /** `Unit.perform_attack`'s odds: distance against range, then cover and defense off. */
  static hitChance(aim: number, range: number, distance: number, lowered: number): number {
    if (distance > range + MAX_RANGE_OFFSET) return 0;
    const chance =
      distance === range
        ? aim
        : distance < range
          ? Math.min(aim + DISTANCE_BONUS * (range - distance), 100)
          : aim - Math.min(DISTANCE_PENALTY * (distance - range), aim);
    return chance - Math.min(chance, Math.min(lowered, 100));
  }
}
