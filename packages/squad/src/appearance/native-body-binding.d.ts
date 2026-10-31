// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { BufferGeometry, SkinnedMesh, Skeleton } from "three";
export function bindNativeSkeleton(
    skeleton: Skeleton,
    rig: {
        bones: Record<
            string,
            { position: number[]; quaternion: number[]; scale: number[]; inverse: number[] }
        >;
    },
): void;
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
