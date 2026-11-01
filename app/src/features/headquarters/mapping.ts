// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * From on-chain recruits to the shapes the squad studio and stats read: looks
 * decoded from `Visuals`, gear mapped onto catalog models by the names
 * `ghosts::items` mints, and the default rifle in hand when a recruit carries
 * no weapon object (the chain's own default).
 */

import { useState } from "react";

import { decodeVisuals } from "@ghosts/squad/appearance/codec";
import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import { ATTACHMENTS, INITIAL_STOCK } from "@ghosts/squad/catalog";
import { restoreSquad, ROLES, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import type {
    Appearance,
    ArmorColors,
    Recruit as LocalRecruit,
    WeaponAttachments,
} from "@ghosts/squad/types";

import type { ChainRecruit, ChainWeapon } from "../../chain";

/** What a recruit without a weapon object fights with: `weapon::default`. */
export const DEFAULT_PRIMARY = "mx4";

/** Catalog models by the names `ghosts::items` and the defaults mint. */
const WEAPON_MODELS: Record<string, string> = {
    "Standard Issue Rifle": "mx4",
    "Standard Rifle": "mx4",
    "Sharpshooter Rifle": "srs9",
    "Plasma Rifle": "plasma",
};
const ARMOR_MODELS: Record<string, string> = {
    "Standard Armor": "spectre",
    "Light Armor": "spectre",
    "Medium Armor": "nyx-mid",
    "Heavy Armor": "nyx-heavy",
};

export const weaponModel = (w: { name: string }) => WEAPON_MODELS[w.name] ?? DEFAULT_PRIMARY;
export const armorModel = (a: { name: string }) => ARMOR_MODELS[a.name] ?? "spectre";
export const upgradeModel = (u: { name: string }) => ATTACHMENTS.find((a) => a.name === u.name);

export interface Look {
    appearance: Appearance;
    armorColors: ArmorColors;
}

/** A recruit's looks; unset visuals fall back to a preset matching the voice. */
export function lookOf(r: ChainRecruit): Look {
    const decoded = decodeVisuals(r.metadata.visuals);
    if (decoded)
        return { ...decoded, appearance: { ...decoded.appearance, name: r.metadata.name } };
    const sex = r.metadata.voice % 2 === 1 ? "female" : "male";
    const base = presets.find((p) => p.sex === sex) ?? presets[0];
    return {
        appearance: normalize({ ...fromPreset(base), name: r.metadata.name }, schema),
        armorColors: DEFAULT_ARMOR_COLORS,
    };
}

function attachmentsOf(weapon: ChainWeapon | ChainRecruit["weapon"]): WeaponAttachments {
    const out: WeaponAttachments = {};
    for (const upgrade of weapon?.upgrades ?? []) {
        const model = upgradeModel(upgrade);
        if (model && !out[model.slot]) out[model.slot] = model.id;
    }
    return out;
}

/** A short callsign from the name: first word, letters and digits only. */
function callsignOf(name: string, taken: Set<string>): string {
    const word = (name.split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
    let callsign = word.length >= 2 ? word.slice(0, 12) : "OPERATIVE";
    for (let n = 2; taken.has(callsign); n++) callsign = `${word.slice(0, 10)}-${n}`;
    taken.add(callsign);
    return callsign;
}

/**
 * The studio's recruit shape for each on-chain recruit, in roster order, with
 * the (draft) look of the selected one swapped in by the caller as needed.
 */
export function toLocalRecruits(recruits: ChainRecruit[]): LocalRecruit[] {
    const taken = new Set<string>();
    return recruits.map((r, i) => {
        const look = lookOf(r);
        return {
            id: r.objectId,
            name: r.metadata.name,
            callsign: callsignOf(r.metadata.name, taken),
            role: ROLES[i % ROLES.length],
            appearance: look.appearance,
            armorColors: look.armorColors,
            equipment: {
                primary: r.weapon ? weaponModel(r.weapon) : DEFAULT_PRIMARY,
                sidearm: null,
                armor: r.armor ? armorModel(r.armor) : null,
                utility: null,
            },
            attachments: attachmentsOf(r.weapon),
        };
    });
}

/**
 * Hand the on-chain squad to the local playtest: `/demo` reads its roster
 * from the squad storage key. The demo keeps its own sidearm and grenade,
 * which the chain does not mint yet. Invalid rosters are not written.
 */
export function syncDemoRoster(recruits: LocalRecruit[]) {
    if (!recruits.length) return;
    const state = {
        version: 1,
        stock: { ...INITIAL_STOCK },
        recruits: recruits.map((r) => ({
            ...r,
            equipment: { ...r.equipment, sidearm: "k12", utility: "frag" },
        })),
    };
    try {
        restoreSquad(state);
        localStorage.setItem(SQUAD_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // storage unavailable or the roster failed validation: the demo keeps its own
    }
}

/**
 * Stable card slots: recruits keep the slot they were first seen in, newly
 * hired ones fill the vacancies in id order. Returns `FREE_RECRUITS`-long
 * slots (null = vacant) plus any recruits beyond that.
 */
export function useSlots<T extends { objectId: string }>(
    recruits: T[],
    capacity: number,
): (T | null)[] {
    const [order, setOrder] = useState<string[]>([]);
    const present = new Set(recruits.map((r) => r.objectId));
    const kept = order.filter((id) => present.has(id));
    const fresh = recruits
        .map((r) => r.objectId)
        .filter((id) => !kept.includes(id))
        .sort();
    const next = [...kept, ...fresh];
    if (next.join() !== order.join()) setOrder(next);

    const byId = new Map(recruits.map((r) => [r.objectId, r]));
    const slots: (T | null)[] = next.map((id) => byId.get(id) ?? null);
    while (slots.length < capacity) slots.push(null);
    return slots;
}
