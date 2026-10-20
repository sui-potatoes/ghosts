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
 * The look of every unit: allies from the host's saved recruits (by squad
 * order), hostiles and missing recruits from the default roster. Without a
 * saved squad the showcase armor tiers are worn. The recruits are only read.
 */
export function deploymentLooks(recruits: readonly Recruit[] | null, units: Unit[]): Map<string, DeploymentLook> {
  const saved = !!recruits?.length;
  const defaults = initialSquad().recruits;
  const roster = saved ? recruits! : defaults;
  return new Map(units.map((unit, i) => {
    const recruit = unit.enemy ? defaults[i % defaults.length] : roster[i] ?? defaults[i % defaults.length];
    return [unit.id, {
      appearance: recruit.appearance,
      armorId: !unit.enemy && saved && roster[i]
        ? recruit.equipment.armor : showcase[i % showcase.length],
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
