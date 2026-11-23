// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Night Shift as an encounter: the level played by the rules a chain match
 * on its tile grid follows (`scenarioFromLevel`), with its own words. No
 * objective: the last side standing wins, as in a ranked match.
 */
import { scenarioFromLevel } from "../editor/playtest.ts";
import type { Scenario } from "../scenario.ts";
import { nightShiftLevel } from "./level.ts";

/** The scenario id; the host keys the training's progress by it. */
export const NIGHT_SHIFT_ID = "night-shift";

/** Night Shift's words: the briefing, the location and the field's lines. */
const COPY: Pick<Scenario, "briefing" | "contract" | "location" | "objectives" | "lines"> = {
  briefing: {
    issuer: "HELIOS STRATEGIC INDUSTRIES / NIGHT DESK",
    title: "Operation Night Shift",
    setting: "Sector 11, Tokyo / 03:40 AM. The store on the corner never closes",
    scene: { place: "Sector 11, Tokyo", rest: "The store on the corner never closes" },
    contract: [
      "A Wraith cell runs its drops through the all-night ELEVENTY on the main road",
      "Three ways in: the road, the store, the service alley",
      "Leave no Wraith standing",
    ],
    rules:
      "Two action points per operator. Low cover takes 25 off the hit chance, high cover 50. Storefront glass and tall fences are high cover: nothing steps across them, and they stop a shot unless the shooter or the target stands against them. Walls, cars and vending machines stop everything. A grenade clears every shelf, fridge, counter and crate within two tiles.",
    facts: [
      ["EMPLOYER", "HELIOS INDUSTRIES"],
      ["OPPOSITION", "WRAITH CELL"],
      ["GROUND", "19 × 24 TILES"],
      ["WIN", "NO HOSTILE STANDING"],
    ],
  },
  contract: { employer: "HELIOS", division: "STRATEGIC INDUSTRIES", value: "₡ 36,000", threat: "HIGH", threatLevel: 4 },
  location: { sector: "SECTOR 11 / TOKYO", coordinates: ["35° 41′ N", "139° 42′ E"], code: "NS–11.024" },
  objectives: {
    secure: { title: "Hold the corner", detail: "Clear the store and the street", order: "Hold the corner" },
    eliminate: { title: "Clear the Wraith cell", order: "Clear Wraith forces" },
  },
  lines: {
    opening: "Squad deployed. Sector 11",
    secured: "Corner clear",
    securedStamp: "CORNER CLEAR",
  },
};

/** Night Shift as an encounter: the rules and the words, its scenery not registered (node-safe). */
export function nightShiftScenario(): Scenario {
  return { ...scenarioFromLevel(nightShiftLevel()), id: NIGHT_SHIFT_ID, ...COPY };
}

