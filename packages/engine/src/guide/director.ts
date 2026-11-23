// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The guide's director: a scripted run of steps over snapshots of the field,
 * as a small pure state machine (tested in `director.test.ts`). A step is done
 * when the player has really done it (a predicate over the snapshot now and
 * the one the step began on), or, for a step that only tells, when the player
 * continues. Only then does the next one start. While a step runs it may hold
 * back what the player asks for (`permits`); the camera, the readouts and
 * cancelling are never held. The player can read back the steps already done
 * (`back` / `forward`) without undoing anything, and leave (`skip`).
 */
import type { Cell } from "../map.ts";
import type { GuideIntent, GuideSnapshot, Pointer } from "./types.ts";

export interface StepSpec {
  id: string;
  /** The first step of a stage names it: the field is set up anew for it (a restart of the field goes back here). */
  stage?: string;
  /** Done when this holds; `start` is the field as the step began. */
  done?: (now: GuideSnapshot, start: GuideSnapshot) => boolean;
  /** A step that only tells: done when the player continues. */
  confirm?: boolean;
  /** A step that teaches a view or a control, not an order: Next passes it, so nobody is ever held on a gesture. */
  passable?: boolean;
  /** May complete while an order still animates (the end of a turn); others wait for the scene. */
  busy?: boolean;
  /** What the player may ask for during the step; nothing held back when absent. */
  permits?: (intent: GuideIntent, now: GuideSnapshot) => boolean;
  /** What the step points at, now. */
  point?: (now: GuideSnapshot) => Pointer[];
  /** The unit the step is about: the card asks for it first while another is selected. */
  unit?: string;
  /** Progress ticks shown with the step (the camera's three moves). */
  ticks?: (now: GuideSnapshot, start: GuideSnapshot) => boolean[];
  /** `false`: the step leaves the camera where the player puts it (looking around); others frame the arena. */
  frame?: false;
  /** Who covers whom to draw during the step, as `[shooter, operator]`; the target in sight and the operator in hand when absent. */
  relation?: (now: GuideSnapshot) => [string, string] | null;
  /** Where the pad's tile cursor (or a throw's landing) jumps on the d-pad: the step's marked tile. */
  cursor?: (now: GuideSnapshot) => Cell | null;
}

export interface DirectorState {
  /** The step being played; `steps.length` once the last one is done. */
  index: number;
  /** The step whose text shows: the current one, or one already done being read back. */
  view: number;
  /** The field as the current step began; null until the field is first seen. */
  start: GuideSnapshot | null;
  /** The player left before the end. */
  left: boolean;
}

export const initialState = (): DirectorState => ({ index: 0, view: 0, start: null, left: false });

/** Every step done. */
export const finished = (steps: readonly StepSpec[], state: DirectorState) => state.index >= steps.length;

/** The step being played, or undefined once every step is done or the player left. */
export function current(steps: readonly StepSpec[], state: DirectorState): StepSpec | undefined {
  return state.left ? undefined : steps[state.index];
}

/** Whether the field can be read right now: no dialog over it, and the scene caught up unless the step need not wait. */
function settled(step: StepSpec, now: GuideSnapshot) {
  return !now.covered && (!now.busy || !!step.busy);
}

/**
 * The state after looking at the field. Completes the step being played when
 * its predicate holds, and keeps completing the next ones while theirs hold
 * from the start (a unit already selected). A step begins on the snapshot it
 * was entered with. Reading back an earlier step follows the play forward.
 */
export function observe(steps: readonly StepSpec[], state: DirectorState, now: GuideSnapshot): DirectorState {
  if (state.left) return state;
  let next = state;
  if (!next.start || next.start.game !== now.game) next = { ...next, start: now };
  for (let guard = 0; guard < steps.length; guard++) {
    const step = steps[next.index];
    if (!step || step.confirm || !step.done || !settled(step, now)) break;
    if (!step.done(now, next.start!)) break;
    next = advance(next, now);
  }
  return next;
}

function advance(state: DirectorState, now: GuideSnapshot): DirectorState {
  const index = state.index + 1;
  return { ...state, index, view: index, start: now };
}

/** The player continues past a step that only tells (or teaches a control); nothing for a step that waits on an order. */
export function proceed(steps: readonly StepSpec[], state: DirectorState, now: GuideSnapshot): DirectorState {
  const step = current(steps, state);
  if (!(step?.confirm || step?.passable) || state.view !== state.index || !settled(step, now)) return state;
  return advance(state, now);
}

/** Show the step before the one on view, without undoing anything. */
export function back(state: DirectorState): DirectorState {
  return state.view > 0 ? { ...state, view: state.view - 1 } : state;
}

/** Show the step after the one on view, up to the one being played. */
export function forward(state: DirectorState): DirectorState {
  return state.view < state.index ? { ...state, view: state.view + 1 } : state;
}

/** The player leaves the run. */
export function skip(state: DirectorState): DirectorState {
  return { ...state, left: true };
}

/** A fresh run on a new game (the encounter restarted). */
export function restart(now: GuideSnapshot): DirectorState {
  return { ...initialState(), start: now };
}

/** The index of the first step of the stage `index` belongs to (0 when no step names a stage). */
export function stageStart(steps: readonly StepSpec[], index: number): number {
  for (let i = Math.min(index, steps.length - 1); i >= 0; i--) if (steps[i].stage) return i;
  return 0;
}

/** The stage `index` belongs to, if any. */
export function stageAt(steps: readonly StepSpec[], index: number): string | undefined {
  return steps[stageStart(steps, index)]?.stage;
}

/** Go to step `index` (a stage's first step), on the field `now`. */
export function jump(state: DirectorState, index: number, now: GuideSnapshot | null): DirectorState {
  return { ...state, index, view: index, start: now, left: false };
}

/**
 * Whether the step being played lets the player do `intent`. With the run
 * left (or past its last step), everything goes; a step without `permits`
 * holds nothing back.
 */
export function permits(steps: readonly StepSpec[], state: DirectorState, intent: GuideIntent, now: GuideSnapshot): boolean {
  const step = current(steps, state);
  if (!step?.permits) return true;
  return step.permits(intent, now);
}
