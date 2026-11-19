// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The player's own presets for squad building: saved squads (a name and the
 * units for one size) and saved unit types (a name and a `Loadout`). Plain,
 * serialisable data, kept on the device for now and meant to move to the
 * account later; pure functions here, the screen does the reading and writing.
 * Anything unreadable in storage is dropped, never trusted.
 */

import { itemOf, presetOf, priceOf, squadSize, type Loadout, type Mode } from "../economy/index.ts";

export const PRESETS_KEY = "ghosts:play-presets";
/** Saved squads per size. */
export const SQUAD_SLOTS = 8;
/** Saved unit types. */
export const TYPE_SLOTS = 8;
export const NAME_MAX = 24;

export type SavedSquad = { id: string; name: string; mode: Mode; units: Loadout[] };
export type SavedType = { id: string; name: string; loadout: Loadout };
export type Library = { v: 1; squads: SavedSquad[]; types: SavedType[] };

export const emptyLibrary = (): Library => ({ v: 1, squads: [], types: [] });

export const sameLoadout = (a: Loadout, b: Loadout): boolean =>
    a.preset === b.preset &&
    a.weapon === b.weapon &&
    a.armor === b.armor &&
    a.utility === b.utility;

const copy = (unit: Loadout): Loadout => ({
    preset: unit.preset,
    weapon: unit.weapon,
    armor: unit.armor,
    utility: unit.utility,
});

/** A loadout from storage, if it names a known type and items of the right slots. */
function readLoadout(x: unknown): Loadout | null {
    if (!x || typeof x !== "object") return null;
    const u = x as Record<string, unknown>;
    if (
        typeof u.preset !== "string" ||
        typeof u.weapon !== "string" ||
        typeof u.armor !== "string" ||
        !(u.utility === null || typeof u.utility === "string")
    )
        return null;
    if (!presetOf(u.preset)) return null;
    if (itemOf(u.weapon)?.slot !== "weapon" || itemOf(u.armor)?.slot !== "armor") return null;
    if (u.utility !== null && itemOf(u.utility)?.slot !== "utility") return null;
    return copy(u as Loadout);
}

/** Trimmed, single spaces, at most `NAME_MAX` characters. */
export const cleanName = (name: string): string =>
    name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

const readName = (x: unknown): string | null =>
    typeof x === "string" && cleanName(x) ? cleanName(x) : null;

/** Read what was stored; entries that do not make sense are dropped one by one. */
export function parseLibrary(raw: string | null): Library {
    if (!raw) return emptyLibrary();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return emptyLibrary();
    }
    if (!data || typeof data !== "object" || (data as { v?: unknown }).v !== 1)
        return emptyLibrary();
    const d = data as { squads?: unknown; types?: unknown };
    const ids = new Set<string>();
    const fresh = (id: unknown): id is string =>
        typeof id === "string" && id.length > 0 && !ids.has(id) && !!ids.add(id);

    const squads: SavedSquad[] = [];
    for (const x of Array.isArray(d.squads) ? d.squads : []) {
        if (!x || typeof x !== "object") continue;
        const s = x as Record<string, unknown>;
        const name = readName(s.name);
        const mode = s.mode === "3x3" || s.mode === "4x4" ? s.mode : null;
        if (!name || !mode || !Array.isArray(s.units)) continue;
        const units = s.units.map(readLoadout);
        if (units.length !== squadSize(mode) || units.some((u) => u === null)) continue;
        if (squads.filter((q) => q.mode === mode).length >= SQUAD_SLOTS) continue;
        if (!fresh(s.id)) continue;
        squads.push({ id: s.id as string, name, mode, units: units as Loadout[] });
    }
    const types: SavedType[] = [];
    for (const x of Array.isArray(d.types) ? d.types : []) {
        if (!x || typeof x !== "object" || types.length >= TYPE_SLOTS) continue;
        const t = x as Record<string, unknown>;
        const name = readName(t.name);
        const loadout = readLoadout(t.loadout);
        if (!name || !loadout || !fresh(t.id)) continue;
        types.push({ id: t.id as string, name, loadout });
    }
    return { v: 1, squads, types };
}

export const serializeLibrary = (library: Library): string => JSON.stringify(library);

/** A new id: time and a random tail, unique enough for one player's handful of presets. */
export const newId = (now = Date.now(), random = Math.random()): string =>
    `${now.toString(36)}${Math.floor(random * 1e6).toString(36)}`;

/** A small stable number for a text (the faces on the stands follow the screen's key). */
export function hashText(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}

/* === Names ============================================================ */

/** Why a name cannot be used, or null. `taken` are the names already in use, the renamed one left out. */
export function nameRefusal(name: string, taken: string[]): string | null {
    const clean = cleanName(name);
    if (!clean) return "Type a name";
    if (taken.some((t) => t.toLowerCase() === clean.toLowerCase())) return "That name is taken";
    return null;
}

/** `base 1`, `base 2`... the first one not taken. */
export function nextName(base: string, taken: string[]): string {
    const used = new Set(taken.map((t) => t.toLowerCase()));
    for (let n = 1; ; n++) {
        const name = cleanName(`${base} ${n}`);
        if (!used.has(name.toLowerCase())) return name;
    }
}

/* === Saved squads ===================================================== */

export const squadsFor = (library: Library, mode: Mode): SavedSquad[] =>
    library.squads.filter((s) => s.mode === mode);

/** Why the squad cannot be saved as a new entry, or null. */
export function saveSquadRefusal(
    library: Library,
    mode: Mode,
    units: (Loadout | null)[],
): string | null {
    if (units.length !== squadSize(mode) || units.some((u) => !u))
        return "Every unit needs a type first";
    if (squadsFor(library, mode).length >= SQUAD_SLOTS)
        return `All ${SQUAD_SLOTS} ${mode} slots are used: overwrite or delete one`;
    return null;
}

export function saveSquad(
    library: Library,
    mode: Mode,
    name: string,
    units: (Loadout | null)[],
    id: string = newId(),
): Library {
    if (saveSquadRefusal(library, mode, units)) return library;
    const entry: SavedSquad = {
        id,
        name: cleanName(name),
        mode,
        units: (units as Loadout[]).map(copy),
    };
    return { ...library, squads: [...library.squads, entry] };
}

export function overwriteSquad(library: Library, id: string, units: (Loadout | null)[]): Library {
    const at = library.squads.find((s) => s.id === id);
    if (!at || units.length !== squadSize(at.mode) || units.some((u) => !u)) return library;
    return {
        ...library,
        squads: library.squads.map((s) =>
            s.id === id ? { ...s, units: (units as Loadout[]).map(copy) } : s,
        ),
    };
}

export function renameSquad(library: Library, id: string, name: string): Library {
    const clean = cleanName(name);
    if (!clean) return library;
    return {
        ...library,
        squads: library.squads.map((s) => (s.id === id ? { ...s, name: clean } : s)),
    };
}

export const deleteSquad = (library: Library, id: string): Library => ({
    ...library,
    squads: library.squads.filter((s) => s.id !== id),
});

export const squadPrice = (squad: SavedSquad): number =>
    squad.units.reduce((sum, unit) => sum + priceOf(unit), 0);

/** Whether a saved squad is the one on the stands now. */
export const isSquad = (saved: SavedSquad, units: (Loadout | null)[]): boolean =>
    saved.units.length === units.length &&
    saved.units.every((u, i) => !!units[i] && sameLoadout(u, units[i]!));

/* === Saved unit types ================================================= */

/** The saved type this unit is exactly, if any. */
export const typeOf = (unit: Loadout, types: SavedType[]): SavedType | undefined =>
    types.find((t) => sameLoadout(t.loadout, unit));

/** Why this unit cannot be saved as a type of its own, or null. */
export function saveTypeRefusal(library: Library, unit: Loadout | null): string | null {
    if (!unit) return "Choose a type first";
    const base = presetOf(unit.preset);
    if (base && sameLoadout(base.loadout, unit))
        return `This is the ${base.name} kit as it comes: change a slot first`;
    const same = typeOf(unit, library.types);
    if (same) return `Saved already as ${same.name}`;
    if (library.types.length >= TYPE_SLOTS)
        return `All ${TYPE_SLOTS} type slots are used: delete one first`;
    return null;
}

export function saveType(
    library: Library,
    name: string,
    unit: Loadout,
    id: string = newId(),
): Library {
    if (saveTypeRefusal(library, unit)) return library;
    return {
        ...library,
        types: [...library.types, { id, name: cleanName(name), loadout: copy(unit) }],
    };
}

export const deleteType = (library: Library, id: string): Library => ({
    ...library,
    types: library.types.filter((t) => t.id !== id),
});
