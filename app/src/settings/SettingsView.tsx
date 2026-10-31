// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, type ReactNode } from "react";

import { uiTick } from "../audio";
import { useBack } from "../hooks/useBack";
import { onAction } from "../input";
import { ControllerPanel } from "./ControllerPanel";
import { AccountPanel, AudioPanel, ControlsPanel, DisplayPanel, PlayerPanel } from "./panels";
import { dialogAbove, ResetHintContext, SettingsHints } from "./SettingList";
import { startSmoke } from "./smoke";
import "./settings.css";

const CATEGORIES = [
    { id: "player", label: "Player" },
    { id: "account", label: "Account & Security" },
    { id: "audio", label: "Audio" },
    { id: "display", label: "Display" },
    { id: "controls", label: "Controls" },
    { id: "controller", label: "Controller" },
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
    controller: ControllerPanel,
};

/**
 * Dimmed smoke drifting behind the menu, Sifu-style: canvas-rendered puffs
 * on a slow wind (settings/smoke.ts). Purely decorative; the host element
 * needs `relative isolate` so the layer sits behind the content but above
 * the host's backdrop. Reduce-motion freezes the field.
 */
export function SettingsSmoke() {
    const canvas = useRef<HTMLCanvasElement | null>(null);
    useEffect(() => {
        if (!canvas.current) return;
        return startSmoke(canvas.current);
    }, []);
    return (
        <canvas
            ref={canvas}
            className="set-smoke pointer-events-none absolute bottom-0 left-0 -z-10 h-[55%] w-full"
            aria-hidden
        />
    );
}

/** Header row: the way back on the left, the location on the right. */
export function SettingsHeader({ children }: { children: ReactNode }) {
    return (
        <header className="set-header flex items-baseline justify-between gap-6">
            {children}
            <p className="label text-muted">System / Settings</p>
        </header>
    );
}

/**
 * The Sifu-style settings menu: categories down the left (switched with the
 * prev/next-tab keys, shown in the hints bar), the category's setting rows on
 * the right, a description panel and a key-hints bar at the bottom. On phones
 * the categories collapse to a scrolling row on top. The route and the
 * in-game overlay both wrap it.
 */
export function SettingsView({
    current,
    select,
}: {
    current: CategoryId;
    select: (id: CategoryId) => void;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const index = CATEGORIES.findIndex((c) => c.id === current);
    const [canReset, setCanReset] = useState(false);

    function step(dir: 1 | -1) {
        uiTick();
        select(CATEGORIES[(index + dir + CATEGORIES.length) % CATEGORIES.length].id);
    }

    // Category switching needs no DOM focus: the view consumes prev/next-tab
    // off the input bus while mounted. A dialog stacked above still wins.
    const stepRef = useRef(step);
    stepRef.current = step;
    useEffect(
        () =>
            onAction((action) => {
                if (action !== "prev-tab" && action !== "next-tab") return false;
                if (dialogAbove(rootRef.current)) return false;
                stepRef.current(action === "prev-tab" ? -1 : 1);
                return true;
            }),
        [],
    );

    // Keep the active category in view when the list overflows on phones.
    useEffect(() => {
        tabRefs.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [index]);

    const Panel = PANELS[current];

    return (
        <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 md:flex-row md:gap-16">
                <nav className="set-nav" aria-label="Settings categories">
                    {CATEGORIES.map((c, i) => (
                        <button
                            key={c.id}
                            ref={(el) => {
                                tabRefs.current[i] = el;
                            }}
                            type="button"
                            className="set-nav-item"
                            aria-current={c.id === current ? "true" : undefined}
                            tabIndex={-1}
                            onClick={() => select(c.id)}
                        >
                            {c.label}
                        </button>
                    ))}
                </nav>

                <section
                    key={current}
                    aria-label={CATEGORIES[index].label}
                    className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                    <ResetHintContext.Provider value={setCanReset}>
                        <Panel />
                    </ResetHintContext.Provider>
                </section>
            </div>

            {/* A global footer across the whole view, not a menu section. */}
            <SettingsHints canReset={canReset} />
        </div>
    );
}

/**
 * Settings inside the pause menu: the same view at the same full-screen
 * proportions as the route, with the encounter still mounted behind it.
 */
export function SettingsOverlay({ onBack }: { onBack: () => void }) {
    const [current, setCurrent] = useState<CategoryId>("audio");
    // Back closes the settings first; the pause menu behind keeps its own back.
    useBack(onBack);
    return (
        <div className="relative isolate flex h-full min-h-0 flex-col">
            <SettingsSmoke />
            <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-10">
                <SettingsHeader>
                    <button className="label text-secondary hover:text-accent" onClick={onBack}>
                        ← Paused
                    </button>
                </SettingsHeader>
                <SettingsView current={current} select={setCurrent} />
            </div>
        </div>
    );
}
