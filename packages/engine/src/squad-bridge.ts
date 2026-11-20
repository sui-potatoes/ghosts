// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { initialSquad } from "@ghosts/squad/model";
import { ATTACHMENT_SLOTS, attachmentById, itemById } from "@ghosts/squad/catalog";
import { fieldStats, RANKS } from "@ghosts/squad/stats";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import type { Appearance, ArmorColors, Recruit } from "@ghosts/squad/types";
import items from "../../catalog/items.json" with { type: "json" };
import { loadoutActions, type UnitAction } from "./action-registry.ts";
import type { Unit, Weapon } from "./game.ts";
import type { IntelSource } from "./intel.ts";
import { roleKits, type Kit, type Scenario, type UnitSpec } from "./scenario.ts";

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
 * the showcase armor tiers are worn. A hostile whose spec has a `look` wears
 * that face and armor instead. The recruits are only read.
 */
export function deploymentLooks(recruits: readonly Recruit[] | null, units: Unit[], specs: readonly UnitSpec[] = []): Map<string, DeploymentLook> {
  const saved = !!recruits?.length;
  const defaults = initialSquad().recruits;
  const roster = saved ? recruits! : defaults;
  let allies = 0;
  return new Map(units.map((unit, i) => {
    const own = unit.enemy ? undefined : roster.find((r) => r.id === unit.id) ?? roster[allies];
    if (!unit.enemy) allies++;
    const recruit = own ?? defaults[i % defaults.length];
    const look = unit.enemy ? specs.find((spec) => spec.id === unit.id)?.look : undefined;
    return [unit.id, {
      appearance: look?.appearance ?? recruit.appearance,
      armorId: look?.armor !== undefined ? look.armor : saved && own ? recruit.equipment.armor : showcase[i % showcase.length],
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
const UTILITY_ITEMS: Record<string, string> = { frag: "frag-grenade", flash: "flashbang", smoke: "smoke-grenade" };

/** What a carried utility grants, from `items.json`; nothing for one with no chain item. */
function utilityActions(id: string | null): UnitAction[] {
  const item = id ? items.items.find((i) => i.id === UTILITY_ITEMS[id]) : undefined;
  return (item?.actions ?? []).map((a) => ({ kind: a.kind, uses: a.uses ?? null }));
}

/** What the demo gives an ally from its recruit: the orders it carries and the unit's own numbers. */
export interface Loadout {
  actions: UnitAction[];
  /** The unit's fields as `Unit::from_recruit` and the weapon make them. */
  fit: Partial<Unit>;
}

/**
 * The unit a recruit makes in a match, from the stats the contract assembles
 * for it (`fieldStats`: rank, weapon with its fittings, armor): health, ammo
 * and clip, aim, mobility, armor and the weapon's damage, spread, crit, range
 * and dodge. The long gun in hand is the rifle or the marksman rifle; the
 * field has no model for the plasma rifle yet, so it shows as the rifle.
 */
function recruitFit(recruit: Pick<Recruit, "equipment" | "attachments" | "rank">): Partial<Unit> {
  const s = fieldStats(recruit);
  const primary = itemById(recruit.equipment.primary);
  const weapon: Weapon = primary?.model === "sniper" ? "sniper" : "rifle";
  const mods = ATTACHMENT_SLOTS.flatMap((slot) => {
    const mod = attachmentById(recruit.attachments?.[slot]);
    return primary && mod?.slot === slot ? [{ kind: slot, name: mod.name, tier: mod.tier }] : [];
  });
  const rank = RANKS.indexOf(recruit.rank as (typeof RANKS)[number]);
  return {
    weapon,
    hp: s.health,
    maxHp: s.health,
    ammo: s.ammo,
    clip: s.ammo,
    magazines: { rifle: s.ammo, sniper: s.ammo, pistol: 6 },
    armor: s.armor,
    aim: s.aim,
    range: s.range,
    mobility: s.mobility,
    damage: s.damage,
    spread: s.spread,
    plusOne: s.plusOne,
    critChance: s.critChance,
    dodge: s.dodge,
    defense: s.defense,
    gear: {
      weapon: primary ? { name: primary.name, mods } : null,
      armor: itemById(recruit.equipment.armor)?.name ?? null,
      ...(rank >= 0 ? { rank: { name: RANKS[rank], index: rank } } : {}),
    },
  };
}

/** A kit as the loadout fields of a recruit. */
const kitRecruit = (kit: Kit) => ({
  equipment: { primary: kit.primary, sidearm: null, armor: kit.armor, utility: kit.utility ?? null },
  attachments: kit.attachments ?? {},
  rank: kit.rank,
});

/**
 * The demo's loadout for each ally, from the recruit it deployed with, as
 * `Unit::from_recruit` builds a chain unit: the actions (no primary weapon, no
 * Attack or Reload; no grenade, no Grenade) and the numbers (`recruitFit`).
 * Matched to units like `deploymentLooks`; a chain match keeps what the chain
 * says and is never given these. Hostiles are built the same way from their
 * scenario's `kit` (their role's `roleKits` by default): one set of rules for both sides.
 */
export function deploymentLoadouts(
  recruits: readonly Recruit[] | null,
  units: Unit[],
  scenario: Scenario,
): Map<string, Loadout> {
  const roster = recruits?.length ? recruits : initialSquad().recruits;
  let allies = 0;
  const out = new Map<string, Loadout>();
  for (const unit of units) {
    if (unit.enemy) {
      const kit = scenario.units.find((spec) => spec.id === unit.id)?.kit ?? roleKits[unit.role];
      out.set(unit.id, {
        actions: loadoutActions({ armed: !!kit.primary, utilities: [utilityActions(kit.utility ?? null)] }),
        fit: recruitFit(kitRecruit(kit)),
      });
      continue;
    }
    const recruit = roster.find((r) => r.id === unit.id) ?? roster[allies];
    allies++;
    if (!recruit) continue;
    out.set(unit.id, {
      actions: loadoutActions({
        armed: !!recruit.equipment.primary,
        utilities: [utilityActions(recruit.equipment.utility)],
        demo: { extract: !scenario.versus && !scenario.noObjective },
      }),
      fit: recruitFit(recruit),
    });
  }
  return out;
}

/** Give each unit its loadout (fresh copies: uses and ammo are spent per encounter). */
export function applyLoadouts(units: Unit[], loadouts: Map<string, Loadout>) {
  for (const unit of units) {
    const loadout = loadouts.get(unit.id);
    if (!loadout) continue;
    const { gear, magazines, ...numbers } = loadout.fit;
    Object.assign(unit, numbers);
    if (magazines) unit.magazines = { ...magazines };
    if (gear) unit.gear = { ...gear, weapon: gear.weapon && { ...gear.weapon, mods: [...gear.weapon.mods] } };
    unit.actions = loadout.actions.map((a) => ({ ...a }));
  }
}

/**
 * The unit readout for an ally with a recruit's gear: its own weapon, mods and
 * rank, and the numbers the rules roll with, as a chain match's readout has
 * them (`chainUnitIntel`). Other units keep the engine's own reading.
 */
export const deployedIntel: IntelSource = (u, base) => {
  const gear = u.gear;
  if (!gear) return base;
  return {
    ...base,
    ...(gear.rank ? { rank: gear.rank } : {}),
    weapon: base.weapon && gear.weapon ? { name: gear.weapon.name, mods: gear.weapon.mods } : base.weapon,
    armor: gear.armor ? { name: gear.armor } : null,
    stats: {
      ...base.stats,
      damage: [Math.max(0, u.damage - u.spread), u.damage + u.spread + (u.plusOne > 0 ? 1 : 0)],
      dodge: u.dodge,
      defense: u.defense,
      critChance: u.critChance,
    },
  };
};
