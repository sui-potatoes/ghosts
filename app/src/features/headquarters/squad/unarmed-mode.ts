// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { UnarmedMode } from "@ghosts/squad/motion/smoking";

/**
 * The unarmed pose smokes a cigarette: it loops, unless the player asked for
 * reduced motion (a still frame, the OS or the game's setting) or battery
 * saving (one drag, then still).
 */
export function unarmedMode(
    display: { reduceMotion: boolean; batterySaver: boolean },
    osReduced: boolean,
): UnarmedMode {
    if (display.reduceMotion || osReduced) return "still";
    return display.batterySaver ? "once" : "loop";
}
