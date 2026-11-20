// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Cell, Unit } from "./game.ts";
import type { Battlefield } from "./scene/battlefield.ts";

/**
 * The thrower's lead-in, before the pin. A player's own throw frames it over
 * the shoulder; a viewer's camera is the viewer's, so the thrower takes the
 * same stance and turn with the camera left exactly where it is.
 */
export function leadIn(
  battlefield: Pick<Battlefield, "aimAt" | "readyThrow">,
  watching: boolean,
  u: Unit,
  at: Cell,
): Promise<void> {
  return watching ? battlefield.readyThrow(u, at) : battlefield.aimAt(u, at, "grenade");
}
