// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Key bindings as data. UI code asks "which action is this key?" and never
 * names a key itself, so rebinding is a change to the stored `Bindings`, not
 * to the components. Keys are `KeyboardEvent.key` values; a named key (longer
 * than one character) may carry a `Shift+` prefix, e.g. `Shift+Tab`.
 */

export type Action =
    "back" | "up" | "down" | "left" | "right" | "confirm" | "prev-tab" | "next-tab" | "reset";

export type Bindings = Record<Action, string[]>;

export const ACTIONS: Action[] = [
    "back",
    "up",
    "down",
    "left",
    "right",
    "confirm",
    "prev-tab",
    "next-tab",
    "reset",
];

export const ACTION_LABELS: Record<Action, string> = {
    back: "Back, or close the open dialog",
    up: "Move up",
    down: "Move down",
    left: "Move left, lower a level",
    right: "Move right, raise a level",
    confirm: "Activate",
    "prev-tab": "Previous settings category",
    "next-tab": "Next settings category",
    reset: "Reset the focused setting",
};

export const DEFAULT_BINDINGS: Bindings = {
    back: ["Escape"],
    up: ["ArrowUp", "w"],
    down: ["ArrowDown", "s"],
    left: ["ArrowLeft", "a"],
    right: ["ArrowRight", "d"],
    confirm: ["Enter", " "],
    "prev-tab": ["Shift+Tab", "q"],
    "next-tab": ["Tab", "e"],
    reset: ["r"],
};

type KeyLike = {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
};

/**
 * The action `e` maps to under `bindings`, or null. Alt/Ctrl/Meta chords
 * never match. Shift distinguishes named keys only (`Shift+Tab` is its own
 * binding); shifted characters still match their lowercase binding.
 */
export function actionOf(e: KeyLike, bindings: Bindings): Action | null {
    if (e.altKey || e.ctrlKey || e.metaKey) return null;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.shiftKey ? `Shift+${e.key}` : e.key;
    for (const action of ACTIONS) {
        if (bindings[action].includes(key)) return action;
    }
    return null;
}

/** Short display form of a key, for hints and the controls table. */
export function keyLabel(key: string): string {
    if (key.startsWith("Shift+")) return `⇧${keyLabel(key.slice("Shift+".length))}`;
    switch (key) {
        case "Escape":
            return "esc";
        case "Enter":
            return "↵";
        case " ":
            return "space";
        case "ArrowUp":
            return "↑";
        case "ArrowDown":
            return "↓";
        case "ArrowLeft":
            return "←";
        case "ArrowRight":
            return "→";
        case "Tab":
            return "tab";
        default:
            return key.length === 1 ? key.toUpperCase() : key.toLowerCase();
    }
}

export { isEditable } from "@ghosts/engine/keys";
