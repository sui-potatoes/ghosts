// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Whether this window should make sound: focused and visible. All audio —
 * the title theme and the encounter's effects — gates on it, so a second
 * tab or a backgrounded window stays silent instead of doubling the mix.
 * Only one window holds focus at a time, which is the whole coordination.
 */

const LISTENERS = new Set<() => void>();

let focused = document.hasFocus() && !document.hidden;

function apply() {
    const now = document.hasFocus() && !document.hidden;
    if (now === focused) return;
    focused = now;
    for (const listener of LISTENERS) listener();
}

// Hidden is decisive at once — and timers throttle in hidden tabs, so act
// inside the event. `blur` fires before the next holder takes focus, and a
// deferred re-read tells moving within the page apart from leaving it.
function update() {
    if (document.hidden) apply();
    else setTimeout(apply);
}

window.addEventListener("focus", update);
window.addEventListener("blur", update);
document.addEventListener("visibilitychange", update);

export function audioFocused(): boolean {
    return focused;
}

export function subscribeAudioFocus(listener: () => void): () => void {
    LISTENERS.add(listener);
    return () => void LISTENERS.delete(listener);
}
