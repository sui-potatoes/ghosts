// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

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
    return next;
}
