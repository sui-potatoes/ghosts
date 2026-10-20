import type { GameEvent } from "./events.ts";
import { distance, type Cell, type Encounter, type Unit } from "./game.ts";

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

/** After moving: reload an empty weapon, otherwise shoot the nearest ally. */
export function hostileAction(game: Encounter, enemy: Unit): HostileAction | null {
  if (enemy.hp <= 0) return null;
  if (enemy.ammo === 0) return { kind: "reload" };
  const target = nearestAlly(game, enemy.pos);
  return target ? { kind: "fire", target } : null;
}

/**
 * The whole hostile phase, one event at a time. State changes as the
 * generator advances, so a caller that animates each event before asking for
 * the next keeps the scene and the HUD in step with the rules.
 */
export function* hostilePhase(game: Encounter): Generator<GameEvent, void, void> {
  if (game.result || game.phase !== "player") return;
  game.beginEnemy();
  yield* game.events.slice(-1);
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
    const next = hostileAction(game, enemy);
    if (next?.kind === "reload") yield* game.apply({ type: "reload", unit: enemy.id });
    else if (next?.kind === "fire")
      yield* game.apply({ type: "fire", unit: enemy.id, target: next.target.id });
  }
  if (!game.result) {
    game.nextTurn();
    yield* game.events.slice(-1);
  }
}
