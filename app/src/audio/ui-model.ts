// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The interface sounds' pure rules (tested in `tests/tactile.test.ts`): the
 * pan from where the row is, the pitch from how high it sits, the small
 * random detune that keeps repeats from sounding identical, and the gate
 * that keeps a sweep from spamming ticks. No Web Audio here.
 */

/** The furthest a sound leans toward a screen edge (-1 is hard left). */
export const PAN_MAX = 0.3;
/** Random detune each play, as a share of the rate (±). */
export const JITTER = 0.025;
/** The least gap between two ticks from any source; a pointer sweep is limited further. */
export const TICK_GAP_MS = 28;
/** The least gap between a counter's clicks. */
export const COUNT_GAP_MS = 40;

/** A sound's pan from the horizontal centre of its row in a viewport `width` wide. */
export function panFor(centerX: number, width: number): number {
    if (!(width > 0) || !Number.isFinite(centerX)) return 0;
    const t = Math.max(0, Math.min(1, centerX / width));
    return (t * 2 - 1) * PAN_MAX;
}

/** The tick's rate from the vertical centre of its row: a four-semitone fall top to bottom. */
export function pitchFor(centerY: number, height: number): number {
    if (!(height > 0) || !Number.isFinite(centerY)) return 1;
    const v = Math.max(0, Math.min(1, centerY / height));
    return 2 ** (((0.5 - v) * 4) / 12);
}

/** `rate` detuned by up to ±JITTER; `rand` is 0 to 1. */
export function jitter(rate: number, rand: () => number = Math.random): number {
    return rate * (1 + (rand() * 2 - 1) * JITTER);
}

/** Lets one event through per `gap` ms; the rest are dropped, not queued. */
export class RateGate {
    private last = -Infinity;
    private readonly gap: number;

    constructor(gap: number) {
        this.gap = gap;
    }

    take(now: number): boolean {
        if (now - this.last < this.gap) return false;
        this.last = now;
        return true;
    }
}
