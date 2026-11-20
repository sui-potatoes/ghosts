// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `glicko::glicko`, ported to the bit: the same `UQ64_64` fixed-point steps (truncating
 * multiply and divide, five Newton steps for the square root, the expected-score table), so a
 * ranked game rates the same here as on chain. The sandbox rates with it, and a client can
 * show what a win or a loss would do before playing.
 */

/** `glicko::Rating`. */
export interface GlickoRating {
    rating: number;
    deviation: number;
    games: number;
    lastPlayedMs: number;
}

export type GlickoScore = "win" | "draw" | "loss";

const ONE = 18_446_744_073_709_551_616n;
const HALF = 9_223_372_036_854_775_808n;
const Q = 106_187_994_795_999_673n;
const Q2 = 611_267_234_680_495n;
const G_COEF = 185_802_959_218_819n;
const G_SEED = 23_058_430_092_136_939_520n;
const SQRT_STEPS = 5;
const E6 = 1_000_000n;
const E_STEP_E2 = 2_500n;
// prettier-ignore
const E_TABLE = [
    500000, 535916, 571463, 606288, 640065, 672510, 703385, 732507, 759747,
    785027, 808318, 829633, 849020, 866557, 882338, 896477, 909091, 920305,
    930242, 939022, 946760, 953565, 959537, 964769, 969347, 973346, 976836,
    979878, 982528, 984834, 986840, 988584, 990099, 991415, 992557, 993548,
    994408, 995154, 995801, 996362, 996848, 997269, 997634, 997951, 998225,
    998462, 998668, 998847, 999001, 999135, 999251, 999351, 999438, 999513,
    999578, 999635, 999684, 999726, 999763, 999795, 999822, 999846, 999867,
    999885, 999900, 999913, 999925, 999935, 999944, 999951, 999958, 999963,
    999968, 999973, 999976, 999979, 999982, 999985, 999987, 999988, 999990,
].map(BigInt);

export const DEFAULT_RATING = 1500;
export const MAX_DEVIATION = 350;
export const MIN_DEVIATION = 30;
const C2_PER_DAY = 1_200;
const MS_PER_DAY = 86_400_000;

/** `glicko::default()`: what a new `Account` starts with, and what a reset goes back to. */
export const defaultRating = (): GlickoRating => ({
    rating: DEFAULT_RATING,
    deviation: MAX_DEVIATION,
    games: 0,
    lastPlayedMs: 0,
});

// `std::uq64_64`, on raw values: truncating, as Move is
const mul = (a: bigint, b: bigint) => (a * b) >> 64n;
const div = (a: bigint, b: bigint) => (a << 64n) / b;
const quotient = (n: bigint, d: bigint) => (n << 64n) / d;
const fromInt = (n: number | bigint) => BigInt(n) << 64n;
const intMul = (n: bigint, x: bigint) => (n * x) >> 64n;

function sqrt(x: bigint, seed: bigint): bigint {
    let y = seed;
    for (let i = 0; i < SQRT_STEPS; i++) y = (y + div(x, y)) >> 1n;
    return y;
}

const round = (x: bigint) => (x + HALF) >> 64n;

/** `glicko::current_deviation`: the deviation grows back with the days since the last game. */
export function currentDeviation(r: GlickoRating, nowMs: number): number {
    if (nowMs <= r.lastPlayedMs) return r.deviation;
    const days = Math.floor((nowMs - r.lastPlayedMs) / MS_PER_DAY);
    if (days === 0) return r.deviation;
    const rd = BigInt(r.deviation);
    const growth = BigInt(C2_PER_DAY * days);
    const n = rd * rd + growth;
    const max = BigInt(MAX_DEVIATION);
    if (n >= max * max) return MAX_DEVIATION;
    let y = rd + growth / (2n * rd);
    if (y > max) y = max;
    for (;;) {
        const next = (y + n / y) / 2n;
        if (next >= y) return Number(y);
        y = next;
    }
}

function g(deviation: number): bigint {
    const rd2 = fromInt(BigInt(deviation) * BigInt(deviation));
    return div(ONE, sqrt(ONE + mul(G_COEF, rd2), G_SEED));
}

function expected(gValue: bigint, rating: number, opponent: number): bigint {
    const higher = rating >= opponent;
    const diff = BigInt(Math.abs(rating - opponent));
    const dE2 = intMul(diff * 100n, gValue);
    const last = E_TABLE.length - 1;
    const idx = Number(dE2 / E_STEP_E2);
    let eE6: bigint;
    if (idx >= last) eE6 = E_TABLE[last];
    else {
        const [lo, hi] = [E_TABLE[idx], E_TABLE[idx + 1]];
        eE6 = lo + ((hi - lo) * (dE2 % E_STEP_E2)) / E_STEP_E2;
    }
    const e = quotient(eE6, E6);
    return higher ? e : ONE - e;
}

function computeOne(
    player: GlickoRating,
    opponent: GlickoRating,
    score: GlickoScore,
    nowMs: number,
): GlickoRating {
    const rd = BigInt(currentDeviation(player, nowMs));
    const gValue = g(currentDeviation(opponent, nowMs));
    const e = expected(gValue, player.rating, opponent.rating);
    const s = score === "win" ? ONE : score === "draw" ? HALF : 0n;

    const a = quotient(1n, rd * rd) + mul(mul(mul(mul(Q2, gValue), gValue), e), ONE - e);
    const gain = s >= e;
    const delta = Number(round(div(mul(mul(Q, gValue), gain ? s - e : e - s), a)));
    const next = sqrt(div(ONE, a), fromInt(rd));
    const deviation = Math.min(Math.max(Number(round(next)), MIN_DEVIATION), MAX_DEVIATION);

    return {
        rating: gain ? player.rating + delta : player.rating - Math.min(delta, player.rating),
        deviation,
        games: player.games + 1,
        lastPlayedMs: nowMs,
    };
}

/** `glicko::compute`: both ratings after a game `a` scored `score` against `b`. */
export function computeRatings(
    a: GlickoRating,
    b: GlickoRating,
    score: GlickoScore,
    nowMs: number,
): [GlickoRating, GlickoRating] {
    const opposite: GlickoScore = score === "win" ? "loss" : score === "loss" ? "win" : "draw";
    return [computeOne(a, b, score, nowMs), computeOne(b, a, opposite, nowMs)];
}
