// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A dialog the shell opens over any screen (sign-in, the encounter's pause
 * menu), in the shared interface language. It is a `FocusRoot` of its own:
 * mounted after the screen, it is the newest consumer on the input bus, so it
 * takes every menu action while it is up and the screen behind holds still,
 * its own cursor untouched; closing it hands the input straight back, the
 * screen's cursor where it was. Back runs `back` (close, resume); a press on
 * the dimmed screen around the block does the same.
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";

import {
    ContextMenu,
    FocusCommandBar,
    FocusCursor,
    FocusRoot,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../ui";
import "./dialogs.css";

type Props = {
    back: Command;
    /** Stencil over the title. */
    eyebrow: string;
    title: string;
    /** One line under the title, only when it answers a question. */
    lead?: ReactNode;
    /** Under the rows: an error, in amber. */
    foot?: ReactNode;
    /** The row the cursor starts on (else the first). */
    initial?: string;
    /** Single-line rows (commands), not options with a second line. */
    compact?: boolean;
    children: ReactNode;
};

export function DialogHost(props: Props) {
    return (
        <FocusRoot back={props.back}>
            <DialogFrame {...props} />
        </FocusRoot>
    );
}

function DialogFrame({ eyebrow, title, lead, foot, initial, compact, children }: Props) {
    const root = useRef<HTMLElement | null>(null);
    const store = useFocusStore();
    const glyphs = useGlyphSet();
    useLayoutEffect(() => {
        if (initial) store.focus(initial, false);
        // Once, on opening.
    }, [store]);
    return (
        <main ref={root} className="gui ui-zoom gui-dialog">
            <div
                className="gui-dialog-stage"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const back = store.command("back");
                    if (back) store.run(back);
                }}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={title}
                    className="gui-dialog-block"
                >
                    <span className="gui-prompt-eyebrow">{eyebrow}</span>
                    <h2 className="gui-prompt-title">{title}</h2>
                    {lead && <p className="gui-prompt-body">{lead}</p>}
                    <div className="gui-dialog-rows" data-compact={compact ? "" : undefined}>
                        {children}
                    </div>
                    {foot}
                </div>
            </div>
            <FocusCommandBar glyphs={glyphs} />
            <ContextMenu root={root} />
            <FocusCursor root={root} />
        </main>
    );
}
