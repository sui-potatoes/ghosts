// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Night Shift's ground, as the editor holds it. Plan, one character per
 * tile, x across, z down (`.` roadway; raised: `,` pavement, `:` car park
 * and depot yard, `-` lane and alley, `_` the store's floor):
 *
 * ```
 *       012345678901234567890
 *     0 ,,....,,####-###-####  # building ring or store wall (Wall)
 *     1 ,,....,,KKKx-#%#-#%%#  % empty building interior (Unwalkable)
 *     2 ,,....,,::::-#%#-#%%#  K vehicle (Wall)  V vending (Wall)
 *     3 ,,....i,BBBB-###-####  F built-in fridge/chiller  S stock
 *     4 ,,....,,---i-x-x-x---  c cigarettes  t terminal  a ATM
 *     5 ,s....,,KKK--------##  C counter  k self-checkout
 *     6 ,,....,,KKK-x--xi--##  g gondola  z freezer  m magazines
 *     7 ,,....,,##FFFSdS#--##  p packing table  T toilet  d door
 *     8 ,,...w,,#T_____=S--##  x AC, crates, bin bank (cover)
 *     9 ,,....,,F_ggg___#-x--  w roadworks  i pole/lamp  s sign
 *    10 ,,====,,F_____C_c--##  A car park (side A)  B depot (B)
 *    11 ,,....i,F_ggg_C_c--##
 *    12 ,,....,VF_____C_c--##
 *    13 ,,....,VF_ggg_k_t--##
 *    14 ,,....,,d_____k_a-x--
 *    15 ,,....,,#zmm_p__#--##
 *    16 ,,...K,,:::::x::::-##
 *    17 ,,...K,,K:KK:::K::-##
 *    18 ,,KK.K,,K:KK:::K::---
 *    19 ,,KK..i,K:KK:::K::###
 *    20 ,,KK..,,::A:A:A:A:#%#
 *    21 ,,....,,::::::::::###
 * ```
 */
import { importLevel, type Level } from "../editor/level.ts";
import file from "./level.json" with { type: "json" };

/** The level as the editor holds it. */
export function nightShiftLevel(): Level {
  return importLevel(file).level;
}

