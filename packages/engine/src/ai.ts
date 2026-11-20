// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { GRENADE_RADIUS, GRENADE_RANGE, usesLeft } from "./action-registry.ts";
import type { GameEvent } from "./events.ts";
import { distance, type Cell, type Encounter, type Unit } from "./game.ts";
import { grenadeBlockReason } from "./targeting.ts";

/**
 * Hostile decisions, pure: each reads the encounter and names what a hostile
 * does next; the session applies it and the scene animates it.
 */

/** Hostiles further than this from every ally advance before acting. */
export const ENGAGE_DISTANCE = 5;

/** The living ally closest to `from`, or undefined once the squad is gone. */
export function nearestAlly(game: Encounter, from: Cell): Unit | undefined {
  return [...game.allies].sort((a, b) => distance(a.pos, from) - distance(b.pos, from))[0];
}

/** Where `enemy` moves this turn: the reachable cell closest to its nearest ally, or null to hold. */
export function hostileAdvance(game: Encounter, enemy: Unit): Cell | null {
  const target = nearestAlly(game, enemy.pos);
  if (!target || distance(enemy.pos, target.pos) <= ENGAGE_DISTANCE) return null;
  const [path] = [...game.paths(enemy).values()]
    .filter((p) => p.length > 1)
    .sort((a, b) => distance(a.at(-1)!, target.pos) - distance(b.at(-1)!, target.pos));
  return path ? path.at(-1)! : null;
}

/** Allies whose overwatch covers `enemy` where it stands. */
export function overwatchReactors(game: Encounter, enemy: Unit): Unit[] {
  return game.allies.filter((a) => a.overwatch && distance(a.pos, enemy.pos) <= a.range + 3);
}

export type HostileAction = { kind: "reload" } | { kind: "fire"; target: Unit };

/**
 * After moving: reload an empty weapon, otherwise shoot the nearest ally in
 * range (`Encounter.inRange`, the rule the player's aiming goes by); null with
 * nobody in range.
 */
export function hostileAction(game: Encounter, enemy: Unit): HostileAction | null {
  if (enemy.hp <= 0) return null;
  if (enemy.ammo === 0) return { kind: "reload" };
  const [target] = game.targetsInRange(enemy).sort((a, b) => distance(a.pos, enemy.pos) - distance(b.pos, enemy.pos));
  return target ? { kind: "fire", target } : null;
}

export type HostileThrow = { order: "flashbang" | "smoke-grenade"; at: Cell };

/**
 * A grenade worth throwing before the shot, for a hostile that holds its
 * ground with AP to spare: a flashbang that dazes the most of the squad and
 * none of its own side (the thrower included); else, once it is down to half
 * health, a smoke grenade over itself and its side with none of the squad in
 * it. Null when it carries neither or no tile is worth it: it just shoots.
 */
export function hostileThrow(game: Encounter, enemy: Unit): HostileThrow | null {
  if (enemy.hp <= 0 || enemy.ap < 2) return null;
  const tiles = (order: HostileThrow["order"]) => {
    const out: Cell[] = [];
    for (let dx = -GRENADE_RANGE; dx <= GRENADE_RANGE; dx++)
      for (let dz = -GRENADE_RANGE; dz <= GRENADE_RANGE; dz++) {
        const p: Cell = [enemy.pos[0] + dx, enemy.pos[1] + dz];
        if (Math.abs(dx) + Math.abs(dz) <= GRENADE_RANGE && !grenadeBlockReason(game, enemy, p, order)) out.push(p);
      }
    return out;
  };
  const caught = (side: Unit[], p: Cell) => side.filter((u) => distance(u.pos, p) <= GRENADE_RADIUS).length;
  const best = (order: HostileThrow["order"], score: (p: Cell) => number): HostileThrow | null => {
    let pick: Cell | null = null,
      top = 0;
    for (const p of tiles(order)) {
      const value = score(p);
      if (value > top) [pick, top] = [p, value];
    }
    return pick && { order, at: pick };
  };
  if (usesLeft(enemy, "Flashbang")) {
    const flash = best("flashbang", (p) => (caught(game.enemies, p) ? 0 : caught(game.allies, p)));
    if (flash) return flash;
  }
  if (usesLeft(enemy, "SmokeGrenade") && enemy.hp * 2 <= enemy.maxHp) {
    const smoke = best("smoke-grenade", (p) =>
      distance(p, enemy.pos) > GRENADE_RADIUS || caught(game.allies, p) ? 0 : caught(game.enemies, p),
    );
    if (smoke) return smoke;
  }
  return null;
}

/**
 * The whole hostile phase, one event at a time. State changes as the
 * generator advances, so a caller that animates each event before asking for
 * the next keeps the scene and the HUD in step with the rules.
 */
export function* hostilePhase(game: Encounter): Generator<GameEvent, void, void> {
  if (game.result || game.phase !== "player") return;
  yield* game.beginEnemy();
  for (const enemy of [...game.enemies]) {
    if (!game.allies.length) break;
    if (enemy.hp <= 0) continue;
    const destination = hostileAdvance(game, enemy);
    if (destination) {
      const moved = game.apply({ type: "move", unit: enemy.id, to: destination });
      yield* moved;
      for (const ally of moved.length ? overwatchReactors(game, enemy) : []) {
        yield* game.react(ally, enemy);
        if (enemy.hp <= 0) break;
      }
    }
    const thrown = hostileThrow(game, enemy);
    if (thrown) yield* game.apply({ type: thrown.order, unit: enemy.id, at: thrown.at });
    if (enemy.hp <= 0 || !game.allies.length) continue;
    const next = hostileAction(game, enemy);
    if (next?.kind === "reload") yield* game.apply({ type: "reload", unit: enemy.id });
    else if (next?.kind === "fire")
      yield* game.apply({ type: "fire", unit: enemy.id, target: next.target.id });
  }
  if (!game.result) {
    yield* game.nextTurn();
  }
}
