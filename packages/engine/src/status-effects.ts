// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Status effects, prepared and empty: the contract has none yet
 * (`docs/plans/effects.md`). This is the shape a unit will carry and the table
 * that describes each kind, mirroring the action registry, so the HUD's slots
 * (the unit panel's status line, the marker over the unit, the effective stats)
 * are wired to data that is simply empty today. No kind is listed until the
 * contract has it; a kind the client doesn't know still shows, by its tag.
 *
 * Decided in the plan, and what the slots assume:
 * - base stats stay untouched; what an effect changes is computed on top
 *   (`effectiveStats`), and removing the effect is the revert;
 * - `turns` counts `next_turn` calls: every turn end takes one off;
 * - damage over time lands at the start of the affected side's own turn;
 * - a stun means no AP; friendly fire is on for every effect.
 */

import type { IconName } from "./ui/icons.tsx";

/** One effect on a unit: `ghosts::effect::Effect { turns, kind }` once it exists. */
export interface UnitEffect {
  /** The kind's catalog id; `"#<tag>"` for one this client doesn't know. */
  kind: string;
  /** `next_turn` calls left before it expires. */
  turns: number;
}

/** The stats an effect can move; the rest of a unit is untouched by them. */
export interface EffectStats {
  aim: number;
  /** The natural defense the shooter's aim is lowered by (cover is separate). */
  defense: number;
  mobility: number;
  armor: number;
}

/** One effect kind as the client knows it. */
export interface EffectSpec {
  id: string;
  /** The `EffectKind` tag on chain. */
  tag: number;
  name: string;
  /** One line for the hint and the unit panel. */
  description: string;
  icon: IconName;
  /** What it adds to the base stats while active; negative takes away. */
  modifies?: Partial<EffectStats>;
  /** The unit gets no AP while it lasts. */
  stuns?: boolean;
  /** Damage at the start of the affected side's turn. */
  damagePerTurn?: number;
}

/**
 * Every effect kind the client knows. Empty until the contract has effects:
 * the HUD never shows a mechanic the game doesn't have.
 */
export const EFFECTS: readonly EffectSpec[] = [];

/** The spec for a kind, undefined for one this client doesn't know (or a fixture's). */
export function effectSpec(kind: string, table: readonly EffectSpec[] = EFFECTS): EffectSpec | undefined {
  return table.find((e) => e.id === kind);
}

/** A kind's name: the table's, or its tag for one this client doesn't know. */
export function effectName(kind: string, table: readonly EffectSpec[] = EFFECTS): string {
  return effectSpec(kind, table)?.name ?? `Effect ${kind.replace(/^#/, "")}`;
}

/**
 * The stats in force: the base plus every active effect's modifier, floored at
 * zero like `stats::add`. The base is never written.
 */
export function effectiveStats(
  base: EffectStats,
  effects: readonly UnitEffect[] = [],
  table: readonly EffectSpec[] = EFFECTS,
): EffectStats {
  const out = { ...base };
  for (const e of effects) {
    const mod = effectSpec(e.kind, table)?.modifies;
    if (!mod || e.turns <= 0) continue;
    for (const key of Object.keys(mod) as (keyof EffectStats)[]) out[key] = Math.max(0, out[key] + (mod[key] ?? 0));
  }
  return out;
}

/** Whether a stun is on the unit: it gets no AP at its side's turn. */
export const isStunned = (effects: readonly UnitEffect[] = [], table: readonly EffectSpec[] = EFFECTS) =>
  effects.some((e) => e.turns > 0 && effectSpec(e.kind, table)?.stuns);

/** `next_turn`: one turn off every effect, those at zero gone. Returns the effects left. */
export function tickEffects(effects: readonly UnitEffect[]): UnitEffect[] {
  return effects.map((e) => ({ ...e, turns: e.turns - 1 })).filter((e) => e.turns > 0);
}

/** One entry of the unit panel's status line and of the plate over the unit. */
export interface EffectLine {
  kind: string;
  name: string;
  /** Turns left, as `next_turn` calls. */
  turns: number;
  description: string;
  icon?: IconName;
}

/** The status line's entries: the active effects, in the order the unit carries them. Empty without effects. */
export function effectLines(effects: readonly UnitEffect[] = [], table: readonly EffectSpec[] = EFFECTS): EffectLine[] {
  return effects
    .filter((e) => e.turns > 0)
    .map((e) => {
      const spec = effectSpec(e.kind, table);
      return { kind: e.kind, name: effectName(e.kind, table), turns: e.turns, description: spec?.description ?? "", icon: spec?.icon };
    });
}

/** The marker over the unit: its effects as one short line, "" without. */
export function effectsTag(effects: readonly UnitEffect[] = [], table: readonly EffectSpec[] = EFFECTS): string {
  return effectLines(effects, table)
    .map((e) => `${e.name.toUpperCase()} ${e.turns}`)
    .join(" · ");
}
