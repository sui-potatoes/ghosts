// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import {
    FocusCommandBar,
    FocusCursor,
    FocusRoot,
    Prompt,
    useGlyphSet,
    type Command,
} from "../../ui";
import "../dialogs/dialogs.css";
import { NameField, readDraft } from "./NameField";
import { nameLine, saveDeny } from "./rules";

/** The lookup waits this long after the last keystroke. */
const LOOKUP_MS = 400;

export interface NameStepDeps {
    /** Whether the name already belongs to another address. */
    taken(name: string): Promise<boolean>;
    /** Saves the name; rejects with a line fit for the prompt. */
    save(name: string): Promise<void>;
    /** Saved: the prompt closes. */
    done(): void;
    /** "Later". */
    later(): void;
}

/**
 * The first-sign-in name prompt: one field, a plain line under it, Save and
 * Later. A `FocusRoot` of its own, like the shell's dialogs, so the screen
 * behind (and whatever it was in the middle of) holds still until it closes.
 * `initial` is for the QA route only.
 */
export function NameStepView({ deps, initial = "" }: { deps: NameStepDeps; initial?: string }) {
    const later: Command = { action: "back", label: "Later", run: deps.later };
    return (
        <FocusRoot back={later}>
            <Frame deps={deps} initial={initial} />
        </FocusRoot>
    );
}

function Frame({ deps, initial }: { deps: NameStepDeps; initial: string }) {
    const glyphs = useGlyphSet();
    const root = useRef<HTMLElement | null>(null);
    const [draft, setDraft] = useState(initial);
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [lookup, setLookup] = useState<{ name: string; taken: boolean } | null>(null);
    const { normalized, problem } = readDraft(draft);
    const taken = lookup?.name === normalized && lookup.taken;
    const line = failure ?? nameLine(normalized, problem, taken);
    const deny = saveDeny(problem, taken, pending);

    // Debounced lookup; a stale answer is ignored, a failed one is silence.
    const latest = useRef(deps);
    latest.current = deps;
    useEffect(() => {
        if (problem) return;
        let live = true;
        const timer = window.setTimeout(() => {
            latest.current.taken(normalized).then(
                (t) => live && setLookup({ name: normalized, taken: t }),
                () => {},
            );
        }, LOOKUP_MS);
        return () => {
            live = false;
            window.clearTimeout(timer);
        };
    }, [normalized, problem]);

    const save = () => {
        if (deny) return;
        setFailure(null);
        setPending(true);
        deps.save(normalized).then(
            () => deps.done(),
            (e: unknown) => {
                setPending(false);
                setFailure(e instanceof Error ? e.message : "Could not save the name");
            },
        );
    };

    return (
        <main ref={root} className="gui ui-zoom gui-dialog">
            <Prompt
                id="prompt-first-name"
                eyebrow="Player"
                title="Choose your name"
                hint={line ?? undefined}
                lines={line ? [["Name", <span className="gset-warn">{line}</span>]] : undefined}
                confirm={{
                    label: pending ? "Saving name" : "Save",
                    deny,
                    run: save,
                }}
                cancel={{ label: "Later", run: () => !pending && deps.later() }}
                glyphs={glyphs}
            >
                What other players see: lowercase letters, digits and hyphens
                <NameField
                    value={draft}
                    onChange={(v) => {
                        setDraft(v);
                        setFailure(null);
                    }}
                    onSubmit={save}
                />
            </Prompt>
            <FocusCommandBar glyphs={glyphs} />
            <FocusCursor root={root} />
        </main>
    );
}
