// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** How long after load the background download waits, so the menu scene loads first. */
const SYNC_DELAY_MS = 4000;

/**
 * Registers `public/sw.js` in builds (never under the dev server, which
 * swaps modules itself — told apart by `import.meta.hot`, not the mode, which
 * follows NODE_ENV) and, once the page has settled, asks it to bring its asset
 * cache up to date. Skipped when the browser asks to save data.
 */
export function registerServiceWorker() {
    if (import.meta.hot || !("serviceWorker" in navigator)) return;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js")
            .then(() => navigator.serviceWorker.ready)
            .then((registration) => {
                if (saveData) return;
                window.setTimeout(() => {
                    const ask = () => registration.active?.postMessage("sync");
                    if (typeof window.requestIdleCallback === "function")
                        window.requestIdleCallback(ask, { timeout: 5000 });
                    else ask();
                }, SYNC_DELAY_MS);
            })
            .catch(() => {});
    });
}
