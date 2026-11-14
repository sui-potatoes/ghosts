// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect } from "react";
import type { WireframeColors } from "@ghosts/squad/studio/wireframe";
import { onKeys } from "../../input";
import {
    currentAction,
    getSettings,
    updateSettings,
    useSettingsSection,
} from "../../settings/store";
import { wireframeKeyFree } from "./wireframe-key";

/** The wireframe view of the gear and recruit stages: a saved display setting. */
export function useWireframe(): [boolean, (on: boolean) => void] {
    const [display, setDisplay] = useSettingsSection("display");
    return [display.wireframe, (on) => setDisplay({ wireframe: on })];
}

/**
 * Z toggles the wireframe through the input bus's shortcut lane: a hidden
 * developer shortcut, listed nowhere. Mounted by every screen that has a 3D
 * stage (`StagePanel`, the classic viewports), never by a match, so combat
 * keys are untouched. A key the player has bound to a menu action or a combat
 * action is theirs: the shortcut yields to it (`wireframeKeyFree`).
 */
export function useWireframeShortcut() {
    useEffect(
        () =>
            onKeys({
                z: (e) => {
                    if (!wireframeKeyFree(currentAction(e), getSettings().controls.combat))
                        return false;
                    updateSettings((s) => ({
                        ...s,
                        display: { ...s.display, wireframe: !s.display.wireframe },
                    }));
                },
            }),
        [],
    );
}

/** Edge and fill colours from the theme: the accent over the surface tone. */
export function wireframeColors(element: Element): WireframeColors {
    const style = getComputedStyle(element);
    const read = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
    return { line: read("--accent-color", "#7fe3ef"), fill: read("--surface-color", "#101215") };
}
