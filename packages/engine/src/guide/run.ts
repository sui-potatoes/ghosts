// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A guided run as the encounter holds it (`<Encounter guide>`): the director's
 * state over one script, fed snapshots of the field by the overlay, asked by
 * the field's actions whether an order may go ahead (`permits`), and the
 * driver that fixes the lesson's dice and plays its hostile turn. Plain
 * TypeScript: no DOM, no three; the overlay subscribes to it like a store.
 */
import { hostilePhase as rulesHostilePhase } from "../ai.ts";
import type { DriverFactory } from "../driver.ts";
import type { Command, GameEvent } from "../events.ts";
import type { Encounter } from "../game.ts";
import { fixShot, type ShotOutcome } from "./dice.ts";
import * as director from "./director.ts";
import type { DirectorState, StepSpec } from "./director.ts";
import type { GuideIntent, GuideSnapshot, StepCopy } from "./types.ts";

export interface GuideScript {
  steps: StepSpec[];
  /** The words of each step, by step id. */
  copy: Record<string, StepCopy>;
  /** The dice a player's shot is taken with; null rolls as the rules would. */
  dice?(game: Encounter, command: Command): ShotOutcome | null;
  /** The hostile turn as the script plays it; null leaves it to the rules. */
  hostileTurn?(game: Encounter): Iterable<GameEvent> | null;
}

/** What the host does when the run ends or is left. */
export interface GuideHost {
  /** The last step was reached: the lessons are done (called once per run). */
  onComplete?(): void;
  /** The player left the run (Skip). */
  onLeave?(): void;
  /** The closing card's ways on, the first one the primary. */
  exits?: { label: string; run(): void }[];
}

/** A refused order, for the card to say so. */
export interface Nudge {
  text: string;
  at: number;
}

export class Guide {
  readonly script: GuideScript;
  readonly host: GuideHost;
  state: DirectorState = director.initialState();
  /** The field as last seen. */
  snapshot: GuideSnapshot | null = null;
  nudge: Nudge | null = null;
  private completed = false;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  /** The encounter seen last, and how many the run has seen (a restart is a new one). */
  private game: object | null = null;
  private games = 0;

  constructor(script: GuideScript, host: GuideHost = {}) {
    this.script = script;
    this.host = host;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  get steps() {
    return this.script.steps;
  }

  /** The step being played, unless the run is over or was left. */
  get step(): StepSpec | undefined {
    return director.current(this.steps, this.state);
  }

  /** The number a game is known by in snapshots: a new encounter object is a restart. */
  gameNumber(game: object): number {
    if (game !== this.game) {
      this.game = game;
      this.games++;
    }
    return this.games;
  }

  /** Look at the field: a restart starts the run over, a step done starts the next. */
  update(now: GuideSnapshot) {
    const restarted = !!this.snapshot && this.snapshot.game !== now.game;
    this.snapshot = now;
    const before = this.state;
    if (restarted) {
      this.state = director.restart(now);
      this.completed = false;
      this.nudge = null;
    } else this.state = director.observe(this.steps, this.state, now);
    if (this.state.index !== before.index) this.nudge = null;
    this.settle();
    // What the card points at follows the field even while the step goes on.
    this.changed();
  }

  /** The closing card was reached: tell the host once. */
  private settle() {
    if (this.completed || this.state.left) return;
    const last = this.steps.length - 1;
    if (this.state.index >= last) {
      this.completed = true;
      this.host.onComplete?.();
    }
  }

  /**
   * Whether the step lets the player do `intent`; when it does not, the card
   * says what to do instead. Before the field is first seen nothing is held.
   */
  permits(intent: GuideIntent): boolean {
    if (this.allows(intent)) return true;
    const copy = this.step && this.script.copy[this.step.id];
    this.nudge = { text: copy?.nudge ?? "", at: Date.now() };
    // Reading back an earlier step: the refusal brings the current one into view.
    this.state = { ...this.state, view: this.state.index };
    this.changed();
    return false;
  }

  /** Whether the step lets `intent` through, saying nothing (what the HUD dims). */
  allows(intent: GuideIntent): boolean {
    const now = this.snapshot;
    return !now || director.permits(this.steps, this.state, intent, now);
  }

  /** Continue past a step that only tells. */
  proceed() {
    if (!this.snapshot) return;
    const next = director.proceed(this.steps, this.state, this.snapshot);
    if (next === this.state) return;
    this.state = next;
    this.nudge = null;
    this.settle();
    this.changed();
  }

  back() {
    this.state = director.back(this.state);
    this.changed();
  }

  forward() {
    this.state = director.forward(this.state);
    this.changed();
  }

  /** Leave the run: nothing is held back any more, and the host takes the player away. */
  skip() {
    this.state = director.skip(this.state);
    this.changed();
    this.host.onLeave?.();
  }

  /** The step's ticks right now, if it has any. */
  ticks(): boolean[] | null {
    const step = this.step;
    const now = this.snapshot;
    if (!step?.ticks || !now || !this.state.start) return null;
    return step.ticks(now, this.state.start);
  }
}

/**
 * The driver for a guided encounter: the bundled rules, with the script's dice
 * on the player's shots and its hostile turn where it has one.
 */
export function guidedDriver(guide: Guide): DriverFactory {
  return (game) => ({
    resolve(command) {
      const { dice } = guide.script;
      if (dice && !guide.state.left) fixShot(game, command, dice(game, command));
      return Promise.resolve(game.apply(command));
    },
    hostilePhase: () => (!guide.state.left && guide.script.hostileTurn?.(game)) || rulesHostilePhase(game),
  });
}
