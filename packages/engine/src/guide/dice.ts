// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Fixed dice for a scripted shot. The bundled rules roll with a seeded LCG
 * (`Encounter.random`, `seed` public); a guided run picks the seed a shot is
 * taken with, so the lesson lands the same way every time without touching the
 * rules. `seedFor` replays `Encounter.shoot`'s draws in their order (hit,
 * crit, the spread's direction and size, plus one, dodge) over candidate seeds
 * and returns the first that gives the outcome asked for. `dice.test.ts` fires
 * real shots with the seeds it finds, so a change to the draws shows there.
 */
import { unitCombat } from "../status-effects.ts";
import type { Encounter, Unit } from "../game.ts";
import type { Command } from "../events.ts";

/** What a scripted shot should do. */
export type ShotOutcome =
  | { hit: false }
  /** A hit for exactly `damage` after armor: a critical one when `crit`, else a plain one. */
  | { hit: true; damage: number; crit?: boolean };

const next = (seed: number) => (seed * 1664525 + 1013904223) >>> 0;

/** The outcome of a shot taken with `seed`, as `Encounter.shoot` rolls it. */
export function rollShot(seed: number, a: Unit, b: Unit, chance: number): { hit: boolean; crit: boolean; damage: number } {
  let s = seed;
  const random = () => (s = next(s)) / 4294967296;
  let hit = random() * 100 < chance;
  let crit = hit && random() < a.critChance / 100;
  let raw = a.damage;
  if (hit && a.spread > 0) {
    const up = random() < 0.5;
    const offset = Math.floor(random() * ((up ? a.spread : Math.min(a.spread, a.damage)) + 1));
    raw += up ? offset : -offset;
  }
  if (hit && a.plusOne > 0 && random() * 100 < a.plusOne) raw++;
  if (crit) raw += Math.floor(a.damage / 2);
  const dodge = unitCombat(b).dodge;
  if (hit && dodge > 0 && random() * 100 < dodge) hit = crit = false;
  return { hit, crit, damage: hit ? Math.max(1, raw - b.armor) : 0 };
}

/** The first seed from `from` that makes `a`'s shot at `b` (at `chance` percent) come out as `want`; null when none does. */
export function seedFor(a: Unit, b: Unit, chance: number, want: ShotOutcome, from = 1, tries = 200_000): number | null {
  for (let seed = from; seed < from + tries; seed++) {
    const roll = rollShot(seed, a, b, chance);
    if (!want.hit ? !roll.hit : roll.hit && roll.crit === !!want.crit && roll.damage === want.damage) return seed;
  }
  return null;
}

/** Take `command` with the dice that give `want`, when it is a shot the rules allow and some seed does. */
export function fixShot(game: Encounter, command: Command, want: ShotOutcome | null) {
  if (command.type !== "fire" || !want) return;
  const a = game.unit(command.unit),
    b = game.unit(command.target);
  if (!a || !b || !game.inRange(a, b)) return;
  const seed = seedFor(a, b, game.chance(a, b), want);
  if (seed !== null) game.seed = seed;
}
