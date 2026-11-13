// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Fictional requisition stock for the sample screen; nothing here is read from the chain. */

export type StatKey =
    "damage" | "aim" | "crit" | "range" | "ammo" | "weight" | "armor" | "dodge" | "health";

export type Stat = {
    key: StatKey;
    value: number;
    text?: string;
};

export type StatDef = {
    label: string;
    max: number;
    unit?: string;
    lowerIsBetter?: boolean;
    hint: string;
};

export const STATS: Record<StatKey, StatDef> = {
    damage: {
        label: "Damage",
        max: 10,
        hint: "Damage per hit; the upper figure on a critical roll is added on top",
    },
    aim: {
        label: "Aim",
        max: 30,
        unit: "%",
        hint: "Added to the operative's base aim on every shot",
    },
    crit: { label: "Critical", max: 40, unit: "%", hint: "Chance a hit lands as a critical" },
    range: {
        label: "Range",
        max: 12,
        unit: "tiles",
        hint: "Optimal engagement distance; aim falls off past it",
    },
    ammo: { label: "Magazine", max: 8, unit: "rds", hint: "Shots before a reload costs an action" },
    weight: {
        label: "Weight",
        max: 8,
        unit: "kg",
        lowerIsBetter: true,
        hint: "Counts against the operative's carry limit",
    },
    armor: { label: "Armor", max: 4, hint: "Damage absorbed from every hit" },
    dodge: { label: "Dodge", max: 30, unit: "%", hint: "Chance a hit is turned into a graze" },
    health: {
        label: "Health",
        max: 4,
        unit: "+hp",
        hint: "Added to the operative's maximum health",
    },
};

export type Item = {
    id: string;
    name: string;
    kind: string;
    serial: string;
    description: string;
    stats: Stat[];
    /** Credit cost to requisition; owned items have none. */
    cost?: number;
    owned?: boolean;
    /** Locked behind something other than credit. */
    clearance?: string;
    /** Fitting slots; omitted for gear that takes none. */
    slots?: string[];
};

export type Section = "weapons" | "armor" | "utility" | "mods";

export const SECTIONS: { id: Section; label: string }[] = [
    { id: "weapons", label: "Weapons" },
    { id: "armor", label: "Armor" },
    { id: "utility", label: "Utility" },
    { id: "mods", label: "Mods" },
];

const rifleSlots = ["Optic", "Muzzle", "Magazine"];

export const STOCK: Record<Section, Item[]> = {
    weapons: [
        {
            id: "mx4",
            name: "Standard Rifle",
            kind: "Assault rifle",
            serial: "MX-4",
            description:
                "Compact, dependable. The weapon you reach for when the contract gets complicated.",
            owned: true,
            slots: rifleSlots,
            stats: [
                { key: "damage", value: 6, text: "2–6" },
                { key: "aim", value: 10 },
                { key: "crit", value: 10 },
                { key: "range", value: 7 },
                { key: "ammo", value: 3 },
                { key: "weight", value: 3.2 },
            ],
        },
        {
            id: "srs9",
            name: "Sharpshooter Rifle",
            kind: "Marksman rifle",
            serial: "SRS-9",
            description: "A long sightline and a steady hand. Built for deliberate engagements.",
            owned: true,
            slots: rifleSlots,
            stats: [
                { key: "damage", value: 6, text: "4–6" },
                { key: "aim", value: 20 },
                { key: "crit", value: 20 },
                { key: "range", value: 11 },
                { key: "ammo", value: 3 },
                { key: "weight", value: 4.7 },
            ],
        },
        {
            id: "plasma",
            name: "Plasma Rifle",
            kind: "Plasma rifle",
            serial: "HX-P2",
            description: "High damage and critical potential for precise engagements.",
            cost: 1200,
            slots: rifleSlots,
            stats: [
                { key: "damage", value: 7, text: "5–7" },
                { key: "aim", value: 15 },
                { key: "crit", value: 30 },
                { key: "range", value: 8 },
                { key: "ammo", value: 3 },
                { key: "weight", value: 3.2 },
            ],
        },
        {
            id: "vk2",
            name: "VK-2 Carbine",
            kind: "Carbine",
            serial: "VK-2",
            description:
                "Short barrel, short temper. Trades reach for a lighter frame and a deeper magazine.",
            cost: 480,
            slots: ["Optic", "Magazine"],
            stats: [
                { key: "damage", value: 5, text: "2–5" },
                { key: "aim", value: 5 },
                { key: "crit", value: 10 },
                { key: "range", value: 5 },
                { key: "ammo", value: 5 },
                { key: "weight", value: 2.4 },
            ],
        },
        {
            id: "hs12",
            name: "HS-12 Breacher",
            kind: "Shotgun",
            serial: "HS-12",
            description: "Doors, corners, the last two metres of any argument.",
            cost: 650,
            slots: ["Muzzle", "Magazine"],
            stats: [
                { key: "damage", value: 8, text: "4–8" },
                { key: "aim", value: 0 },
                { key: "crit", value: 15 },
                { key: "range", value: 3 },
                { key: "ammo", value: 4 },
                { key: "weight", value: 3.9 },
            ],
        },
        {
            id: "k12",
            name: "K–12 Sidearm",
            kind: "Service pistol",
            serial: "K-12",
            description: "A lightweight fallback for close encounters and depleted magazines.",
            owned: true,
            stats: [
                { key: "damage", value: 4, text: "2–4" },
                { key: "aim", value: 5 },
                { key: "crit", value: 5 },
                { key: "range", value: 5 },
                { key: "ammo", value: 6 },
                { key: "weight", value: 0.9 },
            ],
        },
        {
            id: "arc",
            name: "Arc Lance",
            kind: "Gauss rifle",
            serial: "AL-0",
            description:
                "Helios prototype. A rail and a capacitor bank that takes a full turn to recover.",
            cost: 2600,
            clearance: "Requires Helios clearance III. Complete two Helios contracts.",
            slots: rifleSlots,
            stats: [
                { key: "damage", value: 9, text: "6–9" },
                { key: "aim", value: 25 },
                { key: "crit", value: 25 },
                { key: "range", value: 12 },
                { key: "ammo", value: 1 },
                { key: "weight", value: 6.8 },
            ],
        },
        {
            id: "whisper",
            name: "Whisper SMG",
            kind: "Suppressed SMG",
            serial: "WS-7",
            description: "Integral suppressor. Shots from concealment do not break it.",
            cost: 5400,
            slots: ["Optic"],
            stats: [
                { key: "damage", value: 4, text: "2–4" },
                { key: "aim", value: 10 },
                { key: "crit", value: 15 },
                { key: "range", value: 4 },
                { key: "ammo", value: 6 },
                { key: "weight", value: 2.1 },
            ],
        },
    ],
    armor: [
        {
            id: "spectre",
            name: "Spectre Carrier",
            kind: "Light armor",
            serial: "SP-1",
            description:
                "The original fitted carrier. Flexible coverage without sacrificing movement.",
            owned: true,
            stats: [
                { key: "armor", value: 1 },
                { key: "dodge", value: 10 },
                { key: "health", value: 0 },
                { key: "weight", value: 3.4 },
            ],
        },
        {
            id: "veil",
            name: "NYX / Veil",
            kind: "Light armor",
            serial: "NX-V",
            description:
                "Close-fitting ceramic plates over woven graphite, for the quiet approach.",
            cost: 900,
            stats: [
                { key: "armor", value: 1 },
                { key: "dodge", value: 15 },
                { key: "health", value: 0 },
                { key: "weight", value: 2.6 },
            ],
        },
        {
            id: "shade",
            name: "NYX / Shade",
            kind: "Medium armor",
            serial: "NX-S",
            description:
                "Overlapping shells and a reinforced cuirass. Built to move through contested ground.",
            cost: 1500,
            stats: [
                { key: "armor", value: 2 },
                { key: "dodge", value: 5 },
                { key: "health", value: 1 },
                { key: "weight", value: 4.8 },
            ],
        },
        {
            id: "wraith",
            name: "NYX / Wraith",
            kind: "Heavy armor",
            serial: "NX-W",
            description: "Continuous breach cuirass and twin dorsal power housings.",
            cost: 3200,
            clearance: "Requires a heavy armor rack. Expand the armory first.",
            stats: [
                { key: "armor", value: 3 },
                { key: "dodge", value: 0 },
                { key: "health", value: 1 },
                { key: "weight", value: 7.2 },
            ],
        },
    ],
    utility: [
        {
            id: "frag",
            name: "M7 Fragmentation",
            kind: "Throwable",
            serial: "M7",
            description: "One grenade, one opportunity to move a stubborn target.",
            owned: true,
            stats: [
                { key: "damage", value: 5, text: "5" },
                { key: "range", value: 9 },
                { key: "weight", value: 0.5 },
            ],
        },
        {
            id: "trauma",
            name: "Field Trauma Kit",
            kind: "Medical",
            serial: "FT-3",
            description: "Compact dressings and emergency supplies. Get your people home.",
            cost: 300,
            stats: [
                { key: "health", value: 4, text: "+4" },
                { key: "range", value: 1 },
                { key: "weight", value: 0.8 },
            ],
        },
    ],
    mods: [],
};

/** What VEX carries when the screen opens, per section. */
export const ISSUED: Record<Section, string | null> = {
    weapons: "mx4",
    armor: "spectre",
    utility: "frag",
    mods: null,
};

/** Fitted mods on owned weapons, by weapon then slot. */
export const FITTED: Record<string, Record<string, string>> = {
    mx4: { Optic: "Basic Scope", Magazine: "Expanded Clip" },
    srs9: { Optic: "Advanced Scope" },
};

/** The mod a fitting slot takes when Confirm fits one. */
export const SPARE_MOD: Record<string, string> = {
    Optic: "Laser Sight",
    Muzzle: "Compensator",
    Magazine: "Expanded Clip",
};

export const START_BALANCE = 4850;

export function credit(n: number): string {
    return `₡ ${n.toLocaleString("en-US")}`;
}
