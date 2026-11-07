// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { initialSquad } from "@ghosts/squad/model";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import type { Appearance, ArmorColors, Recruit } from "@ghosts/squad/types";
import type { Unit } from "./game.ts";

export interface DeploymentLook {
  appearance: Appearance;
  armorId: string | null;
  armorColors: ArmorColors;
  name?: string;
  callsign?: string;
  /** Voice index within the look's sex; unset means the first recorded voice. */
  voice?: number;
}
const showcase = ["nyx-mid", "nyx", "nyx-heavy", "nyx"];
/**
 * The look of every unit: allies from the host's saved recruits (the one with
 * their id, else by squad order, however the hostiles are mixed in among them),
 * hostiles and missing recruits from the default roster. Without a saved squad
 * the showcase armor tiers are worn. The recruits are only read.
 */
export function deploymentLooks(recruits: readonly Recruit[] | null, units: Unit[]): Map<string, DeploymentLook> {
  const saved = !!recruits?.length;
  const defaults = initialSquad().recruits;
  const roster = saved ? recruits! : defaults;
  let allies = 0;
  return new Map(units.map((unit, i) => {
    const own = unit.enemy ? undefined : roster.find((r) => r.id === unit.id) ?? roster[allies];
    if (!unit.enemy) allies++;
    const recruit = own ?? defaults[i % defaults.length];
    return [unit.id, {
      appearance: recruit.appearance,
      armorId: saved && own ? recruit.equipment.armor : showcase[i % showcase.length],
      armorColors: unit.enemy
        ? { ...DEFAULT_ARMOR_COLORS, primary: "#454144", accent: "#c98177" }
        : recruit.armorColors,
      ...(!unit.enemy ? { name: recruit.name, callsign: recruit.callsign } : {}),
    }];
  }));
}
export function applyDeploymentNames(units: Unit[], looks: Map<string, DeploymentLook>) {
  for (const unit of units) {
    const look = looks.get(unit.id);
    if (look?.name) unit.full = look.name;
    if (look?.callsign) unit.name = look.callsign;
  }
}
