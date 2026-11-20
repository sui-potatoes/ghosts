// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allLooks,
  drawLook,
  gameLook,
  CLOCKS,
  lookClock,
  lookSetting,
  lookFor,
  lookName,
  lookOfGame,
  parseLook,
  RAINY_NIGHT,
  TIME_PRESETS,
  TIMES,
  WEATHER_PARAMS,
  WEATHERS,
} from "./scene-look.ts";
import { timePresets } from "./scene-weather.ts";

const key = (l: { time: string; weather: string }) => `${l.time} ${l.weather}`;

test("byte 0 picks the time, byte 1 the weather from that time's list", () => {
  for (let b0 = 0; b0 < 256; b0++)
    for (let b1 = 0; b1 < 256; b1++) {
      const look = lookFor(b0, b1);
      const time = TIMES[b0 % TIMES.length];
      assert.equal(look.time, time);
      assert.equal(look.weather, WEATHERS[time][b1 % WEATHERS[time].length]);
    }
});

test("every two-byte value gives a shipped look, and every shipped look is given", () => {
  const shipped = new Set(allLooks().map(key));
  const seen = new Set<string>();
  for (let v = 0; v < 65536; v++) {
    const look = lookFor(v >> 8, v & 0xff);
    assert(shipped.has(key(look)), key(look));
    seen.add(key(look));
  }
  assert.deepEqual([...seen].sort(), [...shipped].sort());
});

test("the table has no duplicate entries, and today's rainy night is one of them", () => {
  const looks = allLooks().map(key);
  assert.equal(new Set(looks).size, looks.length);
  for (const time of TIMES) assert.equal(new Set(WEATHERS[time]).size, WEATHERS[time].length);
  assert(looks.includes(key(RAINY_NIGHT)));
  assert.equal(key(lookFor(0, 0)), key(RAINY_NIGHT));
});

test("a game's look is its ID's first two bytes, the same on every read", () => {
  const id = "0x0105" + "ab".repeat(30);
  assert.deepEqual(lookOfGame(id), lookFor(0x01, 0x05));
  assert.deepEqual(lookOfGame(id), lookOfGame(id.toUpperCase().replace("0X", "0x")));
  assert.equal(key(lookOfGame("0x" + "0".repeat(64))), key(RAINY_NIGHT));
  // Only the first two bytes count.
  assert.deepEqual(lookOfGame("0x0105" + "cd".repeat(30)), lookOfGame(id));
});

test("an offline game's look is drawn from two random bytes", () => {
  const rolls = [0.99, 0.5];
  const look = drawLook(() => rolls.shift()!);
  assert.deepEqual(look, lookFor(253, 128));
  const shipped = new Set(allLooks().map(key));
  for (let i = 0; i < 200; i++) assert(shipped.has(key(drawLook())));
});

test("looks have plain names, render with known presets and parse back from a query", () => {
  assert.equal(lookName(RAINY_NIGHT), "Night · Heavy rain");
  for (const look of allLooks()) {
    assert.match(lookName(look), /^[A-Z][a-z ]+ · [A-Z][a-z ]+$/);
    assert(Object.hasOwn(timePresets, TIME_PRESETS[look.time]));
    const w = WEATHER_PARAMS[look.weather];
    assert(w.amount >= 0 && w.amount <= 1 && w.fog > 0);
    assert.deepEqual(parseLook(look.time, look.weather), { time: look.time, weather: look.weather });
  }
  assert.equal(parseLook("noon", "clear"), null);
  assert.equal(parseLook("night", null), null);
});

test("a scenario's look: fixed, drawn afresh for each game, or none (the map's own)", async () => {
  const { blackRain } = await import("./scenario.ts");
  assert.equal(gameLook(blackRain), null);
  const fixed = { time: "dusk", weather: "fog" } as const;
  assert.deepEqual(gameLook({ ...blackRain, look: fixed }), fixed);
  const drawn = new Set<string>();
  for (let i = 0; i < 300; i++) drawn.add(key(gameLook({ ...blackRain, look: "drawn" })!));
  assert(drawn.size > 1, "each match draws its own");
});

test("the setting line writes the look's clock and weather between the scenario's place and its rest", () => {
  const scene = { place: "Kōra Industrial District", rest: "Nobody owns this city. Everybody pays." };
  const authored = "Kōra Industrial District / 02:14 AM / Heavy rainfall. Nobody owns this city. Everybody pays.";
  // Today's look reads as the line always did.
  assert.equal(lookSetting(authored, scene, lookFor(0, 0)), authored);
  assert.equal(lookSetting(authored, scene, RAINY_NIGHT), authored);
  assert.equal(
    lookSetting(authored, scene, { time: "dusk", weather: "snow", seed: 200 }),
    "Kōra Industrial District / 06:20 PM / Snowfall. Nobody owns this city. Everybody pays.",
  );
  // No look, or a scenario with no scene: the authored line.
  assert.equal(lookSetting(authored, scene, null), authored);
  assert.equal(lookSetting("After hours.", undefined, RAINY_NIGHT), "After hours.");
});

test("the clock is the same for the same bytes, always inside its time of day's hours", () => {
  const hours: Record<string, [number, number]> = { night: [0, 4], dawn: [6, 7], day: [10, 15], dusk: [18, 20] };
  for (let v = 0; v < 65536; v += 7) {
    const look = lookFor(v >> 8, v & 0xff);
    const clock = lookClock(look);
    assert.equal(clock, lookClock(lookFor(v >> 8, v & 0xff)));
    const m = /^(\d\d):(\d\d) (AM|PM)$/.exec(clock);
    assert(m, clock);
    const hour = (Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0);
    const [lo, hi] = hours[look.time];
    assert(hour >= lo && hour <= hi, `${look.time} at ${clock}`);
    assert(Number(m[2]) < 60);
  }
  for (const [time, c] of Object.entries(CLOCKS)) assert(c.anchor < c.span, time);
  assert.equal(lookClock({ time: "night", weather: "fog" }), "02:14 AM");
  assert.equal(lookClock({ time: "night", weather: "fog", seed: 300 }), "02:14 AM", "the night's minutes wrap");
  assert.equal(lookClock({ time: "day", weather: "clear", seed: 125 }), "12:05 PM");
});
