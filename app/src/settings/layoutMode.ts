// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";

import { padConnected, subscribePad } from "@ghosts/engine/gamepad";

import type { SettingRow } from "./SettingList";
import { DEFAULTS, LAYOUTS, useSettings, useSettingsSection, type LayoutChoice } from "./store";

/** How the Settings screen presents itself right now. */
export type LayoutMode = "desktop" | "controller";

/**
 * The effective settings layout: the stored choice, with "auto" following the
 * pad CONNECTION. Connection is stable — `padActive` flaps between the pad and
 * the mouse on every input, and a layout that re-arranges itself mid-gesture
 * would be unusable.
 */
export function useLayoutMode(): LayoutMode {
    const [settings] = useSettings();
    const connected = useSyncExternalStore(subscribePad, padConnected);
    const layout = settings.controls.layout;
    return layout === "controller" || (layout === "auto" && connected) ? "controller" : "desktop";
}

const LAYOUT_LABELS: Record<LayoutChoice, string> = {
    auto: "Auto",
    desktop: "Desktop",
    controller: "Controller",
};

/** The "Settings layout" choice row, shared by the Display and Controller panels. */
export function useLayoutRow(): SettingRow {
    const [controls, setControls] = useSettingsSection("controls");
    // Any explicit choice also answers the "controller connected" prompt.
    const setLayout = (layout: LayoutChoice) => setControls({ layout, layoutAnswered: true });
    const step = (dir: 1 | -1) =>
        setLayout(
            LAYOUTS[(LAYOUTS.indexOf(controls.layout) + dir + LAYOUTS.length) % LAYOUTS.length],
        );
    return {
        kind: "choice",
        id: "layout",
        label: "Settings layout",
        description:
            "How Settings lays itself out. Auto uses the controller layout while a pad is connected and the desktop layout otherwise.",
        value: LAYOUT_LABELS[controls.layout],
        onPrev: () => step(-1),
        onNext: () => step(1),
        onReset: () => setLayout(DEFAULTS.controls.layout),
    };
}
