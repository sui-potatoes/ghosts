import {coverPeek} from './high-cover.ts';
import {
  distance,
  SIZE,
  type Cell,
  type Encounter,
  type Unit,
} from "./game.ts";

export function shotBlockReason(
  game: Encounter,
  unit: Unit,
  target?: Unit,
): string | null {
  if (!game.canAct(unit)) return "No action points available";
  if (!unit.ammo) return "Magazine empty — reload first";
  if (!target || target.hp <= 0 || target.enemy === unit.enemy)
    return "Select a living hostile";
  if (distance(unit.pos, target.pos) > unit.range + 3)
    return `Out of range — move closer or equip the sniper`;
  if (coverPeek(unit.pos,target.pos).blocked) return "Wall blocks shot — move to a corner";
  return null;
}
export function bestShotTarget(game: Encounter, unit: Unit): Unit | undefined {
  return [...game.enemies].sort((a, b) => {
    const ar = distance(unit.pos, a.pos) <= unit.range + 3 && !coverPeek(unit.pos,a.pos).blocked,
      br = distance(unit.pos, b.pos) <= unit.range + 3 && !coverPeek(unit.pos,b.pos).blocked;
    return (
      Number(br) - Number(ar) ||
      game.chance(unit, b) - game.chance(unit, a) ||
      distance(unit.pos, a.pos) - distance(unit.pos, b.pos)
    );
  })[0];
}
export function grenadeBlockReason(
  game: Encounter,
  unit: Unit,
  point: Cell | null,
): string | null {
  if (!game.canAct(unit)) return "No action points available";
  if (unit.grenade) return "Grenade already used";
  if (!point) return "Select a landing tile";
  if (
    point[0] < SIZE.minX ||
    point[0] > SIZE.maxX ||
    point[1] < SIZE.minZ ||
    point[1] > SIZE.maxZ
  )
    return "Target is outside the district";
  if (distance(unit.pos, point) > 5)
    return "Out of throw range — maximum 5 tiles";
  return null;
}
export function defaultGrenadeTarget(game: Encounter, unit: Unit): Cell {
  const candidates: Cell[] = [];
  for (let x = SIZE.minX; x <= SIZE.maxX; x++)
    for (let z = SIZE.minZ; z <= SIZE.maxZ; z++) {
      const point: Cell = [x, z];
      if (
        distance(unit.pos, point) >= 3 &&
        !grenadeBlockReason(game, unit, point)
      )
        candidates.push(point);
    }
  const score = (p: Cell) =>
    game.enemies.filter((e) => distance(e.pos, p) <= 2).length * 100 -
    game.allies.filter((a) => distance(a.pos, p) <= 2).length * 200 -
    Math.min(...game.enemies.map((e) => distance(e.pos, p)), 100);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? [...unit.pos];
}
