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

/** The turn number of the newest turn so far, as the players see it. */
const lastRound = (turns: PlaybackState["turns"]) => turns[turns.length - 1]?.round ?? 0;

/**
 * The turn readout: the turn number a player sees ("Turn 07 of 18": both
 * sides' goes in a round share it) and whose go it is.
 */
export function turnReadout(
    state: Pick<PlaybackState, "turns" | "turn">,
    sides: readonly [WatchSide, WatchSide],
) {
    const mark = state.turns[state.turn];
    return {
        turn: `Turn ${two(mark?.round ?? 0)} of ${two(lastRound(state.turns))}`,
        side: mark ? sides[mark.side].name : "",
    };
}

/** One side's go on the scrubber. */
export interface Pip {
    /** Its index into `turns`. */
    index: number;
    /** The turn number shown: the round, as the players count it. */
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
        number: mark.round,
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
    return pip.edge ? `${fell} so far · Turn in play` : fell;
}

/** How many sides' goes the scrubber shows at once: ten turns of both sides. */
export const SCRUB_WINDOW = 20;

/** How far the jump buttons go, in turns as the players count them. */
export const JUMP_TURNS = 10;

/**
 * The scrubber's visible pips: a window of `size` around the viewer's turn, so a
 * long game stays one short strip; `earlier` and `later` count the goes left out.
 */
export function scrubWindow(pips: readonly Pip[], turn: number, size = SCRUB_WINDOW) {
    const from = Math.max(0, Math.min(turn - Math.floor(size / 2), pips.length - size));
    const shown = pips.slice(from, from + size);
    return { pips: shown, earlier: from, later: pips.length - from - shown.length };
}

/**
 * The go `JUMP_TURNS` turns before (`dir` -1) or after (1) the viewer's: the first
 * go of that round, clamped to the game's first and newest.
 */
export function jumpTarget(turns: PlaybackState["turns"], turn: number, dir: 1 | -1): number {
    if (!turns.length) return 0;
    const round = (turns[turn]?.round ?? 0) + dir * JUMP_TURNS;
    const at = turns.findIndex((t) => t.round >= round);
    return dir > 0 ? (at < 0 ? turns.length - 1 : at) : Math.max(0, at);
}

/** The Live chip: absent on a finished match, lit while following, the way back when behind. */
export type LiveChip = { following: boolean; label: string } | null;

export function liveChip(
    state: Pick<PlaybackState, "growing" | "live" | "behind" | "playing">,
): LiveChip {
    if (!state.growing) return null;
    if (state.live) return { following: true, label: "Live" };
    const behind = state.behind;
    return {
        following: false,
        label: behind > 0 ? `Live · ${behind} turn${behind === 1 ? "" : "s"} behind` : "Live",
    };
}

/**
 * The end of a game: who won, or why there is no winner; the line says why a
 * game was won off the field (a player left) and the record in labelled numbers.
 */
export function banner(
    state: Pick<PlaybackState, "finished" | "outcome" | "turns">,
    sides: readonly [WatchSide, WatchSide],
): { title: string; line: string } | null {
    if (!state.finished) return null;
    const fell = state.turns.reduce((n, t) => n + t.kills, 0);
    const outcome = state.outcome;
    const won = outcome && outcome.winner !== null;
    const title = won ? `${sides[outcome.winner!].name} won` : (outcome?.reason ?? "No winner");
    const turns = new Set(state.turns.map((t) => t.round)).size;
    const record = `${turns} turn${turns === 1 ? "" : "s"} · ${fell} unit${fell === 1 ? "" : "s"} fell`;
    return { title, line: won && outcome.reason ? `${outcome.reason} · ${record}` : record };
}

/**
 * The transport's targets in focus order, left to right: the buttons, the
 * scrubber's window (with the jumps either side when goes are left out), Live,
 * and the extras (Copy link). The banner's choices come first once the game is over.
 */
export function focusOrder(
    state: Pick<PlaybackState, "turns" | "turn" | "growing" | "finished">,
    extras: { link?: boolean } = {},
): string[] {
    const ids = ["watch-prev", "watch-play", "watch-next", "watch-speed"];
    const window = scrubWindow(pipsOf({ ...state, growing: state.growing }), state.turn);
    if (window.earlier) ids.push("watch-back");
    window.pips.forEach((pip) => ids.push(`watch-pip-${pip.index}`));
    if (window.later) ids.push("watch-ahead");
    if (state.growing) ids.push("watch-live");
    if (extras.link) ids.push("watch-link");
    ids.push("watch-menu");
    if (state.finished) ids.unshift("watch-replay", "watch-leave");
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

/** The spectator menu's own entries (the pause menu adds Resume, Options and the way out). */
export function spectatorEntries(opts: {
    link: boolean;
    explorer: boolean;
    copied?: "idle" | "copied" | "refused";
}): { id: "link" | "explorer"; label: string }[] {
    return [
        ...(opts.explorer ? [{ id: "explorer" as const, label: "Explorer" }] : []),
        ...(opts.link
            ? [
                  {
                      id: "link" as const,
                      label: opts.copied === "copied" ? "Link copied" : "Copy link",
                  },
              ]
            : []),
    ];
}

/** What the transport keys need of the playback. */
export type KeyedPlayback = {
    toggle(): void;
    prevTurn(): void;
    nextTurn(): void;
    stepSpeed(step: number): void;
    goLive(): void;
    restart(): void;
    getState(): { growing: boolean };
};

/**
 * The viewer's keyboard map for the shortcut lane. While the menu or the
 * settings over it is open the map is empty: the transport stands still.
 */
export function transportKeys(
    playback: KeyedPlayback,
    menuOpen: boolean,
): Record<string, () => boolean | void> {
    if (menuOpen) return {};
    return {
        [WATCH_KEYS.toggle]: () => playback.toggle(),
        [WATCH_KEYS.prev]: () => playback.prevTurn(),
        [WATCH_KEYS.next]: () => playback.nextTurn(),
        [WATCH_KEYS.slower]: () => playback.stepSpeed(-1),
        [WATCH_KEYS.faster]: () => playback.stepSpeed(1),
        "+": () => playback.stepSpeed(1),
        [WATCH_KEYS.live]: () => (playback.getState().growing ? playback.goLive() : false),
        [WATCH_KEYS.restart]: () => playback.restart(),
    };
}
