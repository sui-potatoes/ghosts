// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The find-match screen's rules, apart from the screen: which phase the search
 * is in and what the one action on it is. The screen (`FindMatch.tsx`) feeds
 * it from the account and the queue and draws what it says.
 */

export type FindState = {
    signedIn: boolean;
    /** The player is in a game, or has a seat in one. */
    playing: boolean;
    /** In the queue (the `Account` says `Searching`). */
    searching: boolean;
    /** Free recruits are being hired on the way into the queue. */
    hiring: boolean;
    /** Whole minutes of a matchmaking suspension left; 0 when none. */
    suspendedMin: number;
    /** The last failed write or read. */
    error: string | null;
    /** Time in the queue; 0 before it. */
    elapsedMs: number;
    timeoutMs: number;
    /** A queue request is on its way, or the screen has yet to send one. */
    starting: boolean;
};

export type FindPhase =
    | "signed-out"
    | "playing"
    | "suspended"
    | "failed"
    | "timeout"
    | "searching"
    | "hiring"
    | "starting";

export type FindAction = "sign-in" | "resume" | "retry" | "cancel" | "menu";

export type FindView = {
    phase: FindPhase;
    headline: string;
    note: string;
    /** The screen's one focus target. */
    action: { id: FindAction; label: string };
    /** Something is in flight: the pending mark turns. */
    pending: boolean;
};

export function findView(s: FindState): FindView {
    if (!s.signedIn)
        return {
            phase: "signed-out",
            headline: "Sign in",
            note: "A contract needs a player on file.",
            action: { id: "sign-in", label: "Sign in" },
            pending: false,
        };
    if (s.playing)
        return {
            phase: "playing",
            headline: "Match in progress",
            note: "Your squad is on the field.",
            action: { id: "resume", label: "Resume match" },
            pending: false,
        };
    if (s.suspendedMin > 0)
        return {
            phase: "suspended",
            headline: "Suspended",
            note: `Matchmaking is suspended for ${s.suspendedMin} min.`,
            action: { id: "menu", label: "Back to menu" },
            pending: false,
        };
    if (s.searching && s.elapsedMs > s.timeoutMs)
        return {
            phase: "timeout",
            headline: "No match found",
            note: "No opponent came in time. The squad leaves the queue.",
            action: { id: "cancel", label: "Leave the queue" },
            pending: false,
        };
    if (s.searching)
        return {
            phase: "searching",
            headline: "Finding match",
            note: "Looking for an opponent. The search carries on while you use the menus.",
            action: { id: "cancel", label: "Cancel search" },
            pending: true,
        };
    if (s.hiring)
        return {
            phase: "hiring",
            headline: "Hiring the squad",
            note: "Your first recruits sign on, then the squad queues.",
            action: { id: "menu", label: "Back to menu" },
            pending: true,
        };
    if (s.error && !s.starting)
        return {
            phase: "failed",
            headline: "Search failed",
            note: s.error,
            action: { id: "retry", label: "Try again" },
            pending: false,
        };
    return {
        phase: "starting",
        headline: "Finding match",
        note: "Joining the queue.",
        action: { id: "menu", label: "Back to menu" },
        pending: true,
    };
}

/** `m:ss` of a span of milliseconds. */
export function clockOf(ms: number): string {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

let wanted = false;

/** The title calls this as it opens the screen: the next arrival there queues the squad. */
export function requestFind() {
    wanted = true;
}

/** Whether an arrival asked for a search; reading it clears it, so a reload never queues twice. */
export function takeFindRequest(): boolean {
    const was = wanted;
    wanted = false;
    return was;
}
