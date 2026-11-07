// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { action, cancelTargeting, deselect, endTurn, fire, pick, select, throwGrenade } from "./actions";
import { distance } from "./game";
import { combatActionOf, isEditable as typing, type CombatAction } from "./keys";
import { session } from "./session";
import { engineSettings } from "./settings";
import { toggleGrid, toggleView } from "./ui/view";

export interface ControlOptions {
  /** Cancel with nothing to cancel: the host's pause menu. */
  onPause?: () => void;
  /** Walk operators backwards (Shift+Tab, the left bumper). */
  reverse?: boolean;
}

const ORDERS = new Set(["move", "fire", "grenade", "reload", "pick-up", "overwatch", "hunker", "secure"]);


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
    if (s.selected && !s.busy) deselect();
    else onPause?.();
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
  const { battlefield } = s;
  if (ORDERS.has(command)) void action(command);
  else if (command === "confirm") {
    if (s.mode === "fire") void fire();
    else if (s.mode === "grenade") void throwGrenade();
    else void endTurn();
  } else if (command === "grid") toggleGrid();
  else if (command === "focus") battlefield.focus();
  else if (command === "camera") toggleView();
  else if (command === "rotate-left") battlefield.rotate(-Math.PI / 4);
  else if (command === "rotate-right") battlefield.rotate(Math.PI / 4);
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
  battlefield.onPick = (p, id) => void pick(p, id);
  battlefield.onHover = (p) => {
    const s = session;
    if (s.busy) return;
    const u = s.selectedUnit();
    if (!u) return;
    if (s.mode === "move" && u.ap) {
      const path = battlefield.previewPath(p);
      battlefield.setHover(!!path);
      battlefield.showPath(path);
    } else if (s.mode === "grenade" && distance(u.pos, p) <= 5 && !s.grenadeTarget) {
      battlefield.setHover(true);
      battlefield.showPath([u.pos, p], true);
    }
  };
  // A throw already aimed stays on the field while the pointer goes for its confirm button.
  battlefield.onLeave = () => {
    const s = session;
    const u = s.selectedUnit();
    if (u && s.mode === "grenade" && s.grenadeTarget) battlefield.showPath([u.pos, s.grenadeTarget], true);
  };
}
