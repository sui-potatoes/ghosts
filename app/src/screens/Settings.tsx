// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Link, useSearchParams } from "react-router-dom";

import { useLayoutMode } from "../settings/layoutMode";
import {
    isCategory,
    SettingsHeader,
    SettingsSmoke,
    SettingsView,
    type CategoryId,
} from "../settings/SettingsView";

/**
 * The settings route. The category is kept in `?tab=` so it survives a reload
 * and can be linked, but tab changes replace the history entry so the back
 * action still leaves the screen.
 */
export default function Settings() {
    const [params, setParams] = useSearchParams();
    const tab = params.get("tab");
    const current: CategoryId = isCategory(tab) ? tab : "player";
    // The controller layout takes the whole screen width.
    const mode = useLayoutMode();

    return (
        <main className="relative isolate flex h-screen flex-col px-6 py-10 md:px-16 md:py-16">
            <SettingsSmoke />
            <div
                className={`mx-auto flex min-h-0 w-full flex-1 flex-col gap-10 ${
                    mode === "controller" ? "" : "max-w-6xl"
                }`}
            >
                {/* The controller layout folds the header into the tab bar. */}
                {mode === "desktop" && (
                    <SettingsHeader>
                        <Link to="/" className="label text-secondary hover:text-accent">
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
