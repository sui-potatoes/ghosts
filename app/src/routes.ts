// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Back is hierarchical, never historical. Every screen's parent is the menu
 * (Squad and Armory are sibling sections, not parent and child), and the way
 * up is `upStep`: pop the history entry when the previous one is that parent
 * (the player came from it, so the stack shrinks), otherwise replace the
 * current entry with the parent. Section switches, tab changes and deep links
 * replace their entry, so the stack never holds a trail Back could walk.
 */

/** The route a Back press leads to; null at the top (the menu). */
export function parentOf(pathname: string): string | null {
    if (pathname === "/") return null;
    // The training operations hang off their list under Play.
    if (pathname === "/demo" || pathname === "/demo-2" || pathname === "/demo-basics")
        return "/play/training";
    // The mode screens hang off the Play cards.
    if (pathname.startsWith("/play/")) return "/play";
    // A game in the viewer goes back to the watch screen's lists.
    if (pathname.startsWith("/watch/")) return "/watch";
    return "/";
}

/** Route path by history index, kept by the shell as the player moves. */
export type Trail = Record<number, string>;

export type UpStep = { kind: "pop" } | { kind: "to"; path: string };

/** What Back does on `pathname` at history position `idx`; null when there is nowhere up. */
export function upStep(pathname: string, trail: Trail, idx: number): UpStep | null {
    const parent = parentOf(pathname);
    if (parent === null) return null;
    return idx > 0 && trail[idx - 1] === parent ? { kind: "pop" } : { kind: "to", path: parent };
}

const trail: Trail = {};

/** The history position react-router keeps in `history.state`. */
export function historyIndex(): number {
    return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

/** Note where the current history entry is (called on every location change). */
export function noteRoute(pathname: string) {
    trail[historyIndex()] = pathname;
}

export function currentTrail(): Trail {
    return trail;
}
