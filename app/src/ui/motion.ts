// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { effectiveMotion, type MotionLevel } from "../settings/effects-model";
import { getSettings } from "../settings/store";

/**
 * How much the interface moves now: Display: Interface motion, with the
 * system's reduced-motion preference winning (`effects-model.ts`).
 */
export function motionLevel(): MotionLevel {
    const system =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return effectiveMotion(getSettings().display.motion, system);
}

/**
 * The tactile motion is held: no cursor overshoot, no depth between screens,
 * no lean. State changes, sounds and haptics stay.
 */
export function reducedMotion(): boolean {
    return motionLevel() !== "full";
}
