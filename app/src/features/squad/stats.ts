// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Mirror of `commander::stats` in the Sui Potatoes Move package
 * (`packages/commander/sources/recruit/stats.move` there).
 *
 * Fifteen u8 fields packed into one u128 in field order, lowest byte first.
 * A modifier byte with the sign bit set (0x80 | n) means −n. A recruit goes
 * into battle with their own stats plus the primary weapon's plus the armor's,
 * combined the way `unit.move` does it. Sidearm and utility are not part of
 * that value. Nothing here reads the chain; the presets are the ones
 * `commander::items` mints, copied by hand.
 */

import type { Recruit } from "./types";

export const STAT_KEYS = [
    "mobility",
    "aim",
    "health",
    "armor",
    "dodge",
    "defense",
    "damage",
    "spread",
    "plusOne",
    "critChance",
    "canBeDodged",
    "areaSize",
    "envDamage",
    "range",
    "ammo",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

const SIGN = 0x80;
const CAP = 0x7f;

export const EMPTY: Stats = Object.freeze(
    Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Stats,
);

export function stats(partial: Partial<Stats>): Stats {
    return { ...EMPTY, ...partial };
}

/** `stats::default()`: `new(7, 65, 10, 0, 0)`. */
export const RECRUIT_DEFAULT: Stats = stats({ mobility: 7, aim: 65, health: 10 });

/** `stats::add`: zero and −0 modifiers skip, negatives floor at 0, results cap at 127. */
export function add(base: Stats, modifier: Stats): Stats {
    const out = { ...base };
    for (const key of STAT_KEYS) {
        const m = modifier[key];
        if (!m) continue;
        out[key] = m < 0 ? base[key] - Math.min(base[key], -m) : Math.min(base[key] + m, CAP);
    }
    return out;
}

/** The u128 the chain stores; negative values take the sign bit. */
export function pack(s: Stats): bigint {
    let value = 0n;
    STAT_KEYS.forEach((key, i) => {
        const n = s[key];
        const byte = n < 0 ? SIGN + Math.min(-n, CAP) : Math.min(n, 0xff);
        value |= BigInt(byte) << BigInt(i * 8);
    });
    return value;
}

export function unpack(value: bigint): Stats {
    const out = { ...EMPTY };
    STAT_KEYS.forEach((key, i) => {
        const byte = Number((value >> BigInt(i * 8)) & 0xffn);
        out[key] = byte >= SIGN ? SIGN - byte : byte;
    });
    return out;
}

/**
 * `commander::items` presets by catalog id. The armor presets are
 * `items::armor(1..3)`, the rifles `items::rifle(1..2)`. The sidearm has no
 * chain preset yet, so it carries a frontend one in the same encoding.
 */
export const ITEM_STATS: Record<string, Stats> = {
    // items::rifle(1) "Standard Rifle": 4 DMG, 2 SPREAD, +10% CRIT, 1 AREA, 4 RANGE, 3 AMMO
    mx4: unpack(0x03_04_00_01_01_0a_0a_02_04n << 48n),
    // items::rifle(2) "Sharpshooter Rifle": 5 DMG, 1 SPREAD, +20% CRIT, 1 AREA, 5 RANGE, 3 AMMO
    srs9: unpack(0x03_05_00_01_01_14_14_01_05n << 48n),
    // Frontend preset: a service pistol until commander mints one.
    k12: stats({ damage: 3, spread: 1, critChance: 5, canBeDodged: 1, areaSize: 1, range: 3, ammo: 6 }),
    // items::armor(1) "Light Armor": +1 ARM, +10% DODGE
    spectre: stats({ armor: 1, dodge: 10 }),
    nyx: stats({ armor: 1, dodge: 10 }),
    // items::armor(2) "Medium Armor": +2 ARM
    "nyx-mid": stats({ armor: 2 }),
    // items::armor(3) "Heavy Armor": −1 MOB, +1 HP, +3 ARM, −10% DODGE
    "nyx-heavy": stats({ mobility: -1, health: 1, armor: 3, dodge: -10 }),
};

/**
 * The stats a recruit takes into the field, in `unit.move`'s order: the
 * weapon's modifier, then the armor's, each applied to the recruit's own
 * stats. Applying them one after the other is what lets a negative armor
 * modifier (heavy armor's mobility and dodge) reach the recruit.
 */
export function recruitStats(recruit: Recruit): Stats {
    return contributions(recruit).total;
}

export type Source = "weapon" | "armor";

/** What one piece of gear did to one stat, after the chain's floor and cap. */
export interface Contribution {
    source: Source;
    /** Catalog id of the item, or null when the slot is empty. */
    item: string | null;
    /** The modifier the item carries. */
    requested: number;
    /** What actually changed, once floored at 0 or capped at 127. */
    applied: number;
}

/** The field stats with each gear piece's share, in the order the chain applies them. */
export function contributions(recruit: Recruit): {
    total: Stats;
    byStat: Record<StatKey, Contribution[]>;
} {
    const steps: [Source, string | null][] = [
        ["weapon", recruit.equipment.primary],
        ["armor", recruit.equipment.armor],
    ];
    const byStat = Object.fromEntries(
        STAT_KEYS.map((k) => [k, [] as Contribution[]]),
    ) as Record<StatKey, Contribution[]>;
    let total = RECRUIT_DEFAULT;
    for (const [source, item] of steps) {
        const modifier = ITEM_STATS[item ?? ""] ?? EMPTY;
        const next = add(total, modifier);
        for (const key of STAT_KEYS) {
            if (!modifier[key]) continue;
            byStat[key].push({
                source,
                item,
                requested: modifier[key],
                applied: next[key] - total[key],
            });
        }
        total = next;
    }
    return { total, byStat };
}

// === Presentation ===

export type StatGroup = "operative" | "weapon";

export interface StatRow {
    key: StatKey;
    label: string;
    group: StatGroup;
    /** Full bar. */
    max: number;
    unit?: "%" | "tiles";
}

/** What the dossier lists. Damage shows as a range widened by `spread`. */
export const VISIBLE: StatRow[] = [
    { key: "mobility", label: "Mobility", group: "operative", max: 12, unit: "tiles" },
    { key: "aim", label: "Aim", group: "operative", max: 100, unit: "%" },
    { key: "health", label: "Health", group: "operative", max: 20 },
    { key: "armor", label: "Armor", group: "operative", max: 5 },
    { key: "dodge", label: "Dodge", group: "operative", max: 50, unit: "%" },
    { key: "damage", label: "Damage", group: "weapon", max: 12 },
    { key: "critChance", label: "Crit chance", group: "weapon", max: 100, unit: "%" },
    { key: "range", label: "Range", group: "weapon", max: 10, unit: "tiles" },
    { key: "ammo", label: "Ammo", group: "weapon", max: 6 },
];

/** Resolved in the encounter and never listed in the dossier. */
export const CLASSIFIED: StatKey[] = ["defense", "plusOne", "canBeDodged", "areaSize", "envDamage"];

/** The value text for a row: a damage range, a percentage, or the number. */
export function formatStat(row: StatRow, s: Stats): string {
    if (row.key === "damage") {
        if (!s.damage) return "—";
        const low = Math.max(0, s.damage - s.spread);
        return s.spread ? `${low}–${s.damage + s.spread}` : String(s.damage);
    }
    const value = s[row.key];
    return row.unit === "%" ? `${value}%` : String(value);
}
