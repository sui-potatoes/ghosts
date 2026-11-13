// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The sample's items: only what the game has. Names, tiers and stats are
 * `ghosts::items` (move/packages/ghosts/sources/recruit/items.move): three
 * rifles, three armors, the frag grenade, and the four weapon upgrades in
 * three tiers; any operative takes any of them. Models are the squad catalog's, the way
 * Headquarters maps chain items (`features/headquarters/mapping.ts`). The
 * game has no sidearm on chain yet, no weight and no purchase currency, so
 * the sample shows none. What the sample owns and who holds which rank are
 * fixtures; nothing here is read from or written to the chain.
 */

import { ATTACHMENTS } from "@ghosts/squad/catalog";
import { formatStat, ITEM_STATS, VISIBLE, type StatKey, type Stats } from "@ghosts/squad/stats";
import type { AttachmentSlot, Equipment, Recruit, Slot } from "@ghosts/squad/types";

import { RANKS } from "../../chain/match-rules";

export type Rank = (typeof RANKS)[number];
export { RANKS };

export type Section = "weapons" | "armor" | "utility" | "mods";

export const SECTIONS: { id: Section; label: string }[] = [
    { id: "weapons", label: "Weapons" },
    { id: "armor", label: "Armor" },
    { id: "utility", label: "Utility" },
    { id: "mods", label: "Mods" },
];

/** One line of an item's specification. */
export type Stat = { key: StatKey; label: string; value: number; text: string; max: number };

export type Item = {
    /** The squad catalog id (rifles, armor, utility) or the attachment id (mods). */
    id: string;
    name: string;
    kind: string;
    section: Section;
    tier: 1 | 2 | 3;
    stats: Stat[];
    /** The plain effect, for the bar's hint. */
    effect: string;
    /** Rifles take the four upgrade kinds. */
    slots?: AttachmentSlot[];
    /** What the gear stage shows; for a mod, the Standard Rifle wearing it. */
    model?: Equipment["model"];
    /** For a mod: its slot, fitted on the stage's rifle. */
    mod?: AttachmentSlot;
    /** For armor: the catalog item the character stage dresses the wearer in. */
    wear?: string;
};

const RIFLE_SLOTS: AttachmentSlot[] = ["scope", "laser", "stock", "clip"];

function statRows(stats: Stats, keys: StatKey[]): Stat[] {
    return VISIBLE.filter((row) => keys.includes(row.key)).map((row) => ({
        key: row.key,
        label: row.label,
        value: stats[row.key],
        text: formatStat(row, stats),
        max: row.max,
    }));
}

const WEAPON_KEYS: StatKey[] = ["damage", "critChance", "range", "ammo"];
const ARMOR_KEYS: StatKey[] = ["mobility", "health", "armor", "dodge"];

function rifle(id: string, name: string, tier: 1 | 2 | 3, kind: string): Item {
    const stats = statRows(ITEM_STATS[id], WEAPON_KEYS);
    return {
        id,
        name,
        kind,
        section: "weapons",
        tier,
        stats,
        effect: stats.map((s) => `${s.text} ${s.label.toLowerCase()}`).join(" · "),
        slots: RIFLE_SLOTS,
        model: id === "mx4" ? "rifle" : id === "srs9" ? "sniper" : "plasma",
    };
}

function armor(id: string, name: string, tier: 1 | 2 | 3, effect: string): Item {
    return {
        id,
        name,
        kind: `Tier ${"I".repeat(tier)} armor`,
        section: "armor",
        tier,
        stats: statRows(ITEM_STATS[id], ARMOR_KEYS),
        effect,
        wear: id,
    };
}

const TIER_NAMES = ["", "I", "II", "III"];

export const STOCK: Record<Section, Item[]> = {
    weapons: [
        rifle("mx4", "Standard Rifle", 1, "Rifle · tier I"),
        rifle("srs9", "Sharpshooter Rifle", 2, "Rifle · tier II"),
        rifle("plasma", "Plasma Rifle", 3, "Rifle · tier III"),
    ],
    armor: [
        armor("spectre", "Light Armor", 1, "+1 armor · +10% dodge"),
        armor("nyx-mid", "Medium Armor", 2, "+2 armor"),
        armor("nyx-heavy", "Heavy Armor", 3, "+3 armor · +1 health · −1 mobility · −10% dodge"),
    ],
    utility: [
        {
            id: "frag",
            name: "Frag Grenade",
            kind: "Utility",
            section: "utility",
            tier: 1,
            stats: [],
            effect: "One grenade throw per match",
            model: "grenade",
        },
    ],
    mods: ATTACHMENTS.map((a) => ({
        id: a.id,
        name: a.name,
        kind: `Weapon upgrade · tier ${TIER_NAMES[a.tier]}`,
        section: "mods" as const,
        tier: a.tier as 1 | 2 | 3,
        stats: [],
        effect: a.stat,
        model: "rifle" as const,
        mod: a.slot,
    })),
};

/** Every item by id. */
export const ITEMS: Record<string, Item> = Object.fromEntries(
    Object.values(STOCK)
        .flat()
        .map((item) => [item.id, item]),
);

/** The game's name for a loadout item ("Light Armor", not the model's name). */
export const gearName = (id: string | null | undefined) => (id ? ITEMS[id]?.name : undefined);

/** The loadout slots the game has: no sidearm on chain yet. */
export const LOADOUT_SLOTS: Exclude<Slot, "sidearm">[] = ["primary", "armor", "utility"];

export const LOADOUT_SLOT_NAMES: Record<(typeof LOADOUT_SLOTS)[number], string> = {
    primary: "Rifle",
    armor: "Armor",
    utility: "Utility",
};

/** The items a loadout slot takes. */
export const SLOT_ITEMS: Record<(typeof LOADOUT_SLOTS)[number], Item[]> = {
    primary: STOCK.weapons,
    armor: STOCK.armor,
    utility: STOCK.utility,
};

export const rankIndex = (rank: string) => RANKS.indexOf(rank as Rank);

/** The pictogram step for a rank: one chevron per two ranks, three at most. */
export const rankIcon = (rank: string): "rank1" | "rank2" | "rank3" => {
    const i = rankIndex(rank);
    return i >= 4 ? "rank3" : i >= 2 ? "rank2" : "rank1";
};

/**
 * Fixture ranks and experience for the showcase squad, by position: the game
 * keeps both on each recruit; the local roster /demo plays with has neither.
 */
const FIXTURE_RANKS: { rank: Rank; xp: number }[] = [
    { rank: "Sergeant", xp: 23 },
    { rank: "Lieutenant", xp: 31 },
    { rank: "Corporal", xp: 10 },
    { rank: "Squaddie", xp: 4 },
];

export function fixtureRank(index: number): { rank: Rank; xp: number } {
    return FIXTURE_RANKS[index % FIXTURE_RANKS.length];
}

/**
 * The showcase recruit on the game's real items: no sidearm, armor and
 * utility mapped to what the chain mints (Light Armor for the old carriers,
 * the frag grenade for any other utility).
 */
export function realLoadout(recruit: Recruit): Recruit {
    const { primary, armor, utility } = recruit.equipment;
    return {
        ...recruit,
        equipment: {
            primary: primary && ITEMS[primary] ? primary : "mx4",
            sidearm: null,
            armor: armor && ITEMS[armor] ? armor : "spectre",
            utility: utility ? "frag" : null,
        },
    };
}

/** What the Armory holds when the screen opens (fixture). */
export const OWNED = ["mx4", "srs9", "spectre", "nyx-mid", "frag", "scope-1", "scope-2", "clip-1"];

/** What VEX carries when the screen opens, per section. */
export const ISSUED: Record<Section, string | null> = {
    weapons: "mx4",
    armor: "spectre",
    utility: "frag",
    mods: null,
};

/** Fitted upgrades on owned rifles, by rifle then slot. */
export const FITTED: Record<string, Partial<Record<AttachmentSlot, string>>> = {
    mx4: { scope: "scope-1", clip: "clip-1" },
    srs9: { scope: "scope-2" },
};

/** `ghosts::weapon`: one upgrade of each kind, three at most. */
export const MAX_FITTINGS = 3;
