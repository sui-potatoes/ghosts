// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What a place sounds like, no Web Audio: the beds and their levels, the
 * one-shots and how often they come, from the location and the scene look;
 * and a seeded scheduler that times and places the one-shots around the map.
 * Tested in `ambience-model.test.ts`.
 */

import type { LookTime, LookWeather, SceneLook } from "../scene-look.ts";
import type { SlotId } from "./manifest.ts";

export type Location = "street" | "office";

export type BedSlot = Extract<SlotId, `ambience.${string}.bed${string}`>;
export type OneShotSlot = Extract<SlotId, `ambience.${string}.oneshot.${string}`>;

export interface OneShotRule {
  slot: OneShotSlot;
  /** Average plays per minute. */
  perMinute: number;
  /** `near`: somewhere on the field; `far`: out past its edges. */
  range: "near" | "far";
}

export interface AmbiencePlan {
  /** Bed slots and their level (on top of the slot's own gain); beds left out are silent. */
  beds: Partial<Record<BedSlot, number>>;
  oneShots: OneShotRule[];
  /** The ambience bus low-pass, Hz: fog and snow muffle the city. */
  air: number;
}

/** Fade-in when ambience starts, fade-out when it stops, and the crossfade when the look changes (s). */
export const FADE_IN = 2.5;
export const FADE_OUT = 1.2;
export const CROSSFADE = 3;
/** Pan of the two rain layers: decorrelated left and right, so the bed is wide. */
export const RAIN_SPREAD = 0.6;

const RAIN: Record<LookWeather, number> = { "heavy-rain": 1, "light-rain": 0.4, clear: 0, fog: 0, snow: 0 };
const WIND: Record<LookWeather, number> = { "heavy-rain": 0.3, "light-rain": 0.5, clear: 0.8, fog: 0.5, snow: 0.9 };
const AIR: Record<LookWeather, number> = { "heavy-rain": 9000, "light-rain": 12000, clear: 16000, fog: 2600, snow: 4500 };
/** The city's hum by the clock: busier by day, thinner before dawn. */
const CITY: Record<LookTime, number> = { night: 0.75, dusk: 1, dawn: 0.6, day: 1 };
/** Sirens per minute by the clock. */
const SIRENS: Record<LookTime, number> = { night: 1.2, dusk: 0.8, dawn: 0.4, day: 0.3 };

/** The default look where a game has none: the street's own rainy night. */
const DEFAULT_LOOK: SceneLook = { time: "night", weather: "heavy-rain" };

export function ambiencePlan(location: Location, look: SceneLook | null): AmbiencePlan {
  const { time, weather } = look ?? DEFAULT_LOOK;
  const rain = RAIN[weather];
  if (location === "office") {
    const beds: AmbiencePlan["beds"] = { "ambience.office.bed": 1 };
    // Rain on the glass, faint and dull, when it rains outside.
    if (rain > 0) {
      beds["ambience.rain.bed.a"] = 0.25 * rain;
      beds["ambience.rain.bed.b"] = 0.25 * rain;
    }
    return {
      beds,
      oneShots: [
        { slot: "ambience.office.oneshot.knock", perMinute: 1.2, range: "near" },
        { slot: "ambience.office.oneshot.relay", perMinute: 1.5, range: "near" },
        { slot: "ambience.city.oneshot.siren", perMinute: SIRENS[time] * 0.4, range: "far" },
      ],
      // The building between the field and the city.
      air: 1400,
    };
  }
  const beds: AmbiencePlan["beds"] = {
    "ambience.city.bed": CITY[time],
    "ambience.wind.bed": WIND[weather],
  };
  if (rain > 0) {
    beds["ambience.rain.bed.a"] = rain;
    beds["ambience.rain.bed.b"] = rain;
  }
  const oneShots: OneShotRule[] = [
    { slot: "ambience.city.oneshot.siren", perMinute: SIRENS[time], range: "far" },
    { slot: "ambience.city.oneshot.train", perMinute: time === "night" ? 0.35 : 0.6, range: "far" },
  ];
  if (weather === "heavy-rain") oneShots.push({ slot: "ambience.rain.oneshot.thunder", perMinute: 0.5, range: "far" });
  if (rain > 0) oneShots.push({ slot: "ambience.rain.oneshot.drip", perMinute: 9 * rain, range: "near" });
  else oneShots.push({ slot: "ambience.wind.oneshot.gust", perMinute: weather === "fog" ? 0.6 : 1.2, range: "near" });
  return { beds, oneShots, air: AIR[weather] };
}

/** A small seeded generator (mulberry32): the same seed gives the same ambience. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The field in world metres. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface OneShot {
  slot: OneShotSlot;
  /** Seconds after the previous one. */
  delay: number;
  x: number;
  y: number;
  z: number;
  /** Rate multiplier from the slot's pitch variance. */
  rate: number;
}

/** No two one-shots closer than this (s): the world never chatters. */
export const MIN_GAP = 2.5;
/** How far past the field's edge a `far` sound sits (m). */
export const FAR_RANGE: readonly [number, number] = [35, 90];

/**
 * Times and places the plan's one-shots: exponential gaps at the plan's total
 * rate (never under `MIN_GAP`), the slot by its share of that rate, a point on
 * the field for `near` sounds or out past its edges for `far` ones.
 */
export class OneShotScheduler {
  private readonly random: () => number;
  constructor(seed: number) {
    this.random = seeded(seed);
  }

  next(plan: AmbiencePlan, bounds: Bounds, pitch: (slot: OneShotSlot) => number): OneShot | null {
    const rules = plan.oneShots.filter((r) => r.perMinute > 0);
    const total = rules.reduce((sum, r) => sum + r.perMinute, 0);
    if (!total) return null;
    const r = this.random;
    const delay = Math.max(MIN_GAP, (-Math.log(1 - r()) * 60) / total);
    let pick = r() * total,
      rule = rules[rules.length - 1];
    for (const candidate of rules) {
      pick -= candidate.perMinute;
      if (pick < 0) {
        rule = candidate;
        break;
      }
    }
    let x: number, z: number, y: number;
    if (rule.range === "near") {
      x = bounds.minX + r() * (bounds.maxX - bounds.minX);
      z = bounds.minZ + r() * (bounds.maxZ - bounds.minZ);
      y = 1 + r() * 4;
    } else {
      const cx = (bounds.minX + bounds.maxX) / 2,
        cz = (bounds.minZ + bounds.maxZ) / 2;
      const radius = Math.hypot(bounds.maxX - cx, bounds.maxZ - cz);
      const angle = r() * Math.PI * 2;
      const out = radius + FAR_RANGE[0] + r() * (FAR_RANGE[1] - FAR_RANGE[0]);
      x = cx + Math.cos(angle) * out;
      z = cz + Math.sin(angle) * out;
      y = 6 + r() * 14;
    }
    const variance = pitch(rule.slot);
    return { slot: rule.slot, delay, x, y, z, rate: 1 + (r() * 2 - 1) * variance };
  }
}
