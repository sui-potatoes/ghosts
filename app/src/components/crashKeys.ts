// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Pure parts of the crash screen's own keyboard and pad handling. The screen
 * cannot lean on the app's focus system or input bus (they may be what broke),
 * so this has no imports.
 */

export type CrashAction = "prev" | "next" | "back" | "reload" | "none";

export type CrashKey = {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
};

/** Arrows move, Escape goes back, a plain R reloads. Enter, Space and Tab stay native. */
export function crashKeyAction(e: CrashKey): CrashAction {
    if (e.ctrlKey || e.metaKey || e.altKey) return "none";
    switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
            return e.shiftKey ? "none" : "prev";
        case "ArrowRight":
        case "ArrowDown":
            return e.shiftKey ? "none" : "next";
        case "Escape":
            return "back";
        case "r":
        case "R":
            return e.shiftKey ? "none" : "reload";
        default:
            return "none";
    }
}

/** Next index in a ring of `count`; from nothing focused (-1) a step lands on the first or last. */
export function stepFocus(current: number, count: number, delta: 1 | -1): number {
    if (count <= 0) return -1;
    if (current < 0) return delta > 0 ? 0 : count - 1;
    return (current + delta + count) % count;
}

/** Standard-mapping pad state to a move: d-pad or left stick, left/up -1, right/down +1. */
export function padStep(
    buttons: readonly boolean[],
    axes: readonly number[],
    threshold = 0.6,
): 1 | -1 | 0 {
    const prev =
        buttons[12] || buttons[14] || (axes[0] ?? 0) < -threshold || (axes[1] ?? 0) < -threshold;
    const next =
        buttons[13] || buttons[15] || (axes[0] ?? 0) > threshold || (axes[1] ?? 0) > threshold;
    if (prev === next) return 0;
    return next ? 1 : -1;
}
