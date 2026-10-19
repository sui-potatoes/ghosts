// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Lets any screen open the shell's sign-in dialog without prop drilling:
 * `requestSignIn()` dispatches an event that `App` listens for.
 */
const EVENT = "ghosts:sign-in";

export function requestSignIn() {
    window.dispatchEvent(new Event(EVENT));
}

export function onSignInRequest(handler: () => void): () => void {
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
}
