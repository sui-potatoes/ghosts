// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { GRENADE_RADIUS, GRENADE_RANGE, MAX_RANGE_OFFSET, REFUSAL_TEXT, refusalOf } from "./action-registry.ts";
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
export function grenadeBlockReason(
  game: Encounter,
  unit: Unit,
  point: Cell | null,
): string | null {
  const refusal = refusalOf(game, unit, "Grenade");
  if (refusal) return REFUSAL_TEXT[refusal].toUpperCase();
  if (!point) return "NO LANDING TILE";
  if (!game.map.inBounds(point)) return "OUTSIDE THE DISTRICT";
  // `Map.perform_grenade`: range, then the wall, then the line of throw.
  if (distance(unit.pos, point) > GRENADE_RANGE)
    return "OUT OF THROW RANGE";
  if (game.throwBlocked(unit.pos, point)) return "WALL BLOCKS THROW";
  return null;
}
export function defaultGrenadeTarget(game: Encounter, unit: Unit): Cell {
  const candidates: Cell[] = [];
  const { minX, maxX, minZ, maxZ } = game.map.bounds;
  for (let x = minX; x <= maxX; x++)
    for (let z = minZ; z <= maxZ; z++) {
      const point: Cell = [x, z];
      if (
        distance(unit.pos, point) >= 3 &&
        !grenadeBlockReason(game, unit, point)
      )
        candidates.push(point);
    }
  const score = (p: Cell) =>
    game.enemies.filter((e) => distance(e.pos, p) <= GRENADE_RADIUS).length * 100 -
    game.allies.filter((a) => distance(a.pos, p) <= GRENADE_RADIUS).length * 200 -
    Math.min(...game.enemies.map((e) => distance(e.pos, p)), 100);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? [...unit.pos];
}
