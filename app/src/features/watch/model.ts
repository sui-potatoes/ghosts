// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The viewer's controls as plain data: what the transport, the scrubber, the
 * Live chip and the end-of-game banner say for a playback state, the focus
 * order, and the keys. The screen only draws this. Plain TypeScript, tested
 * in `tests/watch-viewer.test.ts`.
 */

import type { PlaybackState, Speed, WatchSide } from "@ghosts/engine";

/** The speeds in order, as the engine has them (`SPEEDS`), without loading it. */
export const SPEED_STEPS: readonly Speed[] = [0.5, 1, 2, 4];

export const speedLabel = (speed: Speed) => `${speed}x`;

/** The next speed up, wrapping from 4x to 0.5x: one press of the speed control. */
export function cycleSpeed(speed: Speed): Speed {
    return SPEED_STEPS[(SPEED_STEPS.indexOf(speed) + 1) % SPEED_STEPS.length];
}

const two = (n: number) => String(n).padStart(2, "0");

/** The turn readout: "Turn 07 of 18" and whose it is. */
export function turnReadout(
    state: Pick<PlaybackState, "turns" | "turn">,
    sides: readonly [WatchSide, WatchSide],
) {
    const mark = state.turns[state.turn];
    return {
        turn: `Turn ${two(state.turn + 1)} of ${two(state.turns.length)}`,
        side: mark ? sides[mark.side].name : "",
    };
}

/** One turn on the scrubber. */
export interface Pip {
    /** Its index into `turns`; the number shown is one more. */
    index: number;
    number: number;
    side: 0 | 1;
    /** Units that fell in it. */
    kills: number;
    /** Where the viewer is. */
    current: boolean;
    /** Already played to the viewer. */
    past: boolean;
    /** The newest turn of a game still being played. */
    edge: boolean;
}

export function pipsOf(state: Pick<PlaybackState, "turns" | "turn" | "growing">): Pip[] {
    return state.turns.map((mark, index) => ({
        index,
        number: index + 1,
        side: mark.side,
        kills: mark.kills,
        current: index === state.turn,
        past: index < state.turn,
        edge: state.growing && index === state.turns.length - 1,
    }));
}

/** What a pip's row in the command bar says. */
export function pipTitle(pip: Pip, sides: readonly [WatchSide, WatchSide]) {
    return `Turn ${two(pip.number)} · ${sides[pip.side].name}`;
}

export function pipHint(pip: Pip) {
    const fell = pip.kills ? `${pip.kills} unit${pip.kills === 1 ? "" : "s"} fell` : "Nobody fell";
    return pip.edge ? `${fell} so far · the turn being played` : fell;
}

/** The Live chip: absent on a finished game, lit while following, the way back when behind. */
export type LiveChip =
    { following: true; label: string } | { following: false; label: string; hint: string } | null;

export function liveChip(
    state: Pick<PlaybackState, "growing" | "live" | "behind" | "playing">,
): LiveChip {
    if (!state.growing) return null;
    if (state.live) return { following: true, label: "Live" };
    const behind = state.behind;
    return {
        following: false,
        label: behind > 0 ? `Live · ${behind} turn${behind === 1 ? "" : "s"} behind` : "Live",
        hint: state.playing
            ? "Catching up; back to the newest event at 1x"
            : "Back to the newest event at 1x",
    };
}

/** The end of a game: who won, or why there is no winner, and the record in labelled numbers. */
export function banner(
    state: Pick<PlaybackState, "finished" | "outcome" | "turns">,
    sides: readonly [WatchSide, WatchSide],
): { title: string; line: string } | null {
    if (!state.finished) return null;
    const fell = state.turns.reduce((n, t) => n + t.kills, 0);
    const outcome = state.outcome;
    const title =
        outcome && outcome.winner !== null
            ? `${sides[outcome.winner].name} won`
            : (outcome?.reason ?? "No winner");
    const turns = state.turns.length;
    return {
        title,
        line: `${turns} turn${turns === 1 ? "" : "s"} · ${fell} unit${fell === 1 ? "" : "s"} fell`,
    };
}

/** The transport's targets in focus order, left to right: the scrubber's pips between the buttons and Live. */
export function focusOrder(state: Pick<PlaybackState, "turns" | "growing" | "finished">): string[] {
    const ids = ["watch-prev", "watch-play", "watch-next", "watch-speed"];
    state.turns.forEach((_, i) => ids.push(`watch-pip-${i}`));
    if (state.growing) ids.push("watch-live");
    if (state.finished) ids.unshift("watch-again", "watch-leave");
    return ids;
}

/**
 * The viewer's keys, on the input bus's shortcut lane. None is a camera key
 * (Q, E, C, F, G, I, Tab and the mouse stay the camera's and the readouts'),
 * and none is a menu key but Space, which plays and pauses from anywhere
 * (Enter still presses what the cursor is on). The pad takes the same
 * commands through the menu bus: the bumpers step turns, the triggers the
 * speed, A presses what the cursor is on.
 */
export const WATCH_KEYS = {
    toggle: " ",
    prev: "[",
    next: "]",
    slower: "-",
    faster: "=",
    live: "l",
    restart: "Home",
} as const;

export type WatchKey = keyof typeof WATCH_KEYS;

/** How a key cap reads. */
export function keyCap(key: string): string {
    return key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
}
