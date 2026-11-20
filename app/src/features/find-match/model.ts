// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The contract screen's rules (the queue for owned recruits), apart from the
 * screen: which phase the search is in and what the one action on it is, and
 * whether it can run yet. The screen (`FindMatch.tsx`) feeds it from the account
 * and the queue and draws what it says.
 */

export type FindState = {
    signedIn: boolean;
    /** The player is in a game, or has a seat in one. */
    playing: boolean;
    /** In the queue (the `Account` says `Searching`). */
    searching: boolean;
    /** Hosting or waiting in a friendly game's lobby: the queue refuses until it is left. */
    lobby?: boolean;
    /** Searching the ranked queue: one search at a time. */
    ranked?: boolean;
    /** The last contract search ran out of time without a match; not yet read. */
    expired?: boolean;
    /** Free recruits are being hired on the way into the queue. */
    hiring: boolean;
    /** Whole minutes of a matchmaking suspension left; 0 when none. */
    suspendedMin: number;
    /** The last failed write or read. */
    error: string | null;
    /** Time in the queue; 0 before it. */
    elapsedMs: number;
    timeoutMs: number;
    /** A queue request is on its way: the screen was asked for a search and has sent it. */
    starting: boolean;
    /** Another write is in flight: a cancel sent now would be dropped. */
    busy?: boolean;
    /** The account is being funded for the queue transaction, which waits for it. */
    funding?: boolean;
};

export type FindPhase =
    | "signed-out"
    | "playing"
    | "lobby"
    | "ranked"
    | "expired"
    | "suspended"
    | "failed"
    | "timeout"
    | "searching"
    | "funding"
    | "hiring"
    | "starting"
    | "idle";

export type FindAction =
    "sign-in" | "resume" | "lobby" | "ranked" | "find" | "retry" | "cancel" | "menu";

export type FindView = {
    phase: FindPhase;
    headline: string;
    note: string;
    /** The screen's one focus target. */
    action: {
        id: FindAction;
        label: string;
        /** Why the action cannot run yet; the button shows, dimmed, and the bar says why. */
        inactive?: string;
    };
    /** Something is in flight: the pending mark turns. */
    pending: boolean;
};

export function findView(s: FindState): FindView {
    if (!s.signedIn)
        return {
            phase: "signed-out",
            headline: "Sign in",
            note: "A contract match needs a player on file.",
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
    if (s.lobby)
        return {
            phase: "lobby",
            headline: "Friendly game open",
            note: "Leave or close your friendly game to search for a contract match.",
            action: { id: "lobby", label: "Open friendly game" },
            pending: false,
        };
    if (s.ranked)
        return {
            phase: "ranked",
            headline: "Ranked search on",
            note: "Cancel your ranked search to search for a contract match.",
            action: { id: "ranked", label: "Open ranked search" },
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
            note: "No opponent came in time. Leave the queue and search again later.",
            action: {
                id: "cancel",
                label: "Leave the queue",
                inactive: s.busy ? "Saving a change" : undefined,
            },
            pending: false,
        };
    if (s.searching)
        return {
            phase: "searching",
            headline: "Finding match",
            note: "Looking for an opponent for your recruits. The search carries on while you use the menus.",
            action: {
                id: "cancel",
                label: "Cancel search",
                inactive: s.busy ? "Saving a change" : undefined,
            },
            pending: true,
        };
    if (s.funding)
        return {
            phase: "funding",
            headline: "Preparing",
            note: "Getting your account ready, then the squad queues.",
            action: { id: "cancel", label: "Cancel search", inactive: "Preparing" },
            pending: true,
        };
    if (s.hiring)
        return {
            phase: "hiring",
            headline: "Hiring the squad",
            note: "Your first recruits sign on, then the squad queues.",
            action: { id: "cancel", label: "Cancel search", inactive: "Hiring the squad" },
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
    if (s.starting)
        return {
            phase: "starting",
            headline: "Finding match",
            note: "Joining the queue.",
            action: { id: "cancel", label: "Cancel search", inactive: "Joining the queue" },
            pending: true,
        };
    if (s.expired)
        return {
            phase: "expired",
            headline: "No match found",
            note: "The search ran out of time without an opponent.",
            action: { id: "find", label: "Search again" },
            pending: false,
        };
    // Here without having asked for a search (a card, a reload): nothing is sent yet.
    return {
        phase: "idle",
        headline: "Contract",
        note: "Your own recruits. They earn experience and can be lost. Rating does not change.",
        action: { id: "find", label: "Find match" },
        pending: false,
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
