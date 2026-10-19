// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Player name: what other players see instead of an address.
 *
 * Today the name lives in local storage, keyed by address. The plan is to back
 * it with SuiNS, so the rules below are SuiNS label rules: whatever a player
 * picks now is a name they can register later without changing it. Swapping
 * the backend means replacing `store` with one that reads the address's
 * default SuiNS name and writes through a registration flow; the hook and the
 * UI stay as they are.
 */

import { NETWORK } from "../constants";

export type NameSource = "local" | "suins";

export type PlayerName = {
    name: string;
    /** Where the name came from. `null` when it is the generated fallback. */
    source: NameSource | null;
};

/** SuiNS label bounds, inclusive. */
export const NAME_MIN = 3;
export const NAME_MAX = 63;

/** Lowercase letters, digits and hyphens; no hyphen at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Normalize user input the way SuiNS would: lowercase, trimmed. */
export function normalizeName(input: string): string {
    return input.trim().toLowerCase();
}

/** Why `name` is not an acceptable name, or `null` when it is. */
export function validateName(name: string): string | null {
    if (name.length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
    if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
    if (!LABEL.test(name)) return "Lowercase letters, digits and hyphens; no hyphen at the ends.";
    return null;
}

/** Deterministic callsign for an address that has no name yet. */
export function defaultName(address: string): string {
    return `ghost-${address.slice(2, 6)}`;
}

// === Store ===

const LISTENERS = new Set<() => void>();

function key(address: string) {
    return `ghosts:name:${NETWORK}:${address}`;
}

function read(address: string): string | null {
    try {
        return localStorage.getItem(key(address));
    } catch {
        return null;
    }
}

function write(address: string, name: string | null) {
    try {
        if (name) localStorage.setItem(key(address), name);
        else localStorage.removeItem(key(address));
    } catch (e) {
        console.warn("localStorage write failed:", e);
    }
    for (const listener of LISTENERS) listener();
}

/** The stored name for `address`, or the generated fallback. */
export function getPlayerName(address: string): PlayerName {
    const stored = read(address);
    return stored
        ? { name: stored, source: "local" }
        : { name: defaultName(address), source: null };
}

/** Save a (normalized, validated) name for `address`. */
export function setPlayerName(address: string, name: string) {
    const error = validateName(name);
    if (error) throw new Error(error);
    write(address, name);
}

/** Drop the stored name; the fallback applies again. */
export function clearPlayerName(address: string) {
    write(address, null);
}

/** Subscribe to name changes made in this tab. */
export function subscribePlayerName(listener: () => void): () => void {
    LISTENERS.add(listener);
    const onStorage = (e: StorageEvent) => {
        if (e.key?.startsWith("ghosts:name:")) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
        LISTENERS.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}
