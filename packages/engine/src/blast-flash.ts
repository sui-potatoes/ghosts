// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ground flash of a grenade going off: which tiles light and how the light
 * rises and falls. The rules' own area is used (`distance` within
 * `GRENADE_RADIUS`, the count `Encounter.throw` and `throwEffect` make); the
 * scene (`scene/blast-flash.ts`) draws it. Plain TypeScript: it runs in node.
 */

import { GRENADE_RADIUS, type ThrowOrder } from "./action-registry.ts";
import { distance } from "./game.ts";
import type { Cell, TacticalMap } from "./map.ts";

/** The most tiles a burst can light: the diamond of `GRENADE_RADIUS`. */
export const BLAST_TILES = 2 * GRENADE_RADIUS * GRENADE_RADIUS + 2 * GRENADE_RADIUS + 1;

/** Seconds the flash lasts, the share of it spent rising, and the same for a viewer who asked for less motion. */
export const FLASH = {
  duration: 0.6,
  rise: 0.06,
  /** Reduced motion: a slower, dimmer swell and the same fade. */
  calm: { rise: 0.16, peak: 0.4 },
  /** Opacity of the brightest tile at full strength; tiles farther from the centre keep `falloff` less per step. */
  peak: 0.85,
  falloff: 0.14,
} as const;

/** The tiles a grenade landing on `at` lights: within the rules' radius, on the map, and not a wall. */
export function blastTiles(map: Pick<TacticalMap, "inBounds" | "isWall">, at: Cell): Cell[] {
  const tiles: Cell[] = [];
  for (let dx = -GRENADE_RADIUS; dx <= GRENADE_RADIUS; dx++)
    for (let dz = -GRENADE_RADIUS; dz <= GRENADE_RADIUS; dz++) {
      const cell: Cell = [at[0] + dx, at[1] + dz];
      if (distance(cell, at) <= GRENADE_RADIUS && map.inBounds(cell) && !map.isWall(cell)) tiles.push(cell);
    }
  return tiles;
}

/** How strongly a tile `steps` from the centre shines at full strength: 1 at the centre, less outward. */
export function tileWeight(steps: number): number {
  return 1 - FLASH.falloff * steps;
}

/**
 * The flash's strength `t` seconds after the burst, 0 to 1: a quick ease-out
 * rise, then a smooth fall to nothing at `duration`. `calm` swells slower to
 * a lower peak, so it never flares.
 */
export function flashLevel(t: number, calm = false): number {
  if (!(t > 0) || t >= FLASH.duration) return 0;
  const rise = calm ? FLASH.calm.rise : FLASH.rise,
    peak = calm ? FLASH.calm.peak : 1;
  if (t < rise) {
    const u = t / rise;
    return peak * (1 - (1 - u) * (1 - u));
  }
  const u = (t - rise) / (FLASH.duration - rise);
  return peak * (1 - u * u * (3 - 2 * u));
}

/** Which colour token a grenade's flash takes. */
export const FLASH_TINT: Readonly<Record<ThrowOrder, "frag" | "flashbang" | "smoke">> = {
  grenade: "frag",
  flashbang: "flashbang",
  "smoke-grenade": "smoke",
};
