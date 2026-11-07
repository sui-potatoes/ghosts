// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { PadHints } from "./components/PadHints";
import { useBack } from "./hooks/useBack";
import { useMenuNav } from "./hooks/useMenuNav";
import { SettingsOverlay } from "./settings/SettingsView";

type Props = {
    open: boolean;
    onResume: () => void;
    /** Left out where a briefing or a restart makes no sense: a match. */
    onBriefing?: () => void;
    onRestart?: () => void;
    onQuit: () => void;
    quitLabel?: string;
};

type View = "menu" | "options";

/**
 * The in-game pause menu over the encounter frame. Up/Down walk the entries,
 * Confirm activates, Back resumes. Options is the same settings view as
 * the Settings screen, so nothing is lost by changing them here.
 */
export function PauseMenu({
    open,
    onResume,
    onBriefing,
    onRestart,
    onQuit,
    quitLabel = "Quit to menu",
}: Props) {
    const [view, setView] = useState<View>("menu");
    // Up/Down and Confirm come off the input bus, whatever produced them.
    const items = useMenuNav(open && view === "menu");

    useEffect(() => {
        if (open) setView("menu");
    }, [open]);

    useEffect(() => {
        if (open && view === "menu") items.current[0]?.focus();
    }, [open, view, items]);

    useBack(open ? onResume : null);

    if (!open) return null;

    const entries = [
        { label: "Resume", onClick: onResume },
        ...(onBriefing ? [{ label: "Briefing", onClick: onBriefing }] : []),
        { label: "Options", onClick: () => setView("options") },
        ...(onRestart ? [{ label: "Restart encounter", onClick: onRestart }] : []),
        { label: quitLabel, onClick: onQuit },
    ];

    return (
        <div
            className={`fixed inset-0 z-[200] flex items-center justify-center bg-overlay backdrop-blur-sm ${view === "menu" ? "p-6" : ""}`}
            onClick={onResume}
        >
            {/* The root menu is a small card; the settings take the whole screen, like the route. */}
            <div
                className={
                    view === "menu"
                        ? "flex max-h-[92vh] w-full max-w-md flex-col gap-6 overflow-y-auto border border-line bg-surface px-8 py-7"
                        : // No padding here: SettingsOverlay carries it inside its
                          // smoke root, so the smoke reaches the screen edges.
                          "flex h-full min-h-0 w-full flex-col"
                }
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={view === "menu" ? "pause-title" : undefined}
                aria-label={view === "menu" ? undefined : "Settings"}
            >
                {view === "menu" ? (
                    <>
                        <header className="flex flex-col gap-3">
                            <h2
                                id="pause-title"
                                className="font-mono text-3xl font-light tracking-[0.28em] text-foreground uppercase"
                            >
                                Paused
                            </h2>
                        </header>
                        <nav aria-label="Pause menu" className="flex flex-col border-t border-line">
                            {entries.map((entry, i) => (
                                <button
                                    key={entry.label}
                                    ref={(el) => {
                                        items.current[i] = el;
                                    }}
                                    className="menu-item"
                                    onClick={entry.onClick}
                                >
                                    <span className="flex-1">{entry.label}</span>
                                </button>
                            ))}
                        </nav>
                        <PadHints
                            entries={[
                                ["dpad", "Navigate"],
                                ["a", "Select"],
                                ["b", "Resume"],
                            ]}
                        />
                    </>
                ) : (
                    <SettingsOverlay onBack={() => setView("menu")} />
                )}
            </div>
        </div>
    );
}
