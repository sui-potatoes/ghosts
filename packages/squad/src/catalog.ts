// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Equipment, Slot } from "./types";
export const SLOT_NAMES: Record<Slot, string> = {
    primary: "Primary weapon",
    sidearm: "Sidearm",
    armor: "Body armor",
    utility: "Utility",
};
export const SLOTS = Object.keys(SLOT_NAMES) as Slot[];
export const EQUIPMENT: Equipment[] = [
    {
        id: "mx4",
        name: "MX–4 Carbine",
        type: "ASSAULT RIFLE",
        slot: "primary",
        description:
            "Compact, dependable. The weapon you reach for when the contract gets complicated.",
        weight: 3.2,
        stat: "2–6 damage · 3 rounds · 10% crit",
        model: "rifle",
    },
    {
        id: "srs9",
        name: "SRS–9 Precision",
        type: "MARKSMAN RIFLE",
        slot: "primary",
        description: "A long sightline and a steady hand. Built for deliberate engagements.",
        weight: 4.7,
        stat: "4–6 damage · 3 rounds · 20% crit",
        model: "sniper",
    },
    {
        id: "k12",
        name: "K–12 Sidearm",
        type: "SERVICE PISTOL",
        slot: "sidearm",
        description: "A lightweight fallback for close encounters and depleted magazines.",
        weight: 0.9,
        stat: "2–4 damage · 6 rounds",
        model: "pistol",
    },
    {
        id: "spectre",
        name: "Spectre Carrier",
        type: "LIGHT ARMOR",
        slot: "armor",
        description: "The original fitted carrier. Flexible coverage without sacrificing movement.",
        weight: 3.4,
        stat: "+1 armor · +10% dodge",
        model: "armor",
    },
    {
        id: "nyx",
        name: "NYX / Veil",
        type: "LIGHT ARMOR",
        slot: "armor",
        description:
            "Close-fitting ceramic plates over woven graphite. Articulated ribs, gauntlets and contoured leg protection for the quiet approach.",
        weight: 2.6,
        stat: "+1 armor · +10% dodge",
        model: "assassin-armor",
    },
    {
        id: "nyx-mid",
        name: "NYX / Shade",
        type: "MEDIUM ARMOR",
        slot: "armor",
        description:
            "Overlapping shoulder shells, wrapped thigh protection and a reinforced cuirass. Built to move through contested ground.",
        weight: 4.8,
        stat: "+2 armor",
        model: "assassin-mid",
    },
    {
        id: "nyx-heavy",
        name: "NYX / Wraith",
        type: "HEAVY ARMOR",
        slot: "armor",
        description:
            "Continuous breach cuirass, reinforced shoulder arches and twin dorsal power housings. Layered limb shields give Wraith its imposing silhouette.",
        weight: 7.2,
        stat: "+3 armor · +1 health · −1 mobility · −10% dodge",
        model: "assassin-heavy",
    },
    {
        id: "frag",
        name: "M7 Fragmentation",
        type: "THROWABLE",
        slot: "utility",
        description: "One grenade, one opportunity to move a stubborn target.",
        weight: 0.5,
        stat: "5 damage · area effect",
        model: "grenade",
    },
    {
        id: "trauma",
        name: "Field Trauma Kit",
        type: "MEDICAL",
        slot: "utility",
        description: "Compact dressings and emergency supplies. Get your people home.",
        weight: 0.8,
        stat: "Restore 4 health",
        model: "medkit",
    },
];
export const itemById = (id: string | null) => EQUIPMENT.find((item) => item.id === id);
export const INITIAL_STOCK: Record<string, number> = {
    mx4: 4,
    srs9: 2,
    k12: 6,
    spectre: 6,
    nyx: 4,
    "nyx-mid": 4,
    "nyx-heavy": 4,
    frag: 4,
    trauma: 3,
};
