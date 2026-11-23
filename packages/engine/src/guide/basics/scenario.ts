// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics as encounters: one per stage, all on the same simulation room and
 * map plan, played by the rules a chain match on the stage's tile grid
 * follows (`scenarioFromLevel`). Every stage deploys the same units (so the
 * field can switch stages without a reload, `restage`): the ones the stage
 * uses in the room, the rest waiting far outside it. The squad is fixed so
 * the words can name it: VEX (rifle, frag grenade), GHOST (marksman rifle,
 * flashbang), BISHOP (rifle). The targets carry rifles and no armour.
 */
import { initialSquad } from "@ghosts/squad/model";
import type { Recruit } from "@ghosts/squad/types";
import { scenarioFromLevel } from "../../editor/playtest.ts";
import type { Scenario, UnitSpec } from "../../scenario.ts";
import { BRIEFING } from "./copy.ts";
import { parked, stageLevel, type StageId } from "./level.ts";
import { STAGES } from "./script.ts";

/** The training's id; the host keys its progress by it. */
export const BASICS_ID = "basics";

/** The whole squad, from the default roster's faces: VEX, GHOST and BISHOP. */
export function basicsSquad(): Recruit[] {
  const [vex, ghost, bishop] = initialSquad().recruits;
  const kit = (r: Recruit, primary: string, utility: string | null): Recruit => ({
    ...r,
    equipment: { ...r.equipment, primary, armor: "spectre", utility },
    attachments: {},
  });
  return [kit(vex, "mx4", "frag"), kit(ghost, "srs9", "flash"), kit(bishop, "mx4", null)];
}

const TARGET_NAMES = ["TARGET–01", "TARGET–02", "TARGET–03"];

/** A stage of Basics as an encounter. */
export function stageScenario(id: StageId): Scenario {
  const spec = STAGES.find((s) => s.id === id)!;
  const base = scenarioFromLevel(stageLevel(id));
  const squad = base.units.filter((u) => !u.enemy);
  const hostile = base.units.find((u) => u.enemy)!;
  const units: UnitSpec[] = [
    ...squad.map((u, i) => ({ ...u, pos: spec.allies[u.id] ?? parked(i, false) })),
    ...["h1", "h2", "h3"].map(
      (uid, i): UnitSpec => ({
        ...hostile,
        id: uid,
        name: TARGET_NAMES[i],
        full: "Simulation target",
        role: "ASSAULT",
        pos: spec.hostiles[uid] ?? parked(i, true),
        kit: { primary: "mx4", armor: null },
      }),
    ),
  ];
  return {
    ...base,
    id: `basics-${id}`,
    // One plan id for every stage: the scenery stays, the props are the stage's.
    map: { ...base.map, id: "level:basics" },
    units,
    noObjective: true,
    skipBriefing: true,
    briefing: BRIEFING.briefing,
    location: BRIEFING.location,
    contract: BRIEFING.contract,
    objectives: BRIEFING.objectives,
    lines: BRIEFING.lines,
  };
}
