// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Loudness of rendered audio, no Web Audio: ITU-R BS.1770 K-weighting,
 * integrated (gated) and momentary (400 ms) loudness in LUFS, peak and RMS,
 * and the same through a 150 Hz high-pass, standing in for laptop speakers
 * that reproduce nothing below it. Tested in `loudness.test.ts`; the sound
 * audition screen measures every slot with it.
 */

export interface Loudness {
  /** Sample peak, dBFS. */
  peak: number;
  /** RMS over the whole render, both channels, dBFS. */
  rms: number;
  /** Gated integrated loudness, LUFS. */
  integrated: number;
  /** The loudest 400 ms, LUFS: what a one-shot is judged by. */
  momentary: number;
  /** `momentary` through a 150 Hz high-pass: what a laptop's speakers leave of it. */
  laptop: number;
  /** `integrated` through the same high-pass. */
  laptopIntegrated: number;
}

type Coefs = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** BS.1770's head stage, for any rate (libebur128's derivation): +4 dB above about 1.7 kHz. */
function shelf(rate: number): Coefs {
  const f0 = 1681.974450955533,
    g = 3.999843853973347,
    q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / rate),
    vh = 10 ** (g / 20),
    vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
}

/** BS.1770's RLB stage: a high-pass near 38 Hz. */
function rlb(rate: number): Coefs {
  const f0 = 38.13547087602444,
    q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / rate),
    a0 = 1 + k / q + k * k;
  return [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
}

/** RBJ high-pass. */
function highpass(rate: number, fc: number, q: number): Coefs {
  const w = (2 * Math.PI * fc) / rate,
    cos = Math.cos(w),
    alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function filter(x: Float32Array, [b0, b1, b2, a1, a2]: Coefs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

const db = (power: number) => (power > 0 ? 10 * Math.log10(power) : -Infinity);
const lufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

/** Mean square per 400 ms block (100 ms hop) of the K-weighted channels, summed over channels. */
function blocks(weighted: Float32Array[], rate: number): number[] {
  const size = Math.round(0.4 * rate),
    hop = Math.round(0.1 * rate);
  const n = weighted[0].length;
  const out: number[] = [];
  // A render shorter than one block is measured as one block of its own length, padded with silence.
  for (let start = 0; start === 0 || start + size <= n; start += hop) {
    let sum = 0;
    for (const ch of weighted) for (let i = start; i < Math.min(n, start + size); i++) sum += ch[i] * ch[i];
    out.push(sum / size);
    if (start + size >= n) break;
  }
  return out;
}

function gated(powers: number[]): number {
  const loud = powers.filter((p) => lufs(p) > -70);
  if (!loud.length) return -Infinity;
  const threshold = lufs(loud.reduce((a, b) => a + b, 0) / loud.length) - 10;
  const kept = loud.filter((p) => lufs(p) > threshold);
  return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/** Loudness of `channels` (one per speaker) at `rate`. */
export function measure(channels: Float32Array[], rate: number): Loudness {
  let peak = 0,
    sum = 0,
    count = 0;
  for (const ch of channels)
    for (let i = 0; i < ch.length; i++) {
      peak = Math.max(peak, Math.abs(ch[i]));
      sum += ch[i] * ch[i];
      count++;
    }
  const k = (x: Float32Array) => filter(filter(x, shelf(rate)), rlb(rate));
  const full = blocks(channels.map(k), rate);
  const small = blocks(
    channels.map((x) => k(filter(filter(x, highpass(rate, 150, Math.SQRT1_2)), highpass(rate, 150, Math.SQRT1_2)))),
    rate,
  );
  return {
    peak: 20 * Math.log10(peak || 1e-12),
    rms: db(sum / Math.max(1, count)),
    integrated: gated(full),
    momentary: lufs(Math.max(...full)),
    laptop: lufs(Math.max(...small)),
    laptopIntegrated: gated(small),
  };
}
