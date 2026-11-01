// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Combat key bindings as data. The engine defines the actions and their
 * defaults; the shell stores the player's bindings and passes them in through
 * `EngineSettings`. Keys are `KeyboardEvent.key` values, single characters
 * lower-cased. Operators are also selected by their squad number (1–9).
 */

export type CombatAction =
  | "move"
  | "fire"
  | "grenade"
  | "reload"
  | "overwatch"
  | "hunker"
  | "secure"
  | "confirm"
  | "cancel"
  | "next-operator"
  | "camera"
  | "grid"
  | "focus"
  | "rotate-left"
  | "rotate-right";

export type CombatBindings = Record<CombatAction, string[]>;

export const COMBAT_ACTIONS: CombatAction[] = [
  "move",
  "fire",
  "grenade",
  "reload",
  "overwatch",
  "hunker",
  "secure",
  "confirm",
  "cancel",
  "next-operator",
  "camera",
  "grid",
  "focus",
  "rotate-left",
  "rotate-right",
];

export const COMBAT_LABELS: Record<CombatAction, string> = {
  move: "Move",
  fire: "Fire weapon",
  grenade: "Grenade",
  reload: "Reload",
  overwatch: "Overwatch",
  hunker: "Hunker",
  secure: "Extract",
  confirm: "Confirm, or end turn",
  cancel: "Cancel targeting, deselect, or pause",
  "next-operator": "Next operator",
  camera: "Close camera",
  grid: "Tactical grid",
  focus: "Focus operator",
  "rotate-left": "Rotate left",
  "rotate-right": "Rotate right",
};

export const DEFAULT_COMBAT_BINDINGS: CombatBindings = {
  move: ["m"],
  fire: ["x"],
  grenade: ["t"],
  reload: ["r"],
  overwatch: ["o"],
  hunker: ["h"],
  secure: ["v"],
  confirm: ["Enter"],
  cancel: ["Escape"],
  "next-operator": ["Tab"],
  camera: ["c"],
  grid: ["g"],
  focus: ["f"],
  "rotate-left": ["q"],
  "rotate-right": ["e"],
};

type KeyLike = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** The combat action `e` maps to under `bindings`, or null. Ctrl, Alt and Meta chords never match; Shift may. */
export function combatActionOf(e: KeyLike, bindings: CombatBindings): CombatAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const action of COMBAT_ACTIONS) if (bindings[action]?.includes(key)) return action;
  return null;
}

/** Bindings with every action present, from stored data of any shape. */
export function sanitizeCombatBindings(raw: unknown): CombatBindings {
  const stored = (raw ?? {}) as Partial<Record<CombatAction, unknown>>;
  const out = {} as CombatBindings;
  for (const action of COMBAT_ACTIONS) {
    const keys = Array.isArray(stored[action])
      ? (stored[action] as unknown[]).filter((k): k is string => typeof k === "string" && k.length > 0)
      : [];
    out[action] = keys.length ? keys : DEFAULT_COMBAT_BINDINGS[action];
  }
  return out;
}

/** True when typing into `target` should win over game bindings. */
export function isEditable(target: unknown): boolean {
  return target instanceof Element && !!target.closest("input, select, textarea, [contenteditable]");
}

// ---------------------------------------------------------------------------
// Pad combat bindings as data, the same contract as the keyboard's above: the
// engine defines the bindable actions and their defaults, the shell stores the
// player's record and passes it in through `EngineSettings.padCombat`. The
// grammar of the pad stays literal in pad-combat.ts and is never in a record:
// A confirms, B cancels, start pauses, the d-pad and left stick drive the
// cursor, the right stick the camera.

export type PadCombatAction =
  | "fire"
  | "grenade"
  | "reload"
  | "wheel"
  | "prev-operator"
  | "next-operator"
  | "grid"
  | "focus";

/** The buttons a pad combat action may take. A/B, start, the d-pad, the
 *  sticks' directions and L3 are fixed and never bindable. */
export type PadBindable = "x" | "y" | "lb" | "rb" | "lt" | "rt" | "select" | "r3";

/** One button per action; `""` is deliberately unbound. */
export type PadCombatBindings = Record<PadCombatAction, PadBindable | "">;

export const PAD_COMBAT_ACTIONS: PadCombatAction[] = [
  "fire",
  "grenade",
  "reload",
  "wheel",
  "prev-operator",
  "next-operator",
  "grid",
  "focus",
];

export const PAD_BINDABLE: PadBindable[] = ["x", "y", "lb", "rb", "lt", "rt", "select", "r3"];

export const PAD_COMBAT_LABELS: Record<PadCombatAction, string> = {
  fire: "Fire mode",
  grenade: "Grenade mode",
  reload: "Reload",
  wheel: "Action wheel",
  "prev-operator": "Prev operator",
  "next-operator": "Next operator",
  grid: "Tactical grid",
  focus: "Camera focus",
};

export const DEFAULT_PAD_COMBAT_BINDINGS: PadCombatBindings = {
  fire: "rt",
  grenade: "lt",
  reload: "x",
  wheel: "y",
  "prev-operator": "lb",
  "next-operator": "rb",
  grid: "select",
  focus: "r3",
};

/**
 * Bindings with every action present and no button bound twice, from stored
 * data of any shape. A missing, unknown or locked button falls back to the
 * action's default; an explicit `""` stays unbound. When two actions claim
 * one button the first (in `PAD_COMBAT_ACTIONS` order) wins and the other
 * falls back to its default, or to unbound when the default is taken too.
 */
export function sanitizePadCombatBindings(raw: unknown): PadCombatBindings {
  const stored = (raw ?? {}) as Partial<Record<PadCombatAction, unknown>>;
  const taken = new Set<string>();
  const out = {} as PadCombatBindings;
  for (const action of PAD_COMBAT_ACTIONS) {
    const v = stored[action];
    let button: PadBindable | "" =
      v === "" || (typeof v === "string" && (PAD_BINDABLE as string[]).includes(v))
        ? (v as PadBindable | "")
        : DEFAULT_PAD_COMBAT_BINDINGS[action];
    if (button && taken.has(button)) {
      const fallback = DEFAULT_PAD_COMBAT_BINDINGS[action];
      button = taken.has(fallback) ? "" : fallback;
    }
    if (button) taken.add(button);
    out[action] = button;
  }
  return out;
}

/** Short display form of a key for key caps. */
export function keyCap(key: string): string {
  switch (key) {
    case "Escape":
      return "ESC";
    case "Enter":
      return "↵";
    case " ":
      return "SPACE";
    case "Tab":
      return "TAB";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}
