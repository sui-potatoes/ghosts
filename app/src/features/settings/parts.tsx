// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Two row shapes the shared module has no part for, built on its focus hook
 * and row band: a label with a value on the right (an address, a balance, a
 * binding's key caps), and the key caps themselves.
 */

import type { ReactNode } from "react";

import { keyLabel } from "../../settings/keys";
import { InlineCommands, useFocusable, type Command } from "../../ui";

type Focus = {
    id: string;
    group: string;
    title?: string;
    hint?: string;
    commands?: Command[];
    instant?: boolean;
};

/** A focusable label and value: `Address  0x12…ab`. */
export function ValueRow({
    label,
    value,
    tone,
    ...focus
}: Focus & {
    label: string;
    value: ReactNode;
    /** `warn` for a state that needs attention, `dim` for one that is unavailable. */
    tone?: "warn" | "dim" | "accent";
}) {
    const { props, inline, commands } = useFocusable<HTMLButtonElement>(focus);
    return (
        <button type="button" tabIndex={-1} className="gui-row gset-row" {...props}>
            <span className="gset-row-label">{label}</span>
            {inline ? (
                <InlineCommands commands={commands} />
            ) : (
                <span className="gset-row-value" data-tone={tone}>
                    {value}
                </span>
            )}
        </button>
    );
}

/** Key caps for a binding, in the command bar's glyph style; `cap` formats a key. */
export function KeyCaps({
    keys,
    cap = keyLabel,
}: {
    keys: string[];
    cap?: (key: string) => string;
}) {
    return (
        <span className="gset-caps">
            {keys.map((key) => (
                <kbd key={key} className="gui-glyph" data-shape="key">
                    {cap(key)}
                </kbd>
            ))}
        </span>
    );
}

/** Pad glyph text for a binding (`LB  RB`). */
export function PadCaps({ text }: { text: string }) {
    return <span className="gset-pad">{text}</span>;
}
