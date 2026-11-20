// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Record sources over the device's recorded games (`journal.ts`): a recorded
 * one, complete, and the QA growing one that releases a recording's events
 * on a timer as if the game were being played now. The chain's live and
 * finished games are sources of the same interface (`RecordSource` from the
 * engine); the viewer takes any of them.
 */

import {
    recordedSource,
    scenarioById,
    type GameEvent,
    type RecordSource,
    type WatchOutcome,
    type WatchSide,
} from "@ghosts/engine";

import { delayBefore, initialRelease, type DripPace } from "./drip";
import type { LocalJournal } from "./journal";

/** The two sides of a game played in the demo: the player's squad and the hostiles. */
export const DEMO_SIDES: readonly [WatchSide, WatchSide] = [
    { name: "Ghosts" },
    { name: "Hostiles" },
];

/** How a recorded demo game ended, from where the field stood when the recording stopped. */
export function journalOutcome(journal: Pick<LocalJournal, "result">): WatchOutcome {
    if (journal.result === "victory") return { winner: 0 };
    if (journal.result === "defeat") return { winner: 1 };
    return { winner: null, reason: "Left before the end" };
}

/** A recorded game, whole: a replay. Null for a scenario this build no longer has. */
export function localSource(journal: LocalJournal): RecordSource | null {
    const scenario = scenarioById(journal.scenario);
    if (!scenario) return null;
    return recordedSource({
        scenario,
        sides: DEMO_SIDES,
        events: journal.events,
        outcome: () => journalOutcome(journal),
    });
}

/**
 * A source that grows on a timer: it starts with its first subscriber (or
 * `start`); `stop` holds it, and must be called on leave.
 */
export type GrowingSource = RecordSource & { start(): void; stop(): void };

/**
 * A recorded game released as if it were played now (QA only): the first
 * turns at once, then one event at a time; the turn in play has a clock.
 */
export function growingSource(
    journal: LocalJournal,
    pace: DripPace,
    now = () => Date.now(),
): GrowingSource | null {
    const scenario = scenarioById(journal.scenario);
    if (!scenario) return null;
    const all = journal.events;
    const events: GameEvent[] = all.slice(0, initialRelease(all, pace.turns));
    const listeners = new Set<() => void>();
    let timer = 0;
    let started = false;
    let deadline = now() + 90_000;
    const tell = () => {
        for (const listener of listeners) listener();
    };
    const next = () => {
        if (events.length >= all.length) return;
        timer = window.setTimeout(
            () => {
                const event = all[events.length];
                events.push(event);
                if (event.type === "turn" || event.type === "hostile-phase")
                    deadline = now() + 90_000;
                tell();
                next();
            },
            delayBefore(all[events.length], pace),
        );
    };
    return {
        scenario,
        sides: DEMO_SIDES,
        events: () => events,
        ended: () => events.length >= all.length,
        outcome: () => journalOutcome(journal),
        deadline: () => (events.length < all.length ? deadline : undefined),
        // The game goes on from the moment the viewer follows it, not while the field loads.
        subscribe(listener) {
            listeners.add(listener);
            if (!started) this.start();
            return () => void listeners.delete(listener);
        },
        start() {
            started = true;
            deadline = now() + 90_000;
            window.clearTimeout(timer);
            next();
        },
        stop() {
            window.clearTimeout(timer);
        },
    };
}
