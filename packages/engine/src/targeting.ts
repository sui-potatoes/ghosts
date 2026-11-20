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
  if (distance(unit.pos, target.pos) > unit.range + MAX_RANGE_OFFSET)
    return "OUT OF RANGE";
  if (game.shotBlocked(unit.pos, target.pos)) return "WALL BLOCKS SHOT";
  return null;
}
export function bestShotTarget(game: Encounter, unit: Unit): Unit | undefined {
  return [...game.enemies].sort((a, b) => {
    const ar = distance(unit.pos, a.pos) <= unit.range + MAX_RANGE_OFFSET && !game.shotBlocked(unit.pos, a.pos),
      br = distance(unit.pos, b.pos) <= unit.range + MAX_RANGE_OFFSET && !game.shotBlocked(unit.pos, b.pos);
    return (
      Number(br) - Number(ar) ||
      game.chance(unit, b) - game.chance(unit, a) ||
      distance(unit.pos, a.pos) - distance(unit.pos, b.pos)
    );
  })[0];
}

/** Hostiles in weapon range and line of sight; range information remains useful without AP or ammunition. */
export function shootingTargets(game: Encounter, unit: Unit, from: Cell = unit.pos): Unit[] {
  if (unit.hp <= 0 || game.result) return [];
  return game.units.filter((target) => target.hp > 0 && target.enemy !== unit.enemy &&
    distance(from, target.pos) <= unit.range + MAX_RANGE_OFFSET && !game.shotBlocked(from, target.pos));
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
