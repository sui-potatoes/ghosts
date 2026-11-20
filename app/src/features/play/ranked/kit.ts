// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Virtual units as the match and the builder dress them: a ranked loadout's kit
 * by squad catalog id (`fieldKit`), its role, and a figure for it, a Rookie with a
 * face from the character editor's presets (`virtualRecruits`), the opponent's
 * hostiles in faces the player's do not wear (`sideLooks`). A ranked unit has no
 * recruit behind it, so this is what gives it a look; nothing here is saved.
 * Plain TypeScript, tested in `tests/play-kit.test.ts`.
 */

import { itemById } from "@ghosts/squad/catalog";
import { normalizeArmorColors } from "@ghosts/squad/armor-colors";
import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import type { Recruit, Role as RecruitRole } from "@ghosts/squad/types";

import { unpack } from "@ghosts/squad/stats";

import { fieldUnit, kitOf, PRESETS, type Loadout } from "../economy/index.ts";

// === Seeds ===

/** FNV-1a: a stable 32-bit number for a string. */
export function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** Mulberry32: a small seeded generator in [0, 1). */
export function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** `count` different entries of `list` (it must hold that many), in drawn order. */
function draw<T>(list: readonly T[], count: number, random: () => number): T[] {
    const pool = [...list];
    const out: T[] = [];
    while (out.length < count && pool.length)
        out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return out;
}

// === Loadout → engine unit ===

/** A unit's kit by squad catalog id (`@ghosts/squad/catalog`), as the engine's `Kit` takes it. */
export type FieldKit = { primary: string; armor: string; utility: string | null };

/** The basic kit an unknown id falls back to. */
export const BASIC_KIT: FieldKit = { primary: "mx4", armor: "spectre", utility: null };

const SQUAD_SLOT = { primary: "primary", armor: "armor", utility: "utility" } as const;
const warned = new Set<string>();

function warnOnce(text: string) {
    if (warned.has(text)) return;
    warned.add(text);
    console.warn(`[ranked kit] ${text}`);
}

/**
 * A loadout as the squad catalog's ids, slot by slot: the economy's `kitOf`
 * maps the catalog ids, each result must be a squad item of that slot, and
 * anything else falls back to the basic kit with a console warning.
 */
export function fieldKit(loadout: Loadout): FieldKit {
    let mapped: { primary: string | null; armor: string | null; utility: string | null };
    try {
        mapped = kitOf(loadout);
    } catch {
        mapped = { primary: null, armor: null, utility: null };
    }
    const check = (slot: keyof typeof SQUAD_SLOT, id: string | null, from: string | null) => {
        if (slot === "utility" && from === null) return null;
        const item = id ? itemById(id) : undefined;
        if (item && item.slot === SQUAD_SLOT[slot]) return item.id;
        warnOnce(
            `unknown ${slot} "${from}" for preset "${loadout.preset}": the basic kit stands in`,
        );
        return BASIC_KIT[slot];
    };
    return {
        primary: check("primary", mapped.primary, loadout.weapon) ?? BASIC_KIT.primary,
        armor: check("armor", mapped.armor, loadout.armor) ?? BASIC_KIT.armor,
        utility: check("utility", mapped.utility, loadout.utility),
    };
}

/** The engine's role for a kit: what the HUD names it and how the AI weighs it. */
export type FieldRole = "ASSAULT" | "RECON" | "HEAVY" | "SPECIALIST";

export function fieldRole(kit: FieldKit): FieldRole {
    if (itemById(kit.primary)?.model === "sniper") return "RECON";
    if (kit.armor === "nyx-heavy") return "HEAVY";
    if (kit.utility === "trauma") return "SPECIALIST";
    return "ASSAULT";
}

const RECRUIT_ROLE: Record<FieldRole, RecruitRole> = {
    ASSAULT: "Assault",
    RECON: "Marksman",
    HEAVY: "Assault",
    SPECIALIST: "Support",
};

/** The faces a virtual unit can wear: the character editor's identity presets. */
const FACES = presets.filter((p) => p.sex);

/** One side's units as the match deploys them. */
export type Side = {
    /** Unit ids: on chain, the units' own; in the builder, one per place. */
    ids: string[];
    loadouts: Loadout[];
    kits: FieldKit[];
    roles: FieldRole[];
    callsigns: string[];
    /** Full names. */
    names: string[];
    /** What each unit's type is called on the cards and plates. */
    types: string[];
};

/** The faces of the player's units: a seeded slice of the identity presets. */
export const playerFaces = (seed: number, count: number) =>
    draw(FACES, Math.min(FACES.length, count), seeded(seed ^ 0x2545f491));

/**
 * The faces of the opponent's units: the presets the player's units do not
 * wear first, so the squads share a face only when there are too few presets
 * (6 presets, 4 a side: two shared).
 */
export function opponentFaces(seed: number, count: number) {
    const mine = playerFaces(seed, count);
    const random = seeded(seed ^ 0x7f4a7c15);
    const rest = FACES.filter((f) => !mine.includes(f));
    const fresh = draw(rest, Math.min(count, rest.length), random);
    return [...fresh, ...draw(mine, count - fresh.length, random)];
}

/**
 * A side's units as the engine dresses an opponent's (`UnitSpec.look`): the armor
 * their kit names, and a face the player's units do not wear.
 */
export function sideLooks(side: Side, seed: number) {
    const faces = opponentFaces(seed, side.ids.length);
    return side.ids.map((_, i) => {
        const face = faces[i % faces.length] ?? FACES[0];
        return {
            appearance: normalize({ ...fromPreset(face), name: side.names[i] }, schema),
            armor: side.kits[i].armor,
        };
    });
}

/**
 * The player's side as recruits the engine deploys (`Encounter`'s `squad`):
 * matched to units by id, wearing their armor, named by callsign, a face from
 * the editor's presets. Rookies with no fittings; nothing is saved.
 */
export function virtualRecruits(side: Side, seed: number): Recruit[] {
    const faces = playerFaces(seed, side.ids.length);
    return side.ids.map((id, i) => {
        const face = faces[i % faces.length] ?? FACES[0];
        const kit = side.kits[i];
        return {
            id,
            name: side.names[i],
            callsign: side.callsigns[i],
            role: RECRUIT_ROLE[side.roles[i]],
            appearance: normalize({ ...fromPreset(face), name: side.names[i] }, schema),
            armorColors: normalizeArmorColors(null),
            equipment: {
                primary: kit.primary,
                sidearm: "k12",
                armor: kit.armor,
                utility: kit.utility,
            },
            attachments: {},
        };
    });
}

// === A ranked unit on the map ===

/** A unit on the map as `MapUnit` decodes it: what tells its loadout. */
export type ChainUnitLike = {
    recruit: string;
    stats: { value: string | bigint | number };
    actions: readonly { kind: { $kind: string } }[];
};

/** The utility behind each action a ranked unit can carry. */
const UTILITY_OF_ACTION: Record<string, string> = {
    Grenade: "frag-grenade",
    Flashbang: "flashbang",
    SmokeGrenade: "smoke-grenade",
};

const WEAPONS = ["rifle-1", "rifle-2", "rifle-3"];
const ARMORS = ["armor-1", "armor-2", "armor-3"];

/** The preset a loadout is, or the one it is closest to (most slots alike, the first on a tie). */
function presetFor(gear: Omit<Loadout, "preset">): string {
    let best = PRESETS[0];
    let alike = -1;
    for (const preset of PRESETS) {
        const n = (["weapon", "armor", "utility"] as const).filter(
            (slot) => preset.loadout[slot] === gear[slot],
        ).length;
        if (n > alike) [best, alike] = [preset, n];
    }
    return best.id;
}

/**
 * The loadout a ranked unit was built from, read off the unit: the utility from its
 * actions, the rifle and the armor from its stats (the loadout whose stats are
 * nearest, as `unit::from_loadout` adds them to a Rookie's). Ranked units have no
 * recruit to read gear from: this is all there is, in a match and in a replay.
 */
export function unitLoadout(unit: ChainUnitLike): Loadout {
    const stats = unpack(BigInt(unit.stats.value));
    const utility =
        unit.actions.map((a) => UTILITY_OF_ACTION[a.kind.$kind]).find((id) => !!id) ?? null;
    let best: Omit<Loadout, "preset"> = { weapon: WEAPONS[0], armor: ARMORS[0], utility };
    let gap = Number.POSITIVE_INFINITY;
    for (const weapon of WEAPONS)
        for (const armor of ARMORS) {
            const gear = { weapon, armor, utility };
            const field = fieldUnit({ preset: "", ...gear }).stats;
            const d = (Object.keys(stats) as (keyof typeof stats)[]).reduce(
                (sum, key) => sum + Math.abs((field[key] ?? 0) - stats[key]),
                0,
            );
            if (d < gap) [best, gap] = [gear, d];
        }
    return { preset: presetFor(best), ...best };
}

const sameGear = (a: Omit<Loadout, "preset">, b: Omit<Loadout, "preset">) =>
    a.weapon === b.weapon && a.armor === b.armor && a.utility === b.utility;

/** `Assault`, then `Assault-2`: one name per unit, so the field tells them apart. */
function uniqueNames(names: string[]): string[] {
    const count = new Map<string, number>();
    return names.map((name) => {
        const n = (count.get(name) ?? 0) + 1;
        count.set(name, n);
        return n === 1 ? name : `${name}-${n}`;
    });
}

/** A type name as a unit's name: the preset's own, without the modified mark. */
const baseName = (label: string) => label.split(" · ")[0].trim() || label;

/**
 * A side of ranked units as the field and the debrief show it: each unit's loadout,
 * kit and role, and its name: the builder's name for a unit of the same gear when
 * the squad is the player's own (`own`, the units and names the builder sent), else
 * the preset's. Units keep the order given.
 */
export function rankedSide(
    units: readonly ChainUnitLike[],
    own?: { units: Omit<Loadout, "preset">[]; labels: string[] } | null,
): Side {
    const loadouts = units.map(unitLoadout);
    const used = new Set<number>();
    const labels = loadouts.map((loadout) => {
        const at = own?.units.findIndex((gear, i) => !used.has(i) && sameGear(gear, loadout));
        if (own && at !== undefined && at >= 0) {
            used.add(at);
            return baseName(own.labels[at] ?? "");
        }
        return PRESETS.find((p) => p.id === loadout.preset)?.name ?? "Operative";
    });
    const names = uniqueNames(labels);
    const kits = loadouts.map(fieldKit);
    return {
        ids: units.map((u) => u.recruit),
        loadouts,
        kits,
        roles: kits.map(fieldRole),
        callsigns: names.map((name) => name.toUpperCase()),
        names,
        types: labels,
    };
}
