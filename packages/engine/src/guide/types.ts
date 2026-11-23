// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The guide's vocabulary, as plain data: what the field looks like to it (a
 * snapshot), what the player asks for (an intent), what a step points at and
 * what it says. No DOM, no three, no session: the director and its tests read
 * only these.
 */
import type { ThrowOrder } from "../action-registry.ts";
import type { GameEvent } from "../events.ts";
import type { Cell, UnitOrder } from "../game.ts";

/** One unit as the guide sees it. */
export interface GuideUnit {
  id: string;
  enemy: boolean;
  pos: Cell;
  hp: number;
  ap: number;
  ammo: number;
  clip: number;
  /** Status effect kinds on the unit (`Daze`, `Smoke`). */
  effects: string[];
}

/** How far the player has moved the camera since the field opened: totals, never reset. */
export interface CameraTravel {
  /** Radians turned around the focus, either way. */
  turned: number;
  /** Zoom travel, as fractions of the distance to the focus. */
  zoomed: number;
  /** Metres the focus slid over the ground. */
  panned: number;
}

/** The field at one moment, as the director reads it. */
export interface GuideSnapshot {
  /** Bumps when the encounter restarts: a new game under the same guide. */
  game: number;
  turn: number;
  phase: "player" | "enemy";
  result: "victory" | "defeat" | null;
  /** An order is animating: the outcome is in the rules, the scene is still playing it. */
  busy: boolean;
  /** A dialog covers the field (the briefing, the debrief) or the host has it paused. */
  covered: boolean;
  selected: string;
  /** The field's input mode: `move`, `fire` or a throw order. */
  mode: string;
  target: string;
  /** The landing tile of the throw being aimed. */
  throwAt: Cell | null;
  units: GuideUnit[];
  /** The journal, oldest first. */
  events: readonly GameEvent[];
  camera: CameraTravel;
}

/**
 * What the player asks the field for. The guide may hold any of these back
 * during a step; the camera, the readouts, cancelling and aiming a throw's
 * landing tile are never held.
 */
export type GuideIntent =
  | { type: "select"; unit: string }
  | { type: "move"; unit: string; to: Cell }
  /** Arm a targeted order (fire, a throw) or carry out an untargeted one (reload, hunker). */
  | { type: "arm"; unit: string; order: UnitOrder }
  | { type: "fire"; unit: string; target: string }
  | { type: "throw"; unit: string; order: ThrowOrder; at: Cell }
  | { type: "end-turn" };

/** HUD controls a step can point at, by name (the overlay finds them). */
export type HudTarget =
  | "end-turn"
  | "confirm"
  | "odds"
  /** The command bar slot of an action kind (`Attack`, `Reload`, `Grenade`, …). */
  | `command:${string}`
  /** A squad member's tile in the rail. */
  | `member:${string}`
  /** The selected unit's AP pips, HP pips or ammo pips. */
  | "unit-ap"
  | "unit-hp"
  | "unit-ammo";

/** One thing a step points at: tiles on the ground, a unit on the field, or a HUD control. */
export type Pointer =
  | { tiles: Cell[]; tone?: "go" | "prop" | "blast" }
  | { unit: string }
  | { hud: HudTarget };

/** A line of copy, per input: `{key:<combat action>}`, `{pad:<button or pad action>}` and `{cap:<text>}` draw controls. */
export interface Lines {
  keys: string[];
  pad: string[];
  touch: string[];
}

/** What one step says: a title, up to two lines per input, and what a refused order hears. */
export interface StepCopy {
  title: string;
  lines: Lines;
  /** Said when the player tries something the step holds back. */
  nudge?: string;
  /** Labels of the step's ticks (the camera step's three moves). */
  ticks?: string[];
}
