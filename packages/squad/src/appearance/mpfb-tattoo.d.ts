// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { BufferGeometry, Material } from "three";
import type { Appearance } from "../types";
export function nativeTattoo(
    state: Appearance,
    skin: BufferGeometry,
    top: number,
    eyes: BufferGeometry,
): { key: string; g: BufferGeometry; material: Material } | null;
