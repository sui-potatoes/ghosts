// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Squad presets: named squad builds for ranked play. A preset is three
 * podium slots, each a full loadout (rifle with its upgrades, armor,
 * utility) plus an optional preferred recruit. The build is what a preset
 * is about: applied, each podium takes the preferred recruit when they are
 * on the roster (and not wanted elsewhere), otherwise whoever stands there
 * now, and that operative is re-equipped with the slot's loadout. Nothing
 * is ever substituted: an item the armory doesn't hold or a recruit who
 * left shows as a gap and is named.
 *
 * Plain TypeScript; storage is injected (localStorage in the sample, chain
 * objects later), every read and write guarded. Tested in
 * `tests/squad-build.test.ts`.
 */

import { loadoutCost, sameLoadout, type Loadout } from "./squad-build.ts";

export const PRESETS_KEY = "ghosts:squad-presets";
export const PRESETS_VERSION = 1;
export const MAX_PRESETS = 8;

export type PresetSlot = {
    /** The role the slot was built for (BASE / CUSTOM is judged against it). */
    role: string;
    loadout: Loadout;
    /** Who the slot was built around; optional, never required. */
    preferred: string | null;
};

export type Preset = {
    id: string;
    name: string;
    /** Shipped with the game (Standard Issue, …): can't be renamed, overwritten or deleted. */
    builtIn: boolean;
    podiums: (PresetSlot | null)[];
};

export type Stored = { version: number; presets: Preset[] };

/** What the sample has to check a preset against. */
export type Inventory = {
    /** Item ids the armory holds. */
    owned: Set<string>;
    /** Recruit ids on the roster. */
    roster: Set<string>;
};

const kit = (
    primary: string,
    armor: string,
    utility: string | null,
    mods: Loadout["mods"] = {},
): Loadout => ({
    primary,
    armor,
    utility,
    mods,
});

/** Built-in starters, from the game's real items. */
export const BUILT_INS: Preset[] = [
    {
        id: "standard-issue",
        name: "Standard Issue",
        builtIn: true,
        podiums: [
            { role: "Assault", loadout: kit("mx4", "spectre", "frag"), preferred: null },
            {
                role: "Marksman",
                loadout: kit("srs9", "spectre", "frag", { scope: "scope-1" }),
                preferred: null,
            },
            { role: "Support", loadout: kit("mx4", "spectre", "frag"), preferred: null },
        ],
    },
    {
        id: "marksman-cover",
        name: "Marksman Cover",
        builtIn: true,
        podiums: [
            {
                role: "Marksman",
                loadout: kit("srs9", "spectre", "frag", { scope: "scope-2" }),
                preferred: null,
            },
            {
                role: "Marksman",
                loadout: kit("srs9", "spectre", null, { scope: "scope-1", stock: "stock-1" }),
                preferred: null,
            },
            {
                role: "Assault",
                loadout: kit("mx4", "nyx-mid", "frag", { clip: "clip-1" }),
                preferred: null,
            },
        ],
    },
    {
        id: "breach",
        name: "Breach",
        builtIn: true,
        podiums: [
            {
                role: "Assault",
                loadout: kit("mx4", "nyx-heavy", "frag", { clip: "clip-2" }),
                preferred: null,
            },
            {
                role: "Assault",
                loadout: kit("mx4", "nyx-mid", "frag", { clip: "clip-1" }),
                preferred: null,
            },
            { role: "Support", loadout: kit("mx4", "nyx-mid", "frag"), preferred: null },
        ],
    },
];

export const presetCost = (preset: Preset) =>
    preset.podiums.reduce((sum, slot) => sum + (slot ? loadoutCost(slot.loadout) : 0), 0);

const itemsOf = (l: Loadout) =>
    [l.primary, l.armor, l.utility, ...Object.values(l.mods)].filter((x): x is string => !!x);

/** What the inventory lacks for each podium: item ids not held, or a preferred recruit who left. */
export function gaps(
    preset: Preset,
    inventory: Inventory,
): { items: string[]; recruit: string | null }[] {
    // Items are pieces: a preset that wants two of a rifle needs two. The sample's
    // armory is a set (one of each), so a second copy counts as held there.
    return preset.podiums.map((slot) => ({
        items: slot ? itemsOf(slot.loadout).filter((id) => !inventory.owned.has(id)) : [],
        recruit: slot?.preferred && !inventory.roster.has(slot.preferred) ? slot.preferred : null,
    }));
}

/** Whether a preset can be applied as is. */
export const complete = (preset: Preset, inventory: Inventory) =>
    gaps(preset, inventory).every((g) => !g.items.length);

/**
 * Who stands on each podium once the preset is applied: the preferred
 * recruit when on the roster and not preferred by an earlier podium,
 * otherwise the current occupant (if they aren't placed by the preset elsewhere).
 */
export function resolve(
    preset: Preset,
    current: (string | null)[],
    inventory: Inventory,
): (string | null)[] {
    const wanted = preset.podiums.map((slot) =>
        slot?.preferred && inventory.roster.has(slot.preferred) ? slot.preferred : null,
    );
    const taken = new Set(wanted.filter(Boolean));
    const result = wanted.map((id, i) =>
        !preset.podiums[i]
            ? null
            : (id ?? (current[i] && !taken.has(current[i]) ? current[i] : null)),
    );
    // A displaced occupant moves to a podium the preset left open.
    const placed = new Set(result.filter(Boolean));
    const spare = current.filter((id): id is string => !!id && !placed.has(id));
    return result.map((id, i) => id ?? (preset.podiums[i] ? (spare.shift() ?? null) : null));
}

/** The podiums differ from the preset: a different kit, or a filled/empty mismatch. */
export function modified(preset: Preset, loadouts: (Loadout | null)[]): boolean {
    return preset.podiums.some((slot, i) => {
        const now = loadouts[i];
        if (!slot || !now) return !!slot !== !!now;
        return !sameLoadout(slot.loadout, now);
    });
}

/** A preset built from the squad on the podiums. */
export function fromSquad(
    id: string,
    name: string,
    podiums: ({ id: string; role: string; loadout: Loadout } | null)[],
): Preset {
    return {
        id,
        name,
        builtIn: false,
        podiums: podiums.map((p) =>
            p ? { role: p.role, loadout: p.loadout, preferred: p.id } : null,
        ),
    };
}

/** The player's presets after an edit, or the reason it is refused. */
export type Edit = { ok: true; presets: Preset[] } | { ok: false; reason: string };

export function add(presets: Preset[], preset: Preset): Edit {
    if (presets.length >= MAX_PRESETS)
        return { ok: false, reason: `${MAX_PRESETS} presets at most. Delete one first` };
    if (!preset.name.trim()) return { ok: false, reason: "A preset needs a name" };
    return { ok: true, presets: [...presets, { ...preset, name: preset.name.trim() }] };
}

export function rename(presets: Preset[], id: string, name: string): Edit {
    if (!name.trim()) return { ok: false, reason: "A preset needs a name" };
    return {
        ok: true,
        presets: presets.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)),
    };
}

export function overwrite(presets: Preset[], id: string, podiums: Preset["podiums"]): Edit {
    return { ok: true, presets: presets.map((p) => (p.id === id ? { ...p, podiums } : p)) };
}

export function remove(presets: Preset[], id: string): Edit {
    return { ok: true, presets: presets.filter((p) => p.id !== id) };
}

/** "Breach" → "Breach 2" (the first free number). */
export function copyName(presets: Preset[], name: string): string {
    const base = name.replace(/ \d+$/, "");
    for (let n = 2; ; n++) {
        const next = `${base} ${n}`;
        if (!presets.some((p) => p.name === next)) return next;
    }
}

/** Read the player's presets; anything unreadable is an empty list. */
export function load(storage: Pick<Storage, "getItem"> | undefined): Preset[] {
    try {
        const raw = storage?.getItem(PRESETS_KEY);
        if (!raw) return [];
        const data = JSON.parse(raw) as Stored;
        if (data?.version !== PRESETS_VERSION || !Array.isArray(data.presets)) return [];
        return data.presets
            .filter(
                (p) =>
                    p &&
                    typeof p.id === "string" &&
                    typeof p.name === "string" &&
                    Array.isArray(p.podiums),
            )
            .map((p) => ({ ...p, builtIn: false }))
            .slice(0, MAX_PRESETS);
    } catch {
        return [];
    }
}

/** Write the player's presets; false when storage refused (private mode, quota). */
export function store(storage: Pick<Storage, "setItem"> | undefined, presets: Preset[]): boolean {
    try {
        storage?.setItem(
            PRESETS_KEY,
            JSON.stringify({ version: PRESETS_VERSION, presets } satisfies Stored),
        );
        return !!storage;
    } catch {
        return false;
    }
}
