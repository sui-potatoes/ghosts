// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game's look: its time of day and weather, from two bytes. A game on chain
 * takes the first two bytes of its ID, so both players and every spectator see
 * the same sky; an offline game draws two random bytes when it starts. Purely
 * visual: nothing here reaches the rules, the odds or line of sight.
 *
 * The rule: byte 0 picks the time, byte 1 the weather from that time's list.
 *
 *   time    = TIMES[byte0 % TIMES.length]
 *   weather = WEATHERS[time][byte1 % WEATHERS[time].length]
 *
 * Plain TypeScript with type-only imports: it runs in node.
 */

import type { TimeOfDay } from "./scene-weather.ts";
import type { Weather } from "./scene/precipitation.ts";
import type { Scenario } from "./scenario.ts";

export type LookTime = "night" | "dusk" | "dawn" | "day";
export type LookWeather = "heavy-rain" | "light-rain" | "clear" | "fog" | "snow";

export interface SceneLook {
  time: LookTime;
  weather: LookWeather;
  /** The two bytes it came from, as one number (byte 0 high): the briefing's clock. Absent: the time's own hour. */
  seed?: number;
}

export const TIMES: readonly LookTime[] = ["night", "dusk", "dawn", "day"];

/** The weathers each time of day comes in. */
export const WEATHERS: Readonly<Record<LookTime, readonly LookWeather[]>> = {
  night: ["heavy-rain", "light-rain", "clear", "fog", "snow"],
  dusk: ["heavy-rain", "light-rain", "clear", "fog", "snow"],
  // Rain barely shows against daylight: the bright times keep what reads.
  dawn: ["clear", "fog", "snow"],
  day: ["clear", "snow"],
};

/** Today's look, the street's own: a rainy night. */
export const RAINY_NIGHT: SceneLook = { time: "night", weather: "heavy-rain" };

/** The look two bytes stand for. */
export function lookFor(byte0: number, byte1: number): SceneLook {
  const time = TIMES[(byte0 & 0xff) % TIMES.length];
  const weathers = WEATHERS[time];
  return {
    time,
    weather: weathers[(byte1 & 0xff) % weathers.length],
    seed: ((byte0 & 0xff) << 8) | (byte1 & 0xff),
  };
}

/** The look of a game by its ID (`0x` and 64 hex digits): its first two bytes. */
export function lookOfGame(id: string): SceneLook {
  const hex = id.replace(/^0x/i, "").padStart(64, "0");
  return lookFor(parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0);
}

/** A fresh offline game's look: two random bytes. */
export function drawLook(random: () => number = Math.random): SceneLook {
  return lookFor(Math.floor(random() * 256), Math.floor(random() * 256));
}

/** The look a game of `scenario` is shown in: its own, a fresh draw, or null for the map's. */
export function gameLook(scenario: Scenario): SceneLook | null {
  const { look } = scenario;
  return look === "drawn" ? drawLook() : (look ?? null);
}

/** Every look the rule can give, in table order. */
export function allLooks(): SceneLook[] {
  return TIMES.flatMap((time) => WEATHERS[time].map((weather) => ({ time, weather })));
}

export const TIME_NAMES: Readonly<Record<LookTime, string>> = {
  night: "Night",
  dusk: "Dusk",
  dawn: "Dawn",
  day: "Overcast day",
};

export const WEATHER_NAMES: Readonly<Record<LookWeather, string>> = {
  "heavy-rain": "Heavy rain",
  "light-rain": "Light rain",
  clear: "Clear",
  fog: "Fog",
  snow: "Snow",
};

/** The look in plain words, sentence case: "Dusk · Light rain". */
export function lookName(look: SceneLook): string {
  return `${TIME_NAMES[look.time]} · ${WEATHER_NAMES[look.weather]}`;
}

/** How the scene renders a time of day: the lighting preset it starts from. */
export const TIME_PRESETS: Readonly<Record<LookTime, TimeOfDay>> = {
  night: "night",
  dusk: "evening",
  dawn: "morning",
  day: "overcast",
};

/**
 * How the scene renders a weather: what falls, how much of the full rain
 * (drops, splashes and ripples), and the fog's density as a multiple of the
 * time's own.
 */
export const WEATHER_PARAMS: Readonly<Record<LookWeather, { fall: Weather; amount: number; fog: number }>> = {
  "heavy-rain": { fall: "rain", amount: 1, fog: 1 },
  "light-rain": { fall: "rain", amount: 0.3, fog: 1 },
  clear: { fall: "clear", amount: 0, fog: 0.7 },
  fog: { fall: "clear", amount: 0, fog: 1.45 },
  snow: { fall: "snow", amount: 1, fog: 1 },
};

/** A look named in a query (`?time=dusk&weather=fog`); null when either is unknown. */
export function parseLook(time: string | null, weather: string | null): SceneLook | null {
  const t = TIMES.find((x) => x === time);
  const w = (Object.keys(WEATHER_NAMES) as LookWeather[]).find((x) => x === weather);
  return t && w ? { time: t, weather: w } : null;
}

// === The briefing's setting line ===

/**
 * The clock each time of day shows, in minutes after midnight: from `start`,
 * `span` minutes long, the seed's minute counted on from `anchor`. Night
 * opens on 02:14, the street's own hour, so today's look reads as it did.
 */
export const CLOCKS: Readonly<Record<LookTime, { start: number; span: number; anchor: number }>> = {
  night: { start: 0, span: 300, anchor: 134 },
  dawn: { start: 6 * 60, span: 120, anchor: 30 },
  day: { start: 10 * 60, span: 360, anchor: 0 },
  dusk: { start: 18 * 60, span: 180, anchor: 0 },
};

/** The weather as the briefing says it. */
export const WEATHER_LINES: Readonly<Record<LookWeather, string>> = {
  "heavy-rain": "Heavy rainfall",
  "light-rain": "Light rain",
  clear: "Clear sky",
  fog: "Thick fog",
  snow: "Snowfall",
};

/** The look's clock, as the briefing writes it: "02:14 AM". */
export function lookClock(look: SceneLook): string {
  const { start, span, anchor } = CLOCKS[look.time];
  const minutes = start + ((anchor + (look.seed ?? 0)) % span);
  const hour = Math.floor(minutes / 60),
    minute = minutes % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour % 12 || 12)}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

/** Where a scenario happens and the authored words after the weather. */
export interface SettingScene {
  place: string;
  rest: string;
}

/**
 * The briefing's setting line for a game shown in `look`: the place / the
 * clock / the weather, then the rest. Without a look or a scene: `fallback`,
 * the authored line.
 */
export function lookSetting(fallback: string, scene: SettingScene | undefined, look: SceneLook | null): string {
  if (!scene || !look) return fallback;
  return `${scene.place} / ${lookClock(look)} / ${WEATHER_LINES[look.weather]}. ${scene.rest}`;
}
