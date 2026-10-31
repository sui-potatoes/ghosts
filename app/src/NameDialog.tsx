// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useId, useState } from "react";

import { useSubmitNameChange } from "./chain";
import { useBack } from "./hooks/useBack";
import { usePlayerName } from "./hooks/usePlayerName";
import { NAME_MAX, normalizeName, validateName } from "./player/name";

type Props = { open: boolean; onClose: () => void };

/**
 * Change the player name. Input is normalized live (lowercase, trimmed) and
 * checked against SuiNS label rules. Saving registers the name to the address
 * on chain and closes only once that went through; the chain's refusal shows
 * in place.
 */
export function NameDialog({ open, onClose }: Props) {
    const { name: current } = usePlayerName();
    const { submit, pending } = useSubmitNameChange();
    const [draft, setDraft] = useState(current);
    const [error, setError] = useState<string | null>(null);
    const inputId = useId();

    useEffect(() => {
        if (!open) return;
        setDraft(current);
        setError(null);
    }, [open, current]);

    useBack(open ? onClose : null);

    if (!open) return null;

    const normalized = normalizeName(draft);
    const problem = validateName(normalized);
    const unchanged = normalized === current;

    async function save() {
        // Enter submits the form past the disabled button, so re-check here.
        if (pending || unchanged) return;
        if (problem) return setError(problem);
        try {
            await submit(normalized);
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm"
            onClick={onClose}
        >
            <form
                className="flex w-full max-w-md flex-col border border-line bg-surface"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                    e.preventDefault();
                    save();
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${inputId}-title`}
            >
                <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                    <div className="flex flex-col gap-2">
                        <h2 id={`${inputId}-title`} className="label text-foreground">
                            Player name
                        </h2>
                        <p className="text-[13px] text-secondary">
                            What other players see. Lowercase letters, digits and hyphens: a SuiNS
                            name, registered to your address when you save.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="label text-muted hover:text-foreground"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex flex-col gap-3 border-t border-line px-6 py-5">
                    <label htmlFor={inputId} className="label text-secondary">
                        Name
                    </label>
                    <input
                        id={inputId}
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={NAME_MAX}
                        disabled={pending}
                        value={draft}
                        onChange={(e) => {
                            setDraft(e.target.value.toLowerCase());
                            setError(null);
                        }}
                        className="w-full border border-line bg-raised px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-accent"
                    />
                    <p className="min-h-[1.25rem] text-[12px] text-warn">
                        {error ?? (draft && !unchanged ? problem : null)}
                    </p>
                </div>

                <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
                    <button type="button" className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="btn"
                        disabled={!!problem || unchanged || pending}
                    >
                        {pending ? "Signing…" : "Save"}
                    </button>
                </div>
            </form>
        </div>
    );
}
