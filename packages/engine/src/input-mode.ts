// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Which input the player is actually using, so hints can follow it: key caps
 * for a keyboard or a mouse (a mouse user has a keyboard), pad buttons for a
 * pad, nothing but labelled tap targets for a finger. It starts from the
 * device and then follows the last real input: a key press is `keyboard`, a
 * pad button or stick `gamepad`, a touch `touch`, a mouse move or click
 * `mouse`. The mouse events that follow a touch (compatibility echoes, a
 * tablet's emulated pointer) are ignored for a moment so they do not flip it.
 *
 * The rule lives here and nowhere else: the menus (`@ghosts/engine/input-mode`)
 * and the encounter's HUD both read `inputMode()`, and the same value is on
 * `<html data-input>` for CSS. The tracker is pure (node-testable); DOM work
 * is the bind block at the bottom.
 */

import { padActive, subscribePad } from "./gamepad.ts";
import { isEditable } from "./keys.ts";

export type InputMode = "keyboard" | "gamepad" | "mouse" | "touch";

/** What produced an input event. */
export type InputSource = "key" | "pad" | "touch" | "mouse";

/** How long after a touch a mouse event is taken as its echo. */
export const TOUCH_ECHO_MS = 700;

const SOURCE_MODE: Record<InputSource, InputMode> = {
  key: "keyboard",
  pad: "gamepad",
  touch: "touch",
  mouse: "mouse",
};

/** What the device says before any input: a phone or tablet is touch, a pad in use is a pad. */
export function startMode(device: { touch: boolean; pad?: boolean }): InputMode {
  if (device.pad) return "gamepad";
  return device.touch ? "touch" : "keyboard";
}

/** Pure transitions of the mode; the clock is passed in. */
export class InputTracker {
  mode: InputMode;
  private touchedAt = -Infinity;

  constructor(start: InputMode) {
    this.mode = start;
  }

  /** Note an input; true when it changed the mode. */
  note(source: InputSource, now: number): boolean {
    if (source === "touch") this.touchedAt = now;
    else if (source === "mouse" && now - this.touchedAt < TOUCH_ECHO_MS) return false;
    const next = SOURCE_MODE[source];
    if (next === this.mode) return false;
    this.mode = next;
    return true;
  }
}

// ---------------------------------------------------------------------------
// The live mode.

let tracker = new InputTracker("keyboard");
const listeners = new Set<() => void>();

/** The input in use right now. */
export function inputMode(): InputMode {
  return tracker.mode;
}

/** True while hints show no key or pad glyph, only labelled tap targets. */
export function isTouchMode(): boolean {
  return tracker.mode === "touch";
}

/** Notified whenever the mode changes. Returns the unsubscribe. */
export function subscribeInputMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function publish() {
  if (typeof document !== "undefined") document.documentElement.dataset.input = tracker.mode;
  for (const listener of listeners) listener();
}

/** Report an input from outside the DOM listeners (a test, a synthetic source). */
export function noteInput(source: InputSource, now = performance.now()) {
  if (tracker.note(source, now)) publish();
}

/** Start over from a mode (tests, and the first read of the device). */
export function resetInputMode(mode: InputMode) {
  tracker = new InputTracker(mode);
  publish();
}

/** The device without a pointer that hovers: no mouse can be the input in use. */
function touchOnlyDevice(): boolean {
  return window.matchMedia("(any-hover: none)").matches;
}

function deviceIsTouch(): boolean {
  const media = window.matchMedia("(pointer: coarse) and (hover: none)").matches;
  return media || (touchOnlyDevice() && navigator.maxTouchPoints > 0);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  let last: [number, number] = [NaN, NaN];
  resetInputMode(startMode({ touch: deviceIsTouch(), pad: padActive() }));

  window.addEventListener(
    "keydown",
    (e) => {
      // Typing into a field on a glass keyboard is not a keyboard in use.
      if (isEditable(e.target) || e.key === "Unidentified" || e.key === "Process") return;
      noteInput("key");
    },
    true,
  );
  const pointer = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      noteInput("touch");
      return;
    }
    // A device with no hovering pointer has no mouse: what reports as one is an echo.
    if (touchOnlyDevice()) return;
    // A mouse sweeps (move) or presses; a resting pointer repeating its position is not input.
    if (e.type === "pointermove") {
      const same = last[0] === e.clientX && last[1] === e.clientY;
      last = [e.clientX, e.clientY];
      if (same) return;
    }
    noteInput("mouse");
  };
  window.addEventListener("pointerdown", pointer, true);
  window.addEventListener("pointermove", pointer, true);
  // A pad in use is announced by the pad module; its release by a key or pointer is ours.
  subscribePad(() => {
    if (padActive()) noteInput("pad");
  });
}

// Live mutable state: edits reload the page, like the pad module this reads.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
