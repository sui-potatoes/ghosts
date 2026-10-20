// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { useBack } from "./hooks/useBack";
import { SettingsOverlay } from "./settings/SettingsView";
import { listStep } from "./settings/store";

type Props = {
    open: boolean;
    onResume: () => void;
    onBriefing: () => void;
    onRestart: () => void;
    onQuit: () => void;
};

type View = "menu" | "options";

/**
 * The in-game pause menu over the encounter frame. Up/Down walk the entries,
 * Confirm activates, Back resumes. Options is the same settings view as
 * the Settings screen, so nothing is lost by changing them here.
 */
export function PauseMenu({ open, onResume, onBriefing, onRestart, onQuit }: Props) {
    const [view, setView] = useState<View>("menu");
    const items = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (open) setView("menu");
    }, [open]);

    useEffect(() => {
        if (open && view === "menu") items.current[0]?.focus();
    }, [open, view]);

    useBack(open ? onResume : null);

    if (!open) return null;

    const entries = [
        { label: "Resume", onClick: onResume },
        { label: "Briefing", onClick: onBriefing },
        { label: "Options", onClick: () => setView("options") },
        { label: "Restart encounter", onClick: onRestart },
        { label: "Quit to menu", onClick: onQuit },
    ];

    function onNavKey(e: React.KeyboardEvent) {
        const i = items.current.findIndex((el) => el === document.activeElement);
        const next = listStep(e, i, entries.length);
        if (next !== null) items.current[next]?.focus();
    }

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm"
            onClick={onResume}
        >
            <div
                className={`flex max-h-[92vh] w-full flex-col gap-6 overflow-y-auto border border-line bg-surface px-8 py-7 ${view === "menu" ? "max-w-md" : "max-w-3xl"}`}
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
                        <nav
                            aria-label="Pause menu"
                            className="flex flex-col border-t border-line"
                            onKeyDown={onNavKey}
                        >
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
                    </>
                ) : (
                    <SettingsOverlay onBack={() => setView("menu")} />
                )}
            </div>
        </div>
    );
}
