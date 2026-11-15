// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Dev only: `?shot=px,py,pz,tx,ty,tz,fov[,seconds]` pins the encounter to one
 * repeatable frame for before/after screenshots (`app/scripts/capture-shot.mjs`).
 * The camera sits at the given position, target and field of view and takes no
 * input; the deployment briefing is skipped; once the encounter is ready the
 * scene advances in fixed 1/60 s steps for `seconds` (3 by default), whatever
 * the wall clock did, and then holds that frame. `data-shot="ready"` on the
 * viewport marks the held frame. `&time=day` (morning, day, evening, night)
 * picks the time of day for the shot and `&weather=snow` (clear, rain, snow)
 * the weather. Without the parameter nothing here runs.
 */
export interface Shot {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** Fixed steps to simulate before the frame is held. */
  frames: number;
  /** A time-of-day preset to shoot in, as named in the URL; unchecked. */
  time: string | null;
  /** The weather to shoot in, as named in the URL; unchecked. */
  weather: string | null;
}

/** Seconds of scene time one shot step stands for. */
export const SHOT_STEP = 1 / 60;

function parse(): Shot | null {
  if (typeof location === "undefined") return null;
  const query = new URLSearchParams(location.search);
  const raw = query.get("shot");
  if (!raw) return null;
  const n = raw.split(",").map(Number);
  if (n.length < 7 || n.some((v) => !Number.isFinite(v))) return null;
  return {
    position: [n[0], n[1], n[2]],
    target: [n[3], n[4], n[5]],
    fov: n[6],
    frames: Math.round((n[7] ?? 3) / SHOT_STEP),
    time: query.get("time"),
    weather: query.get("weather"),
  };
}

export const shot = parse();

/** Dev only: `?noair` leaves out the street air (height fog, lamp volumes, weather): the original `FogExp2` look, for reference shots. */
export const noAir =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("noair");

/** Dev only: `?plain` draws the scene straight to the canvas, without the post pipeline, for A/B checks. */
export const plain =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("plain");

/** The idle poses' dice under `?shot=`: the same sequence on every load. */
export function shotRandom(): (() => number) | undefined {
  if (!shot) return undefined;
  let seed = 7;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
