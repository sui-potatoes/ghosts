// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Screen-owned Back. A screen built on `<FocusRoot>` answers Back itself (its
 * root back command is the way out, a prompt's back closes the prompt), so it
 * claims Back while mounted and the shell's `EscapeBack` stands aside instead
 * of racing it on the input bus. Dialogs that register with `useBack` later
 * still sit above the screen and close first. Plain TypeScript, tested in
 * `tests/gui-back.test.ts`.
 */

let owners = 0;
const listeners = new Set<() => void>();

function emit() {
    for (const fn of listeners) fn();
}

/** Claim Back for the screen; returns the release (safe to call twice). */
export function claimScreenBack(): () => void {
    owners++;
    emit();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        owners--;
        emit();
    };
}

/** True while a mounted screen owns Back. */
export function screenOwnsBack(): boolean {
    return owners > 0;
}

/** For `useSyncExternalStore`. */
export function subscribeScreenBack(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}
