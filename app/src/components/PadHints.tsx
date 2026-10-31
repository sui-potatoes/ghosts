// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";

import {
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

/** The controller hints line for a screen; renders nothing without a pad. */
export function PadHints({ entries, className }: { entries: PadHint[]; className?: string }) {
    const pad = usePad();
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
