// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Cell } from "./game.ts";

/**
 * What happened, as the rules decided it. The scene animates events, the
 * session voices and announces them, the log is written from them; none of
 * those decide an outcome. Units are referred to by id.
 */
export type GameEvent =
  | { type: "move"; unit: string; path: Cell[]; vault: boolean; cover: boolean }
  | {
      type: "shot";
      unit: string;
      target: string;
      hit: boolean;
      crit: boolean;
      damage: number;
      killed: boolean;
      /** Overwatch: fired out of turn at a hostile that moved. */
      reaction: boolean;
    }
  | { type: "reload"; unit: string }
  | {
      type: "grenade";
      unit: string;
      at: Cell;
      casualties: { unit: string; damage: number; killed: boolean }[];
    }
  | { type: "hunker"; unit: string }
  | { type: "overwatch"; unit: string }
  | { type: "secure"; unit: string }
  | { type: "hostile-phase" }
  | { type: "turn"; turn: number };

/** An order from the player (or the hostile planner) for one unit. */
export type Command =
  | { type: "move"; unit: string; to: Cell }
  | { type: "fire"; unit: string; target: string }
  | { type: "grenade"; unit: string; at: Cell }
  | { type: "reload" | "hunker" | "overwatch" | "secure"; unit: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The combat feed line for an event; `name` resolves a unit id. Scenarios may word some lines themselves. */
export function describe(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "move":
      return `${name(event.unit)} repositioned. −1 AP.`;
    case "shot": {
      const { hit, crit, damage, killed } = event;
      const outcome = hit
        ? `${crit ? "CRITICAL / " : ""}${damage} damage${killed ? " / neutralized" : ""}`
        : "miss";
      return `${name(event.unit)} → ${name(event.target)}: ${outcome}.`;
    }
    case "reload":
      return `${name(event.unit)} reloaded. −1 AP.`;
    case "grenade":
      return `${name(event.unit)} deployed fragmentation grenade. Blast radius: 2.`;
    case "hunker":
      return `${name(event.unit)} hunkered down. Defense increased.`;
    case "overwatch":
      return `${name(event.unit)} on overwatch.`;
    case "secure":
      return `${name(event.unit)} secured the objective.`;
    case "turn":
      return `Turn ${pad2(event.turn)}. Ghosts has control.`;
    case "hostile-phase":
      return null;
  }
}
