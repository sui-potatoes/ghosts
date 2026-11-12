// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Registers `public/sw.js` in builds (never under the dev server, which
 * swaps modules itself — told apart by `import.meta.hot`, not the mode, which
 * follows NODE_ENV). The worker caches assets on demand as the game requests
 * them and refreshes its manifest on its own at every page load, so there is
 * nothing to trigger here and nothing for Save-Data to skip.
 */
export function registerServiceWorker() {
    if (import.meta.hot || !("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
}
