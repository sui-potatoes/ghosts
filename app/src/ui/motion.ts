// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { getSettings } from "../settings/store";

/**
 * The player asked for stillness: the system's reduced-motion preference or
 * Display: Reduce motion. Movement goes (overshoot, parallax, screen
 * motion); state changes, sounds and haptics stay.
 */
export function reducedMotion(): boolean {
    return (
        (typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
        getSettings().display.reduceMotion
    );
}
