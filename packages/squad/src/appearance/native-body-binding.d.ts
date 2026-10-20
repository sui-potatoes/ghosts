// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { BufferGeometry, SkinnedMesh, Skeleton } from "three";
export function installBodySuit(
    mesh: SkinnedMesh,
    top: number,
    skeleton: Skeleton,
    gloves?: boolean,
): void;
export function remapNativeWeights(
    geometry: BufferGeometry,
    nativeSkeleton: Skeleton,
    target: Skeleton,
    skin?: boolean,
): void;
