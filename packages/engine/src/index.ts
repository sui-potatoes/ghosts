// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Ghosts encounter engine. Mount `<Encounter>` to play; the rules,
 * scenario and settings types are here for hosts that store preferences
 * or author scenarios. Key bindings, gamepad, sounds, demo assets and the
 * editor have their own subpaths (`@ghosts/engine/keys`, `/gamepad`,
 * `/sounds`, `/demo-assets`, `/editor`).
 */
import { reset, showBriefing } from "./actions";

export { correctEncounter, followOpponent } from "./actions";

export { Encounter, type EncounterProps } from "./ui/Encounter";
export { blackRain, type Scenario, type UnitSpec } from "./scenario";
export { scenarioById, scenarios } from "./scenarios";
export { paperTrail } from "./office/scenario";
export { OfficeAssets, officeCatalog, officeFinishes, type OfficeKind, type OfficeFinish } from "./office/assets";
export { localDriver, type DriverFactory, type EncounterDriver } from "./driver";
export type { Command, GameEvent } from "./events";
export { replayEncounter, type Encounter as EncounterRules } from "./game";
export { defaultSettings, type AudioLevels, type EngineSettings } from "./settings";

/** A fresh encounter with the same squad, back at the deployment briefing. */
export function restartEncounter() {
  reset();
}

/** Show the briefing over the field. */
export function openBriefing() {
  showBriefing("intel");
}
