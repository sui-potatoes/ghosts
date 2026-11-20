// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game to watch, as the viewer reads it: where it starts and the events
 * since, complete (a replay) or still growing (a live game). Where the events
 * come from is the host's business: an encounter's own journal, a finished
 * game's history, a live game polled as it grows. The viewer only reads this
 * interface, so a new kind of source never touches it.
 *
 * Pure rules, no scene: tested in node.
 */

import { Encounter } from "../game.ts";
import type { GameEvent } from "../events.ts";
import type { Scenario } from "../scenario.ts";

/** One side of a game, in seat order. */
export interface WatchSide {
  /** What the viewer calls the side: a player's name, a squad's. */
  name: string;
}

/** How a finished game ended, when the source knows better than the rules (a forfeit, an abandoned game). */
export interface WatchOutcome {
  /** The winning side, or null for a draw or no result. */
  winner: 0 | 1 | null;
  /** One plain line on why, when it was not decided on the field ("Forfeit"). */
  reason?: string;
}

/**
 * A game as a record: the start and the events since. A recorded game is
 * complete from the start (`ended()` true); a live one appends events as they
 * happen and ends once.
 */
export interface RecordSource {
  /**
   * The scene and every unit that takes part, the ones that fall later too.
   * Side 0's units are those with `enemy` false.
   */
  readonly scenario: Scenario;
  /** The two sides, in seat order. */
  readonly sides: readonly [WatchSide, WatchSide];
  /**
   * Bring a fresh `new Encounter(scenario)` to the state before the first event:
   * stats, gear, authority, turn and phase as the game had them. Called on every
   * rebuild, so it must give the same state each time.
   */
  prepare?(game: Encounter): void;
  /** Every event so far, oldest first. It only ever grows by appending. */
  events(): readonly GameEvent[];
  /** No event will follow. */
  ended(): boolean;
  /** How the game ended, once it has and the events alone don't say; null otherwise. */
  outcome?(): WatchOutcome | null;
  /** When the turn in play runs out (epoch ms), for a live game with a clock. */
  deadline?(): number | undefined;
  /** Called when events are appended, the clock moves or the game ends. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** A source over a fixed list: a recorded game, complete. */
export function recordedSource(
  init: Pick<RecordSource, "scenario" | "sides" | "prepare" | "outcome"> & { events: readonly GameEvent[] },
): RecordSource {
  const events = [...init.events];
  return {
    scenario: init.scenario,
    sides: init.sides,
    prepare: init.prepare,
    outcome: init.outcome,
    events: () => events,
    ended: () => true,
    subscribe: () => () => {},
  };
}

/** One side's turn on the timeline. */
export interface TurnMark {
  /** The event index it starts at: the state after its opening `turn` or `hostile-phase`. */
  start: number;
  /** Whose turn it is. */
  side: 0 | 1;
  /** Units that fell in it. */
  kills: number;
}

/** Whether an event opens a side's turn. */
export const opensTurn = (event: GameEvent) => event.type === "turn" || event.type === "hostile-phase";

/**
 * The turns of a game: one per side's go, the first at index 0 (whoever the
 * prepared encounter opens with, `firstSide`), then one after every `turn`
 * (side 0) or `hostile-phase` (side 1) event.
 */
export function turnsOf(events: readonly GameEvent[], firstSide: 0 | 1 = 0): TurnMark[] {
  const turns: TurnMark[] = [{ start: 0, side: firstSide, kills: 0 }];
  events.forEach((event, i) => {
    if (opensTurn(event)) turns.push({ start: i + 1, side: event.type === "turn" ? 0 : 1, kills: 0 });
    const current = turns[turns.length - 1];
    if (event.type === "shot" && event.killed) current.kills++;
    if (event.type === "grenade") current.kills += event.casualties.filter((c) => c.killed).length;
  });
  return turns;
}

/** The turn the state after `cursor` events belongs to (an index into `turns`). */
export function turnAt(turns: readonly TurnMark[], cursor: number): number {
  let k = 0;
  while (k + 1 < turns.length && turns[k + 1].start <= cursor) k++;
  return k;
}

/**
 * The encounter as it stood after the first `index` events, rebuilt from the
 * start by re-applying them: no command runs again and nothing is rolled.
 * `prepare` brings the fresh encounter to the game's start first.
 */
export function rebuildEncounter(
  scenario: Scenario,
  events: readonly GameEvent[],
  index: number,
  prepare?: (game: Encounter) => void,
): Encounter {
  const game = new Encounter(scenario);
  prepare?.(game);
  const end = Math.max(0, Math.min(index, events.length));
  for (let i = 0; i < end; i++) game.ingest(events[i]);
  return game;
}

/** Which side acts in an encounter's current phase: side 0 plays the "player" phase. */
export const sideInPhase = (game: Pick<Encounter, "phase">): 0 | 1 => (game.phase === "player" ? 0 : 1);
