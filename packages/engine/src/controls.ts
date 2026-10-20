// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { action, cancelTargeting, endTurn, fire, pick, select, throwGrenade } from "./actions";
import { distance } from "./game";
import { combatActionOf } from "./keys";
import { session } from "./session";
import { engineSettings } from "./settings";
import { toggleGrid, toggleView } from "./ui/view";

export interface ControlOptions {
  /** Cancel with nothing to cancel: the host's pause menu. */
  onPause?: () => void;
}

const ORDERS = new Set(["move", "fire", "grenade", "reload", "overwatch", "hunker", "secure"]);

const typing = (el: Element | null) => !!el?.closest("input, select, textarea, [contenteditable]");

/**
 * Keys and the field: combat bindings from the player's settings, squad
 * numbers 1–9, and picks and hovers on the 3D field. Returns the unbind.
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
        scene.open = false;
        scene.querySelector("summary")?.focus();
      }
      return;
    }
    // A cancel nothing here wants goes to the host's pause menu.
    if (command === "cancel" && s.mode === "move") {
      if (onPause) {
        e.preventDefault();
        onPause();
      }
      return;
    }
    if (s.busy) return;
    if (command === "next-operator" && !typing(target)) {
      e.preventDefault();
      const living = s.game.allies;
      const i = living.findIndex((u) => u.id === s.selected);
      if (living.length) select(living[(i + (e.shiftKey ? -1 : 1) + living.length) % living.length].id);
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
    const { battlefield } = s;
    if (ORDERS.has(command)) {
      e.preventDefault();
      void action(command);
    } else if (command === "confirm") {
      e.preventDefault();
      if (s.mode === "fire") void fire();
      else if (s.mode === "grenade") void throwGrenade();
      else void endTurn();
    } else if (command === "grid") toggleGrid();
    else if (command === "focus") battlefield.focus();
    else if (command === "camera") toggleView();
    else if (command === "rotate-left") battlefield.rotate(-Math.PI / 4);
    else if (command === "rotate-right") battlefield.rotate(Math.PI / 4);
    else if (command === "cancel") {
      e.preventDefault();
      cancelTargeting();
    }
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
    if (s.mode === "move" && u.ap) {
      const path = battlefield.previewPath(p);
      battlefield.setHover(!!path);
      battlefield.showPath(path);
    } else if (s.mode === "grenade" && distance(u.pos, p) <= 5 && !s.grenadeTarget) {
      battlefield.setHover(true);
      battlefield.showPath([u.pos, p], true);
    }
  };
}
