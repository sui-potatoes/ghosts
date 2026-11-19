// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The player's ranked rating, mocked on this device until the contract carries
 * the modes: one record in localStorage, read through `useRating`.
 *
 * The step is the contract's own Glicko update, ported to floating point:
 * `ghosts::account::rate_game` (move/packages/ghosts/sources/account.move:430-449)
 * calls `glicko::compute`, and `compute_one` there (packages/glicko/sources/glicko.move
 * :198-230 at rev a890a52 of sui-potatoes/app, the one pinned in
 * move/packages/ghosts/Move.lock; vendored copy under packages/ghosts/build/ghosts/
 * sources/dependencies/glicko/glicko.move) is what `applyResult` follows: same
 * constants (q, 3q^2/pi^2, the 25-point `E_TABLE` with linear interpolation, the
 * deviation bounds 30..350, `c^2` = 1200 per idle day), same rounding to the nearest
 * point. The chain does it in `uq64_64` fixed point, so a result can differ from
 * this one by a point at a rounding edge; the formula is the same.
 *
 * What the mock cannot know is the opponent's deviation (the AI has none): it is
 * a parameter with a default of an established player.
 */

import { useSyncExternalStore } from "react";

export const DEFAULT_RATING = 1500;
/** The deviation of a player who has never played; also its upper bound (glicko.move:71). */
export const DEFAULT_DEVIATION = 350;
/** The lower bound of the deviation (glicko.move:73). */
export const MIN_DEVIATION = 30;
/** What the mock assumes about an AI opponent's deviation: an established player. */
export const MOCK_OPPONENT_DEVIATION = 100;
/** Results kept on the device. */
export const HISTORY_MAX = 20;

const KEY = "ghosts:play-rating";
const MS_PER_DAY = 86_400_000;
/** `c^2`: growth of deviation^2 per idle day (glicko.move:76). */
const C2_PER_DAY = 1_200;
/** `q = ln(10) / 400` (glicko.move:36). */
const Q = Math.LN10 / 400;
const Q2 = Q * Q;
/** `3 q^2 / pi^2` (glicko.move:40). */
const G_COEF = (3 * Q2) / Math.PI ** 2;
/** `E(d)` for `d = 0, 25, ..., 2000`, in millionths (glicko.move:56-66). */
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
];

/** One line of the short history: a game or a reset. */
export type RatingEntry =
    | {
          kind: "game";
          at: number;
          /** The opponent's rating. */
          opponent: number;
          won: boolean;
          /** Points gained or lost. */
          delta: number;
          /** The rating after it. */
          rating: number;
      }
    | { kind: "reset"; at: number; from: number; to: number };

export type RatingState = {
    rating: number;
    /** Glicko deviation: how unsure the rating is; falls as games are played. */
    deviation: number;
    /** The highest it has been. */
    peak: number;
    games: number;
    wins: number;
    losses: number;
    /** Consecutive results: positive wins, negative losses, 0 for none yet. */
    streak: number;
    /** How many times the rating was reset to the default. */
    resets: number;
    /** When it was last reset, null when never. */
    lastResetAt: number | null;
    /** When the last game was rated, null when none; drives idle growth of the deviation. */
    lastPlayedAt: number | null;
    /** The last `HISTORY_MAX` entries, newest first. */
    history: RatingEntry[];
};

const fresh = (): RatingState => ({
    rating: DEFAULT_RATING,
    deviation: DEFAULT_DEVIATION,
    peak: DEFAULT_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    streak: 0,
    resets: 0,
    lastResetAt: null,
    lastPlayedAt: null,
    history: [],
});

// === Glicko step =============================================================

/** Deviation grown by idle days: `min(sqrt(RD^2 + c^2 * days), 350)` (glicko.move:136-156). */
export function currentDeviation(deviation: number, lastPlayedAt: number | null, now: number) {
    if (lastPlayedAt === null || now <= lastPlayedAt) return deviation;
    const days = Math.floor((now - lastPlayedAt) / MS_PER_DAY);
    if (days === 0) return deviation;
    return Math.min(Math.floor(Math.sqrt(deviation * deviation + C2_PER_DAY * days)), 350);
}

/** `g(RD) = 1 / sqrt(1 + 3 q^2 RD^2 / pi^2)` (glicko.move:233). */
const g = (deviation: number) => 1 / Math.sqrt(1 + G_COEF * deviation * deviation);

/** Expected score from the interpolated table, symmetric below zero (glicko.move:242-262). */
function expected(gOpponent: number, rating: number, opponent: number): number {
    const d = Math.abs(rating - opponent) * gOpponent;
    const at = d / 25;
    const idx = Math.floor(at);
    const last = E_TABLE.length - 1;
    const e =
        idx >= last ? E_TABLE[last] : E_TABLE[idx] + (E_TABLE[idx + 1] - E_TABLE[idx]) * (at - idx);
    return rating >= opponent ? e / 1e6 : 1 - e / 1e6;
}

/** `[rating, deviation]` after one game (`compute_one`, glicko.move:198-230). */
export function glickoStep(
    rating: number,
    deviation: number,
    opponent: number,
    opponentDeviation: number,
    score: 0 | 0.5 | 1,
): [number, number] {
    const go = g(opponentDeviation);
    const e = expected(go, rating, opponent);
    // A = 1 / RD^2 + q^2 g^2 E (1 - E)
    const a = 1 / (deviation * deviation) + Q2 * go * go * e * (1 - e);
    // |r' - r| = q g |s - E| / A, rounded to the nearest point
    const delta = Math.round((Q * go * Math.abs(score - e)) / a);
    const next = score >= e ? rating + delta : Math.max(0, rating - delta);
    const rd = Math.min(Math.max(Math.round(Math.sqrt(1 / a)), MIN_DEVIATION), DEFAULT_DEVIATION);
    return [next, rd];
}

/**
 * The state after a rated game against an opponent of this rating. Pure: the
 * clock and the opponent's deviation are parameters.
 */
export function applyResult(
    state: RatingState,
    opponent: number,
    won: boolean,
    opponentDeviation: number = MOCK_OPPONENT_DEVIATION,
    now: number = Date.now(),
): RatingState {
    const rd = currentDeviation(state.deviation, state.lastPlayedAt, now);
    const [rating, deviation] = glickoStep(
        state.rating,
        rd,
        opponent,
        opponentDeviation,
        won ? 1 : 0,
    );
    const entry: RatingEntry = {
        kind: "game",
        at: now,
        opponent,
        won,
        delta: rating - state.rating,
        rating,
    };
    return {
        ...state,
        rating,
        deviation,
        peak: Math.max(state.peak, rating),
        games: state.games + 1,
        wins: state.wins + (won ? 1 : 0),
        losses: state.losses + (won ? 0 : 1),
        streak: won ? Math.max(state.streak, 0) + 1 : Math.min(state.streak, 0) - 1,
        lastPlayedAt: now,
        history: [entry, ...state.history].slice(0, HISTORY_MAX),
    };
}

// === Reset ===================================================================

/** A rating can be reset to the default only from above it, never from below. */
export const canReset = (state: RatingState): boolean => state.rating > DEFAULT_RATING;

/** Why the reset row is inactive, or `undefined` when it can be pressed. */
export const resetDeny = (state: RatingState, inMatch: boolean): string | undefined =>
    inMatch
        ? "Not during a match"
        : canReset(state)
          ? undefined
          : `Only a rating above ${DEFAULT_RATING} can be reset`;

/**
 * Pure reset. From above the default: the rating becomes exactly the default and the
 * deviation goes back to a newcomer's (as `glicko::default()`, the contract's state for
 * a fresh account, so the rating finds its level again quickly); peak, games, wins,
 * losses and streak are kept; `resets` and `lastResetAt` are set and a history entry
 * records it. At or below the default the state is returned unchanged.
 */
export function resetState(state: RatingState, now: number = Date.now()): RatingState {
    if (!canReset(state)) return state;
    const entry: RatingEntry = { kind: "reset", at: now, from: state.rating, to: DEFAULT_RATING };
    return {
        ...state,
        rating: DEFAULT_RATING,
        deviation: DEFAULT_DEVIATION,
        resets: state.resets + 1,
        lastResetAt: now,
        history: [entry, ...state.history].slice(0, HISTORY_MAX),
    };
}

export function resetRating(): RatingState {
    const state = readRating();
    if (!canReset(state)) return state;
    const next = resetState(state);
    writeRating(next);
    return next;
}

// === Storage =================================================================

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown): number => (isNum(v) && v >= 0 ? Math.floor(v) : 0);
const stamp = (v: unknown): number | null => (isNum(v) && v >= 0 ? v : null);

function entryOf(raw: unknown): RatingEntry | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!isNum(r.at)) return null;
    if (r.kind === "reset" && isNum(r.from) && isNum(r.to))
        return { kind: "reset", at: r.at, from: r.from, to: r.to };
    if (
        r.kind === "game" &&
        isNum(r.opponent) &&
        typeof r.won === "boolean" &&
        isNum(r.delta) &&
        isNum(r.rating)
    )
        return {
            kind: "game",
            at: r.at,
            opponent: r.opponent,
            won: r.won,
            delta: r.delta,
            rating: r.rating,
        };
    return null;
}

/**
 * A stored value read defensively: anything that is not a usable record gives the default
 * state; a field that is missing or not a number falls back on its own default.
 */
export function parseRating(raw: string | null): RatingState {
    if (!raw) return fresh();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return fresh();
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return fresh();
    const d = data as Record<string, unknown>;
    if (!isNum(d.rating) || d.rating < 0) return fresh();
    const rating = Math.round(d.rating);
    const deviation = isNum(d.deviation)
        ? Math.min(Math.max(Math.round(d.deviation), MIN_DEVIATION), DEFAULT_DEVIATION)
        : DEFAULT_DEVIATION;
    const history = Array.isArray(d.history)
        ? d.history
              .map(entryOf)
              .filter((e): e is RatingEntry => e !== null)
              .slice(0, HISTORY_MAX)
        : [];
    return {
        rating,
        deviation,
        peak: Math.max(isNum(d.peak) ? Math.round(d.peak) : DEFAULT_RATING, rating),
        games: count(d.games),
        wins: count(d.wins),
        losses: count(d.losses),
        streak: isNum(d.streak) ? Math.trunc(d.streak) : 0,
        resets: count(d.resets),
        lastResetAt: stamp(d.lastResetAt),
        lastPlayedAt: stamp(d.lastPlayedAt),
        history,
    };
}

let cached: RatingState | null = null;
const listeners = new Set<() => void>();

export function readRating(): RatingState {
    if (cached) return cached;
    try {
        cached = parseRating(localStorage.getItem(KEY));
    } catch {
        cached = fresh();
    }
    return cached;
}

export function writeRating(next: RatingState): void {
    cached = next;
    try {
        localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        // Storage may be unavailable; the session keeps the value.
    }
    listeners.forEach((listener) => listener());
}

/** Drop the in-memory copy so the next read goes to storage (tests, other tabs). */
export function forgetRating(): void {
    cached = null;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useRating(): RatingState {
    return useSyncExternalStore(subscribe, readRating, readRating);
}
