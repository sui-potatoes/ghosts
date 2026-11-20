// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The viewer's transport: a cursor over a game's events that plays them one
 * by one through a stage, with play and pause, four speeds, previous and next
 * turn, a jump to any turn, restart, and for a game still being played a Live
 * state that follows new events as they come.
 *
 * Going back is a rebuild: the stage re-applies the events from the start up
 * to the target with no animation and snaps the scene there. Pausing holds the
 * scene clock (time scale 0), so an animation stops where it is and goes on
 * from there; the camera stays free. A seek mid-animation first runs what is
 * playing to its end at once (`finish`), then rebuilds.
 *
 * The result waits for the last thing played: when the game is over and the
 * cursor reached its end by playing, `finished` turns true only after the
 * final event's animation is done and a short beat has passed (`beatSeconds`),
 * so a kill's fall is seen before the banner. A seek shows the result at once.
 *
 * Pure: the stage is an interface, so the state machine is tested in node.
 */

import type { GameEvent } from "../events.ts";
import { turnAt, turnsOf, type RecordSource, type TurnMark, type WatchOutcome } from "./timeline.ts";

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** What plays the events: the scene in the app, a recorder in tests. */
export interface PlaybackStage {
  /** The field as it stood after the first `index` events, at once, with no animation. */
  rebuild(events: readonly GameEvent[], index: number): void;
  /** Apply one event and animate it; resolves when its animation is done. */
  present(event: GameEvent): Promise<void>;
  /** A pause of `seconds` of scene time (it follows the speed and holds while paused). */
  wait(seconds: number): Promise<void>;
  /** Run whatever animates to its end now, until `done` settles. */
  finish(done: Promise<unknown>): Promise<void>;
  /** Scene time per frame time; 0 holds the field. */
  setTimeScale(scale: number): void;
  /** Voice lines on or off: they overlap and can't follow the pitch above 1x. */
  setVoice(on: boolean): void;
  /** The player asked for less motion: the beat before the result is shorter. */
  reduced?(): boolean;
  /** How the field says the game ended, at its end: a side with nobody standing lost. */
  outcome?(): WatchOutcome | null;
}

export interface PlaybackState {
  /** Events applied: the field shows the state after `cursor` events. */
  cursor: number;
  /** Events known so far. */
  total: number;
  turns: readonly TurnMark[];
  /** The turn the cursor is in, an index into `turns`. */
  turn: number;
  playing: boolean;
  speed: Speed;
  /** More events may still come (a live game). */
  growing: boolean;
  /** Playing at the live edge: new events play as they arrive. */
  live: boolean;
  /** Turns between the cursor's turn and the newest one. */
  behind: number;
  /** At the end of a game that is over. */
  finished: boolean;
  /** How it ended, once finished: the source's word first, else the field's; null when neither says. */
  outcome: WatchOutcome | null;
}

/**
 * Scene seconds between the last event's animation ending and the result showing:
 * 0.9 at 1x, 0.4 with Reduce motion. Never under 0.3 s of real time, so 4x is not instant.
 */
export function beatSeconds(speed: number, reduced: boolean): number {
  return Math.max(reduced ? 0.4 : 0.9, 0.3 * speed);
}

/** Scene seconds between one event and the next, at 1x. */
export function gapAfter(event: GameEvent): number {
  switch (event.type) {
    case "effect-start":
    case "effect-end":
    case "watch-spent":
    case "switch-weapon":
      return 0;
    case "turn":
    case "hostile-phase":
      return 1;
    default:
      return 0.45;
  }
}

/** The field's result when it has one (a side wiped out), else the source's (a forfeit, a game left early). */
function fieldOutcome(source: RecordSource, stage: PlaybackStage): WatchOutcome | null {
  const field = stage.outcome?.() ?? null;
  return field && field.winner !== null ? field : (source.outcome?.() ?? field);
}

export class Playback {
  private cursor = 0;
  private playing = false;
  private speed: Speed = 1;
  /**
   * Caught up with a growing game: set on reaching its newest event while
   * playing, kept while the events that arrive next play, cleared by a pause
   * or a seek short of the end.
   */
  private following = false;
  /** Moves on with every seek and on dispose: a play loop or seek from before stops. */
  private gen = 0;
  /** The gen of the play loop running now; -1 with none. */
  private loopGen = -1;
  /** The event being played and the pause after it. */
  private step: Promise<void> | null = null;
  /**
   * The field shows its end as it stands: false from an event played until the beat after the
   * last one has passed (a seek, or a pause with nothing animating, settles it).
   */
  private settled = true;
  private wake: (() => void) | null = null;
  private turnCache: { length: number; turns: TurnMark[] } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private disposed = false;
  private snapshot: PlaybackState | null = null;

  private readonly source: RecordSource;
  private readonly stage: PlaybackStage;
  /** The side whose turn the game opens on. */
  private readonly firstSide: 0 | 1;
  /** The turn number the game opens on, as a player's HUD shows it. */
  private readonly firstRound: number;

  constructor(source: RecordSource, stage: PlaybackStage, firstSide: 0 | 1 = 0, firstRound = 1) {
    this.source = source;
    this.stage = stage;
    this.firstSide = firstSide;
    this.firstRound = firstRound;
    this.unsubscribe = source.subscribe(() => {
      this.turnCache = null;
      this.settleIfIdle();
      this.wake?.();
      this.changed();
    });
  }

  // === State ===

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The state now; the same object until something changes (for `useSyncExternalStore`). */
  getState = (): PlaybackState => (this.snapshot ??= this.compute());

  private changed() {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  private turns(): TurnMark[] {
    const events = this.source.events();
    if (this.turnCache?.length !== events.length)
      this.turnCache = { length: events.length, turns: turnsOf(events, this.firstSide, this.firstRound) };
    return this.turnCache.turns;
  }

  private compute(): PlaybackState {
    const total = this.source.events().length;
    const turns = this.turns();
    const turn = turnAt(turns, this.cursor);
    const growing = !this.source.ended();
    const atEdge = this.cursor >= total;
    return {
      cursor: this.cursor,
      total,
      turns,
      turn,
      playing: this.playing,
      speed: this.speed,
      growing,
      live: growing && this.playing && this.following,
      behind: turns.length - 1 - turn,
      finished: !growing && atEdge && this.settled,
      outcome: !growing && atEdge && this.settled ? fieldOutcome(this.source, this.stage) : null,
    };
  }

  // === Controls ===

  /** Open on the game's start (or its live edge, for a game being played), playing unless `paused`. */
  start({ at = "start", paused = false }: { at?: "start" | "live"; paused?: boolean } = {}) {
    this.playing = !paused;
    this.applyClock();
    void this.seekTo(at === "live" ? this.source.events().length : 0);
  }

  play() {
    if (this.disposed) return;
    if (this.getState().finished) {
      this.restart();
      return;
    }
    this.playing = true;
    // Played at the newest event, the viewer follows from here.
    if (this.cursor >= this.source.events().length) this.following = true;
    this.applyClock();
    this.changed();
    this.kick();
  }

  /** Hold the field where it is: the animation playing stops mid-way and the camera stays free. */
  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.following = false;
    this.applyClock();
    this.settleIfIdle();
    this.wake?.();
    this.changed();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: Speed) {
    if (!SPEEDS.includes(speed)) return;
    this.speed = speed;
    this.applyClock();
    this.changed();
  }

  /** One speed step up (1) or down (-1), stopping at the ends. */
  stepSpeed(dir: 1 | -1) {
    const i = SPEEDS.indexOf(this.speed);
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]);
  }

  /** The start of the next turn; past the last one, the end. */
  nextTurn() {
    const { turns, turn, total } = this.getState();
    void this.seekTo(turn + 1 < turns.length ? turns[turn + 1].start : total);
  }

  /** The start of the turn before the cursor's. */
  prevTurn() {
    const { turns, turn } = this.getState();
    void this.seekTo(turns[Math.max(0, turn - 1)].start);
  }

  /** The start of turn `index` (into `turns`). */
  jump(index: number) {
    const { turns } = this.getState();
    if (!turns.length) return;
    void this.seekTo(turns[Math.max(0, Math.min(turns.length - 1, index))].start);
  }

  /** Back to the game's start, playing. */
  restart() {
    this.playing = true;
    this.applyClock();
    void this.seekTo(0);
  }

  /** To the newest event at 1x, playing: the viewer follows the game from there. */
  goLive() {
    this.speed = 1;
    this.playing = true;
    this.applyClock();
    void this.seekTo(this.source.events().length);
  }

  dispose() {
    this.disposed = true;
    this.gen++;
    this.playing = false;
    this.wake?.();
    this.unsubscribe();
    this.listeners.clear();
  }

  // === Engine room ===

  private applyClock() {
    this.stage.setTimeScale(this.playing ? this.speed : 0);
    this.stage.setVoice(this.speed <= 1);
  }

  /** The field rebuilt at `index`; whatever was playing is run to its end first. */
  private async seekTo(index: number) {
    if (this.disposed) return;
    const gen = ++this.gen;
    this.wake?.();
    if (this.step) await this.stage.finish(this.step);
    if (gen !== this.gen) return;
    const events = this.source.events();
    this.cursor = Math.max(0, Math.min(index, events.length));
    this.following = this.cursor >= events.length;
    this.settled = true;
    this.stage.rebuild(events, this.cursor);
    this.applyClock();
    this.changed();
    this.kick();
  }

  /** Start the play loop when playing and none runs for the current gen. */
  private kick() {
    if (this.playing && !this.disposed && this.loopGen !== this.gen) void this.loop(this.gen);
  }

  /** A paused viewer at the end of a finished game with nothing animating owes no beat: the result shows. */
  private settleIfIdle() {
    if (this.settled || this.playing || this.step || !this.source.ended()) return;
    if (this.cursor >= this.source.events().length) this.settled = true;
  }

  /** The pause after the last event, in scene time: held while paused, run out by a seek. */
  private async beat(gen: number) {
    const step = this.stage.wait(beatSeconds(this.speed, this.stage.reduced?.() ?? false));
    this.step = step;
    await step;
    if (this.step === step) this.step = null;
    if (gen !== this.gen) return;
    this.settled = true;
    this.changed();
  }

  /** Resolves on the next change of the source, or when woken (a pause, a seek). */
  private nextChange() {
    return new Promise<void>((resolve) => {
      this.wake = () => {
        this.wake = null;
        resolve();
      };
    });
  }

  private async loop(gen: number) {
    this.loopGen = gen;
    try {
      while (gen === this.gen && this.playing) {
        const events = this.source.events();
        if (this.cursor >= events.length) {
          if (!this.following) {
            this.following = true;
            this.changed();
          }
          if (this.source.ended()) {
            if (!this.settled) {
              await this.beat(gen);
              continue;
            }
            this.playing = false;
            this.applyClock();
            this.changed();
            return;
          }
          await this.nextChange();
          continue;
        }
        const event = events[this.cursor++];
        this.settled = false;
        this.changed();
        const step = (async () => {
          await this.stage.present(event);
          // After the game's last event the beat stands in for the gap.
          const last = this.source.ended() && this.cursor >= this.source.events().length;
          if (gen === this.gen && !last) await this.stage.wait(gapAfter(event));
        })();
        this.step = step;
        await step;
        if (this.step === step) this.step = null;
      }
    } finally {
      if (this.loopGen === gen) this.loopGen = -1;
    }
  }
}
