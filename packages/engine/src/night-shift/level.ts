// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Night Shift's ground, as the editor holds it. Plan, one character per
 * tile, x across, z down (`,` pavement, `.` asphalt or concrete, `_` the
 * store's floor):
 *
 * ```
 *       0123456789012345678
 *     0 ,,K...xKB.BK#######   # building, store wall (Wall tiles)
 *     1 ,,K...,K..BK#######   K parked vehicle (Wall)
 *     2 ,,K...,KB..K#######   V vending machine (Wall)
 *     3 ,i....,.....#######   F fridge, chiller, wall shelf
 *     4 ,,....,....x...V.t#   = counter (in the store), crosswalk
 *     5 ,,....,.....KKK...#   g low gondola, z chest freezer
 *     6 ,,....,.V.......x.#   x bins, crates, AC, roll cage
 *     7 ,,....i###d#####..#   t café table, i pole, s sign
 *     8 ,,....,##___FFF#..#   d doorway in the store's walls
 *     9 s,....V##__x___d.x#   A coin lot (side A, south)
 *    10 ,,====,##d###d##..#   B night depot (side B, north)
 *    11 ,V....,_=__FF_F#..#
 *    12 ,V....,_=_g___F#x.#   F g z x t = are cover: a frag
 *    13 ,,....x_=_g_g_F#..#   clears them (on chain an
 *    14 ,,KK..,___g_g_F#..#   Obstacle). Glass, fences and
 *    15 ,,KK..,_____zz_#.x#   shelters sit on cell edges.
 *    16 ,,KK..i.Kx...K....#
 *    17 ,,....,.K....K....#
 *    18 ,,...K,.K....K..x.#
 *    19 ,,...K,........V..#
 *    20 ,i...K,.....#######
 *    21 ,,K...,KAs.K#######
 *    22 ,,K...,K..AK#######
 *    23 ,,K...xKA.AK#######
 * ```
 */
import { importLevel, type Level } from "../editor/level.ts";
import file from "./level.json" with { type: "json" };
import next from "./level-next.json" with { type: "json" };

/** The level as the editor holds it. */
export function nightShiftLevel(): Level {
  return importLevel(file).level;
}

/**
 * The next revision, as the editor holds it: the block re-planned as a Tokyo
 * side street (`levels/tokyo-v2.md`). Training plays it now; chain matches
 * keep `level.json` until the preset is re-created from `chain-next.ts`.
 */
export function nightShiftNextLevel(): Level {
  return importLevel(next).level;
}
