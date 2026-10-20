// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { cancelTargeting } from "../actions";
import { keyCap, type CombatAction } from "../keys";
import { session } from "../session";
import { engineSettings } from "../settings";

/** The key cap for an action under the player's current bindings. */
export function cap(action: CombatAction): string {
  return keyCap(engineSettings().combatKeys()[action][0] ?? "");
}

export function toggleGrid() {
  const { battlefield } = session;
  battlefield.setGrid(!battlefield.gridVisible);
  session.changed();
}

/** Close camera on the selected operator and back; in a targeting mode, leave it first. */
export function toggleView() {
  if (session.busy) return;
  if (session.mode !== "move") {
    cancelTargeting();
    return;
  }
  const { battlefield } = session;
  battlefield.view(!battlefield.cinematic);
  session.changed();
}
