// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AccountPanel, AudioPanel, ControlsPanel, DisplayPanel, PlayerPanel } from "./panels";
import { listStep } from "./store";
import "./settings.css";

const CATEGORIES = [
    { id: "player", label: "Player" },
    { id: "account", label: "Account & Security" },
    { id: "audio", label: "Audio" },
    { id: "display", label: "Display" },
    { id: "controls", label: "Controls" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function isCategory(v: string | null): v is CategoryId {
    return CATEGORIES.some((c) => c.id === v);
}

const PANELS: Record<CategoryId, () => ReactNode> = {
    player: PlayerPanel,
    account: AccountPanel,
    audio: AudioPanel,
    display: DisplayPanel,
    controls: ControlsPanel,
};

/** Header row: the way back on the left, the location on the right. */
export function SettingsHeader({ children }: { children: ReactNode }) {
    return (
        <header className="flex items-baseline justify-between gap-6">
            {children}
            <p className="label text-muted">System / Settings</p>
        </header>
    );
}

/**
 * Categories down the left (across the top on phones), the chosen panel on
 * the right. The route and the in-game overlay both wrap it.
 */
export function SettingsView({
    current,
    select,
}: {
    current: CategoryId;
    select: (id: CategoryId) => void;
}) {
    const navRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const index = CATEGORIES.findIndex((c) => c.id === current);

    function onNavKey(e: React.KeyboardEvent) {
        const next = listStep(e, index, CATEGORIES.length);
        if (next === null) return;
        select(CATEGORIES[next].id);
        navRefs.current[next]?.focus();
    }

    const Panel = PANELS[current];

    // Keys act on the category list from the moment the view opens.
    useEffect(() => {
        navRefs.current[index]?.focus();
    }, []);

    return (
        <div className="flex flex-col gap-8 md:flex-row md:gap-14">
            <nav
                aria-label="Settings categories"
                className="flex shrink-0 overflow-x-auto border-t border-line md:w-56 md:flex-col md:overflow-visible"
                onKeyDown={onNavKey}
            >
                {CATEGORIES.map((c, i) => (
                    <button
                        key={c.id}
                        ref={(el) => {
                            navRefs.current[i] = el;
                        }}
                        className="settings-nav-item"
                        aria-current={c.id === current ? "true" : undefined}
                        tabIndex={c.id === current ? 0 : -1}
                        onClick={() => select(c.id)}
                    >
                        {c.label}
                    </button>
                ))}
            </nav>

            <section
                key={current}
                aria-labelledby="settings-panel-title"
                className="flex min-w-0 flex-1 flex-col border-t border-line pt-6"
            >
                <h1
                    id="settings-panel-title"
                    className="mb-4 font-mono text-2xl font-light tracking-[0.2em] text-foreground uppercase"
                >
                    {CATEGORIES[index].label}
                </h1>
                <Panel />
            </section>
        </div>
    );
}

/** Settings inside the pause menu: same view, the encounter stays mounted behind it. */
export function SettingsOverlay({ onBack }: { onBack: () => void }) {
    const [current, setCurrent] = useState<CategoryId>("audio");
    return (
        <div className="flex flex-col gap-8">
            <SettingsHeader>
                <button className="label text-secondary hover:text-accent" onClick={onBack}>
                    Paused
                </button>
            </SettingsHeader>
            <SettingsView current={current} select={setCurrent} />
        </div>
    );
}
