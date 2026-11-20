// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What one prompt glyph looks like for a menu action under a glyph set: a key
 * cap with the player's binding, a pad button, or nothing. Pure, so
 * `tests/gui-touch.test.ts` pins that touch (`none`) draws no glyph at all.
 */

import type { PadKind } from "@ghosts/engine/gamepad";

import type { Action } from "../settings/keys.ts";

/** Which prompts the screen draws: the keyboard's, one pad family's, or none. */
export type GlyphSet = "keys" | "none" | PadKind;

type PadFace = "a" | "b" | "x" | "y" | "lb" | "rb" | "lt" | "rt";

const PAD_OF: Partial<Record<Action, PadFace>> = {
    confirm: "a",
    back: "b",
    reset: "x",
    "prev-tab": "lb",
    "next-tab": "rb",
    "prev-section": "lt",
    "next-section": "rt",
};

const FACES: Record<PadKind, Record<PadFace, string>> = {
    xbox: { a: "A", b: "B", x: "X", y: "Y", lb: "LB", rb: "RB", lt: "LT", rt: "RT" },
    ps: { a: "✕", b: "○", x: "□", y: "△", lb: "L1", rb: "R1", lt: "L2", rt: "R2" },
};

const SHOULDERS = new Set<PadFace>(["lb", "rb", "lt", "rt"]);

export type GlyphView = {
    shape: "key" | "dpad" | "face" | "bumper";
    text: string;
    face?: PadFace;
    pad?: PadKind;
};

/**
 * `keys` are the player's bindings for the action (`label` formats one); `nav`
 * is what a `nav` hint's directions do. Null when there is nothing to draw:
 * touch, or a pad with no button for the action.
 */
export function glyphView(
    action: Action | "nav",
    set: GlyphSet,
    keys: string[],
    label: (key: string) => string,
    nav: "lr" | "ud" = "lr",
): GlyphView | null {
    if (set === "none") return null;
    if (action === "nav") {
        if (set === "keys") return { shape: "key", text: nav === "lr" ? "← →" : "↑ ↓" };
        return { shape: "dpad", text: nav === "lr" ? "◂ ▸" : "▴ ▾" };
    }
    if (set === "keys") {
        // Tabs read as letters flanking the strip (Q · E), not Shift+Tab.
        const tab = action === "prev-tab" || action === "next-tab";
        const key = (tab && keys.find((k) => k.length === 1)) || keys[0];
        return { shape: "key", text: key ? label(key) : "?" };
    }
    const face = PAD_OF[action];
    if (!face) return null;
    return {
        shape: SHOULDERS.has(face) ? "bumper" : "face",
        text: FACES[set][face],
        face,
        pad: set,
    };
}
