// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { actionName, hasKind, specOf, THROW_ORDERS, usesLeft } from "./action-registry.ts";
import { allows, distance, key, weapons, type Cell, type Encounter, type Unit } from "./game.ts";
import { effectDetail, effectName, unitCombat } from "./status-effects.ts";

/**
 * What the unit readout knows about one unit on the field: who it is, what it
 * carries, its condition and what it can do in a fight. The engine fills the
 * live parts from its own `Unit` (`baseIntel`); a host adds what only it
 * knows — names, rank, gear, the stats the bundled rules have no place for —
 * through an `IntelSource`. The readout depends on this shape alone.
 */
export interface UnitIntel {
  id: string;
  /**
   * Whether anything is known. False draws the readout's "no data" state:
   * a unit the player may not read (concealment, once the game has it).
   */
  known: boolean;
  hostile: boolean;
  /** The short name over the unit. */
  callsign: string;
  /** The full name, when it says more than the callsign. */
  name?: string;
  /** Rank by name and step (0 = the lowest); absent where the game keeps none. */
  rank?: { name: string; index: number };
  condition: {
    hp: number;
    maxHp: number;
    /** Armor points: each takes one off every hit. */
    armor: number;
    ap: number;
    apMax: number;
    /** It is this unit's side's turn: its AP mean something now. */
    active: boolean;
    ammo: number;
    clip: number;
  };
  /** Null: unarmed, the unit cannot attack. */
  weapon: { name: string; mods: WeaponMod[] } | null;
  armor: { name: string } | null;
  /** The one utility slot; `uses` null is unlimited, `max` null unknown. */
  utility: { name: string; uses: number | null; max: number | null } | null;
  stats: {
    aim: number;
    /** What a hit (not a crit) deals before armor, lowest and highest roll. */
    damage: [min: number, max: number];
    /** The weapon's range: full aim within it, falling off for three tiles past it. */
    range: number;
    mobility: number;
    /** Only where the rules have them (a match on chain). */
    dodge?: number;
    defense?: number;
    critChance?: number;
  };
  /**
   * Active status effects, in the order the unit carries them: the state's
   * name ("Dazed"), what it does with labelled numbers ("aim 0"), turns left.
   */
  effects: { id: string; label: string; turns?: number; detail?: string }[];
}

export type ModKind = "scope" | "laser" | "stock" | "clip";
export interface WeaponMod {
  kind: ModKind;
  name: string;
  tier: number;
}

/** The opposing player, as a match exposes them: the readout's header line for hostiles. */
export interface OpponentIntel {
  /** The name they assigned themselves; null when they have none. */
  name: string | null;
  rating: number;
  deviation?: number;
  record?: { wins: number; losses: number; draws: number };
}

/**
 * A host's say on a unit: given the engine's `base`, the readout's whole
 * intel. Called when the readout opens or the encounter changes, never per
 * frame; keep it to data already in memory (no requests).
 */
export type IntelSource = (unit: Unit, base: UnitIntel) => UnitIntel;

/** Shots fall off for this many tiles past a weapon's range (`MAX_RANGE_OFFSET`). */
export const RANGE_FALLOFF = 3;

/** The engine's own weapon names, as the readout writes them. */
const WEAPON_NAMES: Record<Unit["weapon"], string> = {
  rifle: "Assault Rifle",
  sniper: "Precision Rifle",
  pistol: "Sidearm",
};

/**
 * Everything the engine itself knows of `u`: condition, its weapon and grenade
 * as the rules hold them, and the rules' stats. `armorName` is the armor the
 * deployed look wears, when there is one.
 */
export function baseIntel(game: Pick<Encounter, "phase">, u: Unit, armorName?: string | null): UnitIntel {
  const armed = allows(u, "fire");
  // The one utility slot: whichever grenade the unit carries.
  const thrown = THROW_ORDERS.map((order) => specOf(order).id).find((kind) => hasKind(u, kind));
  return {
    id: u.id,
    known: true,
    hostile: u.enemy,
    callsign: u.name,
    name: u.full && u.full !== u.name ? u.full : undefined,
    condition: {
      hp: Math.max(0, u.hp),
      maxHp: u.maxHp,
      armor: u.armor,
      ap: u.ap,
      apMax: 2,
      active: u.enemy === (game.phase === "enemy"),
      ammo: armed ? u.ammo : 0,
      clip: armed ? u.clip : 0,
    },
    weapon: armed ? { name: WEAPON_NAMES[u.weapon] ?? weapons[u.weapon].label, mods: [] } : null,
    armor: armorName ? { name: armorName } : null,
    utility: thrown ? { name: actionName(thrown), uses: usesLeft(u, thrown), max: null } : null,
    stats: {
      // What it shoots with now: status effects counted.
      aim: unitCombat(u).aim,
      damage: [u.damage, u.damage],
      range: u.range,
      mobility: u.mobility,
    },
    effects: (u.effects ?? [])
      .filter((e) => e.turns > 0)
      .map((e) => ({ id: e.kind, label: effectName(e.kind), turns: e.turns, detail: effectDetail(e.kind) })),
  };
}

/** The readout for a unit nothing may be learned about: the "no data" state. */
export function unknownIntel(u: Pick<Unit, "id" | "enemy" | "name">): UnitIntel {
  return {
    id: u.id,
    known: false,
    hostile: u.enemy,
    callsign: u.name,
    condition: { hp: 0, maxHp: 0, armor: 0, ap: 0, apMax: 2, active: false, ammo: 0, clip: 0 },
    weapon: null,
    armor: null,
    utility: null,
    stats: { aim: 0, damage: [0, 0], range: 0, mobility: 0 },
    effects: [],
  };
}

/** A weapon's name as the game shows it: a trailing " +" once anything is fitted. */
export const weaponLabel = (w: { name: string; mods: readonly unknown[] }) =>
  w.mods.length ? `${w.name} +` : w.name;

// === Inspect cycling ===

export interface InspectCandidate {
  id: string;
  enemy: boolean;
  hp: number;
}

/**
 * The order Inspect walks units in view: hostiles first, then the player's
 * own, each left to right as they stand on screen. `screenX` is a unit's
 * horizontal screen position, undefined when it is out of view.
 */
export function inspectOrder(units: readonly InspectCandidate[], screenX: (id: string) => number | undefined): string[] {
  const shown = units.flatMap((u) => {
    const x = u.hp > 0 ? screenX(u.id) : undefined;
    return x === undefined ? [] : [{ id: u.id, enemy: u.enemy, x }];
  });
  return shown.sort((a, b) => Number(b.enemy) - Number(a.enemy) || a.x - b.x).map((u) => u.id);
}

/** The next id in `order` after `current` (or before, `dir` -1); the first or last from none. */
export function stepInspect(order: readonly string[], current: string, dir: 1 | -1): string {
  if (!order.length) return "";
  const i = order.indexOf(current);
  if (i < 0) return dir > 0 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

// === Threat ===

export interface ThreatArea {
  /** Tiles one move takes it to, its own among them, by the rules' pathing (the player's move overlay). */
  move: Cell[];
  /** Tiles it can shoot at from where it stands: in range and line of fire. */
  fire: { cell: Cell; falloff: boolean }[];
}

/**
 * What `u` reaches from where it stands, by the rules the HUD uses for the
 * player's own moves and shots: `paths` for the move, range plus fall-off and
 * `shotBlocked` for the shot (`shootingTargets`). Nothing when it cannot act
 * on either: no move order means no move area, unarmed means no fire area.
 */
export function threatArea(game: Encounter, u: Unit): ThreatArea {
  const move: Cell[] = [];
  if (u.hp > 0 && allows(u, "move"))
    for (const path of game.paths(u).values()) move.push(path[path.length - 1]);
  const fire: ThreatArea["fire"] = [];
  if (u.hp > 0 && allows(u, "fire")) {
    const reach = u.range + RANGE_FALLOFF;
    const { minX, maxX, minZ, maxZ } = game.map.bounds;
    for (let x = Math.max(minX, u.pos[0] - reach); x <= Math.min(maxX, u.pos[0] + reach); x++)
      for (let z = Math.max(minZ, u.pos[1] - reach); z <= Math.min(maxZ, u.pos[1] + reach); z++) {
        const cell: Cell = [x, z];
        const d = distance(u.pos, cell);
        if (d === 0 || d > reach || game.shotBlocked(u.pos, cell)) continue;
        fire.push({ cell, falloff: d > u.range });
      }
  }
  return { move, fire };
}

/** A string that changes when anything `threatArea` reads for `u` does: recompute only then. */
export function threatSignature(game: Encounter, u: Unit): string {
  const others = game.units.filter((o) => o.hp > 0 && o !== u).map((o) => key(o.pos)).join(";");
  return `${u.id}@${key(u.pos)}:${u.mobility}:${u.range}:${u.hp > 0}|${others}|${game.events.length}`;
}
