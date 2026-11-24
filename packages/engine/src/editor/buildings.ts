// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Buildings nobody enters, as the level holds them: a ring of building
 * pieces (the masses and shell walls, Wall tiles on chain) around interior
 * cells painted Unwalkable with nothing placed on them. A block is found by
 * flood fill: building cells and the unwalkable cells they touch, joined
 * four ways. The play view draws each block whole from that: the pieces
 * show only their outside faces, a roof spans the entire footprint, and a
 * flat dark fill covers the floor, which is what a cutaway shows.
 *
 * A building that is one placement (a `building-mass-…` asset: its Wall
 * ring is the asset's own cells, the interior the level's unwalkable
 * cells) is a block by itself, no flood fill needed. It draws its own
 * facades and roof, so the play view adds only the fill and the cutaway.
 */
import { assetByUid } from "../catalog.ts";
import type { Cell } from "../map.ts";
import { massDims } from "../shop/catalog.ts";
import { inLevel, placementCells, turnOffset, type Level } from "./level.ts";

export interface Block {
  /** Every cell of the footprint, perimeter pieces and empty interior. */
  cells: Cell[];
  /** The interior cells: unwalkable, nothing placed, roofed by the play view. */
  interior: Cell[];
  /** One placement drew the whole building (facades and roof included), at this index in the level's placements. */
  mass?: number;
  /** A store’s skin (shell walls and built-ins) rather than a solid mass: its tiles keep their own floor. */
  shell: boolean;
  /** Roof height in metres: the tallest piece in the ring. */
  height: number;
}

const key = (c: Cell) => c.join();
const STOREY = 3;

/** A building piece's height, or null for anything else. */
export function buildingHeight(kind: string): number | null {
  if (!kind.startsWith("shop-building-") || /^shop-building-(roof|ceiling|mass)/.test(kind)) return null;
  const floors = /^shop-building-(\d+)$/.exec(kind);
  return floors ? Number(floors[1]) * STOREY : STOREY;
}

/** The level's blocks, and for each building placement (by index) its outside faces. */
export function buildingBlocks(level: Level): { blocks: Block[]; faces: Map<number, number>; blockOf: Map<number, number> } {
  // Shell walls (a store's skin) and building masses never merge into one block.
  const pieces = new Map<string, { index: number; height: number; turn: number; at: Cell; shell: boolean }>();
  const blocks: Block[] = [], faces = new Map<number, number>(), blockOf = new Map<number, number>();
  // Whole buildings first, in placement order: a block each, outside on all four sides.
  level.placements.forEach((p, index) => {
    const spec = assetByUid(p.asset), dims = spec && massDims(spec.kind);
    if (!spec || !dims) return;
    const ring = new Set(placementCells(spec, p).map(key)), cells: Cell[] = [], interior: Cell[] = [];
    for (let x = 0; x < dims.w; x++) for (let z = 0; z < dims.d; z++) {
      const [dx, dz] = turnOffset([x, z], p.turn), cell: Cell = [p.at[0] + dx, p.at[1] + dz];
      cells.push(cell);
      if (!ring.has(key(cell))) interior.push(cell);
    }
    blockOf.set(index, blocks.length);
    faces.set(index, 15);
    blocks.push({ cells, interior, height: dims.floors * STOREY, shell: false, mass: index });
  });
  level.placements.forEach((p, index) => {
    const spec = assetByUid(p.asset);
    const height = spec && !spec.place ? buildingHeight(spec.kind) : null;
    if (height !== null) pieces.set(key(p.at), { index, height, turn: p.turn, at: p.at, shell: spec!.kind.startsWith("shop-building-wall-") });
  });
  const voids = new Set(level.unwalkable.map(key));
  const owner = new Map<string, number>();
  for (const [start, first] of pieces) {
    if (owner.has(start)) continue;
    const block: Block = { cells: [], interior: [], height: 0, shell: first.shell };
    const queue: Cell[] = [pieces.get(start)!.at];
    owner.set(start, blocks.length);
    while (queue.length) {
      const cell = queue.pop()!;
      block.cells.push(cell);
      const piece = pieces.get(key(cell));
      if (piece) block.height = Math.max(block.height, piece.height);
      else block.interior.push(cell);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next: Cell = [cell[0] + dx, cell[1] + dz], k = key(next);
        const piece = pieces.get(k);
        if (owner.has(k) || !inLevel(level, next) || (piece ? piece.shell !== first.shell : !voids.has(k))) continue;
        owner.set(k, blocks.length);
        queue.push(next);
      }
    }
    blocks.push(block);
  }
  // A face is outside when the cell beyond it belongs to no part of the same block.
  for (const piece of pieces.values()) {
    const mine = owner.get(key(piece.at));
    blockOf.set(piece.index, mine!);
    let mask = 0;
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((yaw, bit) => {
      const a = yaw + piece.turn * (Math.PI / 2);
      const next: Cell = [piece.at[0] + Math.round(Math.sin(a)), piece.at[1] + Math.round(Math.cos(a))];
      if (owner.get(key(next)) !== mine) mask |= 1 << bit;
    });
    faces.set(piece.index, mask);
  }
  return { blocks, faces, blockOf };
}
