// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The first-visit intros (`intros.ts`), over a menu screen until accepted. A
 * `FocusRoot` of its own like the shell's other dialogs: it takes every input
 * while up, the screen behind holds still. Back and a press on the dimmed
 * screen do nothing; only its one command closes it. One at a time
 * (`model.ts`). Mount once in the shell.
 */

import { useRef } from "react";

import {
    CommandHint,
    FocusCommandBar,
    FocusCursor,
    FocusRoot,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../ui";
import "../dialogs/dialogs.css";
import "./intro.css";
import { INTROS, type Intro } from "./intros";
import { acceptIntro, useDueIntro } from "./store";

// Refused: Escape and the pad's B knock instead of closing.
const STAY: Command = { action: "back", label: "Back", deny: "Choose how to continue" };

export function IntroHost() {
    const due = useDueIntro();
    if (!due) return null;
    // Keyed: the next intro is a fresh dialog, not the same one re-worded.
    return (
        <FocusRoot key={due} back={STAY} pinned>
            <Frame intro={INTROS[due]} />
        </FocusRoot>
    );
}

function Frame({ intro }: { intro: Intro }) {
    const glyphs = useGlyphSet();
    const store = useFocusStore();
    const root = useRef<HTMLElement | null>(null);
    const commands: Command[] = [
        {
            action: "confirm",
            label: intro.command,
            tone: "primary",
            run: () => acceptIntro(intro.id),
        },
        STAY,
    ];
    const { props } = useFocusable<HTMLDivElement>({
        id: `intro-${intro.id}`,
        group: "intro",
        title: intro.title,
        commands,
    });
    return (
        <main ref={root} className="gui ui-zoom gui-dialog gui-intro">
            {/* The block floats over the first row; the command bar takes the second. */}
            <div />
            <div className="gui-prompt-wrap">
                <div
                    role="alertdialog"
                    aria-modal="true"
                    aria-label={intro.title}
                    className="gui-prompt"
                    {...props}
                    // The block answers clicks through its command line only.
                    onClick={undefined}
                >
                    <div className="gui-intro-body">
                        <h2 className="gui-prompt-title">{intro.title}</h2>
                        <p className="gui-prompt-body">{intro.lead}</p>
                        <dl className="gui-intro-list">
                            {intro.list.map(([label, line]) => (
                                <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{line}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                    <div className="gui-prompt-commands">
                        {commands
                            .filter((c) => c.action !== "back")
                            .map((command) => (
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
            <FocusCommandBar glyphs={glyphs} />
            <FocusCursor root={root} />
        </main>
    );
}
