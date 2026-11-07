// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { equipmentPose, loadEquipmentPoses } from "./equipment-poses.ts";
import type { Sex } from "../types";

/** Captures use centimetres and Z-up; the native Squad rig uses metres and Y-up. */
export function nativeClip(source: T.AnimationClip, inPlace = false) {
  const clip = source.clone();
  const turn = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(1, 0, 0),
    Math.PI / 2,
  );
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
const cache = new Map<string, Promise<Map<string, T.AnimationClip>>>();
export function loadMotions(sex: Sex, model = "rifle") {
  const key = `${sex}/${model === "sniper" ? "sniper" : "rifle"}`;
  if (!cache.has(key)) {
    const request = (async () => {
      const base = `${import.meta.env.BASE_URL}squad/`;
      const [response, poses, smokingResponse] = await Promise.all([
        fetch(`${base}motions/${sex}.bin`),
        loadEquipmentPoses(sex, model),
        fetch(`${base}motions/${sex}-smoking.bin?v=3`),
      ]);
      if (!response.ok) throw Error("Motion library could not load.");
      const blob = await response.blob();
      const data = await new Response(
        blob.stream().pipeThrough(new DecompressionStream("gzip")),
      ).json();
      if (!smokingResponse.ok) throw Error("Smoking motion could not load.");
      const smoking = nativeClip(
        T.AnimationClip.parse(
          await new Response(
            (await smokingResponse.blob())
              .stream()
              .pipeThrough(new DecompressionStream("gzip")),
          ).json(),
        ),
      );
      const library = new Map<string, T.AnimationClip>(
        data.map((source: Parameters<typeof T.AnimationClip.parse>[0]) => {
          const clip = equipmentPose(
            nativeClip(T.AnimationClip.parse(source)),
            poses,
          );
          return [clip.name, clip];
        }),
      );
      library.set(smoking.name, smoking);
      return library;
    })().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, request);
  }
  return cache.get(key)!;
}

/** Combat uses the capture coordinate system; keep the corrected motion identical. */
export function captureClip(source: T.AnimationClip) {
  const clip = source.clone();
  const turn = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(1, 0, 0),
    -Math.PI / 2,
  );
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
