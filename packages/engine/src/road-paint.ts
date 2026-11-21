// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Road paint (zebra bars, lane dashes, edge and stop lines) is a film on the
 * asphalt, not a slab: its top sits `PAINT_HEIGHT` metres over the road. The
 * street (`district.ts`) and the level editor's crosswalk floors
 * (`editor/floors.ts`) build it from these. A few millimetres only; the
 * paint's material takes a polygon offset so it still wins the depth test
 * from the tactical camera, and the snow dusting (which reads the up-facing
 * top) can never leave a bar standing taller than the ground around it.
 */

/** Height of the street's asphalt top, metres (`district.ts`'s road slab). */
export const ROAD_TOP = -0.01;
/** How far the paint's top stands over the surface under it, metres. */
export const PAINT_HEIGHT = 0.005;
/** How far the box reaches below the surface, so no edge ever shows underneath. */
const SINK = 0.002;

/** Vertical placement of a paint box over a surface whose top is at `base`: its centre and its height. */
export function paintBox(base = ROAD_TOP): { y: number; height: number } {
  const height = PAINT_HEIGHT + SINK;
  return { y: base + PAINT_HEIGHT - height / 2, height };
}
