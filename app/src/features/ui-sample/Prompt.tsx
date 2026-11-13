// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

import { CommandHint } from "./CommandBar";
import { FocusScope, useFocusable, useFocusStore, type Command } from "./focus";
import type { GlyphSet } from "./glyphs";

type PromptProps = {
    /** Unique per prompt kind; the focus scope's id. */
    id: string;
    /** Stencil over the title: `REQUISITION ORDER`. */
    eyebrow: string;
    /** The question, ending in `?`. */
    title: string;
    /** The consequence, named plainly. */
    children: ReactNode;
    /** Key figures: `[["COST", "₡ 1,200"], ["BALANCE AFTER", "₡ 3,650"]]`. */
    lines?: [label: string, value: ReactNode][];
    /** The command bar's line while the prompt is up; danger defaults to "cannot be undone". */
    hint?: string;
    /** `danger` turns the frame and the confirm amber: it destroys something. */
    tone?: "default" | "danger";
    confirm: { label: string; run: () => void };
    cancel: { label: string; run: () => void };
    glyphs: GlyphSet;
};

/**
 * A confirmation interrupt: a framed block over the dimmed screen, with no
 * button row of its own to aim at. Confirm and Back answer it from anywhere,
 * so the cursor rests on the block itself (it is the one thing focused) and
 * the command bar carries its two commands. Its own two command lines repeat
 * them beside the question, for the mouse, which should not have to travel
 * to the screen's edge to answer a question asked in the middle.
 */
export function Prompt(props: PromptProps) {
    const back: Command = { action: "back", label: props.cancel.label, run: props.cancel.run };
    return (
        <FocusScope id={props.id} back={back}>
            <div className="uis-scrim" aria-hidden />
            <PromptBlock {...props} />
        </FocusScope>
    );
}

function PromptBlock({
    id,
    eyebrow,
    title,
    children,
    lines,
    hint,
    tone = "default",
    confirm,
    cancel,
    glyphs,
}: PromptProps) {
    const store = useFocusStore();
    const commands: Command[] = [
        {
            action: "confirm",
            label: confirm.label,
            tone: tone === "danger" ? "danger" : "primary",
            run: confirm.run,
        },
        { action: "back", label: cancel.label, run: cancel.run },
    ];
    const { props } = useFocusable<HTMLDivElement>({
        id: `${id}-block`,
        group: "prompt",
        title,
        hint: hint ?? (tone === "danger" ? "This cannot be undone" : undefined),
        commands,
    });
    return (
        <div className="uis-prompt-wrap">
            <div
                role="alertdialog"
                aria-modal="true"
                aria-label={title}
                className="uis-prompt"
                data-tone={tone}
                {...props}
                // The block answers clicks through its command lines only.
                onClick={undefined}
            >
                <span className="uis-prompt-eyebrow">{eyebrow}</span>
                <h2 className="uis-prompt-title">{title}</h2>
                <p className="uis-prompt-body">{children}</p>
                {lines && (
                    <dl className="uis-prompt-lines">
                        {lines.map(([label, value]) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                <div className="uis-prompt-commands">
                    {commands.map((command) => (
                        <CommandHint
                            key={command.action}
                            command={command}
                            glyphs={glyphs}
                            pressed={
                                store.pulse?.kind === "press" &&
                                store.pulse.action === command.action
                            }
                            onRun={(c) => store.run(c)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
