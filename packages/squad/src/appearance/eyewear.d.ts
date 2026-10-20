import type { BufferGeometry, Material } from "three";
import type { Appearance } from "../types";
export function createEyewear(
    state: Appearance,
    skin: BufferGeometry,
    eyes: BufferGeometry,
): { key: string; g: BufferGeometry; material: Material }[];
