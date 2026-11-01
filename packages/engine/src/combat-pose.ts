// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { Weapon } from "./game";

export function aimClip(weapon: Weapon, covered: boolean) {
  return `${covered ? "covered" : "standing"}_${weapon}_fire`;
}
/** Build firing and cover-transition clips by cropping source tracks and combining poses. */
export function combatClips(source: T.AnimationClip[]): T.AnimationClip[] {
  const find = (name: string) => source.find((c) => c.name === name)!;
  const slice = (name: string, source: string, from: number, to: number) => {
    const tracks = find(source).tracks.map((original) => {
      // subclip drops constant tracks whose endpoint keys lie outside the crop.
      // Sample both crop boundaries so a held aim always owns its whole pose.
      const times = [
        from,
        ...Array.from(original.times).filter((t) => t > from && t < to),
        to,
      ];
      const size = original.getValueSize();
      const interpolant =
        original instanceof T.QuaternionKeyframeTrack
          ? new T.QuaternionLinearInterpolant(
              original.times,
              original.values,
              size,
            )
          : new T.LinearInterpolant(original.times, original.values, size);
      const track = original.clone();
      track.times = new Float32Array(times.map((t) => t - from));
      track.values = new Float32Array(
        times.flatMap((t) => Array.from(interpolant.evaluate(t))),
      );
      return track;
    });
    return new T.AnimationClip(name, to - from, tracks);
  };
  const crouch = slice("covered_rifle_fire", "crouch_shooting", 0.95, 1.45);
  const rifle = slice("standing_rifle_fire", "shooting", 0.12, 0.65);
  const sniper = rifle.clone();
  sniper.name = "standing_sniper_fire";
  const coveredSniper = crouch.clone();
  coveredSniper.name = "covered_sniper_fire";
  const pistol = find("pistol_shot").clone();
  pistol.name = "standing_pistol_fire";
  const coveredPistol = pistol.clone();
  coveredPistol.name = "covered_pistol_fire";
  // Preserve the crouched lower body while the independent pistol arm recoils.
  for (const track of coveredPistol.tracks) {
    if (!/(Hips|UpLeg|Leg|Foot|ToeBase)\./.test(track.name)) continue;
    const posture = crouch.tracks.find((t) => t.name === track.name);
    if (!posture) continue;
    const n = track.getValueSize();
    for (let i = 0; i < track.values.length; i += n)
      track.values.set(posture.values.slice(0, n), i);
  }
  // Swapping pelvis poses must not rotate the pistol's upper body. Rebase
  // the spine against the original pelvis at each key, preserving recoil.
  const pistolHips = pistol.tracks.find(t => t.name === "mixamorigHips.quaternion")!;
  const coveredHips = coveredPistol.tracks.find(t => t.name === pistolHips.name)!;
  const spine = coveredPistol.tracks.find(t => t.name === "mixamorigSpine.quaternion")!;
  const sampleHips = new T.QuaternionLinearInterpolant(pistolHips.times, pistolHips.values, 4);
  const inversePelvis = new T.Quaternion().fromArray(coveredHips.values).invert();
  for (let i = 0; i < spine.times.length; i++) {
    const q = inversePelvis.clone()
      .multiply(new T.Quaternion().fromArray(sampleHips.evaluate(spine.times[i])))
      .multiply(new T.Quaternion().fromArray(spine.values, i * 4));
    q.toArray(spine.values, i * 4);
  }
  const rise = slice("covered_rise", "crouch_shooting", 0.28, 0.94);
  const retreat = slice("covered_return", "crouch_shooting", 1.5, 2.25);
  return [
    crouch,
    rifle,
    sniper,
    coveredSniper,
    pistol,
    coveredPistol,
    rise,
    retreat,
  ];
}
