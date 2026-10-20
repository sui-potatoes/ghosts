/**
 * The Ghosts encounter engine. Mount `<Encounter>` to play; the rules,
 * scenario, keys and settings types are here for hosts that store
 * preferences or author scenarios.
 */
import { reset, showBriefing } from "./actions";

export { Encounter, type EncounterProps } from "./ui/Encounter";
export { blackRain, type Scenario } from "./scenario";
export { defaultSettings, type AudioLevels, type EngineSettings } from "./settings";
export {
  COMBAT_ACTIONS,
  COMBAT_LABELS,
  DEFAULT_COMBAT_BINDINGS,
  combatActionOf,
  keyCap,
  sanitizeCombatBindings,
  type CombatAction,
  type CombatBindings,
} from "./keys";

/** A fresh encounter with the same squad, back at the deployment briefing. */
export function restartEncounter() {
  reset();
}

/** Show the briefing over the field. */
export function openBriefing() {
  showBriefing("intel");
}
