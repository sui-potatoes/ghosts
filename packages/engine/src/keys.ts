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
  cancel: "Cancel targeting, or pause",
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
