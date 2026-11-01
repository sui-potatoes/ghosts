// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { action, endTurn, pick, select } from "./actions";
import { audio } from "./audio";
import { runCombatAction, type ControlOptions } from "./controls";
import type { Cell } from "./game";
import { cancelDialog, onPad, padActive, type PadDir, type PadInput } from "./gamepad";
import { PAD_COMBAT_ACTIONS, type PadBindable, type PadCombatAction, type PadCombatBindings } from "./keys";
import { session } from "./session";
import { engineSettings } from "./settings";

/**
 * The controller on the field. Buttons map to the same `CombatAction`s the
 * keyboard produces and run through `runCombatAction` — the bindable ones
 * through the player's `padCombat` record (keys.ts), the fixed grammar (A, B,
 * start, the d-pad and the sticks) literally. Only the input shapes
 * that keys do not have live here: the tile cursor, target walking, the
 * radial action wheel, the free camera while nobody is selected, and focus
 * inside the engine's dialogs. Registered
 * above the app's menu bus — while the encounter owns the screen, menus see
 * nothing; paused or behind a host dialog it yields the pad back.
 */

export const WHEEL_ACTIONS = [
  { id: "fire", label: "FIRE" },
  { id: "grenade", label: "GRENADE" },
  { id: "reload", label: "RELOAD" },
  { id: "overwatch", label: "OVERWATCH" },
  { id: "hunker", label: "HUNKER" },
  { id: "secure", label: "EXTRACT" },
  { id: "end-turn", label: "END TURN" },
] as const;

export function closeWheel() {
  session.wheel = false;
  session.changed();
}

/** Run the wheel entry and close the wheel; the pad and the mouse both land here. */
export function confirmWheel(index: number) {
  const choice = WHEEL_ACTIONS[index]?.id;
  closeWheel();
  if (!choice) return;
  if (choice === "end-turn") void endTurn();
  else void action(choice);
}

const DELTAS: Record<PadDir, Cell> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * The direction nav fired this frame, as a SCREEN-space step; the battlefield
 * turns it into the grid step the camera makes it look like (`screenDelta`).
 */
function navDelta(pad: PadInput): Cell | null {
  for (const dir of ["up", "down", "left", "right"] as const) {
    if (pad.nav(dir)) return DELTAS[dir];
  }
  return null;
}

/** Focus and press buttons inside the engine's open dialog (briefing, debrief). */
function dialogInput(pad: PadInput) {
  const dialog = document.querySelector<HTMLDialogElement>(".encounter dialog[open]");
  if (!dialog) return;
  if (pad.pressed("b")) {
    cancelDialog(dialog);
    return;
  }
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (!buttons.length) return;
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const dir = pad.nav("right") || pad.nav("down") ? 1 : pad.nav("left") || pad.nav("up") ? -1 : 0;
  if (dir) buttons[(Math.max(i, 0) + (i < 0 ? 0 : dir) + buttons.length) % buttons.length].focus();
  else if (pad.pressed("a")) (i < 0 ? buttons[0] : buttons[i]).click();
}

function wheelInput(pad: PadInput, close: PadBindable | "") {
  const s = session;
  const n = WHEEL_ACTIONS.length;
  if (pad.pressed("b") || (close && pad.pressed(close))) {
    closeWheel();
    return;
  }
  // The stick points at a sector; the d-pad steps around the ring.
  const ax = pad.axis(0),
    ay = pad.axis(1);
  let next = s.wheelIndex;
  if (Math.hypot(ax, ay) > 0.5) {
    const angle = Math.atan2(ay, ax);
    next = (Math.round(((angle + Math.PI / 2) / (2 * Math.PI)) * n) + n) % n;
  } else if (pad.pressed("right") || pad.pressed("down")) next = (next + 1) % n;
  else if (pad.pressed("left") || pad.pressed("up")) next = (next + n - 1) % n;
  if (next !== s.wheelIndex) {
    s.wheelIndex = next;
    audio.tone("click");
    s.changed();
  }
  if (pad.pressed("a")) confirmWheel(s.wheelIndex);
}

/** Walk the hostile targets while aiming; `select` re-aims like a click would. */
function cycleTarget(dir: 1 | -1) {
  const s = session;
  const list = s.game.enemies;
  if (!list.length) return;
  const i = list.findIndex((e) => e.id === s.target);
  select(list[(i + dir + list.length) % list.length].id);
}

/** Radians per second of right stick, full deflection. */
const TURN_SPEED = 2.4;
/** Dolly rate per second of right stick: up (negative) moves the camera in. */
const ZOOM_SPEED = 1.1;
/** Free camera: pan in view distances per second, tilt in radians per second. */
const PAN_SPEED = 0.75;
const TILT_SPEED = 1.3;
/** How near the focus, in cells, an operator must stand for A to pick them up. */
const PICKUP_RANGE = 3;

/** Orders for an operator; their buttons are the free camera's while nobody is selected. */
const UNIT_ORDERS = new Set<PadCombatAction>(["fire", "grenade", "reload"]);

/** `b` is unbound or bound to an operator's order, so the free camera may take it. */
function cameraMay(binds: PadCombatBindings, b: PadBindable) {
  return !PAD_COMBAT_ACTIONS.some((a) => binds[a] === b && !UNIT_ORDERS.has(a));
}

/** The living operator nearest the camera's focus, within pickup range. */
function operatorAtFocus() {
  const { game, battlefield } = session;
  const at = battlefield.focusCell();
  if (!at) return undefined;
  let best: (typeof game.allies)[number] | undefined;
  let bestDistance = PICKUP_RANGE;
  for (const u of game.allies) {
    const d = Math.hypot(u.pos[0] - at[0], u.pos[1] - at[1]);
    if (d <= bestDistance) [best, bestDistance] = [u, d];
  }
  return best;
}

/**
 * Nobody selected: the camera gets the whole pad's attention. The left
 * stick and the d-pad pan, the triggers zoom (unless bound to something
 * that works without an operator); the right stick's tilt is in the caller.
 */
function freeCamera(pad: PadInput, binds: PadCombatBindings, dt: number) {
  const { battlefield } = session;
  let x = pad.axis(0) + (pad.held("right") ? 1 : 0) - (pad.held("left") ? 1 : 0);
  let y = pad.axis(1) + (pad.held("down") ? 1 : 0) - (pad.held("up") ? 1 : 0);
  const push = Math.hypot(x, y);
  if (push > 1) [x, y] = [x / push, y / push];
  if (push) battlefield.pan(x * PAN_SPEED * dt, -y * PAN_SPEED * dt);
  const zoom =
    (cameraMay(binds, "lt") && pad.held("lt") ? 1 : 0) - (cameraMay(binds, "rt") && pad.held("rt") ? 1 : 0);
  if (zoom) battlefield.dolly(1 + zoom * ZOOM_SPEED * dt);
}

/** Take the pad while the encounter owns the screen. Returns the unbind. */
export function bindPadCombat({ onPause }: ControlOptions = {}): () => void {
  /** The move cursor, and the operator it belongs to. */
  let cursor: Cell | null = null;
  let cursorFor = "";
  /** The previous frame's time, for the camera's frame-sized turn steps. */
  let lastFrame = 0;

  return onPad((pad) => {
    const s = session;
    const now = performance.now();
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
    lastFrame = now;
    if (s.state !== "ready" || s.paused) return false;
    if (s.dialogOpen) {
      dialogInput(pad);
      return true;
    }
    const { game, battlefield } = s;

    // The bindable buttons, from the player's settings; the fixed grammar
    // (A, B, start, the d-pad, the sticks) stays literal below.
    const binds = engineSettings().padCombat();
    const bound = (a: PadCombatAction) => {
      const b = binds[a];
      return !!b && pad.pressed(b);
    };

    // The right stick drives the camera, even mid-animation: sideways
    // orbits, up and down dolly in and out, both smooth and frame-timed.
    // With nobody selected the camera is free: up and down tilt instead,
    // and the left stick, the d-pad and the triggers pan and zoom.
    const free = !s.selected && !s.wheel;
    const rx = pad.axis(2);
    if (rx) battlefield.rotate(rx * TURN_SPEED * dt);
    const ry = pad.axis(3);
    if (ry && free) battlefield.tilt(ry * TILT_SPEED * dt);
    else if (ry) battlefield.dolly(1 + ry * ZOOM_SPEED * dt);
    if (free) freeCamera(pad, binds, dt);

    if (s.busy || s.resolving) {
      if (free) battlefield.markTile(null);
      return true;
    }
    if (s.wheel) {
      wheelInput(pad, binds.wheel);
      return true;
    }

    if (pad.pressed("start")) {
      onPause?.();
      return true;
    }
    if (bound("grid")) {
      runCombatAction("grid");
      return true;
    }
    if (game.result || game.phase !== "player") {
      if (free) battlefield.markTile(null);
      return true;
    }
    if (bound("wheel")) {
      s.wheel = true;
      s.wheelIndex = 0;
      audio.tone("click");
      s.changed();
      return true;
    }
    if (pad.pressed("b")) {
      runCombatAction("cancel", { onPause });
      return true;
    }
    if (bound("prev-operator")) {
      runCombatAction("next-operator", { reverse: true });
      return true;
    }
    if (bound("next-operator")) {
      runCombatAction("next-operator");
      return true;
    }
    if (free) {
      // The next selection starts its cursor afresh, even on the same operator.
      cursor = null;
      cursorFor = "";
      // The operator nearest the focus wears the hover tile; A takes them, the focus button centres on them.
      const near = operatorAtFocus();
      battlefield.markTile(padActive() && near ? near.pos : null);
      if (near && pad.pressed("a")) select(near.id);
      else if (near && bound("focus")) battlefield.focus(near.id);
      return true;
    }
    if (bound("fire")) {
      runCombatAction("fire");
      return true;
    }
    if (bound("grenade")) {
      runCombatAction("grenade");
      return true;
    }
    if (bound("reload")) {
      runCombatAction("reload");
      return true;
    }
    if (bound("focus")) {
      runCombatAction("focus");
      return true;
    }

    const u = s.selectedUnit();
    if (!u) return true;
    if (s.mode === "fire") {
      if (pad.nav("left")) cycleTarget(-1);
      else if (pad.nav("right")) cycleTarget(1);
      else if (pad.pressed("a")) runCombatAction("confirm");
      return true;
    }
    if (s.mode === "grenade") {
      const from = s.grenadeTarget ?? u.pos;
      const d = navDelta(pad);
      if (d) {
        const [dx, dz] = battlefield.screenDelta(d);
        void pick([from[0] + dx, from[1] + dz]);
      } else if (pad.pressed("a")) runCombatAction("confirm");
      return true;
    }
    // Move: the tile cursor walks reachable cells, drawn as the path preview.
    // A confirms the cursor only — ending the turn stays on the wheel.
    if (cursorFor !== s.selected) {
      cursor = null;
      cursorFor = s.selected;
    }
    const d = navDelta(pad);
    if (d && u.ap) {
      // Cover and props are not destinations; the cursor hops them to the
      // next reachable cell in that direction. The path routes on its own.
      const [dx, dz] = battlefield.screenDelta(d);
      let next: Cell = [(cursor ?? u.pos)[0] + dx, (cursor ?? u.pos)[1] + dz];
      let path: Cell[] | undefined;
      while (game.map.inBounds(next) && !(path = battlefield.previewPath(next))) {
        next = [next[0] + dx, next[1] + dz];
      }
      if (path) {
        cursor = next;
        battlefield.hoverAt(next);
        battlefield.setHover(true);
        battlefield.showPath(path);
      }
    } else if (pad.pressed("a") && cursor) {
      const to = cursor;
      cursor = null;
      void pick(to);
    }
    return true;
  }, 10);
}
