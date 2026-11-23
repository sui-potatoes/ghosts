// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics as an encounter: the yard played by the rules a chain match on its
 * tile grid follows (`scenarioFromLevel`), with its own words and loadouts.
 * The squad is fixed, so the instructions can name it: VEX with a rifle and a
 * frag grenade, GHOST with a marksman rifle and a flashbang. The Wraiths carry
 * rifles and no armour (10 HP, nothing off a hit, no dodge), so the lessons'
 * damage adds up the same way every run.
 */
import { initialSquad } from "@ghosts/squad/model";
import type { Recruit } from "@ghosts/squad/types";
import { scenarioFromLevel } from "../../editor/playtest.ts";
import type { Scenario } from "../../scenario.ts";
import { BRIEFING } from "./copy.ts";
import { basicsLevel } from "./level.ts";

/** The scenario id; the host keys the training's progress by it. */
export const BASICS_ID = "basics";

/** The squad, from the default roster's faces: VEX and GHOST. */
export function basicsSquad(): Recruit[] {
  const [vex, ghost] = initialSquad().recruits;
  return [
    { ...vex, equipment: { ...vex.equipment, primary: "mx4", armor: "spectre", utility: "frag" }, attachments: {} },
    { ...ghost, equipment: { ...ghost.equipment, primary: "srs9", armor: "spectre", utility: "flash" }, attachments: {} },
  ];
}

/** Basics, ready to mount. Throws only if the level file stops being playable. */
export function basicsScenario(): Scenario {
  const base = scenarioFromLevel(basicsLevel());
  return {
    ...base,
    id: BASICS_ID,
    units: base.units.map((u) =>
      u.enemy ? { ...u, role: "ASSAULT" as const, kit: { primary: "mx4", armor: null } } : u,
    ),
    briefing: BRIEFING.briefing,
    location: BRIEFING.location,
    contract: BRIEFING.contract,
    objectives: BRIEFING.objectives,
    lines: BRIEFING.lines,
  };
}
