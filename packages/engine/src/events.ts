// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Cell, Weapon } from "./game.ts";
import type { PropDamage } from "./environment.ts";

/**
 * What happened, as the rules decided it. The scene animates events, the
 * session voices and announces them, the log is written from them; none of
 * those decide an outcome. Units are referred to by id.
 *
 * Events are the full record: every state change the rules make is an event,
 * and `Encounter.ingest` rebuilds the same state from them. That is what lets
 * a replay, a server or the chain decide an encounter — the journal is the
 * wire format a transaction's effects map onto.
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
      environment?: PropDamage[];
    }
  | { type: "reload"; unit: string }
  /** A unit took up a weapon lying where it stands; `weapon` is its name. */
  | { type: "pick-up"; unit: string; weapon: string }
  | {
      type: "grenade";
      unit: string;
      at: Cell;
      casualties: { unit: string; damage: number; killed: boolean }[];
      environment?: PropDamage[];
    }
  | { type: "hunker"; unit: string }
  | { type: "overwatch"; unit: string }
  | { type: "switch-weapon"; unit: string; weapon: Weapon }
  /** An armed overwatch found no shot; the watch is spent all the same. */
  | { type: "watch-spent"; unit: string }
  | { type: "secure"; unit: string }
  | { type: "hostile-phase" }
  | { type: "turn"; turn: number };

/** An order from the player (or the hostile planner) for one unit. */
export type Command =
  | { type: "move"; unit: string; to: Cell }
  | { type: "fire"; unit: string; target: string }
  | { type: "grenade"; unit: string; at: Cell }
  | { type: "switch-weapon"; unit: string; weapon: Weapon }
  | { type: "reload" | "pick-up" | "hunker" | "overwatch" | "secure"; unit: string };

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
    case "pick-up":
      return `${name(event.unit)} took up a ${event.weapon}. −1 AP.`;
    case "grenade": {
      const broken = event.environment?.filter((p) => p.destroyed).length ?? 0;
      return `${name(event.unit)} deployed fragmentation grenade. Blast radius: 2.${broken ? ` ${broken} prop${broken === 1 ? "" : "s"} destroyed.` : ""}`;
    }
    case "hunker":
      return `${name(event.unit)} hunkered down. Defense increased.`;
    case "overwatch":
      return `${name(event.unit)} on overwatch.`;
    case "switch-weapon":
      return `${name(event.unit)} switched to the ${event.weapon}.`;
    case "watch-spent":
      return null;
    case "secure":
      return `${name(event.unit)} secured the objective.`;
    case "turn":
      return `Turn ${pad2(event.turn)}. Ghosts has control.`;
    case "hostile-phase":
      return null;
  }
}
