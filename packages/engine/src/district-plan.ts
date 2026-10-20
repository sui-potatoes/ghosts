import { CELL, footprint, tacticalMap, type Cell, type MapPlan } from "./map.ts";

/**
 * The Kōra district, metres and cells. One plan drives the 3D build
 * (`district.ts`), collision footprints, cover and foot elevation.
 */
export { CELL, footprint };
export const STREET = { avenueHalf: 2.7, crossHalf: 2.025, curb: 0.16, reach: 45 };
export const districtBuildings = [
  { x: -7, z: -5, w: 5, d: 4, h: 5.4, kind: 'seven' },
  { x: 6, z: -5, w: 5, d: 4, h: 4.6, kind: 'lawson' },
  { x: -8, z: 4, w: 3, d: 4, h: 6.1, kind: 'laundry' },
  { x: 6, z: 5, w: 4, d: 3, h: 4.4, kind: 'workshop' },
] as const;

export const lowCoverCells: Cell[] = [
  [-3, 2],
  [-2, 2],
  [2, 2],
  [3, 2],
  [4, -1],
  [5, -1],
  [-4, -3],
  [0, -4],
  [-6, 4],
  [3, -5],
];

export const koraPlan: MapPlan = {
  id: "kora",
  bounds: { minX: -9, maxX: 8, minZ: -7, maxZ: 6 },
  buildings: districtBuildings,
  covers: lowCoverCells,
  street: STREET,
};

export const kora = tacticalMap(koraPlan);

/** Curb ramps at the four corners align with the zebra crossings. */
export const surfaceHeight = kora.surfaceHeight;
