// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Rendered images kept in the browser between visits: recruit portraits and
 * gear thumbnails, so Headquarters does not build a character per card or
 * render the whole catalog on every visit. Keys carry the content hashes of
 * the model files the images were drawn from (the build's
 * `asset-manifest.json`): a deploy that changes a body, a hair style or a gun
 * redraws exactly those images. Without a manifest (the dev server) nothing
 * persists and every visit renders afresh.
 */

const CACHE = "ghosts-images";
/** Bump when the captures themselves change (framing, size, lighting). */
const RENDER_VERSION = 1;
/** Portraits kept; looks edited away from age out first. */
const MAX_PORTRAITS = 96;

type Files = Record<string, string>;

/** FNV-1a over the manifest entries under `prefixes`: changes when any of those files does. */
function digest(files: Files, prefixes: string[]): string {
    let h = 0x811c9dc5;
    for (const path of Object.keys(files).sort()) {
        if (!prefixes.some((p) => path.startsWith(p))) continue;
        for (const ch of `${path}:${files[path]};`) {
            h ^= ch.charCodeAt(0);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
    }
    return h.toString(16);
}

let fingerprints: Promise<{ portraits: string; gear: string } | null> | null = null;
function fingerprint() {
    fingerprints ??= (async () => {
        if (typeof caches === "undefined") return null;
        const response = await fetch("/asset-manifest.json");
        // The dev server answers unknown paths with the app's index page.
        if (!response.ok || !response.headers.get("content-type")?.includes("json")) return null;
        const { files } = (await response.json()) as { files: Files };
        return {
            portraits: `${RENDER_VERSION}-${digest(files, ["/squad/body/", "/squad/editor/"])}`,
            gear: `${RENDER_VERSION}-${digest(files, ["/squad/weapons/", "/squad/armor/"])}`,
        };
    })().catch(() => null);
    return fingerprints;
}

async function sha1(text: string): Promise<string> {
    const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function portraitKey(stamp: string): Promise<string | null> {
    const fp = await fingerprint();
    return fp && `/__images/portrait/${fp.portraits}/${await sha1(stamp)}`;
}

/** A stored portrait for this look (`stamp`: the serialized appearance), or null. */
export async function loadPortrait(stamp: string): Promise<string | null> {
    try {
        const key = await portraitKey(stamp);
        if (!key) return null;
        const hit = await (await caches.open(CACHE)).match(key);
        return hit ? await hit.text() : null;
    } catch {
        return null;
    }
}

/** Keep a drawn portrait for the next visit; the oldest go past the cap. */
export async function savePortrait(stamp: string, url: string): Promise<void> {
    try {
        const key = await portraitKey(stamp);
        if (!key) return;
        const cache = await caches.open(CACHE);
        await cache.put(key, new Response(url));
        const portraits = (await cache.keys()).filter((r) =>
            new URL(r.url).pathname.startsWith("/__images/portrait/"),
        );
        for (const stale of portraits.slice(0, Math.max(0, portraits.length - MAX_PORTRAITS)))
            await cache.delete(stale);
    } catch {
        // storage unavailable or full: the portrait is simply drawn again next time
    }
}

/** Stored gear thumbnails for the current models, or null. */
export async function loadGear(): Promise<Record<string, string> | null> {
    try {
        const fp = await fingerprint();
        if (!fp) return null;
        const hit = await (await caches.open(CACHE)).match(`/__images/gear/${fp.gear}`);
        return hit ? ((await hit.json()) as Record<string, string>) : null;
    } catch {
        return null;
    }
}

/** Keep the gear thumbnails, replacing those drawn from older models. */
export async function saveGear(images: Record<string, string>): Promise<void> {
    try {
        const fp = await fingerprint();
        if (!fp) return;
        const cache = await caches.open(CACHE);
        for (const request of await cache.keys())
            if (new URL(request.url).pathname.startsWith("/__images/gear/"))
                await cache.delete(request);
        await cache.put(`/__images/gear/${fp.gear}`, Response.json(images));
    } catch {
        // as above: drawn again next time
    }
}
