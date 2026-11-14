// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The `/settings` route and the pause menu's Options, in the shared interface
 * language (`src/features/settings/`). The category is kept in `?tab=` so it
 * survives a reload and can be linked; tab changes replace the history entry,
 * so Back still leaves the screen.
 *
 * REVERTING: set `CLASSIC` below to `true`. `/settings` and the pause menu's
 * Options then render the classic screen again (`SettingsClassic.tsx` and
 * `SettingsOverlay` from `src/settings/SettingsView.tsx`), unchanged. The
 * classic screen stays reachable at `/settings-classic` either way.
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useGoUp } from "../hooks/useGoUp";

import { tabOf, tabParams, type TabId } from "../features/settings/model";
import { SettingsView } from "../features/settings/SettingsView";
import { SettingsOverlay } from "../settings/SettingsView";
import SettingsClassic from "./SettingsClassic";

const CLASSIC = false;

export default function Settings() {
    return CLASSIC ? <SettingsClassic /> : <SettingsScreen />;
}

/** The pause menu's Options: Back returns to the pause menu. */
export function SettingsOptions({ onBack }: { onBack: () => void }) {
    return CLASSIC ? <SettingsOverlay onBack={onBack} /> : <OptionsScreen onBack={onBack} />;
}

function SettingsScreen() {
    const [params, setParams] = useSearchParams();
    const leave = useGoUp();
    return (
        <SettingsView
            tab={tabOf(params.get("tab"))}
            onTab={(tab) => setParams(tabParams(tab), { replace: true })}
            location={["System", "Settings"]}
            backLabel="Leave"
            onBack={leave}
        />
    );
}

/**
 * Inside the encounter: a FocusRoot of its own, mounted over the paused field.
 * While it is up it takes every menu action (the newest consumer on the input
 * bus) and claims Back; unmounting hands both back to the pause menu.
 */
function OptionsScreen({ onBack }: { onBack: () => void }) {
    const [tab, setTab] = useState<TabId>("audio");
    return (
        <SettingsView
            tab={tab}
            onTab={setTab}
            location={["Paused", "Options"]}
            backLabel="Paused"
            onBack={onBack}
        />
    );
}
