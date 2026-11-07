// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { hostilePhase } from "./ai.ts";
import type { Command, GameEvent } from "./events.ts";
import type { Encounter } from "./game.ts";

/**
 * What decides an order's outcome: the bundled rules today, a server or the
 * chain later. `resolve` hands back the events of one order with the rules
 * already brought up to date — an async driver submits a transaction, decodes
 * the events from its effects and `ingest`s them before resolving. The session
 * plays whatever comes back, one event at a time, and never decides anything.
 *
 * A remote driver may answer a guaranteed order at once and settle it behind the
 * scene. An outcome that takes dice arrives when it arrives, and the session
 * starts on the order without waiting for it.
 */
export interface EncounterDriver {
  /** Answers take a round trip: start on shots and throws before the outcome is in. */
  remote?: boolean;
  /** Carry out one order; empty when refused. The rules are updated before this resolves. */
  resolve(command: Command): Promise<GameEvent[]>;
  /** The player's turn is over: the whole hostile turn, one event at a time; may be lazy or async. */
  hostilePhase(): Iterable<GameEvent> | AsyncIterable<GameEvent>;
  /** Follow the other side without ending anything; returns when it is the player's turn. */
  watch?(): AsyncIterable<GameEvent>;
}

/** Builds the driver for a (re)started encounter; a host passes its own to `<Encounter>`. */
export type DriverFactory = (game: Encounter) => EncounterDriver;

/** The default driver: the bundled rules decide everything, synchronously. */
export const localDriver: DriverFactory = (game) => ({
  resolve: (command) => Promise.resolve(game.apply(command)),
  hostilePhase: () => hostilePhase(game),
});
