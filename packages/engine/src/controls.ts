// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { action, cancelTargeting, deselect, endTurn, fire, pick, select, throwGrenade } from "./actions";
import { GRENADE_RANGE, hasKind, isThrowOrder, specOf, THROW_ORDERS, type ThrowOrder } from "./action-registry";
import { allows, distance } from "./game";
import { isCameraCommand } from "./camera-input";
import { combatActionOf, isEditable as typing, type CombatAction } from "./keys";
import { session } from "./session";
import { engineSettings } from "./settings";
import { toggleGrid, toggleView } from "./ui/view";
import { closeInspect, cycleInspect, hoverUnit, pinUnit, tapUnit } from "./ui/intel/store";

export interface ControlOptions {
  /** Cancel with nothing to cancel: the host's pause menu. */
  onPause?: () => void;
  /** Walk operators backwards (Shift+Tab, the left bumper). */
  reverse?: boolean;
}

const ORDERS = new Set([
  "move",
  "fire",
  "grenade",
  "flashbang",
  "smoke-grenade",
  "reload",
  "overwatch",
  "hunker",
  "secure",
]);


/**
 * The grenade the selected operator carries: one utility slot, so the frag's
 * binding (key and pad button) arms whichever of the three it has. The
 * flashbang and smoke grenade keep their own keys as well.
 */
export function carriedThrow(): ThrowOrder | undefined {
  const u = session.selectedUnit();
  return u ? THROW_ORDERS.find((order) => hasKind(u, specOf(order).id)) : undefined;
}

/**
 * One executor for every combat action. The keyboard, the controller and the
 * HUD map their inputs to a `CombatAction` and land here, so what an action
 * does never depends on what produced it.
 */
export function runCombatAction(command: CombatAction, { onPause, reverse }: ControlOptions = {}) {
  const s = session;
  // Cancel steps back: out of targeting, then off the selected operator, and
  // what nothing here wants (or anything mid-animation) to the host's pause menu.
  if (command === "cancel" && s.mode === "move") {
    // A held unit readout closes before anything else lets go.
    if (closeInspect()) return;
    if (s.selected && !s.busy) deselect();
    else onPause?.();
    return;
  }
  // Reading the field never waits: the opponent's turn is when it is wanted most.
  if (command === "inspect") {
    cycleInspect(reverse ? -1 : 1);
    return;
  }
  // The camera is never locked: it is the player's own view, and the other side's turn is when it is wanted.
  if (isCameraCommand(command)) {
    const { battlefield } = s;
    if (command === "focus") {
      if (s.selected) battlefield.focus();
    } else if (command === "camera") toggleView();
    else battlefield.rotate((command === "rotate-left" ? -1 : 1) * (Math.PI / 4));
    return;
  }
  if (s.busy) return;
  if (command === "next-operator") {
    const living = s.game.allies;
    const n = living.length;
    const i = living.findIndex((u) => u.id === s.selected);
    // From no selection, forward starts at the first operator and back at the last.
    if (n) select(living[i < 0 ? (reverse ? n - 1 : 0) : (i + (reverse ? -1 : 1) + n) % n].id);
    return;
  }
  if (command === "grenade") void action(carriedThrow() ?? "grenade");
  else if (ORDERS.has(command)) void action(command);
  else if (command === "confirm") {
    if (s.mode === "fire") void fire();
    else if (isThrowOrder(s.mode)) void throwGrenade();
    else void endTurn();
  } else if (command === "grid") toggleGrid();
  else if (command === "cancel") cancelTargeting();
}

/**
 * Keys and the field: combat bindings from the player's settings, squad
 * numbers 1–9, and picks and hovers on the 3D field. The keyboard only maps
 * and guards here; execution is `runCombatAction`. Returns the unbind.
 */
export function bindControls({ onPause }: ControlOptions = {}): () => void {
  const onKey = (e: KeyboardEvent) => {
    const s = session;
    if (s.state !== "ready" || s.paused || s.dialogOpen) return;
    const target = e.target instanceof Element ? e.target : null;
    const scene = target?.closest<HTMLDetailsElement>("#scene-controls");
    const command = combatActionOf(e, engineSettings().combatKeys());
    if (scene) {
      if (command === "cancel") {
        // Consumed here, or the menu bus beneath would also act on the Escape.
        e.preventDefault();
        scene.open = false;
        scene.querySelector("summary")?.focus();
      }
      return;
    }
    if (command === "cancel" && s.mode === "move") {
      if (closeInspect()) {
        e.preventDefault();
        return;
      }
      if (s.selected && !s.busy) {
        e.preventDefault();
        deselect();
        return;
      }
      if (!onPause) return;
      e.preventDefault();
      onPause();
      return;
    }
    if (command === "inspect" && !typing(target)) {
      e.preventDefault();
      runCombatAction("inspect", { reverse: e.shiftKey });
      return;
    }
    if (isCameraCommand(command)) {
      if (s.busy) e.preventDefault();
      runCombatAction(command);
      return;
    }
    if (s.busy) {
      // A combat key mid-animation is spent, not passed to the menus beneath.
      if (command) e.preventDefault();
      return;
    }
    if (command === "next-operator" && !typing(target)) {
      e.preventDefault();
      runCombatAction("next-operator", { reverse: e.shiftKey });
      return;
    }
    // Enter and Space on a focused control press that control.
    if (target?.closest("button, input, select, textarea") && (e.key === "Enter" || e.key === " ")) return;
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const squad = s.game.units.filter((u) => !u.enemy);
      if (squad[+e.key - 1]) select(squad[+e.key - 1].id);
      return;
    }
    if (!command) return;
    if (ORDERS.has(command) || command === "confirm" || command === "cancel") e.preventDefault();
    runCombatAction(command, { onPause });
  };
  document.addEventListener("keydown", onKey);
  bindField();
  return () => document.removeEventListener("keydown", onKey);
}

/** Picks and hovers on the 3D field. */
function bindField() {
  const { battlefield } = session;
  battlefield.onPick = (p, id) => {
    void pick(p, id);
    // The unit readout: a tap opens it (a tap elsewhere closes it), a click on a hostile pins it.
    if (battlefield.lastPointer === "touch") tapUnit(id ?? null);
    else if (id && session.game.unit(id)?.enemy) pinUnit(id);
  };
  battlefield.onMiss = () => {
    if (battlefield.lastPointer === "touch") tapUnit(null);
  };
  battlefield.onUnitHover = hoverUnit;
  battlefield.onUnitHold = pinUnit;
  battlefield.onHover = (p) => {
    const s = session;
    if (s.busy) return;
    const u = s.selectedUnit();
    if (!u) return;
    if (s.mode === "move" && u.ap && allows(u, "move")) {
      const path = battlefield.previewPath(p);
      battlefield.setHover(!!path);
      battlefield.showPath(path);
    } else if (isThrowOrder(s.mode) && distance(u.pos, p) <= GRENADE_RANGE && !s.grenadeTarget) {
      battlefield.setHover(true);
      battlefield.showPath([u.pos, p], true);
    }
  };
  // A throw already aimed stays on the field while the pointer goes for its confirm button.
  battlefield.onLeave = () => {
    const s = session;
    const u = s.selectedUnit();
    if (u && isThrowOrder(s.mode) && s.grenadeTarget) battlefield.showPath([u.pos, s.grenadeTarget], true);
  };
}
