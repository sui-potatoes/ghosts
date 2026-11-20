// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked screen's search, apart from the screen: what the Find button says
 * and why it waits, and the card over the stage while a search is on (joining,
 * waiting with its clock, run out, refused). Plain TypeScript, tested in
 * `tests/play-ranked.test.ts`; the screen feeds it from the `Account`, the queue
 * and the dry run.
 */

import { cr } from "./model.ts";

export type SearchPhase =
    /** Nothing sent: the builder is the screen. */
    | "idle"
    /** The rules, the account and the queue are being read. */
    | "checking"
    /** The search is on its way; `match`: an opponent is waiting, the squad goes in the clear. */
    | "sending-wait"
    | "sending-match"
    /** Sent; the `Account` has not shown the search yet. */
    | "joining"
    /** Waiting in the ranked queue. */
    | "searching"
    /** The queue let the search go without a match. */
    | "expired"
    /** Refused before or by the contract: `line` says why. */
    | "refused";

export type RankedSearchState = {
    signedIn: boolean;
    /** The account is being read. */
    loading: boolean;
    /** In a game, or with a seat in one. */
    playing: boolean;
    /** Waiting in a friendly lobby. */
    lobby: boolean;
    /** Searching the queue for owned recruits. */
    contract: boolean;
    /** Whole minutes of a suspension left; 0 when none. */
    suspendedMin: number;
    /** The size chosen has a level. */
    open: boolean;
    /** `3x3`, `4x4`. */
    mode: string;
    phase: SearchPhase;
    /** When the ranked search began; null before the `Account` shows it. */
    sinceMs: number | null;
    now: number;
    /** How long a ticket waits in the queue. */
    ttlMs: number;
    /** A write is in flight: a cancel now would be dropped. */
    busy: boolean;
    /** The refusal, for `refused`. */
    line?: string;
    tier: string;
    units: number;
    spent: number;
};

export type FindAction = {
    id: "find" | "sign-in" | "resume";
    label: string;
    hint: string;
    /** Inactive with this reason. */
    deny?: string;
};

/** The one action under the builder, and why it waits. `gate`: the squad's first problem. */
export function findAction(s: RankedSearchState, gate: string | null): FindAction {
    if (!s.signedIn)
        return { id: "sign-in", label: "Sign in", hint: "Sign in to play ranked matches" };
    if (s.playing) return { id: "resume", label: "Resume match", hint: "Back to the field" };
    const find = (deny?: string): FindAction => ({
        id: "find",
        label: "Find ranked match",
        hint: deny ?? `Search for an opponent of your rank with this squad`,
        deny,
    });
    if (s.loading) return find("Reading your record");
    if (s.lobby) return find("Leave your friendly match first");
    if (s.contract) return find("Cancel your contract search first");
    if (s.suspendedMin > 0) return find(`Suspended for ${s.suspendedMin} min`);
    if (!s.open) return find(`No ${s.mode} level yet`);
    if (s.phase !== "idle" && s.phase !== "refused" && s.phase !== "expired")
        return find("Searching for an opponent");
    return find(gate ?? undefined);
}

/** `m:ss`. */
export function clock(ms: number): string {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type SearchCard = {
    phase: SearchPhase | "timeout";
    eyebrow: string;
    title: string;
    lines: [label: string, value: string][];
    /** What the bar says while the card has the cursor. */
    hint: string;
    /** A second command besides Back (Search again). */
    primary?: { label: string };
    /** Back's label: cancel the search, or close the card. */
    back: { label: string; deny?: string };
    /** Something is in flight: the mark turns. */
    pending: boolean;
};

/** The card over the stage while a search is on; null while there is none. */
export function searchCard(s: RankedSearchState): SearchCard | null {
    const eyebrow = `Ranked ${s.mode}`;
    const squad: [string, string] = ["Squad", `${s.units} units · ${cr(s.spent)}`];
    const tier: [string, string] = ["Rank", s.tier];
    switch (s.phase) {
        case "idle":
            return null;
        case "checking":
            return {
                phase: s.phase,
                eyebrow,
                title: "Checking the queue",
                lines: [tier, squad],
                hint: "Checking your squad against the rules",
                back: { label: "Cancel search", deny: "Checking the queue" },
                pending: true,
            };
        case "sending-wait":
        case "joining":
            return {
                phase: s.phase,
                eyebrow,
                title: "Joining the queue",
                lines: [tier, squad],
                hint: "Your squad stays hidden until an opponent is found",
                back: { label: "Cancel search", deny: "Joining the queue" },
                pending: true,
            };
        case "sending-match":
            return {
                phase: s.phase,
                eyebrow,
                title: "Opponent found",
                lines: [tier, squad],
                hint: "Starting the match",
                back: { label: "Cancel search", deny: "Starting the match" },
                pending: true,
            };
        case "searching": {
            const elapsed = s.sinceMs === null ? 0 : Math.max(0, s.now - s.sinceMs);
            const out = elapsed > s.ttlMs;
            return {
                phase: out ? "timeout" : "searching",
                eyebrow,
                title: out ? "No opponent yet" : "Looking for an opponent",
                lines: [["Searching", clock(elapsed)], tier, squad],
                hint: out
                    ? "No opponent came in time. Leave the queue and search again later"
                    : "A player of your rank. The search carries on while you use the menus",
                back: {
                    label: out ? "Leave the queue" : "Cancel search",
                    deny: s.busy ? "Saving a change" : undefined,
                },
                pending: !out,
            };
        }
        case "expired":
            return {
                phase: s.phase,
                eyebrow,
                title: "No match found",
                lines: [tier, squad],
                hint: "The search ran out of time without an opponent",
                primary: { label: "Search again" },
                back: { label: "Close" },
                pending: false,
            };
        case "refused":
            return {
                phase: s.phase,
                eyebrow,
                title: "Cannot search",
                lines: [["Reason", s.line ?? "Try again"]],
                hint: s.line ?? "Try again",
                back: { label: "Close" },
                pending: false,
            };
    }
}
