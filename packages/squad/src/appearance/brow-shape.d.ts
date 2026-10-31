// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Sample the depth of the reconstructed surface at (x, y); null off the mesh. */
export type Surface = (x: number, y: number) => number | null;
export function frontSurface(
    positions: ArrayLike<number>,
    indices: ArrayLike<number>,
    cell?: number,
): Surface;
export function shapeBrow(source: Float32Array, params: object, surface: Surface): Float32Array;
