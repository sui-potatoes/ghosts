// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { useBack } from "./hooks/useBack";
import { Hint } from "./settings/controls";
import { AudioPanel, DisplayPanel } from "./settings/panels";
import { currentAction } from "./settings/store";
import "./settings/settings.css";

type Props = {
    open: boolean;
    onResume: () => void;
    onRestart: () => void;
    onQuit: () => void;
};

type View = "menu" | "options";

/**
 * The in-game pause menu over the encounter frame. Up/Down walk the entries,
 * Confirm activates, Back resumes (or leaves Options for the menu). Options
 * are the same audio and display panels as the Settings screen, so nothing
 * is lost by changing them here.
 */
export function PauseMenu({ open, onResume, onRestart, onQuit }: Props) {
    const [view, setView] = useState<View>("menu");
    const items = useRef<(HTMLButtonElement | null)[]>([]);
    const back = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (open) setView("menu");
    }, [open]);

    useEffect(() => {
        if (!open) return;
        if (view === "menu") items.current[0]?.focus();
        else back.current?.focus();
    }, [open, view]);

    useBack(!open ? null : view === "options" ? () => setView("menu") : onResume);

    if (!open) return null;

    const entries = [
        { label: "Resume", onClick: onResume },
        { label: "Options", onClick: () => setView("options") },
        { label: "Restart encounter", onClick: onRestart },
        { label: "Quit to menu", onClick: onQuit },
    ];

    function onNavKey(e: React.KeyboardEvent) {
        const action = currentAction(e);
        const dir = action === "down" ? 1 : action === "up" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const i = items.current.findIndex((el) => el === document.activeElement);
        items.current[(i + dir + entries.length) % entries.length]?.focus();
    }

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm"
            onClick={onResume}
        >
            <div
                className="flex max-h-full w-full max-w-md flex-col gap-8 overflow-y-auto border border-line bg-surface px-8 py-8"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="pause-title"
            >
                <header className="flex flex-col gap-3">
                    <p className="label text-muted">Ghosts / Tokyo street playtest</p>
                    <h2
                        id="pause-title"
                        className="font-mono text-3xl font-light tracking-[0.28em] text-foreground uppercase"
                    >
                        {view === "menu" ? "Paused" : "Options"}
                    </h2>
                </header>

                {view === "menu" ? (
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
                ) : (
                    <div className="flex flex-col gap-8">
                        <section className="flex flex-col gap-1">
                            <h3 className="label pb-2 text-muted">Audio</h3>
                            <AudioPanel />
                        </section>
                        <section className="flex flex-col gap-1">
                            <h3 className="label pb-2 text-muted">Display</h3>
                            <DisplayPanel />
                        </section>
                        <div>
                            <button ref={back} className="btn" onClick={() => setView("menu")}>
                                ‹ Back
                            </button>
                        </div>
                    </div>
                )}

                <Hint
                    items={
                        view === "menu"
                            ? [
                                  ["up", "move"],
                                  ["confirm", "select"],
                                  ["back", "resume"],
                              ]
                            : [["back", "menu"]]
                    }
                />
            </div>
        </div>
    );
}
