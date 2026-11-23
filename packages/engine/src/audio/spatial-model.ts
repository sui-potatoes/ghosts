// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The spatial rules, no Web Audio: where a world point sits relative to the
 * camera, how its pan is widened, what the panner's distance model and
 * equal-power law make of it, and which voice gives way when the pool is full.
 * Tested in `spatial-model.test.ts`.
 *
 * The camera is the ear. A point is taken into camera space (right, up,
 * back), its azimuth from the view direction is widened by `WIDTH` and the
 * point is handed to the panner on a horizontal circle at its true distance,
 * around a listener fixed at the origin. Widening keeps panning strong on a
 * narrow lens: the screen's edge is about 32 degrees off-centre, which an
 * equal-power panner alone would only lean slightly; widened 2.5 times it is
 * all but one speaker, and a quarter of the way out is some 6 dB to one
 * side. Distance stays true, so the fall-off is the manifest's.
 */

/** Azimuth multiplier: a shot at the screen's edge lands near one speaker. */
export const WIDTH = 2.5;
/** Time constant (s) for panner position changes: follows camera moves without zipper noise. */
export const POSITION_SMOOTH = 0.04;
/** The most voices sounding at once across combat and world one-shots. */
export const VOICE_CAP = 16;
/** World one-shots sounding at once, within the cap. */
export const WORLD_VOICE_CAP = 3;

/** Out-parameter for `toListener`: no allocation per frame. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where world point (`px`, `py`, `pz`) is for a listener at the origin facing
 * -z, given the camera's world matrix (column-major, three.js `elements`; a
 * rigid transform). Writes `out`; returns the azimuth before widening, in
 * radians (positive to the right).
 */
export function toListener(m: ArrayLike<number>, px: number, py: number, pz: number, out: Vec3, width = WIDTH): number {
  const dx = px - m[12],
    dy = py - m[13],
    dz = pz - m[14];
  const x = dx * m[0] + dy * m[1] + dz * m[2];
  const y = dx * m[4] + dy * m[5] + dz * m[6];
  const z = dx * m[8] + dy * m[9] + dz * m[10];
  const d = Math.sqrt(x * x + y * y + z * z);
  const az = Math.atan2(x, -z);
  const wide = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, az * width));
  const r = Math.max(d, 0.01);
  out.x = r * Math.sin(wide);
  out.y = 0;
  out.z = -r * Math.cos(wide);
  return az;
}

/** The panner's inverse distance model, as Web Audio computes it. */
export function distanceGain(d: number, ref: number, rolloff: number, max: number): number {
  const c = Math.max(ref, Math.min(d, max));
  return ref / (ref + rolloff * (c - ref));
}

/** Equal-power gains for a mono source at `azimuth` degrees (Web Audio's law). */
export function equalPower(azimuthDeg: number): { left: number; right: number } {
  const a = Math.max(-90, Math.min(90, azimuthDeg));
  const x = (a + 90) / 180;
  return { left: Math.cos((x * Math.PI) / 2), right: Math.sin((x * Math.PI) / 2) };
}

/** A sounding voice, as voice stealing sees it. */
export interface VoiceInfo {
  /** 0: world one-shot, 1: combat. Lower gives way first. */
  priority: number;
  /** Metres from the camera. */
  distance: number;
  /** Seconds since it started. */
  age: number;
}

/**
 * Which voice to stop for a new one when the pool is full: the lowest
 * priority, and among those the furthest and oldest (a metre counts as much
 * as 0.1 s). -1 for an empty pool.
 */
export function pickVictim(voices: readonly VoiceInfo[]): number {
  let best = -1,
    bestPriority = Infinity,
    bestScore = -Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    const score = v.distance * 0.1 + v.age;
    if (v.priority < bestPriority || (v.priority === bestPriority && score > bestScore)) {
      best = i;
      bestPriority = v.priority;
      bestScore = score;
    }
  }
  return best;
}
