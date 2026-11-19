// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked economy: tiers from the rating, the credit budget per mode, presets,
 * item prices and the checks on a squad. Pure data and functions; no React, no
 * chain. The signatures here are the contract with the Play screens: extend them,
 * do not break them.
 *
 * Built to be enforced by a contract later with three checks and no preset logic:
 * the squad has the mode's size, every item is unlocked at the tier, and the
 * prices add up to no more than the budget. Presets are a starting point for the
 * builder; any slot can be swapped. The numbers were tuned with the balance
 * simulation in `app/scripts/play-sim/` (see `docs/plans/play-modes-economy.md`).
 */

import { fieldStats, type Stats } from "@ghosts/squad/stats";

import catalog from "../../../../../packages/catalog/items.json" with { type: "json" };

export type Mode = "3x3" | "4x4";
export type Slot = "weapon" | "armor" | "utility";

/** What one virtual unit carries, by catalog id (`packages/catalog/items.json`). */
export type Loadout = {
    /** The preset it started from. */
    preset: string;
    weapon: string;
    armor: string;
    utility: string | null;
};

export type Tier = {
    id: string;
    name: string;
    /** Rating band: `min` inclusive, `max` exclusive, null for no upper bound. */
    min: number;
    max: number | null;
    budget: Record<Mode, number>;
    /** Every item a squad may carry at this tier, by catalog id. */
    items: string[];
    /** The items this tier adds to the one below it. */
    unlocks: string[];
    /** One line on what the tier is about. */
    summary: string;
};

export type Item = {
    id: string;
    slot: Slot;
    name: string;
    price: number;
    /** One or two sentences from the catalog. */
    description: string;
    /** The lowest tier that unlocks it. */
    tier: string;
};

export type Preset = {
    id: string;
    name: string;
    /** One line on what the unit is for. */
    role: string;
    loadout: Loadout;
    /** The slots a player may change on it. */
    swaps: Slot[];
};

export type Issue = {
    kind: "over-budget" | "locked" | "size" | "illegal";
    /** Index of the unit in the squad, when the issue is about one. */
    unit?: number;
    slot?: Slot;
    /** The catalog id the issue is about, when there is one. */
    item?: string;
    message: string;
};

/** The numbers a unit fights with; the same ones a match would use. */
export type UnitStats = {
    hp: number;
    armor: number;
    mobility: number;
    aim: number;
    /** A normal hit, low to high, as the match readout shows it (crits add half the damage). */
    damage: [number, number];
    /** Tiles at which the weapon fires at its own aim; closer adds, further takes away. */
    range: number;
    /** Chance in percent to dodge a hit that can be dodged. */
    dodge: number;
    /** Chance in percent that a hit is critical. */
    critChance: number;
    /** Shots before a reload. */
    ammo: number;
    /** Grenades carried for the match. */
    grenades: number;
};

// === Items ===

/** Item prices in credits, by catalog id. Only these can be carried in ranked. */
export const PRICES: Readonly<Record<string, number>> = {
    "rifle-1": 20,
    "rifle-2": 40,
    "rifle-3": 60,
    "armor-1": 10,
    "armor-2": 25,
    "armor-3": 45,
    "frag-grenade": 10,
};

const SLOT_OF: Record<string, Slot> = { weapon: "weapon", armor: "armor", utility: "utility" };

// === Tiers ===

const ROOKIE_ITEMS = ["rifle-1", "armor-1", "armor-2", "frag-grenade"];

type TierSpec = Omit<Tier, "items">;

const TIER_SPECS: TierSpec[] = [
    {
        id: "rookie",
        name: "Rookie",
        min: 0,
        max: 1400,
        budget: { "3x3": 125, "4x4": 165 },
        unlocks: ROOKIE_ITEMS,
        summary: "Standard rifles, light and medium armor, grenades.",
    },
    {
        id: "contractor",
        name: "Contractor",
        min: 1400,
        max: 1650,
        budget: { "3x3": 150, "4x4": 200 },
        unlocks: ["rifle-2"],
        summary: "Adds the sharpshooter rifle.",
    },
    {
        id: "operative",
        name: "Operative",
        min: 1650,
        max: 1900,
        budget: { "3x3": 190, "4x4": 255 },
        unlocks: ["armor-3", "rifle-3"],
        summary: "Adds heavy armor and the plasma rifle.",
    },
    {
        id: "elite",
        name: "Elite",
        min: 1900,
        max: null,
        budget: { "3x3": 240, "4x4": 320 },
        unlocks: [],
        summary: "Everything, with the largest budget.",
    },
];

/** Every tier, lowest first. */
export const TIERS: readonly Tier[] = TIER_SPECS.map((spec, i) => ({
    ...spec,
    items: TIER_SPECS.slice(0, i + 1).flatMap((t) => t.unlocks),
}));

const ITEMS: Item[] = Object.entries(PRICES).map(([id, price]) => {
    const entry = catalog.items.find((item) => item.id === id);
    if (!entry || !SLOT_OF[entry.type]) throw new Error(`Not a ranked item: ${id}`);
    return {
        id,
        slot: SLOT_OF[entry.type],
        name: entry.name,
        price,
        description: entry.description,
        tier: TIERS.find((t) => t.unlocks.includes(id))!.id,
    };
});

// === Presets ===

const ALL_SLOTS: Slot[] = ["weapon", "armor", "utility"];

/** Every preset; `presetsFor` keeps those whose items the tier unlocks. */
export const PRESETS: readonly Preset[] = [
    {
        id: "recruit",
        name: "Recruit",
        role: "A rifle and light armor: the cheapest unit that can hold a line.",
        loadout: { preset: "recruit", weapon: "rifle-1", armor: "armor-1", utility: null },
        swaps: ALL_SLOTS,
    },
    {
        id: "runner",
        name: "Runner",
        role: "Light armor to stay quick and dodge, a grenade to flush cover.",
        loadout: { preset: "runner", weapon: "rifle-1", armor: "armor-1", utility: "frag-grenade" },
        swaps: ALL_SLOTS,
    },
    {
        id: "assault",
        name: "Assault",
        role: "Medium armor, rifle and grenade: the line unit that trades well up close.",
        loadout: {
            preset: "assault",
            weapon: "rifle-1",
            armor: "armor-2",
            utility: "frag-grenade",
        },
        swaps: ALL_SLOTS,
    },
    {
        id: "sniper",
        name: "Sniper",
        role: "Sharpshooter rifle from range; spends nothing on a utility.",
        loadout: { preset: "sniper", weapon: "rifle-2", armor: "armor-1", utility: null },
        swaps: ALL_SLOTS,
    },
    {
        id: "heavy",
        name: "Heavy",
        role: "Plasma rifle in heavy armor: slow, hard to put down, hits hardest.",
        loadout: { preset: "heavy", weapon: "rifle-3", armor: "armor-3", utility: null },
        swaps: ALL_SLOTS,
    },
];

export const squadSize = (mode: Mode): number => (mode === "3x3" ? 3 : 4);

export function tierOf(rating: number): Tier {
    // Below every band (a negative rating) is the lowest tier; above every band the highest.
    return (
        TIERS.find((t) => rating >= t.min && (t.max === null || rating < t.max)) ??
        (rating < TIERS[0].min ? TIERS[0] : TIERS[TIERS.length - 1])
    );
}

/**
 * The rating a match between two players is priced at: the lower one, so nobody
 * meets gear they have not unlocked and both build to the same budget.
 */
export const matchRating = (a: number, b: number): number => Math.min(a, b);

export function budgetOf(rating: number, mode: Mode): number {
    return tierOf(rating).budget[mode];
}

const unlocked = (rating: number, id: string | null) =>
    id === null || tierOf(rating).items.includes(id);

/** Presets a player at this rating may field. */
export function presetsFor(rating: number): Preset[] {
    return PRESETS.filter(({ loadout }) =>
        [loadout.weapon, loadout.armor, loadout.utility].every((id) => unlocked(rating, id)),
    );
}

/** Items a player at this rating may put in a slot. */
export function itemsFor(rating: number, slot: Slot): Item[] {
    return ITEMS.filter((item) => item.slot === slot && unlocked(rating, item.id));
}

/** Every ranked item, whatever the tier. */
export const allItems = (): Item[] => [...ITEMS];

export function itemOf(id: string): Item | undefined {
    return ITEMS.find((item) => item.id === id);
}

export const presetOf = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

export function priceOf(loadout: Loadout): number {
    return [loadout.weapon, loadout.armor, loadout.utility].reduce(
        (sum, id) => sum + (id ? (itemOf(id)?.price ?? 0) : 0),
        0,
    );
}

/** One slot where a unit differs from the preset it started from. */
export type Change = { slot: Slot; from: string | null; to: string | null };

const nameOfItem = (id: string | null): string | null => (id ? (itemOf(id)?.name ?? id) : null);

/**
 * How a unit differs from its preset's own loadout, slot by slot, in item
 * names. Empty for an unchanged unit and for one whose preset is not listed.
 */
export function changesFrom(loadout: Loadout): Change[] {
    const base = presetOf(loadout.preset)?.loadout;
    if (!base) return [];
    return ALL_SLOTS.filter((slot) => base[slot] !== loadout[slot]).map((slot) => ({
        slot,
        from: nameOfItem(base[slot]),
        to: nameOfItem(loadout[slot]),
    }));
}

/** `Assault`, or `Assault · modified` once any slot has been swapped. */
export function presetLabel(loadout: Loadout): string {
    const name = presetOf(loadout.preset)?.name ?? loadout.preset;
    return changesFrom(loadout).length > 0 ? `${name} · modified` : name;
}

/** `Armor: Light Armor instead of Medium Armor`, one line per change joined with a middle dot. */
export function changesText(loadout: Loadout): string {
    return changesFrom(loadout)
        .map(
            (c) =>
                `${c.slot.charAt(0).toUpperCase()}${c.slot.slice(1)}: ${c.to ?? "none"} instead of ${c.from ?? "none"}`,
        )
        .join(" · ");
}

/** The lowest tier that unlocks every item of a loadout, or null when none does. */
export function unlockTierOf(loadout: Loadout): Tier | null {
    const ids = [loadout.weapon, loadout.armor, loadout.utility].filter((id): id is string => !!id);
    return TIERS.find((t) => ids.every((id) => t.items.includes(id))) ?? null;
}

export const squadPrice = (squad: Loadout[]): number =>
    squad.reduce((sum, unit) => sum + priceOf(unit), 0);

const SLOT_NAMES: Record<Slot, string> = { weapon: "weapon", armor: "armor", utility: "utility" };

export function validateSquad(squad: Loadout[], rating: number, mode: Mode): Issue[] {
    const issues: Issue[] = [];
    const tier = tierOf(rating);
    if (squad.length !== squadSize(mode))
        issues.push({ kind: "size", message: `A ${mode} squad has ${squadSize(mode)} units.` });
    squad.forEach((unit, i) => {
        const preset = presetOf(unit.preset);
        if (!preset)
            issues.push({ kind: "illegal", unit: i, message: `Unit ${i + 1} has no preset.` });
        for (const slot of ALL_SLOTS) {
            const id = unit[slot];
            if (id === null) {
                if (slot !== "utility")
                    issues.push({
                        kind: "illegal",
                        unit: i,
                        slot,
                        message: `Unit ${i + 1} needs a ${SLOT_NAMES[slot]}.`,
                    });
                continue;
            }
            const item = itemOf(id);
            if (!item || item.slot !== slot) {
                issues.push({
                    kind: "illegal",
                    unit: i,
                    slot,
                    item: id,
                    message: `Unit ${i + 1} cannot carry that as a ${SLOT_NAMES[slot]}.`,
                });
                continue;
            }
            if (preset && !preset.swaps.includes(slot) && preset.loadout[slot] !== id)
                issues.push({
                    kind: "illegal",
                    unit: i,
                    slot,
                    item: id,
                    message: `The ${preset.name} keeps its ${SLOT_NAMES[slot]}.`,
                });
            if (!tier.items.includes(id))
                issues.push({
                    kind: "locked",
                    unit: i,
                    slot,
                    item: id,
                    message: `${item.name} unlocks at ${TIERS.find((t) => t.id === item.tier)!.name}.`,
                });
        }
    });
    const total = squadPrice(squad);
    const budget = tier.budget[mode];
    if (total > budget)
        issues.push({
            kind: "over-budget",
            message: `The squad costs ${total} credits; the budget is ${budget}.`,
        });
    return issues;
}

// === Field stats ===

/** The squad catalog's id for a ranked item (`clientIds` in the catalog). */
const clientId = (id: string | null): string | null =>
    id === null ? null : (catalog.items.find((item) => item.id === id)?.clientIds?.[0] ?? null);

/**
 * The loadout as the engine's `Kit` and a recruit's equipment name it (squad
 * catalog ids: `mx4`, `spectre`, `frag`...), a Rookie with no fittings.
 */
export function kitOf(loadout: Loadout): {
    primary: string | null;
    armor: string | null;
    utility: string | null;
} {
    return {
        primary: clientId(loadout.weapon),
        armor: clientId(loadout.armor),
        utility: clientId(loadout.utility),
    };
}

/** An action a unit carries: the catalog's action id and its uses, null for unlimited. */
export type FieldAction = { kind: string; uses: number | null };

/**
 * The unit a loadout makes in a match, as `unit::from_recruit` builds it: a
 * Rookie's stats plus the weapon's, then the armor's (`fieldStats`, the same
 * code the demo and the Armory use), and the actions: Move, Attack and Reload
 * from the weapon, then whatever the utility grants (`items.json`).
 */
export function fieldUnit(loadout: Loadout): { stats: Stats; actions: FieldAction[] } {
    const kit = kitOf(loadout);
    const stats = fieldStats({
        equipment: { primary: kit.primary, sidearm: null, armor: kit.armor, utility: kit.utility },
        attachments: {},
        rank: undefined,
    });
    const utility = catalog.items.find((item) => item.id === loadout.utility);
    const actions: FieldAction[] = [
        { kind: "Move", uses: null },
        ...(kit.primary
            ? [
                  { kind: "Attack", uses: null },
                  { kind: "Reload", uses: null },
              ]
            : []),
        ...(utility?.actions ?? []).map((a) => ({ kind: a.kind, uses: a.uses ?? null })),
    ];
    return { stats, actions };
}

export function unitStats(loadout: Loadout): UnitStats {
    const { stats: s, actions } = fieldUnit(loadout);
    return {
        hp: s.health,
        armor: s.armor,
        mobility: s.mobility,
        aim: s.aim,
        // the readout of `deployedIntel` in the engine
        damage: [Math.max(0, s.damage - s.spread), s.damage + s.spread + (s.plusOne > 0 ? 1 : 0)],
        range: s.range,
        dodge: s.dodge,
        critChance: s.critChance,
        ammo: s.ammo,
        grenades: actions
            .filter((a) => a.kind === "Grenade")
            .reduce((sum, a) => sum + (a.uses ?? 0), 0),
    };
}

/** For each unit of the default squad, the presets to try, best first. */
const DEFAULT_PLAN: string[][] = [
    ["assault", "runner", "recruit"],
    ["sniper", "runner", "recruit"],
    ["runner", "recruit"],
    ["heavy", "assault", "runner", "recruit"],
];

/** A legal squad to start the builder from; `budget` defaults to the tier's. */
export function defaultSquad(
    rating: number,
    mode: Mode,
    budget: number = budgetOf(rating, mode),
): Loadout[] {
    const open = presetsFor(rating);
    const size = squadSize(mode);
    const cheapest = [...open].sort((a, b) => priceOf(a.loadout) - priceOf(b.loadout))[0];
    const squad = Array.from({ length: size }, () => ({ ...cheapest.loadout }));
    for (let i = 0; i < size; i++) {
        for (const id of DEFAULT_PLAN[i % DEFAULT_PLAN.length]) {
            const preset = open.find((p) => p.id === id);
            if (!preset) continue;
            const next = squad.map((unit, j) => (j === i ? { ...preset.loadout } : unit));
            if (squadPrice(next) <= budget) {
                squad[i] = next[i];
                break;
            }
        }
    }
    // spend what is left, one item at a time: armor first, then weapons, then grenades
    for (const [slot, ladder] of UPGRADES)
        for (let i = 0; i < size; i++)
            for (const id of [...ladder].reverse()) {
                const current = ladder.indexOf(squad[i][slot] ?? "");
                if (ladder.indexOf(id) <= current || !unlocked(rating, id)) continue;
                const next = { ...squad[i], [slot]: id };
                if (squadPrice(squad) - priceOf(squad[i]) + priceOf(next) <= budget) {
                    squad[i] = next;
                    break;
                }
            }
    return squad;
}

/** What `defaultSquad` upgrades into with credits left over, each ladder best last. */
const UPGRADES: [Slot, string[]][] = [
    ["armor", ["armor-1", "armor-2", "armor-3"]],
    ["weapon", ["rifle-1", "rifle-2", "rifle-3"]],
    ["utility", ["", "frag-grenade"]],
];
