// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/*
 * Asset cache for Ghosts. The build writes `/asset-manifest.json`: every
 * shipped file (bundles, models, motions, textures, audio) with a short
 * content hash. On each visit the page asks this worker to sync: it reads the
 * manifest, downloads what is new or changed in the background (a few at a
 * time) and drops what a deploy removed. Requests for listed files are then
 * answered from the cache — across reloads and browser restarts — and a
 * changed file catches up by the next load. Anything not in the manifest
 * (documents, the chain, other origins) goes to the network untouched.
 */

const CACHE = "ghosts-assets";
/** What the cache holds, by path: the hash each entry was stored under. */
const STATE = "/__ghosts/state";
/** The newest manifest seen, kept so a restarted worker knows it at once. */
const LATEST = "/__ghosts/manifest";
const PARALLEL = 4;

let manifest = {};
let state = {};
const loaded = (async () => {
    const cache = await caches.open(CACHE);
    manifest = (await (await cache.match(LATEST))?.json()) ?? {};
    state = (await (await cache.match(STATE))?.json()) ?? {};
})().catch(() => {});

let saveTimer = 0;
function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), 1000);
}
async function save() {
    const cache = await caches.open(CACHE);
    await cache.put(STATE, Response.json(state));
}

/** A real file: a missing one comes back as the app's index page (SPA fallback). */
const isAsset = (response) =>
    response.status === 200 && !(response.headers.get("content-type") ?? "").includes("text/html");

async function store(cache, path, hash, response) {
    if (!isAsset(response)) return;
    await cache.put(path, response);
    state[path] = hash;
    saveSoon();
}

async function sync() {
    await loaded;
    const response = await fetch("/asset-manifest.json", { cache: "no-cache" });
    if (!response.ok) return;
    const { files } = await response.json();
    manifest = files;
    const cache = await caches.open(CACHE);
    await cache.put(LATEST, Response.json(files));
    // Files a deploy removed or replaced under a new name.
    for (const path of Object.keys(state))
        if (!(path in files)) {
            await cache.delete(path);
            delete state[path];
        }
    const todo = Object.entries(files).filter(([path, hash]) => state[path] !== hash);
    let next = 0;
    async function lane() {
        while (next < todo.length) {
            const [path, hash] = todo[next++];
            try {
                // Bypass the HTTP cache: an unversioned file may have changed.
                await store(cache, path, hash, await fetch(path, { cache: "no-cache" }));
            } catch {
                // offline or interrupted: the next visit picks it up
            }
        }
    }
    await Promise.all(Array.from({ length: PARALLEL }, lane));
    await save();
}

let syncing = null;
self.addEventListener("message", (event) => {
    if (event.data !== "sync") return;
    syncing ??= sync().finally(() => (syncing = null));
    event.waitUntil(syncing);
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET" || request.headers.has("range")) return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || request.mode === "navigate") return;
    const path = url.pathname;
    event.respondWith(
        (async () => {
            await loaded;
            const want = manifest[path];
            if (!want) return fetch(request);
            const cache = await caches.open(CACHE);
            // Version queries (`?v=N`) change with the file, and so does its hash.
            if (state[path] === want) {
                const hit = await cache.match(path);
                if (hit) return hit;
            }
            const response = await fetch(request);
            event.waitUntil(store(cache, path, want, response.clone()).catch(() => {}));
            return response;
        })(),
    );
});
