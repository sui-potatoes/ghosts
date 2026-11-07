// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Whether anything is being saved right now: sends, the waits after them and
 * the refreshes that follow. The shell's `<SaveIndicator />` reads this and
 * shows a corner spinner, the way a game shows it is saving progress.
 */

import { useSyncExternalStore } from "react";

let inFlight = 0;
const listeners = new Set<() => void>();

function bump(by: number) {
    inFlight += by;
    for (const listener of listeners) listener();
}

/** Count `work` as saving until it settles; resolves or rejects with it. */
export function trackSaving<T>(work: Promise<T>): Promise<T> {
    bump(1);
    return work.finally(() => bump(-1));
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** True while any tracked work is in flight. */
export function useSaving(): boolean {
    return useSyncExternalStore(subscribe, () => inFlight > 0);
}
