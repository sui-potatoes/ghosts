// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Ghosts encounter engine. Mount `<Encounter>` to play; the rules,
 * scenario and settings types are here for hosts that store preferences
 * or author scenarios. Key bindings, gamepad, sounds, demo assets and the
 * editor have their own subpaths (`@ghosts/engine/keys`, `/gamepad`,
 * `/sounds`, `/demo-assets`, `/editor`).
 */
import { closeDebrief, reset, showBriefing } from "./actions";
import { encounterReport, type EncounterDebrief } from "./aftermath/report";
import { session } from "./session";

export { correctEncounter, followOpponent } from "./actions";

export { Encounter, type EncounterProps, type ObserverCard, type ObserverEnding, type ObserverOptions } from "./ui/Encounter";
export { Playback, SPEEDS, type PlaybackState, type Speed } from "./replay/playback";
export {
  opensTurn,
  recordedSource,
  turnAt,
  turnsOf,
  type RecordSource,
  type TurnMark,
  type WatchOutcome,
  type WatchSide,
} from "./replay/timeline";
export type { EncounterDebrief, EncounterReport, RecruitReport } from "./aftermath/report";
export { blackRain, type Scenario, type UnitSpec } from "./scenario";
export { scenarioById, scenarios } from "./scenarios";
export { lookName, lookOfGame, type SceneLook } from "./scene-look";
export { paperTrail } from "./office/scenario";
export { OfficeAssets, officeCatalog, officeFinishes, type OfficeKind, type OfficeFinish } from "./office/assets";
export { ShopAssets, shopFinishes, shopKinds, type ShopKind, type ShopFinish } from "./shop/assets";
export { deployedIntel } from "./squad-bridge";
export { localDriver, type DriverFactory, type EncounterDriver } from "./driver";
export { Guide, type GuideHost } from "./guide/run";
export { basicsTraining, BASICS_ID } from "./guide/basics";
export {
  nightShift, nightShiftLevel, nightShiftScenario, NIGHT_SHIFT_ID, NIGHT_SHIFT_MAP, NIGHT_SHIFT_NAME, NIGHT_SHIFT_POSITIONS,
  NIGHT_SHIFT_SIZE,
} from "./night-shift";
export type { Command, GameEvent } from "./events";
export { replayEncounter, type Encounter as EncounterRules, type UnitOrder } from "./game";
export { defaultSettings, type AudioLevels, type EngineSettings } from "./settings";
export type { Unit as EncounterUnit } from "./game";
export {
  baseIntel,
  weaponLabel,
  type IntelSource,
  type ModKind,
  type OpponentIntel,
  type UnitIntel,
  type WeaponMod,
} from "./intel";

/** A fresh encounter with the same squad, back at the deployment briefing. */
export function restartEncounter() {
  reset();
}

/** End the host's debrief (`onDebrief`) and show the field as it stands. */
export function closeEncounterDebrief() {
  closeDebrief();
}

/** Show the briefing over the field. */
export function openBriefing() {
  showBriefing("intel");
}

/** A viewer: show the match card (`ObserverOptions.card`) over the field, without starting or stopping anything. */
export function openMatchCard() {
  showBriefing("match");
}

/**
 * The mounted encounter's after-action report as it stands now, for a host
 * that ends it early (a forfeit): who is down, kills so far, the turn.
 */
export function encounterSnapshot(): EncounterDebrief {
  const { game } = session;
  return {
    report: encounterReport(game),
    operation: game.scenario.briefing.title,
    sector: game.scenario.location.sector,
  };
}
