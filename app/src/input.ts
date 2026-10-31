// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * One input system for every menu: the keyboard and the controller are thin
 * adapters that map to the same `Action`s (settings/keys.ts) and dispatch
 * them on one bus. Consumers subscribe LIFO — the newest (the topmost UI)
 * sees an action first and returns true to consume it — so what an action
 * does never depends on what produced it. Combat input is the engine's own
 * binding: while the encounter owns the screen its pad handler sits above
 * this one, and its keyboard handler ignores menus.
 */

import { cancelDialog, onPad, type PadButton, type PadInput } from "@ghosts/engine/gamepad";
import { isEditable, type Action } from "./settings/keys";
import { currentAction } from "./settings/store";

/** True consumes the action; the consumers below it do not see it. */
export type ActionHandler = (action: Action) => boolean | void;

const handlers: ActionHandler[] = [];

/**
 * Screen shortcuts, the second lane on the same bus: raw chords for keys that
 * are tools rather than menu actions (the editor's R/E/S/P, ⌘Z). A chord is
 * `Mod+Shift+key` — `Mod` is ⌘ or Ctrl, single characters lower-cased, and
 * `Shift` named only on chords and named keys, so a shifted letter stays
 * itself. Maps stack LIFO like action handlers; typing in a field skips them.
 * A handler consumes its chord unless it returns false.
 */
export type Shortcuts = Record<string, (e: KeyboardEvent) => boolean | void>;

const keymaps: Shortcuts[] = [];

/** Register screen shortcuts; the latest map wins conflicts. Returns the unbind. */
export function onKeys(map: Shortcuts): () => void {
    keymaps.push(map);
    return () => {
        const i = keymaps.lastIndexOf(map);
        if (i >= 0) keymaps.splice(i, 1);
    };
}

function chordOf(e: KeyboardEvent): string {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const shift = e.shiftKey && (mod || e.key.length > 1);
    return `${mod ? "Mod+" : ""}${shift ? "Shift+" : ""}${key}`;
}

/** Walk the shortcut maps top-down; true when one of them took the key. */
function dispatchKeys(e: KeyboardEvent): boolean {
    const chord = chordOf(e);
    for (let i = keymaps.length - 1; i >= 0; i--) {
        const run = keymaps[i][chord];
        if (run && run(e) !== false) return true;
    }
    return false;
}

/** Subscribe to menu actions; the latest subscriber is asked first. Returns the unbind. */
export function onAction(handler: ActionHandler): () => void {
    handlers.push(handler);
    return () => {
        const i = handlers.lastIndexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
    };
}

/** Walk the consumers top-down; true when one of them took the action. */
export function dispatchAction(action: Action): boolean {
    for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i](action) === true) return true;
    }
    return false;
}

function onKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    // Shortcuts sit above the menu actions; typing in a field skips them.
    if (!isEditable(e.target) && dispatchKeys(e)) {
        e.preventDefault();
        return;
    }
    const action = currentAction(e);
    if (!action) return;
    if (action === "back") {
        // Typing swallows a printable back key; a native dialog closes itself.
        if (e.key !== "Escape" && isEditable(e.target)) return;
        if (document.querySelector("dialog[open]")) return;
    } else if (isEditable(e.target)) {
        return;
    }
    if (dispatchAction(action)) e.preventDefault();
}

/** What each pad button means in a menu. Directions go through `nav`. */
const PAD_MENU: [PadButton, Action][] = [
    ["a", "confirm"],
    ["b", "back"],
    ["start", "back"],
    ["lb", "prev-tab"],
    ["rb", "next-tab"],
    ["x", "reset"],
];

const NAV = ["up", "down", "left", "right"] as const;

/**
 * The pad in menus, below the engine's combat handler. A confirm nobody
 * consumed falls back to pressing the focused control, which is what a
 * trusted Enter would have done natively.
 */
function onMenuPad(pad: PadInput): boolean {
    for (const dir of NAV) {
        if (!pad.nav(dir)) continue;
        dispatchAction(dir);
        return true;
    }
    for (const [button, action] of PAD_MENU) {
        if (!pad.pressed(button)) continue;
        if (action === "back") {
            const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
            if (dialog) {
                // Like Escape: cancel first, so the dialog's owner sees it.
                cancelDialog(dialog);
                return true;
            }
        }
        if (!dispatchAction(action) && action === "confirm") {
            const el = document.activeElement;
            if (el instanceof HTMLElement && el.matches("button:not(:disabled), a, summary"))
                el.click();
        }
        return true;
    }
    return false;
}

/** Bind the keyboard and the controller to the bus, once. Returns the unbind. */
export function bindInput(): () => void {
    window.addEventListener("keydown", onKeyDown);
    const unbindPad = onPad(onMenuPad, 0);
    return () => {
        window.removeEventListener("keydown", onKeyDown);
        unbindPad();
    };
}
