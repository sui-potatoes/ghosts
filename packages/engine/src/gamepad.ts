// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Controller input for menus and combat. The Gamepad API has no button
 * events, so a frame loop polls the first pad while one is connected.
 * Edges, hold-repeat on directions and the left stick as a d-pad live in
 * `PadTracker` (pure, node-testable); each frame the handlers get one
 * `PadInput` in priority order until one consumes it. DOM work stays in
 * the bind block at the bottom, so menu screens import this without the
 * 3D engine (`@ghosts/engine/gamepad`).
 */

import { isEditable } from "./keys.ts";

export type PadButton =
  | "a"
  | "b"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "select"
  | "start"
  | "l3"
  | "r3"
  | "up"
  | "down"
  | "left"
  | "right";

export type PadDir = "up" | "down" | "left" | "right";
export type PadKind = "xbox" | "ps";

/** One frame of raw pad state, as the standard mapping lays it out. */
export interface PadSnapshot {
  buttons: readonly boolean[];
  axes: readonly number[];
}

/** One frame of interpreted input, handed to `onPad` handlers. */
export interface PadInput {
  /** The button is down this frame. */
  held(b: PadButton): boolean;
  /** The button went down this frame. */
  pressed(b: PadButton): boolean;
  /** D-pad or left stick: fires on the edge, then key-repeats while held. */
  nav(d: PadDir): boolean;
  /** Stick axis 0–3, zero inside the dead zone. */
  axis(i: number): number;
}

/** Standard-mapping button indices. */
const INDEX: Record<PadButton, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  select: 8,
  start: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};

const BUTTONS = Object.keys(INDEX) as PadButton[];

const DIRS: Record<PadDir, { axis: 0 | 1; sign: 1 | -1 }> = {
  up: { axis: 1, sign: -1 },
  down: { axis: 1, sign: 1 },
  left: { axis: 0, sign: -1 },
  right: { axis: 0, sign: 1 },
};

const NAV_DELAY = 380;
const NAV_REPEAT = 130;
const STICK_NAV = 0.55;
const DEADZONE = 0.25;

/** The buttons down in a raw snapshot (the settings diagram's highlight). */
export function heldPadButtons(snap: PadSnapshot): PadButton[] {
  return BUTTONS.filter((b) => snap.buttons[INDEX[b]]);
}

/** Edges and repeat across frames; `read` once per frame with its timestamp. */
export class PadTracker {
  private prev = new Set<PadButton>();
  /** Per held direction, when the repeat fires next. */
  private repeat = new Map<PadDir, number>();

  read(snap: PadSnapshot, now: number): PadInput {
    const down = new Set<PadButton>();
    for (const b of BUTTONS) if (snap.buttons[INDEX[b]]) down.add(b);
    const prev = this.prev;
    this.prev = down;
    const repeat = this.repeat;
    const dirHeld = (d: PadDir) =>
      down.has(d) || (snap.axes[DIRS[d].axis] ?? 0) * DIRS[d].sign > STICK_NAV;
    return {
      held: (b) => down.has(b),
      pressed: (b) => down.has(b) && !prev.has(b),
      nav: (d) => {
        if (!dirHeld(d)) {
          repeat.delete(d);
          return false;
        }
        const at = repeat.get(d);
        if (at === undefined) {
          repeat.set(d, now + NAV_DELAY);
          return true;
        }
        if (now < at) return false;
        repeat.set(d, now + NAV_REPEAT);
        return true;
      },
      axis: (i) => {
        const v = snap.axes[i] ?? 0;
        return Math.abs(v) < DEADZONE ? 0 : v;
      },
    };
  }
}

/** Button face per pad family, for hints and the settings diagram. */
const GLYPHS: Record<PadKind, Partial<Record<PadButton, string>>> = {
  xbox: { a: "A", b: "B", x: "X", y: "Y", select: "VIEW", start: "MENU" },
  ps: {
    a: "✕",
    b: "◯",
    x: "▢",
    y: "△",
    lb: "L1",
    rb: "R1",
    lt: "L2",
    rt: "R2",
    select: "SHARE",
    start: "OPTIONS",
  },
};

/** Display face of a button on the connected pad family. */
export function padGlyph(b: PadButton | "dpad" | "ls" | "rs"): string {
  if (b === "dpad") return "✛";
  if (b === "ls") return "LS";
  if (b === "rs") return "RS";
  return GLYPHS[kind][b] ?? b.toUpperCase();
}

// ---------------------------------------------------------------------------
// The live pad: connection state, the frame loop and the handler chain.

/** True consumes the frame; the handlers after this one do not see it. */
export type PadHandler = (pad: PadInput) => boolean | void;

const handlers: { fn: PadHandler; priority: number }[] = [];
const observers = new Set<(snap: PadSnapshot) => void>();
const listeners = new Set<() => void>();
const tracker = new PadTracker();
let connected = false;
let active = false;
let kind: PadKind = "xbox";
let name = "";
let raf = 0;

function setActive(on: boolean) {
  if (on === active) return;
  active = on;
  for (const listener of listeners) listener();
}

/** Handle pad frames; higher `priority` sees the frame first. Returns the unbind. */
export function onPad(fn: PadHandler, priority = 0): () => void {
  const entry = { fn, priority };
  handlers.push(entry);
  handlers.sort((a, b) => b.priority - a.priority);
  return () => {
    const i = handlers.indexOf(entry);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Watch raw frames without consuming them (the settings diagram). Returns the unbind. */
export function observePad(fn: (snap: PadSnapshot) => void): () => void {
  observers.add(fn);
  return () => void observers.delete(fn);
}

export function padConnected(): boolean {
  return connected;
}

export function padKind(): PadKind {
  return kind;
}

/**
 * The pad is the input device in use: it was touched since the last trusted
 * mouse or key input. UI that must pick one mode (the HUD's pointer buttons
 * against pad hints) follows this, the way console ports swap prompts.
 */
export function padActive(): boolean {
  return connected && active;
}

/** The connected pad as the system names it, or "". */
export function padName(): string {
  return connected ? name : "";
}

/** Notified on connect, disconnect and pad-family change. Returns the unsubscribe. */
export function subscribePad(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function firstPad(): Gamepad | null {
  const pads = navigator.getGamepads();
  for (const pad of pads) if (pad && pad.mapping === "standard") return pad;
  for (const pad of pads) if (pad) return pad;
  return null;
}

function setConnected(on: boolean, id = "") {
  const next: PadKind = /playstation|dual.?sho|dual.?sense|sony|054c/i.test(id) ? "ps" : kind;
  if (on === connected && next === kind) return;
  connected = on;
  if (on) {
    kind = next;
    name = id.replace(/\s*\(.*\)$/, "");
  }
  for (const listener of listeners) listener();
  if (on && !raf) raf = requestAnimationFrame(frame);
  if (!on && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function frame(now: number) {
  raf = 0;
  const pad = firstPad();
  if (!pad) {
    setConnected(false);
    return;
  }
  const snap: PadSnapshot = { buttons: pad.buttons.map((b) => b.pressed), axes: pad.axes };
  if (snap.buttons.some(Boolean) || snap.axes.some((v) => Math.abs(v) > 0.3)) setActive(true);
  for (const fn of observers) fn(snap);
  const input = tracker.read(snap, now);
  for (const { fn } of [...handlers]) if (fn(input) === true) break;
  raf = requestAnimationFrame(frame);
}

/**
 * Close `dialog` the way a trusted Escape would: fire a cancelable `cancel`
 * first, so the dialog's owner sees the close (React's `onCancel`, pending
 * state), and close only when nothing prevented it. `close()` alone fires no
 * `cancel`, which is how a pad's B button used to strand dialog state.
 */
export function cancelDialog(dialog: HTMLDialogElement) {
  if (dialog.dispatchEvent(new Event("cancel", { cancelable: true })) && dialog.open) dialog.close();
}

if (typeof window !== "undefined") {
  window.addEventListener("gamepadconnected", (e) => setConnected(true, e.gamepad.id));
  window.addEventListener("gamepaddisconnected", () => {
    if (!firstPad()) setConnected(false);
  });
  // Real mouse or key input hands the UI back to the pointer mode — except
  // typing into a field: a pad user enters text on the keyboard without
  // surrendering the pad, so the glyph hints hold through it.
  const byHand = (e: Event) => {
    if (!e.isTrusted) return;
    if (e.type === "keydown" && isEditable(e.target)) return;
    setActive(false);
  };
  window.addEventListener("pointerdown", byHand, true);
  window.addEventListener("keydown", byHand, true);
}

// This module is live mutable state: a hot re-execution would hand the UI a
// fresh instance while the running encounter still drives the old one (dead
// input, unselectable units). Edits here reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
