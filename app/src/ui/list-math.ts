// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The arithmetic behind `<List>`: where the list scrolls so the cursor stays
 * in view, and where the quiet position rail draws. Plain TypeScript, tested
 * in `tests/gui-list.test.ts`.
 */

export type ListView = {
    /** Current scroll offset. */
    top: number;
    /** Visible height. */
    height: number;
    /** Full content height. */
    content: number;
};

/**
 * The scroll offset that keeps `item` (its top and height in content
 * coordinates) in view with `margin` to spare on the side it is moving
 * toward, so the next row always peeks in. Unchanged when it is already
 * comfortably visible; the margin shrinks when the view is too short for it.
 */
export function followScroll(
    view: ListView,
    item: { top: number; height: number },
    margin: number,
): number {
    const max = Math.max(0, view.content - view.height);
    const room = Math.max(0, (view.height - item.height) / 2);
    const m = Math.max(0, Math.min(margin, room));
    let top = view.top;
    if (item.top - m < top) top = item.top - m;
    else if (item.top + item.height + m > top + view.height)
        top = item.top + item.height + m - view.height;
    return Math.round(Math.max(0, Math.min(max, top)));
}

/**
 * The rail's thumb as fractions of the rail (start, size), or null when the
 * whole list fits and no rail is drawn. A minimum size keeps it visible on
 * very long lists.
 */
export function railThumb(view: ListView, minSize = 0.08): { start: number; size: number } | null {
    if (view.content <= view.height + 1) return null;
    const size = Math.max(minSize, view.height / view.content);
    const max = view.content - view.height;
    const start = (Math.max(0, Math.min(max, view.top)) / max) * (1 - size);
    return { start, size };
}

/** Whether more of the list lies above and below the visible window. */
export function overflowEdges(view: ListView): { above: boolean; below: boolean } {
    return {
        above: view.top > 1,
        below: view.top + view.height < view.content - 1,
    };
}
