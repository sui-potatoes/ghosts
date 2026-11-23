// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The editor's search keys as pure logic: where the highlight goes over the
 * flat result list for a key, and when Reset has anything to discard. The
 * screen owns the DOM; this owns the arithmetic.
 */

export type NavKey = "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export const isNavKey = (key: string): key is NavKey =>
    key === "ArrowDown" ||
    key === "ArrowUp" ||
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "Home" ||
    key === "End";

/**
 * The highlight after `key`, over `count` results laid out `columns` wide
 * (1 is a plain list). -1 when there is nothing to highlight. Null when the
 * key does not move it, so the field keeps its own use of the key (the caret
 * on Left/Right in a list). A list wraps top and bottom; a grid clamps, and a
 * step down from a column the last row lacks lands on the final result.
 */
export function moveHighlight(
    index: number,
    count: number,
    key: NavKey,
    columns = 1,
): number | null {
    if (count <= 0) return -1;
    const cols = Math.max(1, Math.floor(columns));
    const at = Math.min(Math.max(index, 0), count - 1);
    const last = count - 1;
    switch (key) {
        case "Home":
            return 0;
        case "End":
            return last;
        case "ArrowDown":
            if (cols === 1) return at === last ? 0 : at + 1;
            if (at + cols <= last) return at + cols;
            // A row below exists but is short: land on its last result.
            return Math.floor(at / cols) < Math.floor(last / cols) ? last : at;
        case "ArrowUp":
            if (cols === 1) return at === 0 ? last : at - 1;
            return at - cols >= 0 ? at - cols : at;
        case "ArrowRight":
            return cols === 1 ? null : Math.min(at + 1, last);
        case "ArrowLeft":
            return cols === 1 ? null : Math.max(at - 1, 0);
    }
}

/** The highlight kept inside the results, for when they change under it. */
export const clampHighlight = (index: number, count: number): number =>
    count <= 0 ? -1 : Math.min(Math.max(index, 0), count - 1);

/** Reset is offered while the board differs from its base (both as export text). */
export const canReset = (current: string, base: string): boolean => current !== base;
