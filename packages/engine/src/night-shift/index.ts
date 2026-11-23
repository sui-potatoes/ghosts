// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Night Shift, Tokyo / Sector 11: a 21 × 22 street corner in the editor's
 * level format (`level.json`, the export file the editor reads and writes; the
 * editor opens it as a base). An all-night ELEVENTY store sits between its own
 * car park (side A, south) and a parcel depot (side B, north), with three
 * lanes between them: the road on the west, the store (front door, sales
 * floor, stockroom, back door) and the service alley on the east, joined by
 * the back lane and the forecourt. Played by the rules a chain match on its
 * tile grid follows (`scenarioFromLevel`); no objective, the last side
 * standing wins, as in a ranked match. `level.ts` draws the plan; `chain.ts`
 * pins the chain's copy.
 */
import { levelView } from "../editor/playtest-view.ts";
import type { Scenario } from "../scenario.ts";
import { registerMapView } from "../scene/maps.ts";
import { nightShiftLevel } from "./level.ts";
import { nightShiftScenario } from "./scenario.ts";

/** Night Shift, ready to mount: the scenario, with its scenery registered for the battlefield. */
export function nightShift(): Scenario {
  const scenario = nightShiftScenario();
  registerMapView(scenario.map.id, levelView(nightShiftLevel()));
  return scenario;
}

export { nightShiftLevel } from "./level.ts";
export { nightShiftScenario, NIGHT_SHIFT_ID } from "./scenario.ts";
export { NIGHT_SHIFT_MAP, NIGHT_SHIFT_NAME, NIGHT_SHIFT_POSITIONS, NIGHT_SHIFT_SIZE } from "./chain.ts";
export { NIGHT_SHIFT_SURROUNDINGS, type Surroundings, type SurroundingBuilding } from "./surroundings.ts";
