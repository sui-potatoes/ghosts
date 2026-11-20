// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Pure helpers for the player's fullnode RPC override; no browser or SDK imports. */

export type RpcUrlCheck = { ok: true; url: string } | { ok: false; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Check a typed fullnode URL. Empty means "use the default" and passes as "".
 * Otherwise it must parse as an https URL, or http on localhost, and carry no
 * credentials. The result is trimmed and loses trailing slashes.
 */
export function validateRpcUrl(input: string): RpcUrlCheck {
    const text = input.trim();
    if (!text) return { ok: true, url: "" };
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return { ok: false, error: "Not a valid URL" };
    }
    const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
    if (url.protocol === "http:") {
        if (!local) return { ok: false, error: "Use https (http only works for localhost)" };
    } else if (url.protocol !== "https:") {
        return { ok: false, error: "The URL must start with https://" };
    }
    if (url.username || url.password) {
        return { ok: false, error: "Credentials in the URL are not allowed" };
    }
    if (url.hash) return { ok: false, error: "Remove the #fragment" };
    return { ok: true, url: (url.origin + url.pathname + url.search).replace(/\/+$/, "") };
}
