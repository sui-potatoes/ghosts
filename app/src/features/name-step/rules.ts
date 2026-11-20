// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The first-sign-in name step's pure rules, tested in `tests/name-step.test.ts`:
 * who is asked, where, what a draft says, and what Save does. No React, no chain.
 */

/** What the step knows about the signed-in address. */
export interface AskState {
    address: string | null;
    /** The name the address assigned to itself: undefined while loading or unreadable. */
    assigned: string | null | undefined;
    /** This device holds a name for the address. */
    localName: boolean;
    /** "Later" was pressed for this address on this device. */
    skipped: boolean;
}

/** No name on the address, never skipped here: ask. Unknown stays quiet. */
export function needsName(s: AskState): boolean {
    if (!s.address || s.assigned === undefined) return false;
    return s.assigned === null && !s.localName && !s.skipped;
}

/** Menu screens only: never in a match, the spectator viewer or the editor. */
export function menuRoute(pathname: string): boolean {
    const path = pathname.replace(/\/+$/, "") || "/";
    return (
        path === "/" ||
        path === "/menu-classic" ||
        path === "/play" ||
        path.startsWith("/play/") ||
        path === "/watch" ||
        path === "/leaderboard" ||
        path.startsWith("/settings") ||
        path.startsWith("/headquarters")
    );
}

/** Asked now: the player needs the step and is on a menu screen. */
export function askNow(s: AskState, pathname: string): boolean {
    return needsName(s) && menuRoute(pathname);
}

const skipKey = (network: string, address: string) => `ghosts:name-later:${network}:${address}`;

export interface SkipStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function wasSkipped(store: SkipStore | null, network: string, address: string): boolean {
    try {
        return store?.getItem(skipKey(network, address)) === "1";
    } catch {
        return false;
    }
}

export function skip(store: SkipStore | null, network: string, address: string) {
    try {
        store?.setItem(skipKey(network, address), "1");
    } catch {
        // storage may be blocked: asked again next time
    }
}

export const TAKEN_LINE = "This name is taken";

/** The plain line under the field for a draft; null for an empty or fine one. */
export function nameLine(
    normalized: string,
    problem: string | null,
    taken: boolean,
): string | null {
    if (!normalized) return null;
    if (problem) return problem;
    return taken ? TAKEN_LINE : null;
}

/** Why Save is refused, or undefined when it can go. Taking a moment to look up never refuses. */
export function saveDeny(
    problem: string | null,
    taken: boolean,
    pending: boolean,
): string | undefined {
    if (pending) return "Saving name";
    if (problem) return problem; // an empty draft is a problem too
    if (taken) return TAKEN_LINE;
    return undefined;
}
