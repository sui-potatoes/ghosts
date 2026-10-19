/** Metres. One shared plan drives geometry, collision footprints and foot elevation. */
export const CELL = 1.35;
export const STREET = { avenueHalf: 2.7, crossHalf: 2.025, curb: 0.16, reach: 45 };
export const districtBuildings = [
  { x: -7, z: -5, w: 5, d: 4, h: 5.4, kind: 'seven' },
  { x: 6, z: -5, w: 5, d: 4, h: 4.6, kind: 'lawson' },
  { x: -8, z: 4, w: 3, d: 4, h: 6.1, kind: 'laundry' },
  { x: 6, z: 5, w: 4, d: 3, h: 4.4, kind: 'workshop' },
] as const;
export function footprint(b: { x: number; z: number; w: number; d: number }) {
  const minX = (b.x - Math.floor(b.w / 2) - 0.5) * CELL;
  const minZ = (b.z - Math.floor(b.d / 2) - 0.5) * CELL;
  return { minX, minZ, maxX: minX + b.w * CELL, maxZ: minZ + b.d * CELL,
    x: minX + b.w * CELL / 2, z: minZ + b.d * CELL / 2, w: b.w * CELL, d: b.d * CELL };
}
/** Curb ramps at the four corners align with the zebra crossings. */
export function surfaceHeight(x: number, z: number) {
  const dx = Math.abs(x) - STREET.avenueHalf, dz = Math.abs(z) - STREET.crossHalf;
  if (dx <= 0 || dz <= 0) return 0;
  const rampX = Math.abs(Math.abs(z) - 3.25) < 0.7;
  const rampZ = Math.abs(Math.abs(x) - 3.85) < 0.7;
  return STREET.curb * Math.min(1, rampX ? dx / 0.75 : 1, rampZ ? dz / 0.75 : 1);
}

export const lowCoverCells: [number,number][] = [
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
