// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { PadKind } from "@ghosts/engine/gamepad";

import { useInputMode, usePadActive } from "../components/PadHints";
import { keyLabel, type Action } from "../settings/keys";
import { useSettings } from "../settings/store";
import { glyphView, type GlyphSet } from "./glyph-model";

export type { GlyphSet };

/**
 * The glyph set follows the last-used device, the way console ports swap
 * prompts: a pad touched since the last key or pointer press shows its
 * family, and a touch shows no glyph at all (`inputMode()` is the one rule).
 * `?pad=xbox` or `?pad=ps` pins one for review without a controller.
 */
export function useGlyphSet(): GlyphSet {
    const pad = usePadActive() as PadKind | "";
    const mode = useInputMode();
    const pinned = new URLSearchParams(window.location.search).get("pad");
    if (pinned === "xbox" || pinned === "ps") return pinned;
    if (mode === "touch") return "none";
    return pad || "keys";
}

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
 * `nav` draws the arrow pair on keys and the d-pad on a pad. Touch (`none`)
 * draws nothing: the command's label is the whole prompt.
 */
export function Glyph({ action, set, nav = "lr" }: GlyphProps) {
    const [settings] = useSettings();
    const keys = action === "nav" ? [] : (settings.controls.bindings[action] ?? []);
    const view = glyphView(action, set, keys, keyLabel, nav);
    if (!view) return null;
    return (
        <kbd
            className="gui-glyph"
            data-shape={view.shape}
            data-face={view.face}
            data-pad={view.pad}
        >
            {view.text}
        </kbd>
    );
}
