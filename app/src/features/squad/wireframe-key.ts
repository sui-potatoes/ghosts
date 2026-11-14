// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The shortcut key; not a menu key by default and not in the combat set. */
export const WIREFRAME_KEY = "z";

/**
 * True when Z may toggle the wireframe: the player has not bound it to a menu
 * action (`menuAction` is what the key event maps to, or null) nor to any
 * combat action. A rebound key keeps its meaning; the shortcut stays silent
 * for that player.
 */
export function wireframeKeyFree(
    menuAction: string | null,
    combat: Record<string, string[]>,
): boolean {
    if (menuAction) return false;
    return !Object.values(combat).some((keys) => keys.includes(WIREFRAME_KEY));
}
