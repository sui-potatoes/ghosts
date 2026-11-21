// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The interface effects' settings, as pure rules (tested in
 * `tests/settings-gui.test.ts`): how much the interface moves, read from a
 * saved object of any age, and what the player gets once the system's own
 * reduced-motion preference is counted. No DOM, no store.
 */

/**
 * Interface motion. `full`: everything, the cursor's overshoot, the depth
 * between screens, the spring of a press, the bloom and the title scene's
 * lean included. `reduced`: those go; the interface still animates its plain
 * state changes. `off`: nothing animates (the old "Reduce motion" on).
 */
export const MOTION_LEVELS = ["full", "reduced", "off"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];

/**
 * The level a saved display section asks for. Saves from before the level
 * existed only have `reduceMotion`: on is `off`, anything else `full`.
 */
export function motionOf(display: { motion?: unknown; reduceMotion?: unknown }): MotionLevel {
    if (MOTION_LEVELS.includes(display.motion as MotionLevel)) return display.motion as MotionLevel;
    return display.reduceMotion === true ? "off" : "full";
}

type Display = { motion: MotionLevel; reduceMotion: boolean };

/**
 * A write that only touched the legacy `reduceMotion` switch (the classic
 * settings screen) moves the level with it; otherwise the level decides and
 * `reduceMotion` follows it (it is `motion === "off"`, kept for its readers).
 */
export function settleMotion<D extends Display>(prev: D, next: D): D {
    const motion =
        next.reduceMotion !== prev.reduceMotion && next.motion === prev.motion
            ? next.reduceMotion
                ? "off"
                : "full"
            : next.motion;
    return { ...next, motion, reduceMotion: motion === "off" };
}

/**
 * What the player gets: the system's reduced-motion preference wins, as
 * before (no overshoot, depth or lean, and the interface's own animation
 * held by the system's media query), whatever the level.
 */
export function effectiveMotion(level: MotionLevel, systemReduced: boolean): MotionLevel {
    return systemReduced ? "off" : level;
}
