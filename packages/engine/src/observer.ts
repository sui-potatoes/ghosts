// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Observer mode: the encounter mounted with no seat. Nobody gives orders; the
 * camera is free; both squads are equals, side 0 (the units with `enemy`
 * false) and side 1, each named by the record being watched. These are the
 * rules of it the controls, the HUD and the presenter ask; nothing here
 * assumes the viewer is side 0.
 *
 * Pure: tested in node.
 */

import type { CombatAction } from "./keys.ts";
import type { Unit } from "./game.ts";
import type { WatchSide } from "./replay/timeline.ts";

/** What the session knows when it is a viewer's. */
export interface ObserverView {
  /** The two sides, in seat order, as the record names them. */
  sides: readonly [WatchSide, WatchSide];
  /** The turn on the viewer's timeline (each side's go is one), from 1. */
  turn: number;
  /** When the live game's turn runs out (epoch ms), while the viewer follows it; absent otherwise. */
  deadline?: number;
}

/**
 * The combat keys a viewer has: the camera (rotate, focus, the close camera),
 * the grid, reading units (inspect, stepping through them) and cancel. No
 * order, no confirm: nothing on the field is the viewer's to move.
 */
const OBSERVER_COMMANDS: ReadonlySet<CombatAction> = new Set([
  "rotate-left",
  "rotate-right",
  "focus",
  "camera",
  "grid",
  "inspect",
  "next-operator",
  "cancel",
]);

export function observerAllows(command: CombatAction | null | undefined): command is CombatAction {
  return !!command && OBSERVER_COMMANDS.has(command);
}

/** A unit's side: 0 for the units with `enemy` false. */
export const sideOf = (u: Pick<Unit, "enemy">): 0 | 1 => (u.enemy ? 1 : 0);

/** Both squads in deployment order, side 0 first: the viewer's two rosters. */
export function rosters<U extends Pick<Unit, "enemy">>(units: readonly U[]): [U[], U[]] {
  return [units.filter((u) => !u.enemy), units.filter((u) => u.enemy)];
}

/**
 * The unit after (`dir` 1) or before (-1) `current` among the living of both
 * sides, side 0 first; from nobody, the first (or last). Undefined with nobody standing.
 */
export function cycleUnit<U extends Pick<Unit, "id" | "hp" | "enemy">>(
  units: readonly U[],
  current: string,
  dir: 1 | -1,
): U | undefined {
  const living = rosters(units)
    .flat()
    .filter((u) => u.hp > 0);
  const n = living.length;
  if (!n) return undefined;
  const i = living.findIndex((u) => u.id === current);
  return living[i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The status line as a side's turn opens: "TURN 07 / VANCE". */
export function turnLine(turn: number, side: WatchSide): string {
  return `TURN ${pad2(turn)} / ${side.name.toUpperCase()}`;
}

/** Units still standing of how many each side deployed. */
export function standing(units: readonly Pick<Unit, "enemy" | "hp">[]): [{ alive: number; total: number }, { alive: number; total: number }] {
  return rosters(units).map((side) => ({ alive: side.filter((u) => u.hp > 0).length, total: side.length })) as [
    { alive: number; total: number },
    { alive: number; total: number },
  ];
}
