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
import type { Cell, Encounter } from "../game.ts";
import type { Scenario } from "../scenario.ts";
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
  /** The run's stages (lessons), in order: each step that names one starts it on a field of its own. */
  stages?: { id: string; title: string }[];
  /** The encounter a stage plays on (the same units and map plan as every other). */
  stageScenario?(id: string): Scenario;
  /** The few inputs each stage needs, always on the card. */
  controls?: Record<string, import("./types.ts").Lines>;
  /** The cells the camera frames for each step (the room). */
  frame?: Cell[];
  /** Draw the level as the training simulation (`sim-scene.ts`): pieces by what they are. */
  simulation?: boolean;
  /** Draw who covers whom from the target in sight (the simulation's cover lines). */
  relations?: boolean;
  /** Set the field up once the deployed units have their loadouts (each new game). */
  prepare?(game: Encounter): void;
}

/** What the host does when the run ends or is left. */
export interface GuideHost {
  /** The last step was reached: the lessons are done (called once per run). */
  onComplete?(): void;
  /** The player left the run (Skip). */
  onLeave?(): void;
  /** The closing card's ways on, the first one the primary. */
  exits?: { label: string; run(): void }[];
  /** The lessons this device has completed, for the card's lesson list. */
  done?: string[];
  /** A lesson was completed. */
  onStage?(id: string): void;
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
  /** The stage the field shows, and whether the next new encounter is the guide's own restage. */
  fieldStage: string | undefined;
  private restaging = false;

  constructor(script: GuideScript, host: GuideHost = {}) {
    this.script = script;
    this.host = host;
    this.fieldStage = director.stageAt(script.steps, 0);
  }

  /** Open the run on a stage's first step (before the field is up; the host mounts that stage). */
  startAt(stage: string) {
    const index = this.steps.findIndex((s) => s.stage === stage);
    if (index < 0) return;
    this.state = director.jump(this.state, index, null);
    this.fieldStage = stage;
  }

  /** The stage the step being played belongs to. */
  get stage(): string | undefined {
    return director.stageAt(this.steps, this.state.index);
  }

  /** The stage the field should switch to now, if the run has moved on past the one it shows. */
  wantsStage(): string | undefined {
    const stage = this.stage;
    return stage && stage !== this.fieldStage && !director.finished(this.steps, this.state) ? stage : undefined;
  }

  /** The field was switched to `stage` by the guide: the next new encounter goes on the run, it does not restart it. */
  restaged(stage: string) {
    this.fieldStage = stage;
    this.restaging = true;
  }

  /** Go to a lesson's first step; the field follows (`wantsStage`), the same lesson restarts. */
  jumpTo(stage: string) {
    const index = this.steps.findIndex((s) => s.stage === stage);
    if (index < 0) return;
    this.state = director.jump(this.state, index, this.snapshot);
    this.fieldStage = undefined;
    this.nudge = null;
    this.passed = -1;
    this.changed();
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
    const fresh = !!this.snapshot && this.snapshot.game !== now.game;
    this.snapshot = now;
    const before = this.state;
    if (fresh && !this.restaging) {
      // The field restarted under the run (the pause menu): back to the start of its stage.
      this.state = director.jump(this.state, director.stageStart(this.steps, this.state.index), now);
      this.nudge = null;
      this.passed = -1;
    } else {
      if (fresh) this.restaging = false;
      this.state = director.observe(this.steps, this.state, now);
    }
    this.stagesDone(before);
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

  /** The step last left by Next without being done (a control lesson passed over): its "done" line is not said. */
  passed = -1;

  /** Continue past a step that only tells (or pass a control lesson). */
  proceed() {
    if (!this.snapshot) return;
    const next = director.proceed(this.steps, this.state, this.snapshot);
    if (next === this.state) return;
    const before = this.state;
    if (this.step?.passable) this.passed = before.index;
    this.state = next;
    this.nudge = null;
    this.stagesDone(before);
    this.settle();
    this.changed();
  }

  /** Tell the host of every stage the run moved past since `before`. */
  private stagesDone(before: DirectorState) {
    if (this.state.index <= before.index) return;
    const from = director.stageAt(this.steps, before.index);
    const to = director.stageAt(this.steps, this.state.index);
    if (from && (from !== to || director.finished(this.steps, this.state) || this.state.index >= this.steps.length - 1))
      this.host.onStage?.(from);
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

  /**
   * Where the pad's cursor jumps on the d-pad during the step: its marked tile
   * (or a throw's landing), for the operator the step is about. Null: the pad
   * steers as it always does.
   */
  padCursor(): Cell | null {
    const step = this.step;
    const now = this.snapshot;
    if (!step?.cursor || !now || this.state.view !== this.state.index) return null;
    if (step.unit && now.selected !== step.unit) return null;
    return step.cursor(now);
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
