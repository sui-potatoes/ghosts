// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react";

import { onAction } from "../input";

/**
 * The "back" action as a stack: consumers subscribe to the input bus LIFO,
 * so the most recently opened dialog closes before the screen behind it
 * goes back. Typing guards and native `<dialog>` Escape handling live in
 * the input adapters, not here.
 */

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
        return onAction((action) => {
            if (action !== "back") return false;
            ref.current?.();
            return true;
        });
    }, [active]);
}
