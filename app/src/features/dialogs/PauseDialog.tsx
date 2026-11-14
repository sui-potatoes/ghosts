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
};

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

export function PauseDialog({
    open,
    onResume,
    onBriefing,
    onRestart,
    onQuit,
    quitLabel = "Quit to menu",
}: PauseProps) {
    const [view, setView] = useState<"menu" | "options" | "back-from-options">("menu");
    // Closed, it forgets Options: the next pause starts on Resume.
    useEffect(() => {
        if (!open) setView("menu");
    }, [open]);

    if (!open) return null;
    if (view === "options")
        return (
            // A layer of its own: the settings frame alone would sit under the
            // encounter's rail, unit tags and objectives.
            <div className="gui-over-field">
                <SettingsOptions onBack={() => setView("back-from-options")} />
            </div>
        );

    const run: Record<PauseEntry["id"], () => void> = {
        resume: onResume,
        briefing: () => onBriefing?.(),
        options: () => setView("options"),
        restart: () => onRestart?.(),
        quit: onQuit,
    };
    const entries = pauseEntries({ briefing: !!onBriefing, restart: !!onRestart, quitLabel });

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

function PauseRows({
    entries,
    run,
}: {
    entries: PauseEntry[];
    run: Record<PauseEntry["id"], () => void>;
}) {
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
