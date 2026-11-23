// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics, the first training: a 12 × 10 yard in the editor's level format
 * (`level.json`, the export file the editor reads and writes; the editor opens
 * it as a base). South, the squad: VEX and GHOST. North, two Wraiths, each
 * behind a crate. Between them a crate for VEX's cover, pallets for GHOST to
 * vault, a masonry wall that hides WRAITH–02 from VEX, and a few props to
 * dress the edges. Every lesson's tile is named below, in level cells.
 *
 * ```
 *      x 0 1 2 3 4 5 6 7 8 9 10 11
 *   z 0  . . . c . . . . . c .  .      c cone, b bicycle, s sign, p pole
 *     1  . . . . . . . . . . .  b      H hostile, X their crates
 *     2  . . . . . H H . . . .  .      the grenade lands on WRAITH–01's tile
 *     3  . . o . . X X . . . o  .      o loose crates (dressing)
 *     4  = = = = = =|= = = = =  =      = crosswalk paint
 *     5  s . . . . C|. . . G .  .      C VEX's crate, | the wall (west edges)
 *     6  . . . . . V|. . . P .  .      V VEX's cover tile, P pallets to vault
 *     7  . . . . . .|. . . g .  .      g GHOST's first move, G after the vault
 *     8  . . . A . . . . . . .  B      A VEX deploys, B GHOST deploys
 *     9  p . . . . . . . . . .  .
 * ```
 */
import { importLevel, type Level } from "../../editor/level.ts";
import type { Cell } from "../../map.ts";
import file from "./level.json" with { type: "json" };

/** The level as the editor holds it. */
export function basicsLevel(): Level {
  return importLevel(file).level;
}

/** The lesson tiles, in level cells (`[x, z]`, 0-based, z grows south). */
export const MARKS = {
  /** GHOST's first move: the route and the action points. */
  ghostMove: [9, 7],
  /** The pallets GHOST vaults. */
  pallets: [9, 6],
  /** Where the vault lands, in the open towards WRAITH–02. */
  ghostVault: [9, 5],
  /** VEX's cover tile, behind the crate from WRAITH–01. */
  vexCover: [5, 6],
  /** The crate in front of it. */
  vexCrate: [5, 5],
  /** The hostiles' crates. */
  crates: [
    [5, 3],
    [6, 3],
  ],
  /**
   * Where the grenade lands: WRAITH–01's tile, with WRAITH–02 and both crates
   * in the blast. It is also where the throw starts aimed (`defaultGrenadeTarget`).
   */
  blast: [5, 2],
} satisfies Record<string, Cell | Cell[]>;
