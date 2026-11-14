// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useFitScale } from "../hooks/useFitScale";
import { useGoUp } from "../hooks/useGoUp";

import { useLayoutMode } from "../settings/layoutMode";
import {
    isCategory,
    SettingsHeader,
    SETTINGS_FIT_HEIGHT,
    SETTINGS_FIT_WIDTH,
    SettingsSmoke,
    SettingsView,
    type CategoryId,
} from "../settings/SettingsView";

/**
 * The classic settings screen, kept at `/settings-classic` (and behind the
 * switch in `Settings.tsx`) until the shared-interface one is signed off. The
 * category is kept in `?tab=` so it survives a reload
 * and can be linked, but tab changes replace the history entry so the back
 * action still leaves the screen.
 */
export default function SettingsClassic() {
    const [params, setParams] = useSearchParams();
    const goUp = useGoUp();
    const tab = params.get("tab");
    const current: CategoryId = isCategory(tab) ? tab : "player";
    // The controller layout takes the whole screen width.
    const mode = useLayoutMode();
    const screen = useRef<HTMLElement | null>(null);
    useFitScale(screen, { designHeight: SETTINGS_FIT_HEIGHT, designWidth: SETTINGS_FIT_WIDTH });

    return (
        <main
            ref={screen}
            className="set-screen fit-root relative isolate flex h-dvh flex-col px-6 py-10 md:px-16 md:py-16"
        >
            <SettingsSmoke />
            <div
                className={`mx-auto flex min-h-0 w-full flex-1 flex-col gap-10 ${
                    mode === "controller" ? "" : "max-w-6xl"
                }`}
            >
                {/* The controller layout folds the header into the tab bar. */}
                {mode === "desktop" && (
                    <SettingsHeader>
                        <Link
                            to="/"
                            className="label text-secondary hover:text-accent"
                            onClick={(e) => {
                                e.preventDefault();
                                goUp();
                            }}
                        >
                            ← Menu
                        </Link>
                    </SettingsHeader>
                )}
                <SettingsView
                    current={current}
                    select={(id) =>
                        setParams(id === "player" ? {} : { tab: id }, { replace: true })
                    }
                />
            </div>
        </main>
    );
}
