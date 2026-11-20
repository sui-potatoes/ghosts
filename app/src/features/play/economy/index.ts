// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked economy: tiers from the rating, the credit budget per size, presets,
 * item prices and the checks on a squad. Pure data and functions; no React, no
 * network. The numbers are the contract's `Rules` (`ghosts::rules`): the published
 * values are built in (`DEFAULT_RULES`), and the live object replaces them once
 * read (`applyRules`), so the admin's retuning reaches the builder without a new
 * app. The checks are the contract's `check_squad`: the squad has the size, every
 * item is unlocked at the tier, and the prices add up to no more than the budget.
 * Presets are a starting point for the builder; any slot can be swapped.
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
    /** The lowest tier that unlocks it; null when no tier does. */
    tier: string | null;
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

// === The rules ===

/**
 * The economy as the contract's `Rules` set it: prices, the tier each item unlocks
 * at, the four tiers with their budgets, which sizes have a level, the placement
 * floor and the two clocks of ranked play. Read live from the shared `Rules`
 * object (`rulesFromChain`, applied by `applyRules`), so a balance change by the
 * holder of the `RulesCap` needs no new app. `DEFAULT_RULES` is what the contract
 * publishes with: the offline and fixture value, tested equal to a Move-printed
 * `Rules` in `tests/ranked-chain.test.ts`.
 */
export type EconomyRules = {
    /** `Rules.version`: 0 for the built-in default. */
    version: number;
    /** Price in credits, by catalog id. */
    prices: Record<string, number>;
    /** The lowest tier index an item is unlocked at; past the last tier, locked for everyone. */
    unlock: Record<string, number>;
    /** Lowest first: where each tier starts and its budget per size. */
    tiers: { min: number; budget: Record<Mode, number> }[];
    /** Whether a size has a level: one without cannot be queued for. */
    open: Record<Mode, boolean>;
    /** While fewer ranked games are finished, the tier is at least `tier`. */
    placement: { games: number; tier: number };
    /** How long the player a match found waiting has to show their squad. */
    revealLimitMs: number;
    /** How long after a rating reset the next one can be. */
    resetCooldownMs: number;
};

/** The catalog ids the contract's item lists name, index for index. */
const RULE_ITEMS = {
    weapons: ["rifle-1", "rifle-2", "rifle-3"],
    armor: ["armor-1", "armor-2", "armor-3"],
    utilities: ["frag-grenade", "flashbang", "smoke-grenade"],
} as const;

/** `rules::new` in `move/packages/ghosts/sources/rules.move`. */
export const DEFAULT_RULES: EconomyRules = {
    version: 0,
    prices: {
        "rifle-1": 20,
        "rifle-2": 40,
        "rifle-3": 60,
        "armor-1": 10,
        "armor-2": 25,
        "armor-3": 45,
        "frag-grenade": 10,
        flashbang: 10,
        "smoke-grenade": 10,
    },
    unlock: {
        "rifle-1": 0,
        "rifle-2": 1,
        "rifle-3": 2,
        "armor-1": 0,
        "armor-2": 0,
        "armor-3": 2,
        "frag-grenade": 0,
        flashbang: 0,
        "smoke-grenade": 0,
    },
    tiers: [
        { min: 0, budget: { "3x3": 125, "4x4": 165 } },
        { min: 1400, budget: { "3x3": 150, "4x4": 200 } },
        { min: 1650, budget: { "3x3": 190, "4x4": 255 } },
        { min: 1900, budget: { "3x3": 240, "4x4": 320 } },
    ],
    open: { "3x3": true, "4x4": false },
    placement: { games: 5, tier: 1 },
    revealLimitMs: 60_000,
    resetCooldownMs: 7 * 86_400_000,
};

/** The `Rules` fields the economy reads, as `ghosts::rules::Rules` decodes (`Rules` in `src/chain/bcs.ts`). */
export type ChainRulesLike = {
    version: number;
    weapons: readonly { price: number; minTier: number }[];
    armor: readonly { price: number; minTier: number }[];
    utilities: readonly { price: number; minTier: number }[];
    tiers: readonly { minRating: string | number | bigint; budgets: readonly number[] }[];
    sizes: readonly { units: number; level?: string | null }[];
    placementGames: number;
    placementTier: number;
    revealLimitMs: string | number | bigint;
    resetCooldownMs: string | number | bigint;
};

const MODE_OF_UNITS: Record<number, Mode> = { 3: "3x3", 4: "4x4" };

/** The economy a decoded `Rules` object sets. */
export function rulesFromChain(rules: ChainRulesLike): EconomyRules {
    const prices: Record<string, number> = {};
    const unlock: Record<string, number> = {};
    for (const list of ["weapons", "armor", "utilities"] as const)
        RULE_ITEMS[list].forEach((id, i) => {
            const item = rules[list][i];
            if (!item) return;
            prices[id] = item.price;
            unlock[id] = item.minTier;
        });
    const open: Record<Mode, boolean> = { "3x3": false, "4x4": false };
    const column: Partial<Record<Mode, number>> = {};
    rules.sizes.forEach((size, j) => {
        const mode = MODE_OF_UNITS[size.units];
        if (!mode) return;
        open[mode] = !!size.level;
        column[mode] = j;
    });
    const budgetOfColumn = (budgets: readonly number[], mode: Mode) =>
        column[mode] === undefined ? 0 : (budgets[column[mode]!] ?? 0);
    return {
        version: rules.version,
        prices,
        unlock,
        tiers: rules.tiers.map((tier) => ({
            min: Number(tier.minRating),
            budget: {
                "3x3": budgetOfColumn(tier.budgets, "3x3"),
                "4x4": budgetOfColumn(tier.budgets, "4x4"),
            },
        })),
        open,
        placement: { games: rules.placementGames, tier: rules.placementTier },
        revealLimitMs: Number(rules.revealLimitMs),
        resetCooldownMs: Number(rules.resetCooldownMs),
    };
}

const SLOT_OF: Record<string, Slot> = { weapon: "weapon", armor: "armor", utility: "utility" };

/** What each tier is called, lowest first; the contract numbers them. */
const TIER_NAMES = [
    { id: "rookie", name: "Rookie" },
    { id: "contractor", name: "Contractor" },
    { id: "operative", name: "Operative" },
    { id: "elite", name: "Elite" },
];

/** The lines the published tiers carry; a tier whose unlocks differ gets one built from them. */
const TIER_SUMMARIES: Record<string, string> = {
    "rifle-1,armor-1,armor-2,frag-grenade,flashbang,smoke-grenade":
        "Standard rifles, light and medium armor, frag, flash and smoke grenades",
    "rifle-2": "Adds the sharpshooter rifle",
    "armor-3,rifle-3": "Adds heavy armor and the plasma rifle",
    "": "Everything, with the largest budget",
};

/** The catalog's name for an item, lowercased mid-sentence. */
const catalogName = (id: string) => catalog.items.find((item) => item.id === id)?.name ?? id;

function summaryOf(unlocks: string[], first: boolean): string {
    const known = TIER_SUMMARIES[unlocks.join(",")];
    if (known) return known;
    const names = unlocks.map(catalogName);
    const list =
        names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    return first ? `${list}` : `Adds ${list}`;
}

/** The order unlocks are listed in, as the published tiers list them. */
const UNLOCK_ORDER = [
    "rifle-1",
    "armor-1",
    "armor-2",
    "armor-3",
    "rifle-2",
    "rifle-3",
    "frag-grenade",
    "flashbang",
    "smoke-grenade",
];

let rules: EconomyRules = DEFAULT_RULES;

/** Item prices in credits, by catalog id. Only these can be carried in ranked. */
export let PRICES: Readonly<Record<string, number>> = {};
/** Every tier, lowest first. */
export let TIERS: readonly Tier[] = [];
let ITEMS: Item[] = [];

function build(next: EconomyRules) {
    rules = next;
    PRICES = { ...next.prices };
    const ids = UNLOCK_ORDER.filter((id) => id in next.prices);
    TIERS = next.tiers.map((tier, i) => {
        const named = TIER_NAMES[i] ?? { id: `tier-${i}`, name: `Rank ${i + 1}` };
        const unlocks = ids.filter((id) => next.unlock[id] === i);
        return {
            ...named,
            min: tier.min,
            max: next.tiers[i + 1]?.min ?? null,
            budget: { ...tier.budget },
            unlocks,
            items: ids.filter((id) => next.unlock[id] <= i),
            summary: summaryOf(unlocks, i === 0),
        };
    });
    ITEMS = ids.map((id) => {
        const entry = catalog.items.find((item) => item.id === id);
        if (!entry || !SLOT_OF[entry.type]) throw new Error(`Not a ranked item: ${id}`);
        return {
            id,
            slot: SLOT_OF[entry.type],
            name: entry.name,
            price: next.prices[id],
            description: entry.description,
            tier: TIERS[next.unlock[id]]?.id ?? null,
        };
    });
}

build(DEFAULT_RULES);

const listeners = new Set<() => void>();

/** Run the economy on these rules: the live `Rules` once read. Screens re-render through `useEconomy`. */
export function applyRules(next: EconomyRules) {
    if (JSON.stringify(next) === JSON.stringify(rules)) return;
    build(next);
    listeners.forEach((listener) => listener());
}

/** The rules the economy runs on now. */
export const economyRules = (): EconomyRules => rules;

/** For `useSyncExternalStore`: a change of rules. */
export function subscribeEconomy(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Whether a size has a level, so it can be queued for. */
export const sizeOpen = (mode: Mode): boolean => rules.open[mode];

/**
 * A rating that falls in the tier a player stands at: their own, raised to the
 * placement tier's floor while they have finished fewer than the placement games.
 * Every function here that takes a rating gives the contract's `tier_of` for it.
 */
export function standingRating(rating: number, games: number): number {
    if (games >= rules.placement.games) return rating;
    const floor = TIERS[rules.placement.tier]?.min ?? 0;
    return Math.max(rating, floor);
}

// === Presets ===

const ALL_SLOTS: Slot[] = ["weapon", "armor", "utility"];

/** Every preset; `presetsFor` keeps those whose items the tier unlocks. */
export const PRESETS: readonly Preset[] = [
    {
        id: "recruit",
        name: "Recruit",
        role: "A rifle and light armor: the cheapest unit that can hold a line",
        loadout: { preset: "recruit", weapon: "rifle-1", armor: "armor-1", utility: null },
        swaps: ALL_SLOTS,
    },
    {
        id: "runner",
        name: "Runner",
        role: "Light armor to stay quick and dodge, a grenade to flush cover",
        loadout: { preset: "runner", weapon: "rifle-1", armor: "armor-1", utility: "frag-grenade" },
        swaps: ALL_SLOTS,
    },
    {
        id: "assault",
        name: "Assault",
        role: "Medium armor, rifle and grenade: the line unit that trades well up close",
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
        role: "Sharpshooter rifle from range; spends nothing on a utility",
        loadout: { preset: "sniper", weapon: "rifle-2", armor: "armor-1", utility: null },
        swaps: ALL_SLOTS,
    },
    {
        id: "heavy",
        name: "Heavy",
        role: "Plasma rifle in heavy armor: slow, hard to put down, hits hardest",
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

/** The standard budgets for a size, one per tier, lowest first. */
export function standardBudgets(mode: Mode): { tier: Tier; credits: number }[] {
    return TIERS.map((tier) => ({ tier, credits: tier.budget[mode] }));
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

/**
 * The checks on a squad. `budget` undefined is the rating's tier budget (ranked);
 * a number is that many credits (a friendly match's rule); null is no credit limit.
 * Gear is always checked against the rating's tier.
 */
export function validateSquad(
    squad: Loadout[],
    rating: number,
    mode: Mode,
    budget?: number | null,
): Issue[] {
    const issues: Issue[] = [];
    const tier = tierOf(rating);
    if (squad.length !== squadSize(mode))
        issues.push({ kind: "size", message: `A ${mode} squad has ${squadSize(mode)} units` });
    squad.forEach((unit, i) => {
        const preset = presetOf(unit.preset);
        if (!preset)
            issues.push({ kind: "illegal", unit: i, message: `Unit ${i + 1} has no preset` });
        for (const slot of ALL_SLOTS) {
            const id = unit[slot];
            if (id === null) {
                if (slot !== "utility")
                    issues.push({
                        kind: "illegal",
                        unit: i,
                        slot,
                        message: `Unit ${i + 1} needs a ${SLOT_NAMES[slot]}`,
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
                    message: `Unit ${i + 1} cannot carry that as a ${SLOT_NAMES[slot]}`,
                });
                continue;
            }
            if (preset && !preset.swaps.includes(slot) && preset.loadout[slot] !== id)
                issues.push({
                    kind: "illegal",
                    unit: i,
                    slot,
                    item: id,
                    message: `The ${preset.name} keeps its ${SLOT_NAMES[slot]}`,
                });
            if (!tier.items.includes(id))
                issues.push({
                    kind: "locked",
                    unit: i,
                    slot,
                    item: id,
                    message: item.tier
                        ? `${item.name} unlocks at ${TIERS.find((t) => t.id === item.tier)!.name}`
                        : `${item.name} is not offered`,
                });
        }
    });
    const total = squadPrice(squad);
    const limit = budget === undefined ? tier.budget[mode] : budget;
    if (limit !== null && total > limit)
        issues.push({
            kind: "over-budget",
            message: `The squad costs ${total} credits; the budget is ${limit}`,
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

/** The actions that throw a grenade: the frag grenade, the flashbang and the smoke grenade. */
const GRENADE_KINDS = ["Grenade", "Flashbang", "SmokeGrenade"];

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
            .filter((a) => GRENADE_KINDS.includes(a.kind))
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
