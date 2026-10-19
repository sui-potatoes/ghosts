// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Key bindings as data. UI code asks "which action is this key?" and never
 * names a key itself, so rebinding is a change to the stored `Bindings`, not
 * to the components. Keys are `KeyboardEvent.key` values.
 */

export type Action = "back" | "up" | "down" | "left" | "right" | "confirm";

export type Bindings = Record<Action, string[]>;

export const ACTIONS: Action[] = ["back", "up", "down", "left", "right", "confirm"];

export const ACTION_LABELS: Record<Action, string> = {
    back: "Back, or close the open dialog",
    up: "Move up",
    down: "Move down",
    left: "Move left, lower a level",
    right: "Move right, raise a level",
    confirm: "Activate",
};

export const DEFAULT_BINDINGS: Bindings = {
    back: ["Escape"],
    up: ["ArrowUp", "w"],
    down: ["ArrowDown", "s"],
    left: ["ArrowLeft", "a"],
    right: ["ArrowRight", "d"],
    confirm: ["Enter", " "],
};

type KeyLike = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** The action `e` maps to under `bindings`, or null. Modifier chords never match. */
export function actionOf(e: KeyLike, bindings: Bindings): Action | null {
    if (e.altKey || e.ctrlKey || e.metaKey) return null;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    for (const action of ACTIONS) {
        if (bindings[action].includes(key)) return action;
    }
    return null;
}

/** Short display form of a key, for hints and the controls table. */
export function keyLabel(key: string): string {
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
        default:
            return key.length === 1 ? key.toUpperCase() : key.toLowerCase();
    }
}

/** True when typing into `target` should win over game bindings. */
export function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
