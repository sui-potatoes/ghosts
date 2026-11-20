// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A ranked match between the match and the first turn, apart from the screen.
 * The player who found the match is on the map already and waits for the other
 * squad; the player who was found shows theirs, which this device does at once
 * with the salt it kept. Tested in `tests/play-ranked.test.ts`.
 */

import { clock } from "./search.ts";

export type WaitingPhase =
    /** Found waiting: the squad is being shown. */
    | "revealing"
    /** Found waiting, and the squad and salt are not on this device. */
    | "lost"
    /** Found waiting, past the reveal limit. */
    | "late"
    /** The reveal failed and is tried again; `line` says why. */
    | "failed"
    /** The finder: on the map, the other squad not shown yet. */
    | "waiting"
    /** The finder, past the reveal limit: the match is theirs. */
    | "called";

export type WaitingInput = {
    phase: WaitingPhase;
    line?: string;
    /** The reveal limit, ms. */
    deadline: number;
    now: number;
    /** `Ranked 3x3`. */
    title: string;
    busy: boolean;
};

export type WaitingView = {
    headline: string;
    note: string;
    /** The clock to the reveal limit; null where it no longer matters. */
    left: string | null;
    /** The one action: Continue once the limit is out, else none (Back leaves the match). */
    action: { label: string; deny?: string } | null;
    pending: boolean;
};

export function waitingView(w: WaitingInput): WaitingView {
    const left = Math.max(0, w.deadline - w.now);
    switch (w.phase) {
        case "revealing":
            return {
                headline: "Opponent found",
                note: "Showing your squad. The match starts as soon as it is in.",
                left: clock(left),
                action: null,
                pending: true,
            };
        case "failed":
            return {
                headline: "Opponent found",
                note: `${w.line ?? "Could not show the squad"}. Trying again.`,
                left: clock(left),
                action: null,
                pending: true,
            };
        case "lost":
            return {
                headline: "Opponent found",
                note: "This squad can no longer be shown; the match is forfeit.",
                left: null,
                action: null,
                pending: w.busy,
            };
        case "late":
            return {
                headline: "Opponent found",
                note: "The time to show the squad is over; the match goes to your opponent.",
                left: null,
                action: null,
                pending: w.busy,
            };
        case "waiting":
            return {
                headline: "Opponent found",
                note: "Your squad is in. Waiting for your opponent to show theirs.",
                left: clock(left),
                action: null,
                pending: true,
            };
        case "called":
            return {
                headline: "Opponent never showed",
                note: "Your opponent did not show a squad in time. The match is yours.",
                left: null,
                action: { label: "Continue", deny: w.busy ? "Saving a change" : undefined },
                pending: false,
            };
    }
}
