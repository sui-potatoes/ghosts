// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { PadKind } from "@ghosts/engine/gamepad";

import { usePadActive } from "../components/PadHints";
import { keyLabel, type Action } from "../settings/keys";
import { useSettings } from "../settings/store";

/** Which prompts the screen draws: the keyboard's, or one pad family's. */
export type GlyphSet = "keys" | PadKind;

/**
 * The glyph set follows the last-used device, the way console ports swap
 * prompts: a pad touched since the last key or pointer press shows its
 * family. `?pad=xbox` or `?pad=ps` pins one for review without a controller.
 */
export function useGlyphSet(): GlyphSet {
    const pad = usePadActive() as PadKind | "";
    const pinned = new URLSearchParams(window.location.search).get("pad");
    if (pinned === "xbox" || pinned === "ps") return pinned;
    return pad || "keys";
}

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

type GlyphProps = {
    /** A menu action, or `nav` for the directions a target holds. */
    action: Action | "nav";
    set: GlyphSet;
    /** For `nav`: left/right or up/down. */
    nav?: "lr" | "ud";
};

/**
 * One prompt glyph for a menu action: a key cap with the player's own binding,
 * or the pad button — a round face for A/B/X/Y, a flat bar for the shoulders.
 * `nav` draws the arrow pair on keys and the d-pad on a pad.
 */
export function Glyph({ action, set, nav = "lr" }: GlyphProps) {
    const [settings] = useSettings();
    if (action === "nav") {
        return (
            <kbd className="gui-glyph" data-shape={set === "keys" ? "key" : "dpad"}>
                {set === "keys" ? (nav === "lr" ? "← →" : "↑ ↓") : nav === "lr" ? "◂ ▸" : "▴ ▾"}
            </kbd>
        );
    }
    if (set === "keys") {
        const keys = settings.controls.bindings[action] ?? [];
        // Tabs read as letters flanking the strip (Q · E), not Shift+Tab.
        const tab = action === "prev-tab" || action === "next-tab";
        const key = (tab && keys.find((k) => k.length === 1)) || keys[0];
        return (
            <kbd className="gui-glyph" data-shape="key">
                {key ? keyLabel(key) : "?"}
            </kbd>
        );
    }
    const face = PAD_OF[action];
    if (!face) return null;
    return (
        <kbd
            className="gui-glyph"
            data-shape={SHOULDERS.has(face) ? "bumper" : "face"}
            data-face={face}
            data-pad={set}
        >
            {FACES[set][face]}
        </kbd>
    );
}
