// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The pace of the QA "growing" source: a recorded game released as if it were
 * being played now. The first turns are out at once (so there is a past to
 * rewind into), then one event at a time, a turn's opening slower than the
 * moves inside it. Plain TypeScript, tested in `tests/watch-viewer.test.ts`.
 */

import type { GameEvent } from "@ghosts/engine";

export interface DripPace {
    /** Turns out at once when the source opens. */
    turns: number;
    /** Ms between two events. */
    step: number;
    /** Ms before an event that opens a turn. */
    turn: number;
}

export const DEFAULT_PACE: DripPace = { turns: 3, step: 1500, turn: 3500 };

const opens = (e: GameEvent) => e.type === "turn" || e.type === "hostile-phase";

/** How many events are out when the source opens: everything before the opening of turn `turns + 1`. */
export function initialRelease(events: readonly GameEvent[], turns: number): number {
    let seen = 0;
    for (let i = 0; i < events.length; i++) {
        if (!opens(events[i])) continue;
        if (++seen === turns) return i;
    }
    return events.length;
}

/** Ms to wait before releasing `next`. */
export function delayBefore(next: GameEvent, pace: DripPace): number {
    return opens(next) ? pace.turn : pace.step;
}

/** A `?pace=` override: "fast" for a quick look, else the default. */
export function paceOf(param: string | null): DripPace {
    return param === "fast" ? { turns: 3, step: 300, turn: 900 } : DEFAULT_PACE;
}
