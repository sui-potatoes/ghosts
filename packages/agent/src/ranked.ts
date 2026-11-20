// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked play, the pure part: the live `Rules` as a plain view, the squad bytes `find_ranked`
 * and `reveal_squad` take, the commitment and its salt, the tier of a player, the squad check
 * of `rules::check_squad` (in its abort order), the unit `unit::from_loadout` builds, the app's
 * presets and a squad generator for bots. It mirrors `ghosts::rules` and `ghosts::unit` in the
 * package source; reads and sends are in `sui.ts` and `contract.ts`.
 *
 * Nothing here hard-codes a price, a tier or a budget: everything is read from the `Rules`, so a
 * retune on chain needs no SDK release. Only the stats an item gives are fixed, as they are in
 * Move (a new item is a new package).
 */

import { toHex } from "@mysten/sui/utils";

import { decodeStats, encodeStats } from "./bcs.ts";
import { blake2b256 } from "./blake2b.ts";
import type { Stats, Unit, UnitActionEntry } from "./types.ts";

// === The rules ===

/** `rules::Item`: a price in credits and the lowest tier it is unlocked at. */
export interface RankedItem {
    price: number;
    minTier: number;
}

/** `rules::Tier`: its lowest rating, and its budget for each size, in `sizes` order. */
export interface RankedTier {
    minRating: number;
    budgets: number[];
}

/** `rules::Size`: units a side, the `Matchmaker<Ranked>` it queues in, its level (null: closed). */
export interface RankedSize {
    units: number;
    queue: string;
    level: string | null;
}

/** `ghosts::rules::Rules`, decoded (`decodeRules` in `bcs.ts`). */
export interface RankedRules {
    id: string;
    /** Bumped by every admin write. */
    version: number;
    /** Index `i` is the rifle of tier `i + 1`. */
    weapons: RankedItem[];
    /** Index `i` is the armor of tier `i + 1`. */
    armor: RankedItem[];
    /** Index `i` is the utility of kind `i`: 0 frag, 1 flashbang, 2 smoke. */
    utilities: RankedItem[];
    /** By ascending `minRating`: a tier is its index. */
    tiers: RankedTier[];
    sizes: RankedSize[];
    placementGames: number;
    placementTier: number;
    revealLimitMs: number;
    resetCooldownMs: number;
}

/** The tier names of the app, by index; a tier past them is named by its number. */
export const TIER_NAMES = ["Rookie", "Contractor", "Operative", "Elite"] as const;
export const tierName = (tier: number) => TIER_NAMES[tier] ?? `Tier ${tier}`;

/** `rules::NO_UTILITY`: the utility byte of a unit that carries none. */
export const NO_UTILITY = 0xff;
/** The bytes a unit takes in a squad: rifle tier, armor tier, utility kind. */
export const UNIT_BYTES = 3;
/** A salt is 32 random bytes: squads are a small space, a short salt could be brute-forced. */
export const SALT_BYTES = 32;

/** `items::utility` kinds, as the third byte of a unit. */
export const UTILITY_NAMES = ["frag", "flashbang", "smoke"] as const;
export type UtilityKindName = (typeof UTILITY_NAMES)[number];
export const RIFLE_NAMES = ["Standard Rifle", "Sharpshooter Rifle", "Plasma Rifle"] as const;
export const ARMOR_NAMES = ["Light Armor", "Medium Armor", "Heavy Armor"] as const;

/** What one unit of a ranked squad carries: tiers from 1, a utility kind or none. */
export interface Loadout {
    rifle: number;
    armor: number;
    /** 0 frag grenade, 1 flashbang, 2 smoke grenade; null for none. */
    utility: number | null;
}

/** `rules::tier_of`: the highest tier the rating reaches, and the placement floor while placing. */
export function tierOf(rules: RankedRules, rating: number, games: number): number {
    let tier = 0;
    rules.tiers.forEach((t, i) => {
        if (t.minRating <= rating) tier = i;
    });
    if (games < rules.placementGames) tier = Math.max(tier, rules.placementTier);
    return tier;
}

/** `rules::size_of`, without the abort: the size whose queue is `queue`, or null. */
export function sizeOfQueue(rules: RankedRules, queue: string): RankedSize | null {
    const id = normalize(queue);
    return rules.sizes.find((size) => normalize(size.queue) === id) ?? null;
}

/** The `Size` of `units`, or null when the rules have none (`rules::ENoSize`). */
export function rankedSize(rules: RankedRules, units: number): RankedSize | null {
    return rules.sizes.find((size) => size.units === units) ?? null;
}

/** Whether every item of a loadout exists and is unlocked at `tier`. */
export function loadoutUnlocked(rules: RankedRules, tier: number, loadout: Loadout): boolean {
    const open = (item: RankedItem | undefined) => !!item && item.minTier <= tier;
    return (
        open(rules.weapons[loadout.rifle - 1]) &&
        open(rules.armor[loadout.armor - 1]) &&
        (loadout.utility === null || open(rules.utilities[loadout.utility]))
    );
}

/** `rules::budget`: the credits a squad of `units` gets at `tier`; null for an unknown size or tier. */
export function budgetOf(rules: RankedRules, tier: number, units: number): number | null {
    const i = rules.sizes.findIndex((size) => size.units === units);
    const budget = i < 0 ? undefined : rules.tiers[tier]?.budgets[i];
    return budget ?? null;
}

const normalize = (id: string) => id.toLowerCase().replace(/^0x0*/, "");

// === Squad bytes ===

/** The bytes of a squad: three per unit, `[rifle, armor, utility]`, `NO_UTILITY` for none. */
export function encodeSquad(squad: Loadout[]): Uint8Array {
    const bytes = new Uint8Array(squad.length * UNIT_BYTES);
    squad.forEach(({ rifle, armor, utility }, i) => {
        bytes.set([rifle, armor, utility ?? NO_UTILITY], i * UNIT_BYTES);
    });
    return bytes;
}

/** The inverse of `encodeSquad`. A trailing partial unit is dropped: `checkSquad` reports it. */
export function decodeSquad(bytes: Uint8Array): Loadout[] {
    const squad: Loadout[] = [];
    for (let i = 0; i + UNIT_BYTES <= bytes.length; i += UNIT_BYTES) {
        const utility = bytes[i + 2];
        squad.push({
            rifle: bytes[i],
            armor: bytes[i + 1],
            utility: utility === NO_UTILITY ? null : utility,
        });
    }
    return squad;
}

/** 32 random bytes from the platform's CSPRNG. Keep them until the reveal; never log them. */
export function newSquadSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** `blake2b256(squad ‖ salt)`, as the `0x` address `find_ranked` takes and `Searching` holds. */
export function squadCommitment(squad: Uint8Array, salt: Uint8Array): string {
    const preimage = new Uint8Array(squad.length + salt.length);
    preimage.set(squad);
    preimage.set(salt, squad.length);
    return `0x${toHex(blake2b256(preimage))}`;
}

// === The check ===

export type SquadProblemKind =
    | "no_size"
    | "bad_tier"
    | "squad_size"
    | "unknown_item"
    | "item_locked"
    | "over_budget";

/** Why `rules::check_squad` would abort, with the abort code of `ghosts::rules` (null: not one). */
export interface SquadProblem {
    kind: SquadProblemKind;
    /** `rules::ENoSize` 7, `ESquadSize` 0, `EUnknownItem` 1, `EItemLocked` 2, `EOverBudget` 3. */
    abort: number | null;
    unit?: number;
    slot?: "rifle" | "armor" | "utility";
    message: string;
}

/** The price of a squad under the rules, unknown items left out. */
export function squadPrice(rules: RankedRules, squad: Loadout[]): number {
    return squad.reduce(
        (sum, { rifle, armor, utility }) =>
            sum +
            (rules.weapons[rifle - 1]?.price ?? 0) +
            (rules.armor[armor - 1]?.price ?? 0) +
            (utility === null ? 0 : (rules.utilities[utility]?.price ?? 0)),
        0,
    );
}

/**
 * `rules::check_squad(rules, size, tier, squad)`, aborts in the same order: the size and the
 * tier's budget first (`ENoSize`, then an index out of bounds for an unknown tier), then
 * `ESquadSize`, then unit by unit the rifle, the armor and the utility (`EUnknownItem`, then
 * `EItemLocked`), then `EOverBudget`. Null when the contract would take the squad.
 */
export function checkSquad(
    rules: RankedRules,
    size: number,
    tier: number,
    squad: Uint8Array,
): SquadProblem | null {
    const i = rules.sizes.findIndex((s) => s.units === size);
    if (i < 0) {
        return { kind: "no_size", abort: 7, message: `There are no ranked squads of ${size}.` };
    }
    const budget = rules.tiers[tier]?.budgets[i];
    if (budget === undefined) {
        return { kind: "bad_tier", abort: null, message: `There is no tier ${tier}.` };
    }
    if (squad.length !== UNIT_BYTES * size) {
        return {
            kind: "squad_size",
            abort: 0,
            message: `A squad of ${size} is ${UNIT_BYTES * size} bytes, three a unit; got ${squad.length}.`,
        };
    }

    let total = 0;
    const price = (
        items: RankedItem[],
        byte: number,
        first: number,
        unit: number,
        slot: SquadProblem["slot"],
    ): SquadProblem | number => {
        const item = byte >= first ? items[byte - first] : undefined;
        if (!item) {
            const message = `Unit ${unit + 1}: no ${slot} ${byte}.`;
            return { kind: "unknown_item", abort: 1, unit, slot, message };
        }
        if (item.minTier > tier) {
            return {
                kind: "item_locked",
                abort: 2,
                unit,
                slot,
                message: `Unit ${unit + 1}: that ${slot} unlocks at ${tierName(item.minTier)}.`,
            };
        }
        return item.price;
    };
    for (let unit = 0; unit < size; unit++) {
        const [rifle, armor, utility] = squad.slice(UNIT_BYTES * unit, UNIT_BYTES * unit + 3);
        const costs = [
            price(rules.weapons, rifle, 1, unit, "rifle"),
            price(rules.armor, armor, 1, unit, "armor"),
            utility === NO_UTILITY ? 0 : price(rules.utilities, utility, 0, unit, "utility"),
        ];
        for (const cost of costs) {
            if (typeof cost !== "number") return cost;
            total += cost;
        }
    }
    if (total > budget) {
        return {
            kind: "over_budget",
            abort: 3,
            message: `The squad costs ${total} credits; the budget of ${tierName(tier)} for ${size} is ${budget}.`,
        };
    }
    return null;
}

// === The unit a loadout makes ===

/** `stats::default()`: a rookie, unarmed. */
const ROOKIE: Stats = decodeStats(encodeStatsOf([7, 65, 10, 0, 0]));

function encodeStatsOf(values: number[]): bigint {
    return values.reduce((packed, value, i) => packed | (BigInt(value) << BigInt(8 * i)), 0n);
}

/** `items::rifle_stats`: damage, spread, plus one, crit, can be dodged, area, env, range, ammo. */
const RIFLE_STATS: Record<number, bigint> = {
    1: 0x03_04_00_00_01_0a_0a_02_04n << 48n,
    2: 0x03_05_00_00_01_14_14_01_05n << 48n,
    3: 0x03_05_00_00_01_1e_1e_01_06n << 48n,
};

/** `items::armor_stats`: mobility, aim, health, armor, dodge; `128 + n` takes `n` away. */
const ARMOR_STATS: Record<number, bigint> = {
    1: encodeStatsOf([0, 0, 0, 1, 10]),
    2: encodeStatsOf([0, 0, 0, 2, 0]),
    3: encodeStatsOf([128 + 1, 0, 1, 3, 128 + 10]),
};

/** `items::utility_parts`: what each utility kind grants. Its stats are the zero modifier. */
const UTILITY_ACTIONS: Record<number, UnitActionEntry["kind"]> = {
    0: "grenade",
    1: "flashbang",
    2: "smoke_grenade",
};

const SIGN = 0x80n;
const PARAMS_MASK = (1n << 120n) - 1n;

/** `stats::add`: a signed byte modifier per stat, never below 0, a touched value capped at 127. */
export function addStats(stats: bigint, modifier: bigint): bigint {
    let result = stats & PARAMS_MASK;
    for (let i = 0n; i < 15n && modifier >> (8n * i) !== 0n; i++) {
        const shift = 8n * i;
        const mod = (modifier >> shift) & 0xffn;
        if (mod === 0n || mod === SIGN) continue;
        const value = (stats >> shift) & 0xffn;
        let next = mod > SIGN ? value - (mod - SIGN < value ? mod - SIGN : value) : value + mod;
        if (next > SIGN - 1n) next = SIGN - 1n;
        result = (result & ~(0xffn << shift)) | (next << shift);
    }
    return result;
}

/**
 * `unit::from_loadout`: a rookie's stats plus the rifle's, then the armor's (the utility adds
 * the zero modifier), and the actions `Move`, `Attack`, `Reload`, then the utility's, once per
 * match. Returns null for a loadout Move would abort on (an unknown rifle or armor tier).
 */
export function unitFromLoadout(
    loadout: Loadout,
): { stats: Stats; actions: UnitActionEntry[]; ap: number; hp: number; ammo: number } | null {
    const rifle = RIFLE_STATS[loadout.rifle];
    const armor = ARMOR_STATS[loadout.armor];
    if (rifle === undefined || armor === undefined) return null;
    const packed = addStats(addStats(encodeStats(ROOKIE), rifle), armor);
    const stats = decodeStats(packed);
    const actions: UnitActionEntry[] = [
        { kind: "move", uses: null },
        { kind: "attack", uses: null },
        { kind: "reload", uses: null },
    ];
    const granted = loadout.utility === null ? undefined : UTILITY_ACTIONS[loadout.utility];
    if (granted) actions.push({ kind: granted, uses: 1 });
    return { stats, actions, ap: 2, hp: stats.health, ammo: stats.ammo };
}

/** Every loadout the initial items allow: rifles and armors 1 to 3, each utility or none. */
export const ALL_LOADOUTS: readonly Loadout[] = [1, 2, 3].flatMap((rifle) =>
    [1, 2, 3].flatMap((armor) =>
        [0, 1, 2, null].map((utility) => ({ rifle, armor, utility })),
    ),
);

/**
 * The loadout a unit on the map was built from, read back from its full stats and actions (an
 * opponent's squad is public once it is placed). Null for a unit no loadout makes: a recruit.
 */
export function loadoutOfUnit(unit: Pick<Unit, "stats" | "actions" | "hpMax">): Loadout | null {
    const kinds = (actions: UnitActionEntry[]) => actions.map((a) => a.kind).join(",");
    return (
        ALL_LOADOUTS.find((loadout) => {
            const built = unitFromLoadout(loadout)!;
            const same = (Object.keys(built.stats) as (keyof Stats)[]).every(
                (key) => built.stats[key] === unit.stats[key],
            );
            return same && built.hp === unit.hpMax && kinds(built.actions) === kinds(unit.actions);
        }) ?? null
    );
}

// === Presets and names ===

export type PresetId = "recruit" | "runner" | "assault" | "sniper" | "heavy";

/** The app's presets (`app/src/features/play/economy`), as loadouts. */
export const LOADOUT_PRESETS: Readonly<Record<PresetId, Loadout>> = {
    /** A rifle and light armor: the cheapest unit that can hold a line. */
    recruit: { rifle: 1, armor: 1, utility: null },
    /** Light armor to stay quick and dodge, a grenade to flush cover. */
    runner: { rifle: 1, armor: 1, utility: 0 },
    /** Medium armor, rifle and grenade: the line unit that trades well up close. */
    assault: { rifle: 1, armor: 2, utility: 0 },
    /** Sharpshooter rifle from range; spends nothing on a utility. */
    sniper: { rifle: 2, armor: 1, utility: null },
    /** Plasma rifle in heavy armor: slow, hard to put down, hits hardest. */
    heavy: { rifle: 3, armor: 3, utility: null },
};

export const PRESET_IDS = Object.keys(LOADOUT_PRESETS) as PresetId[];

/** `2/1/frag`: rifle tier, armor tier, utility; `-` for none. */
export function loadoutText({ rifle, armor, utility }: Loadout): string {
    return `${rifle}/${armor}/${utility === null ? "-" : (UTILITY_NAMES[utility] ?? utility)}`;
}

/** One line for a squad, unit by unit: `2/1/- 1/2/frag 1/1/smoke`. */
export function describeSquad(squad: Loadout[]): string {
    return squad.map(loadoutText).join(" ");
}

/**
 * A squad as text: units split by commas or spaces, each a preset name (`assault`) or
 * `RIFLE/ARMOR/UTILITY` (`2/1/-`, `1/2/frag`, `3:3:smoke`), or the whole squad as `0x` hex bytes.
 * Throws with a message saying what is wrong.
 */
export function parseSquad(text: string): Loadout[] {
    const trimmed = text.trim();
    if (/^0x[0-9a-f]*$/i.test(trimmed)) {
        const hex = trimmed.slice(2);
        if (hex.length % 2) throw new Error("Squad hex has an odd number of digits.");
        return decodeSquad(Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16)));
    }
    const units = trimmed.split(/[\s,]+/).filter(Boolean);
    if (units.length === 0) throw new Error("No units in the squad.");
    return units.map((unit) => {
        const preset = LOADOUT_PRESETS[unit.toLowerCase() as PresetId];
        if (preset) return { ...preset };
        const parts = unit.toLowerCase().split(/[/:]/);
        if (parts.length !== 3) {
            throw new Error(
                `Not a unit: ${unit.slice(0, 20)}. Use a preset (${PRESET_IDS.join(", ")}) or RIFLE/ARMOR/UTILITY like 2/1/frag.`,
            );
        }
        const [rifle, armor] = [Number(parts[0]), Number(parts[1])];
        if (![rifle, armor].every((n) => Number.isInteger(n) && n >= 1 && n <= 255)) {
            throw new Error(`Rifle and armor are tiers from 1: ${unit.slice(0, 20)}.`);
        }
        const word = parts[2];
        let utility: number | null;
        if (word === "-" || word === "none" || word === "") utility = null;
        else if ((UTILITY_NAMES as readonly string[]).includes(word)) {
            utility = UTILITY_NAMES.indexOf(word as UtilityKindName);
        } else if (word === "grenade" || word === "frag_grenade") utility = 0;
        else if (word === "smoke_grenade") utility = 2;
        else if (/^\d+$/.test(word) && Number(word) < 255) utility = Number(word);
        else throw new Error(`Not a utility: ${word.slice(0, 20)}. Use frag, flashbang, smoke or -.`);
        return { rifle, armor, utility };
    });
}

// === The squad generator ===

/** mulberry32: small, seedable, the same stream for the same seed. */
export function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface AutoSquadOptions {
    /** A seed for a reproducible squad; without one (and without `random`) each call differs. */
    seed?: number;
    /** A source of numbers in [0, 1); overrides `seed`. */
    random?: () => number;
    /** How likely each archetype is, before what the budget and the tier allow. Default `ARCHETYPE_WEIGHTS`. */
    weights?: Partial<Record<PresetId, number>>;
    /** The most units of one archetype, while the budget leaves a choice. Default 2. */
    maxSame?: number;
    /** How likely each utility is when one is added. Default `UTILITY_WEIGHTS`. */
    utilityWeights?: Partial<Record<UtilityKindName, number>>;
    /**
     * The chance of stopping the spending of leftover credits after each upgrade, so that not
     * every squad is maxed out. Default 0: credits are spent while anything is affordable.
     */
    thrift?: number;
}

/** Archetype weights by default: line units most, the specialists less. */
export const ARCHETYPE_WEIGHTS: Readonly<Record<PresetId, number>> = {
    recruit: 1,
    runner: 3,
    assault: 4,
    sniper: 3,
    heavy: 2,
};

export const UTILITY_WEIGHTS: Readonly<Record<UtilityKindName, number>> = {
    frag: 4,
    flashbang: 3,
    smoke: 3,
};

export interface AutoSquad {
    squad: Loadout[];
    bytes: Uint8Array;
    /** The archetype each unit started from, before upgrades. */
    archetypes: PresetId[];
    price: number;
    budget: number;
    tier: number;
    size: number;
}

function pick<T>(random: () => number, options: { value: T; weight: number }[]): T | undefined {
    const total = options.reduce((sum, o) => sum + Math.max(0, o.weight), 0);
    if (total <= 0) return undefined;
    let roll = random() * total;
    for (const option of options) {
        roll -= Math.max(0, option.weight);
        if (roll < 0) return option.value;
    }
    return options.at(-1)?.value;
}

/**
 * A valid ranked squad of `size` for a player of `tier`, built from the live `rules` with
 * controlled randomness:
 *
 * 1. Archetypes are the app's presets whose items the tier unlocks (`recruit`, `runner`,
 *    `assault`, `sniper`, `heavy`), priced by the rules.
 * 2. Unit by unit, one is drawn by weight among those that leave room for the cheapest unit in
 *    every slot still open, and no more than `maxSame` of one kind while there is a choice.
 * 3. Leftover credits go on random upgrades, one at a time: a rifle or an armor a tier up, a
 *    utility where there is none, each only if unlocked and affordable, until nothing is (or
 *    `thrift` stops it early). A preset's utility may be swapped for another of the same price.
 * 4. The result is checked with `checkSquad`; a squad that fails would be a bug, and throws.
 *
 * Throws `Error` when no valid squad exists (the size has no budget, or even the cheapest units
 * are over it).
 */
export function autoSquad(
    rules: RankedRules,
    tier: number,
    size: number,
    options: AutoSquadOptions = {},
): AutoSquad {
    const random = options.random ?? seededRandom(options.seed ?? (Math.random() * 2 ** 32) >>> 0);
    const budget = budgetOf(rules, tier, size);
    if (budget === null) throw new Error(`No budget for ${size} units at tier ${tier}.`);
    const weights = { ...ARCHETYPE_WEIGHTS, ...options.weights };
    const utilityWeights = { ...UTILITY_WEIGHTS, ...options.utilityWeights };
    const maxSame = options.maxSame ?? 2;
    const utilityWeight = (kind: number) => utilityWeights[UTILITY_NAMES[kind]] ?? 1;

    const open = (items: RankedItem[], first: number) =>
        items.flatMap((item, i) => (item.minTier <= tier ? [i + first] : []));
    const rifles = open(rules.weapons, 1);
    const armors = open(rules.armor, 1);
    const utilities = open(rules.utilities, 0);
    const unlocked = ({ rifle, armor, utility }: Loadout) =>
        rifles.includes(rifle) &&
        armors.includes(armor) &&
        (utility === null || utilities.includes(utility));
    const priceOf = (loadout: Loadout) => squadPrice(rules, [loadout]);

    if (rifles.length === 0 || armors.length === 0) {
        throw new Error(`Tier ${tier} unlocks no rifle or no armor: no squad can be built.`);
    }
    const rifle = (r: number) => rules.weapons[r - 1].price;
    const armor = (a: number) => rules.armor[a - 1].price;
    const cheapUnit: Loadout = {
        rifle: rifles.reduce((a, b) => (rifle(b) < rifle(a) ? b : a)),
        armor: armors.reduce((a, b) => (armor(b) < armor(a) ? b : a)),
        utility: null,
    };
    const cheapest = priceOf(cheapUnit);
    if (cheapest * size > budget) {
        throw new Error(`Even the cheapest squad (${cheapest * size}) is over the budget of ${budget}.`);
    }

    // 1-2. the composition
    const archetypes = PRESET_IDS.filter((id) => unlocked(LOADOUT_PRESETS[id]));
    const squad: Loadout[] = [];
    const kinds: PresetId[] = [];
    let spent = 0;
    for (let slot = 0; slot < size; slot++) {
        const reserve = cheapest * (size - slot - 1);
        const fits = (id: PresetId) => spent + priceOf(LOADOUT_PRESETS[id]) + reserve <= budget;
        const count = (id: PresetId) => kinds.filter((k) => k === id).length;
        let choices = archetypes.filter((id) => fits(id) && count(id) < maxSame);
        if (choices.length === 0) choices = archetypes.filter(fits);
        const chosen = pick(random, choices.map((id) => ({ value: id, weight: weights[id] ?? 0 })));
        const loadout = chosen ? { ...LOADOUT_PRESETS[chosen] } : { ...cheapUnit };
        // a preset's utility, when it has one, is any of the unlocked ones at that price
        if (loadout.utility !== null) {
            const price = rules.utilities[loadout.utility]?.price;
            const same = utilities.filter((u) => rules.utilities[u].price === price);
            const weighted = same.map((u) => ({ value: u, weight: utilityWeight(u) }));
            loadout.utility = pick(random, weighted) ?? loadout.utility;
        }
        squad.push(loadout);
        kinds.push(chosen ?? "recruit");
        spent += priceOf(loadout);
    }

    // 3. leftover credits, one random upgrade at a time
    const thrift = options.thrift ?? 0;
    for (;;) {
        const upgrades: { unit: number; next: Loadout; weight: number }[] = [];
        squad.forEach((unit, i) => {
            const consider = (next: Loadout, weight: number) => {
                if (!unlocked(next)) return;
                if (spent - priceOf(unit) + priceOf(next) > budget) return;
                upgrades.push({ unit: i, next, weight });
            };
            if (rules.weapons[unit.rifle]) consider({ ...unit, rifle: unit.rifle + 1 }, 2);
            if (rules.armor[unit.armor]) consider({ ...unit, armor: unit.armor + 1 }, 2);
            if (unit.utility === null) {
                for (const u of utilities) consider({ ...unit, utility: u }, utilityWeight(u));
            }
        });
        const upgrade = pick(random, upgrades.map((u) => ({ value: u, weight: u.weight })));
        if (!upgrade) break;
        spent += priceOf(upgrade.next) - priceOf(squad[upgrade.unit]);
        squad[upgrade.unit] = upgrade.next;
        if (thrift > 0 && random() < thrift) break;
    }

    // 4. valid by construction, and checked all the same
    const bytes = encodeSquad(squad);
    const problem = checkSquad(rules, size, tier, bytes);
    if (problem) throw new Error(`The generated squad is invalid: ${problem.message}`);
    return { squad, bytes, archetypes: kinds, price: squadPrice(rules, squad), budget, tier, size };
}
