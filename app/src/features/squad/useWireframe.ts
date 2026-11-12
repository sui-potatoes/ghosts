// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect } from "react";
import type { WireframeColors } from "@ghosts/squad/studio/wireframe";
import { onKeys } from "../../input";
import { useSettingsSection } from "../../settings/store";

/** The wireframe view of the gear and recruit stages: a saved display setting. */
export function useWireframe(): [boolean, (on: boolean) => void] {
    const [display, setDisplay] = useSettingsSection("display");
    return [display.wireframe, (on) => setDisplay({ wireframe: on })];
}

/**
 * Z toggles the wireframe through the input bus's shortcut lane (the menu
 * actions own W A S D Q E R and the arrows; Z is unbound; Blender's key too).
 */
export function useWireframeShortcut() {
    const [on, set] = useWireframe();
    useEffect(() => onKeys({ z: () => set(!on) }), [on, set]);
}

/** Edge and fill colours from the theme: the accent over the surface tone. */
export function wireframeColors(element: Element): WireframeColors {
    const style = getComputedStyle(element);
    const read = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
    return { line: read("--accent-color", "#7fe3ef"), fill: read("--surface-color", "#101215") };
}
