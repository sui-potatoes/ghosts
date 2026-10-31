// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";

import { padConnected, subscribePad } from "@ghosts/engine/gamepad";

import { useSettings } from "./store";

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
