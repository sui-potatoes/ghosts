// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The engine's procedural sounds, by generator name (`manifest.ts`). Two kinds:
 *
 * - `render`: a sound computed once into samples, in plain JS (seeded, so it
 *   is the same every load; runs in node for the tests). Beds are seamless
 *   loops with decorrelated lengths, normalised to `BED_RMS`; one-shots are
 *   normalised to `SHOT_PEAK`. All are stand-ins: quiet, dark, unshowy.
 * - `play`: a short node chain built per play — the combat tones that existed
 *   before the manifest, unchanged.
 *
 * Nothing here runs at import time.
 */

import { seeded } from "./ambience-model.ts";
import type { EngineGeneratorName } from "./manifest.ts";

/** Samples rendered at this rate: everything here is dark enough, and it halves the work. */
export const RENDER_RATE = 24000;
/** Beds come out at this RMS (−20 dBFS); the manifest's gain sets their level. */
export const BED_RMS = 0.1;
/** One-shots come out at this peak; the manifest's gain sets their level. */
export const SHOT_PEAK = 0.8;

export interface Rendered {
  kind: "render";
  /** Mono samples at `rate`. */
  render(rate: number): Float32Array;
}

export interface Played {
  kind: "play";
  /** Schedule the sound into `out` at `at`; returns its source and every node to unhook after. */
  play(ctx: BaseAudioContext, out: AudioNode, at: number): { source: AudioScheduledSourceNode; nodes: AudioNode[] };
}

export type Generator = Rendered | Played;

// === DSP helpers (all in place, no allocation beyond the output) ===

/** One-pole low-pass coefficient for `hz` at `rate`. */
const lpCoef = (hz: number, rate: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate);

function lowpass(x: Float32Array, hz: number, rate: number, passes = 1) {
  const a = lpCoef(hz, rate);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i] - y);
  }
}

function highpass(x: Float32Array, hz: number, rate: number, passes = 1) {
  const a = lpCoef(hz, rate);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += a * (x[i] - y);
      x[i] -= y;
    }
  }
}

/** A slow random walk in [lo, hi], `steps` control points per second, smoothly interpolated. */
function walk(n: number, rate: number, steps: number, lo: number, hi: number, random: () => number): Float32Array {
  const out = new Float32Array(n);
  const every = Math.max(1, Math.round(rate / steps));
  let from = lo + random() * (hi - lo),
    to = lo + random() * (hi - lo);
  for (let i = 0; i < n; i++) {
    const k = i % every;
    if (k === 0 && i > 0) {
      from = to;
      to = lo + random() * (hi - lo);
    }
    const t = k / every;
    out[i] = from + (to - from) * (t * t * (3 - 2 * t));
  }
  return out;
}

/**
 * A seamless loop of `seconds`: `fill` renders `seconds + fade` and the tail
 * is crossfaded (equal power) over the head, so the end runs into the start.
 */
function loop(seconds: number, rate: number, fill: (n: number) => Float32Array): Float32Array {
  const n = Math.round(seconds * rate),
    f = Math.round(Math.min(1.5, seconds / 4) * rate);
  const x = fill(n + f);
  const out = x.slice(0, n);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = x[i] * Math.sin((t * Math.PI) / 2) + x[n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function normaliseRms(x: Float32Array, target: number): Float32Array {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  const rms = Math.sqrt(sum / x.length) || 1;
  const k = target / rms;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

function normalisePeak(x: Float32Array, target: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const k = target / (peak || 1);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

function noise(n: number, random: () => number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = random() * 2 - 1;
  return x;
}

/** Brown noise: integrated white, leaking so it never drifts. */
function brown(n: number, random: () => number): Float32Array {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) x[i] = y = y * 0.996 + (random() * 2 - 1) * 0.06;
  return x;
}

/** A state-variable band-pass whose centre follows `centre` (Hz per sample). */
function bandSweep(x: Float32Array, centre: Float32Array, q: number, rate: number) {
  let low = 0,
    band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(centre[i], rate / 6)) / rate);
    low += f * band;
    const high = x[i] - low - damp * band;
    band += f * high;
    x[i] = band;
  }
}

/** Fade the ends of a one-shot so it starts and stops on silence. */
function edges(x: Float32Array, rate: number, attack: number, release: number) {
  const a = Math.round(attack * rate),
    r = Math.round(release * rate);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < r && i < x.length; i++) x[x.length - 1 - i] *= i / r;
}

// === Beds ===

function rain(seconds: number, seed: number): Rendered {
  return {
    kind: "render",
    render: (rate) =>
      normaliseRms(
        loop(seconds, rate, (n) => {
          const r = seeded(seed);
          const hiss = noise(n, r);
          highpass(hiss, 500, rate, 2);
          lowpass(hiss, 6000, rate);
          // Drops: sparse short bursts, most of them small.
          const drops = new Float32Array(n);
          const perSample = 140 / rate;
          for (let i = 0; i < n; i++) {
            if (r() >= perSample) continue;
            const amp = r() ** 2.5 * 1.6,
              len = Math.round((0.002 + r() * 0.004) * rate);
            for (let k = 0; k < len && i + k < n; k++) drops[i + k] += (r() * 2 - 1) * amp * (1 - k / len) ** 2;
          }
          highpass(drops, 900, rate);
          lowpass(drops, 4500, rate);
          const swell = walk(n, rate, 0.4, 0.8, 1, r);
          for (let i = 0; i < n; i++) hiss[i] = (hiss[i] * 0.7 + drops[i]) * swell[i];
          return hiss;
        }),
        BED_RMS,
      ),
  };
}

const city: Rendered = {
  kind: "render",
  render: (rate) =>
    normaliseRms(
      loop(19.3, rate, (n) => {
        const r = seeded(3);
        const rumble = brown(n, r);
        lowpass(rumble, 140, rate, 2);
        highpass(rumble, 25, rate);
        // Far traffic: a band of engines and tyres that swells and recedes; it carries on small speakers.
        const traffic = noise(n, r);
        highpass(traffic, 220, rate, 2);
        lowpass(traffic, 1400, rate, 2);
        // Wet roads far off: a thin hiss on top.
        const hiss = noise(n, r);
        highpass(hiss, 2000, rate, 2);
        lowpass(hiss, 6000, rate);
        const swell = walk(n, rate, 0.25, 0.35, 1, r);
        for (let i = 0; i < n; i++) rumble[i] = rumble[i] * 1.3 + traffic[i] * 1.1 * swell[i] + hiss[i] * 0.12;
        return rumble;
      }),
      BED_RMS,
    ),
};

const wind: Rendered = {
  kind: "render",
  render: (rate) =>
    normaliseRms(
      loop(23.7, rate, (n) => {
        const r = seeded(4);
        const x = noise(n, r);
        lowpass(x, 1500, rate);
        bandSweep(x, walk(n, rate, 0.3, 220, 650, r), 1.6, rate);
        const swell = walk(n, rate, 0.2, 0.35, 1, r);
        for (let i = 0; i < n; i++) x[i] *= swell[i];
        return x;
      }),
      BED_RMS,
    ),
};

const room: Rendered = {
  kind: "render",
  render: (rate) =>
    normaliseRms(
      loop(17.9, rate, (n) => {
        const r = seeded(5);
        const air = brown(n, r);
        lowpass(air, 260, rate, 2);
        // The air handling: a broad vent hiss, the part a laptop hears.
        const vent = noise(n, r);
        highpass(vent, 250, rate, 2);
        lowpass(vent, 2600, rate, 2);
        const breathe = walk(n, rate, 0.15, 0.8, 1, r);
        // Mains hum and the harmonics a ballast adds, low in the mix; whole cycles, so the loop stays seamless.
        for (let i = 0; i < n; i++) {
          const t = i / rate;
          const w = 2 * Math.PI * 50 * t;
          const hum = Math.sin(w) * 0.01 + Math.sin(2 * w) * 0.008 + Math.sin(3 * w) * 0.005 + Math.sin(4 * w) * 0.004 + Math.sin(6 * w) * 0.003;
          air[i] = (air[i] * 1 + vent[i] * 0.8) * breathe[i] + hum;
        }
        return air;
      }),
      BED_RMS,
    ),
};

// === One-shots ===

function shot(seconds: number, seed: number, fill: (x: Float32Array, rate: number, r: () => number) => void, attack = 0.005, release = 0.05): Rendered {
  return {
    kind: "render",
    render: (rate) => {
      const x = new Float32Array(Math.round(seconds * rate));
      fill(x, rate, seeded(seed));
      edges(x, rate, attack, release);
      return normalisePeak(x, SHOT_PEAK);
    },
  };
}

/** A few late copies, softer each: the street's walls answering a far sound. */
function echoes(x: Float32Array, rate: number, taps: readonly (readonly [number, number])[]) {
  const dry = x.slice();
  for (const [delay, gain] of taps) {
    const d = Math.round(delay * rate);
    for (let i = d; i < x.length; i++) x[i] += dry[i - d] * gain;
  }
}

const siren = shot(9, 6, (x, rate) => {
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    // A slow wail, drifting down as it passes.
    const f = (660 + 260 * Math.sin((2 * Math.PI * t) / 2.8)) * (1 - 0.05 * (t / 9));
    phase += (2 * Math.PI * f) / rate;
    const env = Math.min(1, t / 2.2) * Math.min(1, (9 - t) / 3.2);
    x[i] = (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) * env * env;
  }
  lowpass(x, 1400, rate, 2);
  echoes(x, rate, [[0.13, 0.35], [0.29, 0.22], [0.47, 0.12]]);
}, 0.05, 0.4);

const train = shot(10, 7, (x, rate, r) => {
  const rumble = brown(x.length, r);
  lowpass(rumble, 160, rate, 2);
  // The cars rolling: a band of noise in the midrange, which small speakers keep.
  const roll = noise(x.length, r);
  highpass(roll, 250, rate, 2);
  lowpass(roll, 1600, rate, 2);
  const clacks = new Float32Array(x.length);
  for (let t = 0.3; t < 9.7; t += 0.46) {
    for (const off of [0, 0.11]) {
      const at = Math.round((t + off) * rate),
        len = Math.round(0.03 * rate);
      for (let k = 0; k < len && at + k < x.length; k++) {
        const u = k / rate;
        // Steel on steel: a knock with a short ring in it.
        clacks[at + k] += ((r() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 1850 * u) * 0.4 + Math.sin(2 * Math.PI * 2730 * u) * 0.25) * (1 - k / len) ** 3;
      }
    }
  }
  lowpass(clacks, 3500, rate);
  for (let i = 0; i < x.length; i++) {
    const env = Math.sin((Math.PI * i) / x.length) ** 2;
    x[i] = (rumble[i] * 1.5 + roll[i] * 1.3 + clacks[i] * 0.6) * env;
  }
}, 0.3, 1);

const thunder = shot(7, 8, (x, rate, r) => {
  // The strike: a crackle of sparse snaps over the first second and a half.
  const crack = new Float32Array(x.length);
  for (let i = 0; i < 1.6 * rate; i++) {
    if (r() >= 120 / rate) continue;
    const t = i / rate,
      amp = Math.exp(-t / 0.5) * (0.3 + r() * 0.7),
      len = Math.round((0.003 + r() * 0.01) * rate);
    for (let k = 0; k < len && i + k < x.length; k++) crack[i + k] += (r() * 2 - 1) * amp * (1 - k / len);
  }
  lowpass(crack, 2600, rate, 2);
  highpass(crack, 200, rate);
  const rumble = brown(x.length, r);
  lowpass(rumble, 90, rate, 2);
  // The roll in the midrange, so it carries on small speakers.
  const roll = noise(x.length, r);
  highpass(roll, 150, rate, 2);
  lowpass(roll, 650, rate, 2);
  const swell = walk(x.length, rate, 3, 0.4, 1, r);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.6) * Math.exp(-t / 2.4) * swell[i];
    x[i] = crack[i] * 0.9 + rumble[i] * 2 * env + roll[i] * 1.8 * env;
  }
}, 0.02, 1);

const drip = shot(0.35, 9, (x, rate, r) => {
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    // A drop into a puddle: a click, then a bright plink that falls in pitch.
    const f = 1300 + 1500 * Math.exp(-t / 0.015);
    phase += (2 * Math.PI * f) / rate;
    x[i] = Math.sin(phase) * Math.exp(-t / 0.045) + (i < rate * 0.0015 ? (r() * 2 - 1) * 0.8 : 0);
  }
  // A smaller second drop.
  const at = Math.round(0.12 * rate);
  for (let i = at, p = 0; i < x.length; i++) {
    const t = (i - at) / rate;
    p += (2 * Math.PI * (1700 + 1200 * Math.exp(-t / 0.012))) / rate;
    x[i] += Math.sin(p) * 0.4 * Math.exp(-t / 0.03);
  }
}, 0.0005, 0.05);

const gust = shot(5, 10, (x, rate, r) => {
  const n = noise(x.length, r);
  lowpass(n, 1600, rate);
  const centre = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) centre[i] = 380 + 480 * Math.sin((Math.PI * i) / x.length);
  bandSweep(n, centre, 1.3, rate);
  for (let i = 0; i < x.length; i++) x[i] = n[i] * Math.sin((Math.PI * i) / x.length) ** 1.5;
}, 0.2, 0.6);

const knock = shot(0.9, 11, (x, rate, r) => {
  for (const [at, amp] of [[0, 1], [0.14, 0.7], [0.33, 0.45]] as const) {
    const start = Math.round(at * rate);
    for (let i = start; i < x.length; i++) {
      const t = (i - start) / rate;
      const body = Math.exp(-t / 0.05) * amp,
        ring = Math.exp(-t / 0.09) * amp;
      if (body < 1e-4 && ring < 1e-4) break;
      // A water pipe struck from inside: a thud, the pipe's metal ringing, and the strike itself.
      x[i] +=
        (Math.sin(2 * Math.PI * 118 * t) + 0.4 * Math.sin(2 * Math.PI * 236 * t)) * body +
        (0.35 * Math.sin(2 * Math.PI * 640 * t) + 0.25 * Math.sin(2 * Math.PI * 1490 * t) + 0.12 * Math.sin(2 * Math.PI * 2310 * t)) * ring +
        (t < 0.004 ? (r() * 2 - 1) * 0.8 * amp : 0);
    }
  }
  lowpass(x, 4000, rate);
}, 0.001, 0.1);

const relay = shot(0.5, 12, (x, rate, r) => {
  // A relay pulling in and its contact bouncing, then the unit's motor starting.
  for (const [at, amp] of [[0, 1], [0.012, 0.4], [0.075, 0.7]] as const) {
    const start = Math.round(at * rate),
      len = Math.round(0.006 * rate);
    for (let k = 0; k < len; k++) {
      const t = k / rate;
      x[start + k] += ((r() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * 2900 * t) * 0.5) * amp * (1 - k / len) ** 2;
    }
  }
  highpass(x, 600, rate);
  const motor = Math.round(0.075 * rate);
  for (let i = motor; i < x.length; i++) {
    const t = i / rate - 0.075;
    const env = Math.min(1, t / 0.04) * Math.exp(-t / 0.15);
    x[i] += (Math.sin(2 * Math.PI * 100 * t) * 0.15 + Math.sin(2 * Math.PI * 200 * t) * 0.12 + Math.sin(2 * Math.PI * 400 * t) * 0.06) * env;
  }
}, 0.0005, 0.08);

/** The ring in the ears after a flashbang: high tones near 5.6 kHz, one partial beating slowly against another, dying away. */
const ring = shot(3.2, 13, (x, rate) => {
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.9);
    x[i] = (Math.sin(2 * Math.PI * 5600 * t) + Math.sin(2 * Math.PI * 5606 * t) * 0.7 + Math.sin(2 * Math.PI * 4180 * t) * 0.18) * env;
  }
}, 0.02, 0.3);

/**
 * The smoke grenade: a pop as the canister vents, then a hiss that builds
 * for the second the cloud takes to billow out and dies away as it thins
 * (`Effects.smokeBurst`).
 */
const smoke = shot(4, 14, (x, rate, r) => {
  const hiss = noise(x.length, r);
  highpass(hiss, 1500, rate, 2);
  lowpass(hiss, 7000, rate);
  const flutter = walk(x.length, rate, 12, 0.75, 1, r);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.08) * (t < 1.1 ? 1 : Math.exp(-(t - 1.1) / 0.9));
    const pop = t < 0.03 ? (r() * 2 - 1) * (1 - t / 0.03) * 1.5 : 0;
    x[i] = hiss[i] * env * flutter[i] + pop;
  }
}, 0.002, 0.3);

// === The field's own sounds: steps, hits, falls (placeholders) ===

/** A footfall a cell: a heel on wet asphalt and the scuff after it. */
const step = shot(0.15, 15, (x, rate, r) => {
  for (const [at, amp] of [[0, 1]] as const) {
    const start = Math.round(at * rate);
    for (let i = start; i < x.length; i++) {
      const t = (i - start) / rate;
      if (t > 0.09) break;
      const heel = Math.exp(-t / 0.012),
        scuff = t > 0.01 ? Math.exp(-(t - 0.01) / 0.03) * 0.4 : 0;
      x[i] += ((r() * 2 - 1) * (heel * 0.6 + scuff) + Math.sin(2 * Math.PI * 90 * t) * heel * 0.8) * amp;
    }
  }
  highpass(x, 120, rate);
  lowpass(x, 5000, rate);
}, 0.001, 0.03);

/** A vault over low cover: a hand and a boot landing, the kit rattling. */
const vault = shot(0.6, 16, (x, rate, r) => {
  for (const [at, amp] of [[0, 0.6], [0.32, 1]] as const) {
    const start = Math.round(at * rate);
    for (let i = start; i < x.length; i++) {
      const t = (i - start) / rate;
      if (t > 0.25) break;
      const thud = Math.exp(-t / 0.025);
      x[i] += (Math.sin(2 * Math.PI * 75 * t) * thud + (r() * 2 - 1) * thud * 0.5 + (r() * 2 - 1) * Math.exp(-t / 0.08) * 0.2) * amp;
    }
  }
  highpass(x, 60, rate);
  lowpass(x, 6000, rate);
}, 0.001, 0.05);

/** A round striking a body: a sharp crack of armour, a smack, a dull thump under them. */
const hit = shot(0.4, 17, (x, rate, r) => {
  const smack = noise(x.length, r);
  highpass(smack, 300, rate, 2);
  lowpass(smack, 1400, rate, 2);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const crack = Math.exp(-t / 0.006),
      thump = Math.exp(-t / 0.05);
    x[i] = (r() * 2 - 1) * crack * 0.9 + smack[i] * Math.exp(-t / 0.03) * 3 + Math.sin(2 * Math.PI * (95 + 60 * Math.exp(-t / 0.02)) * t) * thump * 0.7;
  }
  lowpass(x, 7000, rate);
}, 0.0005, 0.08);

/** A miss: the round snapping past and striking something hard behind. */
const miss = shot(0.5, 18, (x, rate, r) => {
  const whiz = noise(x.length, r);
  bandSweep(whiz, Float32Array.from({ length: x.length }, (_, i) => 3800 - 2400 * Math.min(1, i / (0.12 * rate))), 3, rate);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const snap = t < 0.12 ? Math.sin((Math.PI * t) / 0.12) : 0;
    const strike = t > 0.13 ? Math.exp(-(t - 0.13) / 0.02) : 0;
    x[i] = whiz[i] * snap * 1.5 + (r() * 2 - 1) * strike * 0.7;
  }
  highpass(x, 300, rate);
}, 0.002, 0.05);

/** A body going down: knees, then the fall, and the kit settling. */
const down = shot(1.2, 19, (x, rate, r) => {
  for (const [at, amp, tone] of [[0, 0.5, 110], [0.38, 1, 70], [0.55, 0.35, 160]] as const) {
    const start = Math.round(at * rate);
    for (let i = start; i < x.length; i++) {
      const t = (i - start) / rate;
      if (t > 0.5) break;
      const thud = Math.exp(-t / 0.05);
      x[i] += (Math.sin(2 * Math.PI * tone * t) * thud + (r() * 2 - 1) * thud * 0.45 + (r() * 2 - 1) * Math.exp(-t / 0.15) * 0.12) * amp;
    }
  }
  highpass(x, 50, rate);
  lowpass(x, 5000, rate);
}, 0.002, 0.1);

/** The kit shifting: webbing, a rifle settled against cover. */
const gear = shot(0.7, 20, (x, rate, r) => {
  const rustle = noise(x.length, r);
  highpass(rustle, 1200, rate);
  lowpass(rustle, 6000, rate);
  const grain = walk(x.length, rate, 40, 0, 1, r);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const env = Math.sin(Math.PI * Math.min(1, t / 0.6)) ** 2;
    const clink = t > 0.42 && t < 0.5 ? Math.sin(2 * Math.PI * 2100 * (t - 0.42)) * Math.exp(-(t - 0.42) / 0.02) * 0.5 : 0;
    x[i] = rustle[i] * env * grain[i] ** 2 + clink;
  }
}, 0.01, 0.05);

/** Cover breaking: a crunch, then debris falling. */
const debris = shot(1.4, 21, (x, rate, r) => {
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const crunch = Math.exp(-t / 0.06);
    x[i] = (r() * 2 - 1) * crunch;
  }
  for (let k = 0; k < 26; k++) {
    const start = Math.round((0.08 + r() * 1.1) * rate),
      amp = 0.15 + r() * 0.35,
      tone = 500 + r() * 2500;
    for (let i = start; i < x.length; i++) {
      const t = (i - start) / rate;
      if (t > 0.05) break;
      x[i] += ((r() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * tone * t) * 0.4) * amp * Math.exp(-t / 0.012);
    }
  }
  highpass(x, 80, rate);
  lowpass(x, 6500, rate);
}, 0.001, 0.15);

/** A side's turn starting: two low radio blips. */
const turn = shot(0.5, 22, (x, rate) => {
  for (const [at, f] of [[0, 620], [0.16, 820]] as const) {
    const start = Math.round(at * rate),
      len = Math.round(0.09 * rate);
    for (let k = 0; k < len; k++) {
      const t = k / rate;
      const env = Math.min(1, t / 0.005) * Math.min(1, (len - k) / (0.02 * rate));
      x[start + k] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t)) * env;
    }
  }
  highpass(x, 300, rate);
  lowpass(x, 3400, rate);
}, 0.002, 0.05);

// === The combat tones that predate the manifest, as they were ===

/** A fresh noise burst of `seconds`, shaped by `env(i, n)`, through one filter and a gain. */
function burst(seconds: number, env: (i: number, n: number) => number, filter: BiquadFilterOptions, level: number): Played {
  return {
    kind: "play",
    play(ctx, out, at) {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * env(i, data.length);
      const source = new AudioBufferSourceNode(ctx, { buffer });
      const shape = new BiquadFilterNode(ctx, filter);
      const gain = new GainNode(ctx, { gain: level });
      source.connect(shape).connect(gain).connect(out);
      source.start(at);
      return { source, nodes: [shape, gain] };
    },
  };
}

const decay = (i: number, n: number) => Math.pow(1 - i / n, 3);
/** Measured against the interface tick at default settings (`/sounds`, Measure). */
const CLICK_LEVEL = 0.19;
const LOCK_LEVEL = 0.45;

export const ENGINE_GENERATORS = {
  // The click and the lock as they were, brought up to an interface tick's loudness.
  "tone.click": burst(0.05, decay, { type: "lowpass", frequency: 2800 }, CLICK_LEVEL),
  "tone.lock": burst(0.03, decay, { type: "bandpass", frequency: 650, Q: 0.7 }, LOCK_LEVEL),
  "tone.smoke": smoke,
  "tone.ring": ring,
  "bed.rain.a": rain(13.7, 1),
  "bed.rain.b": rain(17.3, 2),
  "bed.city": city,
  "bed.wind": wind,
  "bed.room": room,
  "shot.siren": siren,
  "shot.train": train,
  "shot.thunder": thunder,
  "shot.drip": drip,
  "shot.gust": gust,
  "shot.knock": knock,
  "shot.relay": relay,
  "unit.step": step,
  "unit.vault": vault,
  "unit.hit": hit,
  "unit.miss": miss,
  "unit.down": down,
  "unit.gear": gear,
  "field.debris": debris,
  "field.turn": turn,
} satisfies Record<EngineGeneratorName, Generator>;
