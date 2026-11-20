// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Status effects on units, as `ghosts::effect` has them: the shape a unit
 * carries, the table that describes each kind, and the rules the contract
 * applies to them, so the demo rules, the HUD and a chain match agree.
 *
 * - An effect is a kind and the turns left (`kind << 4 | turns` on chain); a
 *   unit has at most one per kind, in the order they landed.
 * - Base stats stay untouched; what an effect changes is folded on top in list
 *   order (`effectiveStats`, `stats::add`: floored at 0, capped at 127).
 * - `turns` counts `next_turn` calls: every turn end, whoever ends it, takes
 *   one off every effect on every living unit; at 0 an `EffectEnd` removes it.
 * - A second effect of a kind the unit has keeps the larger timer (`refresh`).
 * - A unit that falls takes its effects with it; no `EffectEnd` is written.
 */

import catalog from "../../catalog/effects.json" with { type: "json" };
import type { IconName } from "./ui/icons.tsx";

/** One effect on a unit: `ghosts::effect::Effect`, kind by catalog id. */
export interface UnitEffect {
  /** The kind's catalog id (`"Daze"`, `"Smoke"`); `"#<tag>"` for one this client doesn't know. */
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
  /** The effect's kind number on chain (`DAZE` = 0, `SMOKE` = 1). */
  tag: number;
  /** The state's name: "Dazed", "In smoke". */
  name: string;
  /** One line for the hint. */
  description: string;
  icon: IconName;
  /** How long a fresh one lasts, in `next_turn` calls. */
  turns: number;
  /** What it adds to the base stats while active; negative takes away. */
  modifies?: Partial<EffectStats>;
  /** The unit gets no AP while it lasts. */
  stuns?: boolean;
  /** Damage at the start of the affected side's turn. */
  damagePerTurn?: number;
}

/** `stats::add` caps a modified value here (seven bits). */
const STAT_CAP = 127;
/** `effect::SMOKE_DEFENSE`, `effect::SMOKE_AIM_PENALTY`. */
export const SMOKE_DEFENSE = 30;
export const SMOKE_AIM_PENALTY = 30;

type CatalogEffect = (typeof catalog.effects)[number];

const entry = (id: string): CatalogEffect | undefined => catalog.effects.find((e) => e.id === id);

/** The engine's half of a kind; its tag, turns and description come from `effects.json`. */
function kind(id: string, tag: number, rest: Omit<EffectSpec, "id" | "tag" | "turns" | "description"> & { turns: number }): EffectSpec {
  const e = entry(id);
  return { id, tag: e?.kind ?? tag, description: e?.description ?? "", ...rest, turns: e?.turns ?? rest.turns };
}

/** Every effect kind the client knows, by the contract's kind number. */
export const EFFECTS: readonly EffectSpec[] = [
  // `DAZE_MODIFIER`: aim −127, which takes any aim to 0 and no smoke gives back.
  kind("Daze", 0, { name: "Dazed", icon: "flash", turns: 2, modifies: { aim: -STAT_CAP } }),
  // `SMOKE_MODIFIER`: aim −30, defense +30.
  kind("Smoke", 1, { name: "In smoke", icon: "smoke", turns: 2, modifies: { aim: -SMOKE_AIM_PENALTY, defense: SMOKE_DEFENSE } }),
];

/** The spec for a kind, undefined for one this client doesn't know (or a fixture's). */
export function effectSpec(kind: string, table: readonly EffectSpec[] = EFFECTS): EffectSpec | undefined {
  return table.find((e) => e.id === kind);
}

/** The catalog id for an effect kind number; `"#<tag>"` for one this client doesn't know. */
export function effectKindOfTag(tag: number, table: readonly EffectSpec[] = EFFECTS): string {
  return table.find((e) => e.tag === tag)?.id ?? `#${tag}`;
}

/** A kind's name: the table's, or its tag for one this client doesn't know. */
export function effectName(kind: string, table: readonly EffectSpec[] = EFFECTS): string {
  return effectSpec(kind, table)?.name ?? `Effect ${kind.replace(/^#/, "")}`;
}

/**
 * The stats in force: the base plus every active effect's modifier, in the
 * order the unit carries them, each modified value floored at 0 and capped at
 * 127 like `stats::add`. The base is never written.
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
    for (const key of Object.keys(mod) as (keyof EffectStats)[]) {
      if (!mod[key]) continue;
      out[key] = Math.min(STAT_CAP, Math.max(0, out[key] + mod[key]));
    }
  }
  return out;
}

/** What a unit shoots with and is shot against, effects counted: `Unit.effective_stats` aim and defense. */
export function unitCombat(u: { aim: number; defense: number; mobility: number; armor: number; effects?: readonly UnitEffect[] }) {
  return effectiveStats({ aim: u.aim, defense: u.defense, mobility: u.mobility, armor: u.armor }, u.effects ?? []);
}

/** Whether a stun is on the unit: it gets no AP at its side's turn. */
export const isStunned = (effects: readonly UnitEffect[] = [], table: readonly EffectSpec[] = EFFECTS) =>
  effects.some((e) => e.turns > 0 && effectSpec(e.kind, table)?.stuns);

/** A fresh effect of a kind, for the kind's turns. */
export function freshEffect(kind: string, table: readonly EffectSpec[] = EFFECTS): UnitEffect {
  return { kind, turns: effectSpec(kind, table)?.turns ?? 2 };
}

/**
 * `Unit.apply_effect`: a kind the unit has keeps its slot and the larger of
 * the two timers (`refresh`); a new kind goes at the end. Returns the effect
 * as the unit now has it: what `EffectStart` carries.
 */
export function applyEffect(effects: UnitEffect[], effect: UnitEffect): UnitEffect {
  const had = effects.find((e) => e.kind === effect.kind);
  if (had) {
    had.turns = Math.max(had.turns, effect.turns);
    return { ...had };
  }
  effects.push({ ...effect });
  return { ...effect };
}

/** `EffectStart` replayed: the kind's entry set to what the record carries, or added at the end. */
export function setEffect(effects: UnitEffect[], effect: UnitEffect) {
  const had = effects.find((e) => e.kind === effect.kind);
  if (had) had.turns = effect.turns;
  else effects.push({ ...effect });
}

/** `next_turn`: one turn off every effect; those at 0 stay until their `EffectEnd`. Returns the kinds that ran out. */
export function tickEffects(effects: UnitEffect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    if (e.turns > 0) e.turns--;
    if (e.turns === 0) out.push(e.kind);
  }
  return out;
}

/** `EffectEnd`: the kind is gone, the rest keep their order. */
export function endEffect(effects: UnitEffect[], kind: string): UnitEffect[] {
  return effects.filter((e) => e.kind !== kind);
}

/** "1 turn left", "2 turns left". */
export const turnsLeft = (turns: number) => `${turns} turn${turns === 1 ? "" : "s"} left`;

/** What an effect does, with labelled numbers: "aim 0", "+30 defense, −30 aim". */
export function effectDetail(kind: string, table: readonly EffectSpec[] = EFFECTS): string {
  const mod = effectSpec(kind, table)?.modifies;
  if (!mod) return "";
  const parts: string[] = [];
  const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
  if (mod.defense) parts.push(`${signed(mod.defense)} defense`);
  if (mod.aim) parts.push(mod.aim <= -STAT_CAP ? "aim 0" : `${signed(mod.aim)} aim`);
  if (mod.mobility) parts.push(`${signed(mod.mobility)} mobility`);
  if (mod.armor) parts.push(`${signed(mod.armor)} armor`);
  return parts.join(", ");
}

/** One entry of the unit panel's status line and of the plate over the unit. */
export interface EffectLine {
  kind: string;
  name: string;
  /** Turns left, as `next_turn` calls. */
  turns: number;
  description: string;
  /** What it does, with labelled numbers ("aim 0"). */
  detail: string;
  /** The whole line: "Dazed: aim 0, 1 turn left". */
  text: string;
  icon?: IconName;
}

/** The status line's entries: the active effects, in the order the unit carries them. Empty without effects. */
export function effectLines(effects: readonly UnitEffect[] = [], table: readonly EffectSpec[] = EFFECTS): EffectLine[] {
  return effects
    .filter((e) => e.turns > 0)
    .map((e) => {
      const spec = effectSpec(e.kind, table);
      const name = effectName(e.kind, table);
      const detail = effectDetail(e.kind, table);
      return {
        kind: e.kind,
        name,
        turns: e.turns,
        description: spec?.description ?? "",
        detail,
        text: `${name}: ${detail ? `${detail}, ` : ""}${turnsLeft(e.turns)}`,
        icon: spec?.icon,
      };
    });
}

/** The marker over the unit: its effects as one short line, "" without. */
export function effectsTag(effects: readonly UnitEffect[] = [], table: readonly EffectSpec[] = EFFECTS): string {
  return effectLines(effects, table)
    .map((e) => `${e.name.toUpperCase()} ${e.turns}`)
    .join(" · ");
}
