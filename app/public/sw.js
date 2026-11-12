// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/*
 * On-demand asset cache for Ghosts. The build writes `/asset-manifest.json`:
 * every shipped file with a short content hash. Nothing is downloaded ahead of
 * time: the first time the game asks for a listed file (models, motions,
 * textures, audio) it comes from the network and is kept here, stamped with the
 * hash it was fetched under; later requests are answered from the cache.
 *
 * An entry is only ever served while its stamp equals the manifest's current
 * hash for that path. The manifest is refreshed on startup and on every
 * navigation; entries whose hash changed or whose file is gone are deleted (not
 * re-downloaded), and a file with no valid entry is fetched past the HTTP cache,
 * so a thirty-day-cached old copy is never stored under a new hash.
 *
 * Paths are the keys, as in the manifest: a version query (`?v=N`) is ignored.
 * Hashed `/assets/*` bundles are left to the HTTP cache (their names change
 * with their content and they are cached for a year). Documents, the chain,
 * other origins and Range requests (audio, video) go to the network untouched.
 */

/** Bumped when the entry format changes; every other `ghosts-assets*` cache is deleted. */
const CACHE = "ghosts-assets-v2";
/** The hash an entry was fetched under, kept as a header on the cached response. */
const HASH = "x-ghosts-hash";
/** The newest manifest seen, kept so a restarted worker knows it at once. */
const LATEST = "/__ghosts/manifest";
const INTERNAL = "/__ghosts/";

/** Does a cached entry hold the file the manifest lists now? */
function isCurrent(stored, path, files) {
    return stored != null && files[path] === stored;
}

/** Cached `[path, hash]` pairs to delete: changed hash, unknown file or no stamp. */
function staleEntries(entries, files) {
    return entries.filter(([path, hash]) => !isCurrent(hash, path, files)).map(([path]) => path);
}

/** Does the worker handle this path at all? */
function isManaged(path, files) {
    return path in files && !path.startsWith("/assets/") && !path.startsWith(INTERNAL);
}

/** A real file: a missing one comes back as the app's index page (SPA fallback). */
const isAsset = (response) =>
    response.status === 200 && !(response.headers.get("content-type") ?? "").includes("text/html");

let files = {};
let refreshing = null;

async function prune(cache) {
    const entries = [];
    for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if (path.startsWith(INTERNAL)) continue;
        const hit = await cache.match(request);
        entries.push([path, hit?.headers.get(HASH) ?? null]);
    }
    for (const path of staleEntries(entries, files)) await cache.delete(path);
}

async function refresh() {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch("/asset-manifest.json", { cache: "no-cache" });
        const next = response.ok ? (await response.json()).files : null;
        if (!next || typeof next !== "object") throw new Error("no manifest");
        files = next;
        await cache.put(LATEST, Response.json(files));
    } catch {
        // offline: keep the last manifest we know
        if (!Object.keys(files).length)
            files = (await (await cache.match(LATEST))?.json().catch(() => null)) ?? {};
        return;
    }
    await prune(cache);
}

/** Starts a refresh unless one is running; requests wait on it so none sees an old manifest. */
function refreshSoon() {
    refreshing ??= refresh()
        .catch(() => {})
        .finally(() => (refreshing = null));
    return refreshing;
}

async function store(cache, path, hash, response) {
    if (!isAsset(response)) return;
    const headers = new Headers(response.headers);
    headers.set(HASH, hash);
    await cache.put(
        path,
        new Response(response.body, { status: 200, statusText: response.statusText, headers }),
    );
}

const started = refreshSoon();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
    event.waitUntil(
        (async () => {
            for (const name of await caches.keys())
                if (name.startsWith("ghosts-assets") && name !== CACHE) await caches.delete(name);
            await started;
            await self.clients.claim();
        })(),
    ),
);

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (request.mode === "navigate") {
        // A page load is when a deploy shows up: learn the new manifest now.
        event.waitUntil(refreshSoon());
        return;
    }
    if (request.headers.has("range")) return;
    const path = url.pathname;
    event.respondWith(
        (async () => {
            await (refreshing ?? started);
            if (!isManaged(path, files)) return fetch(request);
            const want = files[path];
            const cache = await caches.open(CACHE);
            const hit = await cache.match(path);
            if (hit && isCurrent(hit.headers.get(HASH), path, files)) return hit;
            // Bypass the HTTP cache: an unversioned file may be an old copy.
            const response = await fetch(request, { cache: "no-cache" });
            event.waitUntil(store(cache, path, want, response.clone()).catch(() => {}));
            return response;
        })(),
    );
});
