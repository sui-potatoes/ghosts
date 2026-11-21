// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Haptics for the menus: the pad's rumble motors (`vibrationActuator`,
 * `dual-rumble`) while the pad is the input in use, `navigator.vibrate` on a
 * phone while a finger is. Which buzz a gesture makes is `model.ts`; this is
 * the feature detection and the switch (Controls: Vibration). Nothing plays
 * while the window does not own the player's attention.
 */

import { inputMode } from "@ghosts/engine/input-mode";

import { audioFocused } from "../audio/focus";
import { getSettings } from "../settings/store";
import { hapticDevice, hapticPlan, MOVE_GAP_MS, type Gesture, type Rumble } from "./model";

export type { Gesture } from "./model";

type Actuator = {
    playEffect?: (
        type: "dual-rumble",
        params: {
            startDelay?: number;
            duration: number;
            strongMagnitude: number;
            weakMagnitude: number;
        },
    ) => Promise<unknown>;
};

let lastMove = -Infinity;

/** The first connected pad that can rumble. */
function actuator(): Actuator | null {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
        const motor = (pad as (Gamepad & { vibrationActuator?: Actuator }) | null)
            ?.vibrationActuator;
        if (motor?.playEffect) return motor;
    }
    return null;
}

function rumble(motor: Actuator, pulses: Rumble[]) {
    for (const p of pulses) {
        const play = () =>
            void motor
                .playEffect?.("dual-rumble", {
                    duration: p.duration,
                    strongMagnitude: p.strong,
                    weakMagnitude: p.weak,
                })
                ?.catch(() => {});
        // A new effect replaces the running one, so a second pulse waits its turn.
        if (p.delay > 0) window.setTimeout(play, p.delay);
        else play();
    }
}

/** Feel `gesture` on the input in use; `level` is how far a hold has come (0 to 1). */
export function haptic(gesture: Gesture, level = 1) {
    if (typeof window === "undefined" || !getSettings().controls.vibration) return;
    if (!audioFocused()) return;
    const device = hapticDevice(inputMode());
    if (device === "none") return;
    if (gesture === "move") {
        const now = performance.now();
        if (now - lastMove < MOVE_GAP_MS) return;
        lastMove = now;
    }
    const plan = hapticPlan(gesture, device, level);
    if (!plan) return;
    if ("rumble" in plan) {
        const motor = actuator();
        if (motor) rumble(motor, plan.rumble);
    } else if (typeof navigator.vibrate === "function") {
        try {
            navigator.vibrate(plan.vibrate);
        } catch {
            // Refused without a user gesture yet: nothing to feel.
        }
    }
}
