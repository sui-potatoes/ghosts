// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { MouseEvent, PointerEvent } from "react";

import { useFocusState, type Command, type CommandAction, type FocusStore } from "./focus";
import { barModel } from "./bar-model";
import { Glyph, type GlyphSet } from "./glyphs";

type CommandBarProps = {
    /** What the cursor is on, named on the left. */
    title?: string;
    /** One line about it: what the stat means, what the action costs. */
    hint?: string;
    /** Why the confirm is refused; replaces the hint, in amber. */
    deny?: string;
    /** Replays the refusal motion when it changes. */
    denyKey?: number;
    commands: Command[];
    back: Command;
    glyphs: GlyphSet;
    /** The action pressed this instant, drawn pressed. */
    pressed?: CommandAction | null;
    onRun: (command: Command) => void;
};

/**
 * The bottom edge: the commands for whatever the cursor is on, each with its
 * glyph, in fixed slots — Reset, then Confirm (the primary, heaviest), then
 * Back behind a rule, always last. Every command is also a click target, so
 * the mouse reaches the same actions the pad does.
 */
export function CommandBar({
    title,
    hint,
    deny,
    denyKey,
    commands,
    back,
    glyphs,
    pressed,
    onRun,
}: CommandBarProps) {
    const { nav, slots } = barModel(commands, back, glyphs);
    return (
        <footer className="gui-bar">
            {/* Both lines always render (empty when there is nothing to say): the bar keeps its shape. */}
            <div className="gui-bar-context">
                <span className="gui-bar-title">{title}</span>
                {deny ? (
                    <span key={denyKey} className="gui-bar-hint" data-deny>
                        <i className="gui-warn-mark" aria-hidden />
                        <span className="gui-bar-hint-text">{deny}</span>
                    </span>
                ) : (
                    <span className="gui-bar-hint">
                        <span className="gui-bar-hint-text">{hint}</span>
                    </span>
                )}
            </div>
            <div className="gui-bar-commands">
                {nav.map((command) => (
                    <span key={command.label} className="gui-cmd" data-action="nav">
                        <Glyph action="nav" nav={command.glyph} set={glyphs} />
                        <span className="gui-cmd-label">{command.label}</span>
                    </span>
                ))}
                {nav.length > 0 && <span className="gui-bar-rule" aria-hidden />}
                {slots.map((command) => (
                    <CommandHint
                        key={command.action}
                        command={command}
                        glyphs={glyphs}
                        pressed={pressed === command.action}
                        onRun={onRun}
                    />
                ))}
                <span className="gui-bar-rule" aria-hidden />
                <CommandHint
                    command={back}
                    glyphs={glyphs}
                    pressed={pressed === "back"}
                    onRun={onRun}
                />
            </div>
        </footer>
    );
}

type HintProps = {
    command: Command;
    glyphs: GlyphSet;
    pressed?: boolean;
    onRun: (command: Command) => void;
};

/** One command: glyph and label. Used by the bar and by a prompt's own lines. */
export function CommandHint({ command, glyphs, pressed, onRun }: HintProps) {
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-cmd"
            data-action={command.action}
            data-tone={command.tone}
            data-denied={command.deny ? "" : undefined}
            aria-disabled={command.deny ? true : undefined}
            data-pressed={pressed || undefined}
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            // A held answer starts on the press and is let go on release (the
            // focus root's hold driver); its click is not a second answer.
            onPointerDown={(e: PointerEvent) => {
                if (!command.hold || command.deny) return;
                if (e.pointerType === "mouse" && e.button !== 0) return;
                onRun(command);
            }}
            onClick={() => {
                if (!command.hold || command.deny) onRun(command);
            }}
        >
            <Glyph action={command.action} nav={command.glyph} set={glyphs} />
            <span className="gui-cmd-label">{command.label}</span>
        </button>
    );
}

/**
 * What the bar shows for the store's cursor. The pointer may rest on another
 * target than the one a click selected: the title and hint follow the
 * pointer, while the commands belong to the selection and name it. `target`
 * is the node a run is attributed to.
 */
export function barOf(store: FocusStore) {
    const node = store.node(store.focused);
    const subjectId = store.subject;
    const subject = subjectId !== store.focused ? store.node(subjectId) : undefined;
    const commands = ((subject ?? node)?.commands ?? []).map((c) =>
        subject?.title && c.action === "confirm"
            ? { ...c, label: `${c.label} \u00b7 ${subject.title}` }
            : c,
    );
    return { title: node?.title, hint: node?.hint, commands, target: subjectId };
}

/** The command bar wired to the focus cursor: it follows whatever is focused. */
export function FocusCommandBar({ glyphs }: { glyphs: GlyphSet }) {
    const store = useFocusState();
    const { title, hint, commands, target } = barOf(store);
    const confirm = commands.find((c) => c.action === "confirm");
    const pulse = store.pulse;
    return (
        <CommandBar
            title={title}
            hint={hint}
            deny={confirm?.deny}
            denyKey={store.denies}
            commands={commands.filter((c) => c.action !== "back")}
            back={store.command("back")!}
            glyphs={glyphs}
            pressed={pulse?.kind === "press" ? pulse.action : null}
            onRun={(command) => store.run(command, target)}
        />
    );
}
