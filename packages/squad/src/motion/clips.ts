// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { clearEquipment, motionSkeleton } from "./clearance.ts";
import type { Sex } from "../types";

/** Captures use centimetres and Z-up; the native Squad rig uses metres and Y-up. */
export function nativeClip(source: T.AnimationClip, inPlace = false) {
    const clip = source.clone();
    const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
    const v = new T.Vector3(),
        q = new T.Quaternion();
    for (const track of clip.tracks) {
        if (track.name.endsWith(".position")) {
            for (let i = 0; i < track.values.length; i += 3) {
                v.fromArray(track.values, i).multiplyScalar(0.01);
                if (track.name === "mixamorigHips.position") {
                    v.applyQuaternion(turn);
                    if (inPlace) {
                        v.x = 0;
                        v.z = 0;
                    }
                }
                v.toArray(track.values, i);
            }
        }
        if (track.name === "mixamorigHips.quaternion") {
            for (let i = 0; i < track.values.length; i += 4) {
                q.fromArray(track.values, i).premultiply(turn).toArray(track.values, i);
            }
        }
    }
    return clip;
}
const cache = new Map<Sex, Promise<Map<string, T.AnimationClip>>>();
export function loadMotions(sex: Sex) {
    if (!cache.has(sex)) {
        const request = (async () => {
            const base = `${import.meta.env.BASE_URL}squad/`;
            const [response, body, mount] = await Promise.all([
                fetch(`${base}motions/${sex}.bin`),
                fetch(`${base}body/${sex}/skin.glb`).then((r) => r.arrayBuffer()),
                fetch(`${base}body/${sex}/weapon-mount.json`).then((r) => r.json()),
            ]);
            const skeleton = motionSkeleton(body);
            if (!response.ok) throw Error("Motion library could not load.");
            const blob = await response.blob();
            const data = await new Response(
                blob.stream().pipeThrough(new DecompressionStream("gzip")),
            ).json();
            return new Map<string, T.AnimationClip>(
                data.map((source: Parameters<typeof T.AnimationClip.parse>[0]) => {
                    const clip = clearEquipment(
                        nativeClip(T.AnimationClip.parse(source)),
                        skeleton,
                        mount,
                    );
                    return [clip.name, clip];
                }),
            );
        })().catch((error) => {
            cache.delete(sex);
            throw error;
        });
        cache.set(sex, request);
    }
    return cache.get(sex)!;
}

/** Combat uses the capture coordinate system; keep the corrected motion identical. */
export function captureClip(source: T.AnimationClip) {
    const clip = source.clone();
    const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
    for (const track of clip.tracks) {
        if (track.name.endsWith(".position"))
            for (let i = 0; i < track.values.length; i += 3) {
                const v = new T.Vector3().fromArray(track.values, i);
                if (track.name === "mixamorigHips.position") v.applyQuaternion(turn);
                v.multiplyScalar(100).toArray(track.values, i);
            }
        if (track.name === "mixamorigHips.quaternion")
            for (let i = 0; i < track.values.length; i += 4)
                new T.Quaternion()
                    .fromArray(track.values, i)
                    .premultiply(turn)
                    .toArray(track.values, i);
    }
    return clip;
}
