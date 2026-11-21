// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Which buzz a gesture makes on which device (tested in
 * `tests/tactile.test.ts`). A pad rumbles on every gesture, a move only a
 * short light pulse; a phone buzzes only for what was decided (a confirm, a
 * refusal, a hold), never for a hover or a scroll. Keyboard and mouse have
 * nothing to shake.
 */

export type Gesture = "move" | "confirm" | "deny" | "back" | "hold";

/** What the input in use can feel. */
export type HapticDevice = "pad" | "touch" | "none";

/** One `dual-rumble` effect; magnitudes 0 to 1, times in ms. */
export type Rumble = { delay: number; duration: number; strong: number; weak: number };

export type HapticPlan = { rumble: Rumble[] } | { vibrate: number[] };

/** The device for an input mode (`@ghosts/engine/input-mode`). */
export function hapticDevice(mode: "keyboard" | "gamepad" | "mouse" | "touch"): HapticDevice {
    return mode === "gamepad" ? "pad" : mode === "touch" ? "touch" : "none";
}

/** The least gap between two move pulses on a pad (a held stick repeats at 130 ms). */
export const MOVE_GAP_MS = 40;

/**
 * The buzz for `gesture` on `device`; `level` (0 to 1) is how far a hold has
 * come, so its rumble grows. Null: nothing to feel.
 */
export function hapticPlan(gesture: Gesture, device: HapticDevice, level = 1): HapticPlan | null {
    const l = Math.max(0, Math.min(1, level));
    if (device === "pad") {
        switch (gesture) {
            case "move":
                return { rumble: [{ delay: 0, duration: 18, strong: 0, weak: 0.18 }] };
            case "confirm":
                return { rumble: [{ delay: 0, duration: 42, strong: 0.35, weak: 0.55 }] };
            case "deny":
                return {
                    rumble: [
                        { delay: 0, duration: 45, strong: 0.5, weak: 0.3 },
                        { delay: 95, duration: 45, strong: 0.5, weak: 0.3 },
                    ],
                };
            case "back":
                return { rumble: [{ delay: 0, duration: 22, strong: 0, weak: 0.25 }] };
            case "hold":
                return {
                    rumble: [
                        {
                            delay: 0,
                            duration: 60,
                            strong: round(0.1 + 0.45 * l),
                            weak: round(0.2 + 0.4 * l),
                        },
                    ],
                };
        }
    }
    if (device === "touch") {
        switch (gesture) {
            case "confirm":
                return { vibrate: [12] };
            case "deny":
                return { vibrate: [16, 70, 16] };
            case "hold":
                return { vibrate: [Math.round(6 + 8 * l)] };
            default:
                return null;
        }
    }
    return null;
}

const round = (v: number) => Math.round(v * 100) / 100;
