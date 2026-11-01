// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { Sex } from "../types";

export interface EquipmentPoses {
    version: 1;
    sources: Record<string, string>;
    clips: Record<
        string,
        {
            duration: number;
            tracks: ReturnType<typeof T.KeyframeTrack.toJSON>[];
        }
    >;
}

/** Baked native-rig tracks. Collision fitting is an offline authoring operation. */
export function equipmentPose(source: T.AnimationClip, poses: EquipmentPoses) {
    const fitted = poses.clips[source.name];
    if (!fitted) throw Error(`Equipment pose missing: ${source.name}`);
    if (Math.abs(fitted.duration - source.duration) > 0.001)
        throw Error(`Equipment pose is stale: ${source.name}`);
    const clip = source.clone();
    const replacements = T.AnimationClip.parse({
        uuid: T.MathUtils.generateUUID(),
        blendMode: source.blendMode,
        name: source.name,
        duration: source.duration,
        tracks: fitted.tracks,
    }).tracks;
    const names = new Set(replacements.map((track) => track.name));
    clip.tracks = [...clip.tracks.filter((track) => !names.has(track.name)), ...replacements];
    return clip;
}

const cache = new Map<string, Promise<EquipmentPoses>>();
export function loadEquipmentPoses(sex: Sex, model = "rifle") {
    const key = `${sex}${model === "sniper" ? "-sniper" : ""}`;
    if (!cache.has(key)) {
        const request = (async () => {
            const response = await fetch(
                `${import.meta.env.BASE_URL}squad/motions/${key}-equipment.bin?v=6`,
            );
            if (!response.ok) throw Error("Equipment poses could not load.");
            const blob = await response.blob();
            const data: EquipmentPoses = await new Response(
                blob.stream().pipeThrough(new DecompressionStream("gzip")),
            ).json();
            if (data.version !== 1) throw Error("Unsupported equipment pose format.");
            return data;
        })().catch((error) => {
            cache.delete(key);
            throw error;
        });
        cache.set(key, request);
    }
    return cache.get(key)!;
}
