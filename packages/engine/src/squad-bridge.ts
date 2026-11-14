// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { initialSquad } from "@ghosts/squad/model";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import type { Appearance, ArmorColors, Recruit } from "@ghosts/squad/types";
import items from "../../catalog/items.json" with { type: "json" };
import { loadoutActions, type UnitAction } from "./action-registry.ts";
import type { Unit } from "./game.ts";
import type { Scenario } from "./scenario.ts";

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

/** The squad catalog's utilities by the chain item that stands for them (`items.json`). */
const UTILITY_ITEMS: Record<string, string> = { frag: "frag-grenade" };

/** What a carried utility grants, from `items.json`; nothing for one with no chain item. */
function utilityActions(id: string | null): UnitAction[] {
  const item = id ? items.items.find((i) => i.id === UTILITY_ITEMS[id]) : undefined;
  return (item?.actions ?? []).map((a) => ({ kind: a.kind, uses: a.uses ?? null }));
}

/**
 * The demo's actions for each ally, from the loadout it deployed with, as
 * `Unit::from_recruit` builds a chain unit's: no primary weapon, no Attack or
 * Reload; no grenade, no Grenade. Matched to units like `deploymentLooks`; a
 * chain match keeps what the chain says and is never given these.
 */
export function deploymentLoadouts(
  recruits: readonly Recruit[] | null,
  units: Unit[],
  scenario: Scenario,
): Map<string, UnitAction[]> {
  const roster = recruits?.length ? recruits : initialSquad().recruits;
  let allies = 0;
  const out = new Map<string, UnitAction[]>();
  for (const unit of units) {
    if (unit.enemy) continue;
    const recruit = roster.find((r) => r.id === unit.id) ?? roster[allies];
    allies++;
    if (!recruit) continue;
    out.set(
      unit.id,
      loadoutActions({
        armed: !!recruit.equipment.primary,
        utilities: [utilityActions(recruit.equipment.utility)],
        demo: { extract: !scenario.versus },
      }),
    );
  }
  return out;
}

/** Give each unit its loadout's actions (fresh copies: uses are spent per encounter). */
export function applyLoadouts(units: Unit[], loadouts: Map<string, UnitAction[]>) {
  for (const unit of units) {
    const actions = loadouts.get(unit.id);
    if (actions) unit.actions = actions.map((a) => ({ ...a }));
  }
}
