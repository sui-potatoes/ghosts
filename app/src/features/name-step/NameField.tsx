// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { NAME_MAX, normalizeName, validateName } from "../../player/name";
import { TextField } from "../../ui";

/**
 * The player-name field both name prompts share (Settings' rename and the
 * first-sign-in step): lowercases as it takes input, holds the registry's
 * length, Enter submits.
 */
export function NameField({
    value,
    onChange,
    onSubmit,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
}) {
    return (
        <TextField
            label="Name"
            value={value}
            maxLength={NAME_MAX}
            onChange={(v) => onChange(v.toLowerCase())}
            onSubmit={onSubmit}
        />
    );
}

/** A draft as the registry reads it: normalized, with what is wrong with it. */
export function readDraft(draft: string): { normalized: string; problem: string | null } {
    const normalized = normalizeName(draft);
    return { normalized, problem: validateName(normalized) };
}
