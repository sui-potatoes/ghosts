// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";
import { inspectOrder, stepInspect, type IntelSource, type OpponentIntel } from "../../intel";
import { session } from "../../session";

/**
 * Which unit the readout describes, and how it got there. A hovered unit
 * shows while the pointer is on it; a held one (pinned by a click or a long
 * press, cycled to with Inspect, tapped) stays until Back or another pick.
 * Hover wins over the held unit and hands it back on leaving. One readout at
 * a time. Listeners hear only when the described unit changes, never on
 * pointer moves within a unit.
 */
export type Hold = "pin" | "cycle" | "tap";

class InspectStore {
  hovered = "";
  held = "";
  hold: Hold | null = null;
  /** The host's intel and the opposing player, read live from `<Encounter>`'s props. */
  source: IntelSource | undefined;
  opponent: OpponentIntel | null = null;
  version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getVersion = () => this.version;

  changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  reset() {
    this.hovered = this.held = "";
    this.hold = null;
    this.changed();
  }
}

export const inspect = new InspectStore();

/**
 * Inspect as a command, for the HUD's command bar: the bindable keyboard
 * action (label in `COMBAT_LABELS`, key cap through `cap("inspect")`) and the
 * pad button, fixed like the sticks.
 */
export const INSPECT_COMMAND = { action: "inspect", pad: "l3" } as const;

export function useInspect() {
  useSyncExternalStore(inspect.subscribe, inspect.getVersion);
  return inspect;
}

const living = (id: string) => !!id && (session.game.unit(id)?.hp ?? 0) > 0;

/** The unit the floating readout shows now; "" for none. Targeting a shot shows its own (merged) readout. */
export function shownUnit(): string {
  const s = session;
  if (s.state !== "ready" || s.dialogOpen || s.mode === "fire") return "";
  if (living(inspect.hovered)) return inspect.hovered;
  return living(inspect.held) ? inspect.held : "";
}

/** The pointer is on `id` (or on no unit). */
export function hoverUnit(id: string | null) {
  const next = id ?? "";
  if (next === inspect.hovered) return;
  inspect.hovered = next;
  inspect.changed();
}

function hold(id: string, how: Hold) {
  if (inspect.held === id && inspect.hold === how) return;
  inspect.held = id;
  inspect.hold = id ? how : null;
  inspect.changed();
}

/** A click (or a long press) pins `id`; a second one on the pinned unit lets it go. */
export function pinUnit(id: string) {
  if (inspect.held === id && inspect.hold === "pin") hold("", "pin");
  else hold(id, "pin");
}

/** A tap on a unit opens its readout; a tap elsewhere (`null`) closes a tapped one. */
export function tapUnit(id: string | null) {
  if (id) hold(id, "tap");
  else if (inspect.hold === "tap") hold("", "tap");
}

/**
 * Inspect from the keys or the pad: the next unit in view (`dir` -1: the
 * previous), hostiles first, each left to right. Off while a shot or a throw
 * is being aimed: targeting walks the hostiles itself.
 */
export function cycleInspect(dir: 1 | -1 = 1) {
  const s = session;
  if (s.state !== "ready" || s.mode !== "move") return false;
  const order = inspectOrder(s.game.units, (id) => s.battlefield.screenX(id));
  const current = inspect.hold === "cycle" || inspect.hold === "pin" ? inspect.held : "";
  const next = stepInspect(order, current, dir);
  if (!next) return false;
  // Keys and pad take over from a pointer resting on some other unit.
  inspect.hovered = "";
  hold(next, "cycle");
  return true;
}

/** Whether Back has a readout to close. */
export function inspectHeld(): boolean {
  return living(inspect.held);
}

/** Back: close a held readout; false when there was none. */
export function closeInspect(): boolean {
  if (!inspectHeld()) {
    if (inspect.held) hold("", "pin");
    return false;
  }
  hold("", "pin");
  return true;
}
