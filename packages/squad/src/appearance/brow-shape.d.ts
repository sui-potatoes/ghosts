export interface Surface {
    sample(x: number, y: number): number;
}
export function frontSurface(positions: ArrayLike<number>, indices: ArrayLike<number>): Surface;
export function shapeBrow(source: Float32Array, params: object, surface: Surface): Float32Array;
