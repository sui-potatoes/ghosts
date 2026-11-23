// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";

import type { IntroId } from "./intros";
import { accept, dueIntro, readAccepted, type Accepted, type IntroStore } from "./model";

const device: IntroStore | null = (() => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
})();

// Read once; acceptance is held here too, so a device that will not store it
// still accepts for the session.
let accepted: Accepted = readAccepted(device);
const listeners = new Set<() => void>();

export function acceptIntro(id: IntroId) {
    accepted = accept(device, accepted, id).accepted;
    for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

/** The intro due on this screen, or null. Other first-run prompts wait while it is not. */
export function useDueIntro(): IntroId | null {
    const { pathname } = useLocation();
    const current = useSyncExternalStore(
        subscribe,
        () => accepted,
        () => ({}),
    );
    return dueIntro(pathname, current);
}
