// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { blackRain, type Scenario } from "../scenario.ts";
import { officePlan } from "./plan.ts";

export const paperTrail: Scenario = {
  ...blackRain,
  id: "paper-trail",
  map: officePlan,
  relay: [0, -5],
  briefing: {
    issuer: "HELIOS STRATEGIC INDUSTRIES / INTERNAL AFFAIRS",
    title: "Demo 2 · Paper Trail",
    setting: "Kōra administration / Floor 07 / After hours. Follow the paper trail.",
    contract: [
      "Wraith forces are erasing the procurement archive. Cross the office floor, enter records through either open doorway and recover the evidence from the uplink.",
      "Move an operator onto the illuminated relay pad and use *Extract*. Neutralize the three hostile operators to complete the contract.",
    ],
    rules: "Two action points per operator. Desks and filing cabinets provide low cover. Chairs and glass partitions block movement; glass provides no protection. Furniture breaks under fire and explosions. One nearby grenade breaches office wall panels and steel doors; rifle fire only shatters their glass panes. Doors are propped open and PIN pads are display props.",
    facts: [["STAGE", "DEMO 2 / OFFICE"], ["ASSET PACK", "29 MODULAR OBJECTS"], ["OPPOSITION", "WRAITH FORCES"], ["EXTRACTION", "PROCUREMENT ARCHIVE"]],
  },
  location: { sector: "ADMINISTRATION / FLOOR 07", coordinates: ["35° 41′ N", "139° 41′ E"], code: "PT–07.002" },
  objectives: {
    secure: { title: "Recover the archive", detail: "Reach the records room uplink.", order: "Extract procurement records" },
    eliminate: { title: "Clear office hostiles", order: "Neutralize Wraith forces" },
  },
  lines: { opening: "Office breach. Recover the procurement archive.", secured: "Records acquired. Clear remaining hostiles.", securedStamp: "ARCHIVE RECOVERED" },
  units: blackRain.units.map((unit, i) => ({ ...unit, pos: ([[-3, 5], [-1, 5], [1, 5], [0, 6], [-4, -3], [5, -2], [2, -5]] as [number, number][])[i] })),
};
