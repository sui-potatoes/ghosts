// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The encounter's pause menu in the shared interface language: resume,
 * briefing, options, restart, quit, under one cursor. Back resumes. Options is
 * the same settings view as the Settings screen (`SettingsOptions`), mounted
 * in its place; its Back returns here with the cursor on Options.
 */

import { useEffect, useState } from "react";

import { SettingsOptions } from "../../screens/Settings";
import { ListRow, type Command } from "../../ui";
import { DialogHost } from "./DialogHost";
import { pauseEntries, type PauseEntry } from "./model";

export type PauseProps = {
    open: boolean;
    onResume: () => void;
    /** Left out where a briefing or a restart makes no sense: a match. */
    onBriefing?: () => void;
    onRestart?: () => void;
    onQuit: () => void;
    quitLabel?: string;
    /** The host's own entries (a spectator's Copy link, Explorer), after Options. */
    extra?: readonly (PauseEntry & { run: () => void })[];
};

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

export function PauseDialog({
    open,
    onResume,
    onBriefing,
    onRestart,
    onQuit,
    quitLabel = "Quit to menu",
    extra,
}: PauseProps) {
    const [view, setView] = useState<"menu" | "options" | "back-from-options">("menu");
    // Closed, it forgets Options: the next pause starts on Resume.
    useEffect(() => {
        if (!open) setView("menu");
    }, [open]);

    // While Options covers the field, the field's own interface steps aside.
    const over = open && view === "options";
    useEffect(() => {
        if (!over) return;
        const root = document.documentElement;
        root.dataset.overField = "";
        return () => {
            delete root.dataset.overField;
        };
    }, [over]);

    if (!open) return null;
    if (view === "options")
        return (
            // A layer of its own, translucent over the level; the field's rail,
            // unit tags and objectives are hidden meanwhile (`data-over-field`).
            <div className="gui-over-field">
                <SettingsOptions onBack={() => setView("back-from-options")} />
            </div>
        );

    const run: Record<string, () => void> = {
        ...Object.fromEntries((extra ?? []).map((e) => [e.id, e.run])),
        resume: onResume,
        briefing: () => onBriefing?.(),
        options: () => setView("options"),
        restart: () => onRestart?.(),
        quit: onQuit,
    };
    const entries = pauseEntries({
        briefing: !!onBriefing,
        restart: !!onRestart,
        quitLabel,
        extra,
    });

    return (
        <DialogHost
            back={{ action: "back", label: "Resume", run: onResume }}
            eyebrow="Encounter"
            title="Paused"
            initial={view === "back-from-options" ? "pause-options" : undefined}
            compact
        >
            <PauseRows entries={entries} run={run} />
        </DialogHost>
    );
}

function PauseRows({ entries, run }: { entries: PauseEntry[]; run: Record<string, () => void> }) {
    return (
        <>
            {entries.map((entry) => (
                <ListRow
                    key={entry.id}
                    id={`pause-${entry.id}`}
                    group="pause"
                    name={entry.label}
                    title={entry.label}
                    instant
                    commands={[
                        NAV,
                        {
                            action: "confirm",
                            label: entry.id === "resume" ? "Resume" : "Select",
                            tone: "primary",
                            run: run[entry.id],
                        },
                    ]}
                />
            ))}
        </>
    );
}
