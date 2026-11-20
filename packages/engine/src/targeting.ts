// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
  GRENADE_RADIUS,
  GRENADE_RANGE,
  MAX_RANGE_OFFSET,
  REFUSAL_TEXT,
  THROW_EFFECT,
  refusalOf,
  specOf,
  type ThrowOrder,
} from "./action-registry.ts";
import {
  distance,
  shotDamage,
  type Cell,
  type Encounter,
  type Unit,
} from "./game.ts";

/** What one shot from `unit`'s equipped weapon can take off `target`, armor counted. */
export function damagePreview(unit: Unit, target: Unit) {
  const hit = Math.min(shotDamage(unit, target), target.hp);
  const crit = Math.min(shotDamage(unit, target, true), target.hp);
  return { hit, crit, lethal: hit >= target.hp };
}

export function shotBlockReason(
  game: Encounter,
  unit: Unit,
  target?: Unit,
): string | null {
  const refusal = refusalOf(game, unit, "Attack");
  if (refusal) return REFUSAL_TEXT[refusal].toUpperCase();
  if (!target || target.hp <= 0 || target.enemy === unit.enemy)
    return "NO TARGET";
  if (game.inRange(unit, target)) return null;
  // Why `Encounter.inRange` refuses it: the distance, else the line.
  if (distance(unit.pos, target.pos) > unit.range + MAX_RANGE_OFFSET)
    return "OUT OF RANGE";
  return "WALL BLOCKS SHOT";
}

/**
 * The hostile aiming starts on: the best odds among those in range
 * (`Encounter.inRange`), the nearest on a tie; none when nobody is in range.
 */
export function bestShotTarget(game: Encounter, unit: Unit): Unit | undefined {
  return [...game.targetsInRange(unit)].sort(
    (a, b) => game.chance(unit, b) - game.chance(unit, a) || distance(unit.pos, a.pos) - distance(unit.pos, b.pos),
  )[0];
}

/**
 * The hostiles aiming may step through, in the encounter's order: those in
 * range (`Encounter.inRange`). One out of range is never offered.
 */
export function aimTargets(game: Encounter, unit: Unit): Unit[] {
  return game.result ? [] : game.targetsInRange(unit);
}

/** The next (or previous) hostile in range after `current`, wrapping round; undefined with none in range. */
export function stepAimTarget(game: Encounter, unit: Unit, current: string, dir: 1 | -1): Unit | undefined {
  const list = aimTargets(game, unit);
  if (!list.length) return undefined;
  const i = list.findIndex((e) => e.id === current);
  return list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
}

/** Hostiles in weapon range and line of sight; range information remains useful without AP or ammunition. */
export function shootingTargets(game: Encounter, unit: Unit, from: Cell = unit.pos): Unit[] {
  if (unit.hp <= 0 || game.result) return [];
  return game.targetsInRange(unit, from);
}
/**
 * Why a throw of `order` (any grenade: they share range, radius and the
 * checks) can't land on `point`, or null when it can.
 */
export function grenadeBlockReason(
  game: Encounter,
  unit: Unit,
  point: Cell | null,
  order: ThrowOrder = "grenade",
): string | null {
  const refusal = refusalOf(game, unit, specOf(order).id);
  if (refusal) return REFUSAL_TEXT[refusal].toUpperCase();
  if (!point) return "NO LANDING TILE";
  if (!game.map.inBounds(point)) return "OUTSIDE THE DISTRICT";
  // `Map.perform_grenade`: range, then the wall, then the line of throw.
  if (distance(unit.pos, point) > GRENADE_RANGE)
    return "OUT OF THROW RANGE";
  if (game.throwBlocked(unit.pos, point)) return "WALL BLOCKS THROW";
  return null;
}
/**
 * Every living unit a throw landing on `at` catches, either side, the thrower
 * too (friendly fire is on), in `Map.units` order: what the preview marks.
 */
export function burstUnits(game: Encounter, at: Cell | null): Unit[] {
  return at ? game.unitsInMapOrder().filter((u) => distance(u.pos, at) <= GRENADE_RADIUS) : [];
}

/**
 * Where a throw of `order` starts aimed: the frag and the flashbang on the
 * most hostiles and fewest of the squad; the smoke grenade, which shields
 * whoever it covers, on the most of the squad and fewest hostiles.
 */
export function defaultGrenadeTarget(game: Encounter, unit: Unit, order: ThrowOrder = "grenade"): Cell {
  const shield = THROW_EFFECT[order] === "Smoke";
  const [friends, foes] = unit.enemy ? [game.enemies, game.allies] : [game.allies, game.enemies];
  const candidates: Cell[] = [];
  const { minX, maxX, minZ, maxZ } = game.map.bounds;
  for (let x = minX; x <= maxX; x++)
    for (let z = minZ; z <= maxZ; z++) {
      const point: Cell = [x, z];
      if (
        (shield || distance(unit.pos, point) >= 3) &&
        !grenadeBlockReason(game, unit, point, order)
      )
        candidates.push(point);
    }
  const near = (side: Unit[], p: Cell) => side.filter((e) => distance(e.pos, p) <= GRENADE_RADIUS).length;
  const score = (p: Cell) =>
    shield
      ? near(friends, p) * 100 - near(foes, p) * 200 - Math.min(...friends.map((a) => distance(a.pos, p)), 100)
      : near(foes, p) * 100 - near(friends, p) * 200 - Math.min(...foes.map((e) => distance(e.pos, p)), 100);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? [...unit.pos];
}
