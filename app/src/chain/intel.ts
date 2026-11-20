// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the match's unit readout knows, from data the match screen already
 * holds: the polled `Game` (each map unit's stats, actions with their uses)
 * and the recruits in its `Table` (names, rank, gear), which both players can
 * read and the screen fetches once per table size. The opposing player is
 * their `Account` (rating, record) and the name their address assigned
 * itself. Plain functions; `useMatchIntel` feeds them to the engine.
 */

import type { ModKind, OpponentIntel, UnitIntel } from "@ghosts/engine";
import { unpack } from "@ghosts/squad/stats";

import type { ChainAccount, ChainRecruit } from "./ghosts";
import { effectiveStats, RANKS, type unitsOnMap } from "./match-rules.ts";

/** `UPGRADE_KINDS` in order: the `kind` byte of a `WeaponUpgrade`. */
const MOD_KINDS: readonly ModKind[] = ["scope", "laser", "stock", "clip"];

/** The actions every unit has from its body and weapon; the rest come from its utility. */
const BASE_ACTIONS = new Set(["Move", "Attack", "Reload"]);

type MapUnit = ReturnType<typeof unitsOnMap>[number]["unit"];
type Recruit = Pick<ChainRecruit, "metadata" | "rank" | "weapon" | "armor" | "utilities">;

/**
 * The engine's reading of a unit (`base`: condition as the field shows it
 * this moment) with what the chain adds: the recruit's name, rank and gear,
 * the unit's stats the bundled rules have no place for, and its utility's
 * uses left. Either may be missing (a recruit not read yet): what is there
 * is used, the rest stays the engine's.
 */
export function chainUnitIntel(base: UnitIntel, recruit?: Recruit, unit?: MapUnit): UnitIntel {
    const intel: UnitIntel = { ...base, stats: { ...base.stats } };
    if (unit) {
        // effects (daze, smoke) change the aim and the defense the unit shoots and is shot with
        const s = effectiveStats(unpack(BigInt(unit.stats.value)), unit.effects);
        const armed = unit.actions.some(({ kind }) => kind.$kind === "Attack");
        intel.stats = {
            aim: s.aim,
            // `Unit.perform_attack`: the damage stat, plus or minus `spread`, plus one on a `plus_one` roll
            damage: [
                Math.max(0, s.damage - s.spread),
                s.damage + s.spread + (s.plusOne > 0 ? 1 : 0),
            ],
            range: s.range,
            mobility: s.mobility,
            dodge: s.dodge,
            defense: s.defense,
            critChance: s.critChance,
        };
        if (!armed) intel.weapon = null;
    }
    if (!recruit) return intel;
    intel.name = recruit.metadata.name;
    const rank = recruit.rank.$kind;
    intel.rank = { name: rank, index: Math.max(0, RANKS.indexOf(rank as (typeof RANKS)[number])) };
    if (recruit.weapon && (!unit || intel.weapon))
        intel.weapon = {
            name: recruit.weapon.name,
            mods: recruit.weapon.upgrades.map((u) => ({
                kind: MOD_KINDS[u.kind] ?? "scope",
                name: u.name,
                tier: u.tier,
            })),
        };
    else intel.weapon = null;
    intel.armor = recruit.armor ? { name: recruit.armor.name } : null;
    const utility = recruit.utilities[0];
    if (!utility) intel.utility = null;
    else {
        const granted = new Set(utility.actions.map(({ kind }) => kind.$kind));
        const limited = (uses: (number | null)[]) =>
            uses.some((u) => u === null)
                ? null
                : uses.reduce<number>((sum, u) => sum + (u ?? 0), 0);
        const max = limited(utility.actions.map(({ uses }) => uses));
        // the unit's own copies count down; the recruit's stay as issued
        const left = unit
            ? limited(
                  unit.actions
                      .filter(
                          ({ kind }) => !BASE_ACTIONS.has(kind.$kind) && granted.has(kind.$kind),
                      )
                      .map(({ uses }) => uses),
              )
            : max;
        intel.utility = { name: utility.name, uses: left, max };
    }
    return intel;
}

/** The opposing player's line, from their `Account` and assigned name. */
export function opponentIntel(
    account: ChainAccount,
    name: string | null | undefined,
): OpponentIntel {
    return {
        name: name ?? null,
        rating: Number(account.rating.rating),
        deviation: Number(account.rating.deviation),
        record: {
            wins: Number(account.score.wins),
            losses: Number(account.score.losses),
            draws: Number(account.score.draws),
        },
    };
}
