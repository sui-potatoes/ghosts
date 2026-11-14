// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";

/**
 * Local type for the optional navigator.keyboard lock and unlock methods.
 */
type KeyboardLock = { lock(keys?: string[]): Promise<void>; unlock(): void };

function keyboardLock(): KeyboardLock | null {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    return keyboard && "lock" in keyboard ? keyboard : null;
}

// Release the Esc capture whenever fullscreen ends, however it was left.
if (typeof document !== "undefined") {
    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) keyboardLock()?.unlock();
    });
}

/**
 * Live browser fullscreen state. Not part of the settings store: browsers
 * only enter fullscreen from a user gesture, so it cannot be restored at
 * startup, and the system UI can flip it at any time.
 */
export function useFullscreen(): [boolean, (on: boolean) => void] {
    const on = useSyncExternalStore(
        (onChange) => {
            document.addEventListener("fullscreenchange", onChange);
            return () => document.removeEventListener("fullscreenchange", onChange);
        },
        () => document.fullscreenElement !== null,
    );
    const set = (next: boolean) => {
        if (next === (document.fullscreenElement !== null)) return;
        if (next)
            document.documentElement
                .requestFullscreen()
                .then(() => keyboardLock()?.lock(["Escape"]))
                .catch(() => {});
        else document.exitFullscreen().catch(() => {});
    };
    return [on, set];
}
