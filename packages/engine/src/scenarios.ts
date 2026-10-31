// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { blackRain, type Scenario } from "./scenario.ts";
import { paperTrail } from "./office/scenario.ts";

/**
 * Every playable encounter, in campaign order. A new level is a `Scenario`
 * (the rules), scenery registered for its map id (`scene/maps.ts`) and an
 * entry here; hosts pick one and mount `<Encounter scenario={...}>`.
 */
export const scenarios: readonly Scenario[] = [blackRain, paperTrail];

/** The scenario with `id`, or undefined for a level this build does not know. */
export function scenarioById(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
