// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { CombatAction } from "./keys.ts";

/** The combat commands that only move the camera: they stay live while the session is busy. */
const CAMERA_COMMANDS: ReadonlySet<CombatAction> = new Set(["rotate-left", "rotate-right", "focus", "camera"]);

export function isCameraCommand(command: CombatAction | null | undefined): command is CombatAction {
  return !!command && CAMERA_COMMANDS.has(command);
}

/**
 * Whether the pad's free camera (left stick and d-pad pan, triggers zoom, right
 * stick tilts) is on: nobody selected, or not the player's turn to act (the
 * other side's phase, or an animation running). The radial wheel always owns the stick.
 */
export function padCameraFree(s: { selected: string; wheel: boolean; busy: boolean; phase: string }): boolean {
  return !s.wheel && (!s.selected || s.busy || s.phase !== "player");
}
