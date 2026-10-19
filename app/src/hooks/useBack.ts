// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react";

import { isEditable } from "../settings/keys";
import { currentAction } from "../settings/store";

/**
 * The "back" action (Escape by default) as a stack: the most recently
 * activated handler is the only one that runs, so an open dialog closes
 * before the screen behind it goes back. Native `<dialog>` elements keep
 * their own Escape behavior, and a back key that is a printable character
 * never fires while typing in a field.
 */

const stack: Array<() => void> = [];
let bound = false;

function onKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented || currentAction(e) !== "back") return;
    if (e.key !== "Escape" && isEditable(e.target)) return;
    // A native <dialog> closes itself on Escape via its cancel event.
    if (document.querySelector("dialog[open]")) return;
    const top = stack[stack.length - 1];
    if (!top) return;
    e.preventDefault();
    top();
}

function bind() {
    if (bound) return;
    bound = true;
    window.addEventListener("keydown", onKeyDown);
}

/**
 * Run `handler` on the back action while it is non-null. The entry is
 * registered once per activation, so re-renders do not reorder the stack; the
 * latest handler is always the one called.
 */
export function useBack(handler: (() => void) | null | undefined) {
    const ref = useRef(handler);
    ref.current = handler;
    const active = !!handler;

    useEffect(() => {
        if (!active) return;
        bind();
        const entry = () => ref.current?.();
        stack.push(entry);
        return () => {
            const i = stack.lastIndexOf(entry);
            if (i >= 0) stack.splice(i, 1);
        };
    }, [active]);
}
