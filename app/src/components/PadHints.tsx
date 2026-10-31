// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";

import {
    padActive,
    padConnected,
    padGlyph,
    padKind,
    subscribePad,
    type PadButton,
} from "@ghosts/engine/gamepad";

export type PadHint = [button: PadButton | "dpad" | "ls" | "rs", label: string];

/** "" with no controller; otherwise the pad family, so glyphs re-render on change. */
export function usePad(): string {
    return useSyncExternalStore(subscribePad, () => (padConnected() ? padKind() : ""));
}

/**
 * "" unless the pad is the input device in use (touched since the last
 * trusted mouse or key input); the pad family while it is. Hints follow
 * this, the way console ports swap prompts; device state (the Controller
 * panel, the layout) stays on the stable connection.
 */
export function usePadActive(): string {
    return useSyncExternalStore(subscribePad, () => (padActive() ? padKind() : ""));
}

/** The controller hints line for a screen; renders nothing while the pad is idle. */
export function PadHints({ entries, className }: { entries: PadHint[]; className?: string }) {
    const pad = usePadActive();
    if (!pad) return null;
    return (
        <div className={`pad-hints label ${className ?? ""}`} aria-hidden>
            {entries.map(([button, label]) => (
                <span key={label}>
                    <kbd className="kbd">{padGlyph(button)}</kbd>
                    {label}
                </span>
            ))}
        </div>
    );
}
