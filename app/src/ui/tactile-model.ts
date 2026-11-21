// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The menu's physical feel, as pure rules (tested in `tests/tactile.test.ts`):
 * the cursor's detent travel, the hold that arms a dangerous answer, a
 * counter's steps as it rolls to a new value and which way a screen change
 * moves. No DOM, no React, no app imports.
 */

// === The cursor's detent ====================================================

/** The cursor's box, in the screen's own pixels. */
export type Box = { x: number; y: number; w: number; h: number };

/** One travel between targets: short and fast, like a selector into a detent. */
export const DETENT_MS = 80;
/** The most the cursor runs past its target before it settles, px. */
export const DETENT_OVERSHOOT_PX = 2.5;
/** The overshoot as a share of the distance, for short hops (capped above). */
export const DETENT_OVERSHOOT_RATIO = 0.06;
/** Where in the travel (0 to 1) the cursor is furthest past its target. */
export const DETENT_PEAK = 0.62;
/** The run in: fast out of the old row, decelerating into the overshoot. */
export const DETENT_EASE_IN = "cubic-bezier(0.25, 0.7, 0.35, 1)";
/** The settle back from the overshoot. */
export const DETENT_EASE_OUT = "cubic-bezier(0.4, 0, 0.6, 1)";

/** How far past the target a travel of `delta` px runs: a fixed small detent, never a bounce. */
export function overshoot(delta: number, max = DETENT_OVERSHOOT_PX): number {
    if (!delta) return 0;
    return Math.sign(delta) * Math.min(max, Math.abs(delta) * DETENT_OVERSHOOT_RATIO);
}

export type DetentFrame = Box & { offset: number; easing?: string };

/**
 * The cursor's keyframes from one target to the next: it runs a little past
 * along the way it travelled, then settles. Size overshoots less (a row
 * swelling reads as a bounce). `still` (reduced motion) is a plain cut.
 */
export function detentFrames(from: Box, to: Box, still = false): DetentFrame[] {
    if (still) return [];
    const peak: Box = {
        x: to.x + overshoot(to.x - from.x),
        y: to.y + overshoot(to.y - from.y),
        w: to.w + overshoot(to.w - from.w, 1.5),
        h: to.h + overshoot(to.h - from.h, 1.5),
    };
    return [
        { ...from, offset: 0, easing: DETENT_EASE_IN },
        { ...peak, offset: DETENT_PEAK, easing: DETENT_EASE_OUT },
        { ...to, offset: 1 },
    ];
}

/** Two boxes the same within a fraction of a pixel: a re-measure, not a move. */
export function sameBox(a: Box, b: Box): boolean {
    return (
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.w - b.w) < 0.5 &&
        Math.abs(a.h - b.h) < 0.5
    );
}

// === Hold to confirm ========================================================

/** How long a dangerous answer must be held. */
export const HOLD_MS = 900;
/** The rising ticks (and rumble steps) along the hold. */
export const HOLD_STEPS = 8;

export type HoldFrame = {
    /** 0 to 1 along the hold. */
    progress: number;
    /** 0 to HOLD_STEPS; a new step plays a tick. */
    step: number;
    /** This frame reached a new step. */
    stepped: boolean;
    /** The hold is complete: the answer runs now, still held or not. */
    done: boolean;
};

/**
 * One hold at a time. `begin` starts it (a key's auto-repeat or a second
 * press of the same answer is ignored), `frame` reads it, `release` before
 * completion cancels. Completion is reached while still held, not on release.
 */
export class HoldMachine {
    private start: number | null = null;
    private key: string | null = null;
    private last = 0;
    private readonly duration: number;

    constructor(duration = HOLD_MS) {
        this.duration = duration;
    }

    get active(): boolean {
        return this.start !== null;
    }

    /** True when this press started a hold; false while one is already running. */
    begin(key: string, now: number): boolean {
        if (this.start !== null) return false;
        this.start = now;
        this.key = key;
        this.last = 0;
        return true;
    }

    /** Which answer is being held. */
    get holding(): string | null {
        return this.key;
    }

    frame(now: number): HoldFrame {
        if (this.start === null) return { progress: 0, step: 0, stepped: false, done: false };
        const progress = Math.max(0, Math.min(1, (now - this.start) / this.duration));
        const step = Math.min(HOLD_STEPS, Math.floor(progress * HOLD_STEPS));
        const stepped = step > this.last;
        this.last = step;
        const done = progress >= 1;
        if (done) this.clear();
        return { progress, step, stepped, done };
    }

    /** Let go: "cancelled" before completion, "idle" when nothing was held. */
    release(): "cancelled" | "idle" {
        if (this.start === null) return "idle";
        this.clear();
        return "cancelled";
    }

    private clear() {
        this.start = null;
        this.key = null;
        this.last = 0;
    }
}

/** The playback rate of a hold's tick: rising a fifth from the first step to the last. */
export function holdRate(step: number): number {
    const s = Math.max(0, Math.min(HOLD_STEPS, step));
    return 0.7 * 2 ** ((s / HOLD_STEPS) * (7 / 12));
}

// === Counters ===============================================================

/** A roll never takes longer than this. */
export const COUNTER_MAX_MS = 600;
/** Never more clicks than this, however far the value moves. */
export const COUNTER_MAX_STEPS = 12;
/** The gap between clicks when there are few. */
export const COUNTER_STEP_MS = 45;

export type CounterStep = { at: number; value: number };

/**
 * The values a counter shows rolling from `from` to `to`: whole numbers,
 * easing out (big steps first, settling into the last), the last exactly
 * `to`, within COUNTER_MAX_MS. Empty when nothing changes.
 */
export function counterSteps(from: number, to: number): CounterStep[] {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
    const diff = to - from;
    if (diff === 0) return [];
    const n = Math.max(1, Math.min(COUNTER_MAX_STEPS, Math.round(Math.abs(diff))));
    const gap = Math.min(COUNTER_STEP_MS, COUNTER_MAX_MS / n);
    const steps: CounterStep[] = [];
    let prev = from;
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        // Few units: one click per unit. Many: eased, big steps first.
        const eased = Math.abs(diff) <= COUNTER_MAX_STEPS ? t : 1 - (1 - t) * (1 - t);
        const value = i === n ? to : Math.round(from + diff * eased);
        if (value === prev) continue;
        steps.push({ at: Math.round(i * gap), value });
        prev = value;
    }
    return steps;
}

// === Screen changes =========================================================

export type NavMotion = "in" | "back";

/**
 * Which way a route change moves: "back" when the new screen is an ancestor
 * of the old (going up), "in" otherwise; null for no motion (the first
 * screen, a query change, a switch between sibling sections of one place).
 */
export function navMotion(
    from: string | null,
    to: string,
    parentOf: (path: string) => string | null,
): NavMotion | null {
    if (from === null || from === to) return null;
    for (let p = parentOf(from); p !== null; p = parentOf(p)) if (p === to) return "back";
    const head = (path: string) => path.split("/")[1] ?? "";
    if (head(from) !== "" && head(from) === head(to) && parentOf(from) === parentOf(to))
        return null;
    return "in";
}
