// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";

import { FACTORY_SKIN } from "@ghosts/squad/weapon-skins";

/**
 * The finish chosen for each weapon, kept on this device only (nothing on
 * chain yet): weapon object id → skin id. Factory is the absence of an entry.
 * Storage can be missing or throw (private mode, blocked site data); then
 * every weapon reads as Factory and choices last until the page closes.
 */
export const WEAPON_SKINS_KEY = "ghosts:weapon-skins";

type Store = Pick<Storage, "getItem" | "setItem">;

function deviceStorage(): Store | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Every saved choice; malformed entries are dropped. */
export function readWeaponSkins(store: Store | null = deviceStorage()): Record<string, string> {
    try {
        const raw = store?.getItem(WEAPON_SKINS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(
            Object.entries(parsed).filter(
                (e): e is [string, string] => typeof e[1] === "string" && e[1] !== FACTORY_SKIN,
            ),
        );
    } catch {
        return {};
    }
}

/** Saves `skin` for `weaponId` (Factory removes the entry); returns every choice. */
export function saveWeaponSkin(
    weaponId: string,
    skin: string,
    store: Store | null = deviceStorage(),
): Record<string, string> {
    const next = readWeaponSkins(store);
    if (skin === FACTORY_SKIN) delete next[weaponId];
    else next[weaponId] = skin;
    try {
        store?.setItem(WEAPON_SKINS_KEY, JSON.stringify(next));
    } catch {
        // full or blocked: the choice still holds for this visit
    }
    if (store === deviceStorage()) {
        session = next;
        listeners.forEach((listener) => listener());
    }
    return next;
}

/** This visit's view of the device's choices; written through on save, so a
 * blocked storage still keeps them until the page closes. */
let session: Record<string, string> | null = null;
const listeners = new Set<() => void>();

/** The finish chosen for a weapon object, or undefined for Factory. */
export function skinForWeapon(weaponId: string): string | undefined {
    return currentWeaponSkins()[weaponId];
}

/** Every choice on this device, as a stable object between changes. */
export function currentWeaponSkins(): Record<string, string> {
    return (session ??= readWeaponSkins());
}

/** Calls `listener` when a choice changes, here or in another tab. */
export function subscribeWeaponSkins(listener: () => void): () => void {
    const fromTab = (e: StorageEvent) => {
        if (e.key !== WEAPON_SKINS_KEY && e.key !== null) return;
        session = readWeaponSkins();
        listener();
    };
    listeners.add(listener);
    globalThis.addEventListener?.("storage", fromTab);
    return () => {
        listeners.delete(listener);
        globalThis.removeEventListener?.("storage", fromTab);
    };
}

/** Every choice, re-rendering on change: pass it to `toLocalRecruits`. */
export function useWeaponSkins(): Record<string, string> {
    return useSyncExternalStore(subscribeWeaponSkins, currentWeaponSkins);
}
