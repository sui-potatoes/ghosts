// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked builder's rules, apart from the screen: the squad as plain
 * loadouts, what a preset or a swap does to it, the credit arithmetic, what the
 * device remembers and when Start is allowed. Everything about tiers, items,
 * prices and stats comes from the economy; nothing here knows a preset or an
 * item by name.
 */

import {
    allItems,
    budgetOf,
    defaultSquad,
    itemOf,
    itemsFor,
    PRESETS,
    presetsFor,
    priceOf,
    squadSize,
    TIERS,
    tierOf,
    unitStats,
    unlockTierOf,
    validateSquad,
    type Issue,
    type Loadout,
    type Mode,
    type Preset,
    type Slot,
    type UnitStats,
} from "../economy/index.ts";
import { sameLoadout, type SavedType } from "./presets.ts";

export const SIZES: Mode[] = ["3x3", "4x4"];
export const SLOTS: Slot[] = ["weapon", "armor", "utility"];
export const SLOT_NAMES: Record<Slot, string> = {
    weapon: "Weapon",
    armor: "Armor",
    utility: "Utility",
};

export const STORE_KEY = "ghosts:play-ranked";

/** One place in the squad: a unit, or nobody yet (a type has to be chosen first). */
export type Stand = Loadout | null;

export type Squads = Partial<Record<Mode, Stand[]>>;

/** What the builder keeps between visits. */
export type Saved = {
    v: 1;
    mode: Mode;
    squads: Squads;
    /** The tier the player last saw the builder in, to say when it changed. */
    seen: { tier: string; name: string; budget: number } | null;
};

/* === Credits ========================================================== */

/** `55 cr`. */
export const cr = (n: number): string => `${n} cr`;

/** `+15 cr`, `−10 cr`, `+0 cr`. */
export const crDelta = (n: number): string =>
    n > 0 ? `+${n} cr` : n < 0 ? `\u2212${-n} cr` : "+0 cr";

/** What remains after a choice: `leaves 25 cr`, `20 cr over`, or `No limit`. */
export const leavesText = (left: number | null): string =>
    left === null ? "No limit" : left >= 0 ? `leaves ${left} cr` : `${-left} cr over`;

export const squadCost = (squad: Stand[]): number =>
    squad.reduce((sum, unit) => sum + (unit ? priceOf(unit) : 0), 0);

export type BudgetView = {
    /** Null: no limit. */
    budget: number | null;
    spent: number;
    /** Negative when over; null without a limit. */
    left: number | null;
    over: boolean;
};

/** The squad against its budget; the tier's when none is given, null for no limit. */
export function budgetView(
    squad: Stand[],
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): BudgetView {
    const spent = squadCost(squad);
    if (budget === null) return { budget, spent, left: null, over: false };
    return { budget, spent, left: budget - spent, over: spent > budget };
}

/* === The squad ======================================================== */

/** A squad of the right size for `mode`: what fits is kept, new places are filled with the default. */
export function fitSquad<T extends Stand>(
    squad: T[],
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): (T | Loadout)[] {
    const size = squadSize(mode);
    if (squad.length === size) return squad;
    if (squad.length > size) return squad.slice(0, size);
    const fill = defaultSquad(rating, mode, budget ?? Number.POSITIVE_INFINITY);
    return [...squad, ...fill.slice(squad.length, size)];
}

const replaceAt = <T extends Stand>(squad: T[], index: number, unit: T): T[] =>
    squad.map((u, i) => (i === index ? unit : u));

/** Clear a place: the unit goes, its type has to be chosen again. */
export function clearUnit(squad: Stand[], index: number): Stand[] {
    if (index < 0 || index >= squad.length) return squad;
    return replaceAt<Stand>(squad, index, null);
}

export function presetOf(rating: number, id: string): Preset | undefined {
    return presetsFor(rating).find((preset) => preset.id === id);
}

/** Start the unit over from a preset. */
export function choosePreset<T extends Stand>(
    squad: T[],
    index: number,
    preset: Preset,
): (T | Loadout)[] {
    if (index < 0 || index >= squad.length) return squad;
    return replaceAt<T | Loadout>(squad, index, { ...preset.loadout });
}

/** Whether the unit's preset lets the slot change. A preset the economy no longer lists is not held to it. */
export function canSwap(unit: Loadout, slot: Slot, rating: number): boolean {
    const preset = presetOf(rating, unit.preset);
    return preset ? preset.swaps.includes(slot) : true;
}

/** The unit with one slot changed. `null` is the empty utility. */
export function withItem(unit: Loadout, slot: Slot, id: string | null): Loadout {
    if (slot === "utility") return { ...unit, utility: id };
    if (id === null) return unit;
    return { ...unit, [slot]: id };
}

/** Swap one slot of one unit; refused (the same squad back) when the preset fixes the slot. */
export function swapItem<T extends Stand>(
    squad: T[],
    index: number,
    slot: Slot,
    id: string | null,
    rating: number,
): (T | Loadout)[] {
    const unit = squad[index];
    if (!unit || !canSwap(unit, slot, rating)) return squad;
    if (id !== null && !itemOf(id)) return squad;
    return replaceAt<T | Loadout>(squad, index, withItem(unit, slot, id));
}

/* === The picker's options ============================================= */

/** What the builder needs to price a choice: whose tier, which size, how much to spend. */
export type Limits = {
    rating: number;
    mode: Mode;
    /** Null: no limit. */
    budget: number | null;
};

export const tierLimits = (rating: number, mode: Mode): Limits => ({
    rating,
    mode,
    budget: budgetOf(rating, mode),
});

export type PickOption = {
    /** Unique within the picker: `preset:assault`, `mine:k3x`, `weapon:rifle`, `utility:none`. */
    key: string;
    group: "preset" | Slot;
    name: string;
    /** The preset's role line; empty for items and saved types. */
    role: string;
    /** The catalog's description of an item; empty for types. */
    description: string;
    /** A saved type of the player's own. */
    mine: boolean;
    /** What the unit would carry if this were chosen. */
    unit: Loadout;
    /** The item's own price, or the whole unit's for a type. */
    price: number;
    /** What the unit would cost more (+) or less (-) than it does now. */
    delta: number;
    /** Credits left for the squad if this were chosen; null without a limit. */
    leftAfter: number | null;
    current: boolean;
    /** Why the player's tier does not allow it: `Unlocks at Contractor`. */
    locked?: string;
};

export type PickSection = {
    group: "preset" | Slot;
    title: string;
    /** Why nothing here can change, when that is so. */
    fixed?: string;
    options: PickOption[];
};

const unlockText = (tier: string | undefined): string =>
    tier ? `Unlocks at ${tier}` : "Not available at this rank";

/** Why a loadout cannot be fielded at this rating, or undefined when it can. */
export function lockedReason(loadout: Loadout, rating: number): string | undefined {
    const open = tierOf(rating).items;
    const ids = [loadout.weapon, loadout.armor, loadout.utility].filter((id): id is string => !!id);
    if (ids.every((id) => open.includes(id))) return undefined;
    return unlockText(unlockTierOf(loadout)?.name);
}

function optionMaker(squad: Stand[], index: number, limits: Limits) {
    const unit = squad[index];
    const now = unit ? priceOf(unit) : 0;
    const left = budgetView(squad, limits.rating, limits.mode, limits.budget).left;
    return (
        key: string,
        group: PickOption["group"],
        name: string,
        next: Loadout,
        price: number,
        current: boolean,
        extra: Partial<PickOption> = {},
    ): PickOption => {
        const delta = priceOf(next) - now;
        return {
            key,
            group,
            name,
            role: "",
            description: "",
            mine: false,
            unit: next,
            price,
            delta,
            leftAfter: left === null ? null : left - delta,
            current,
            ...extra,
        };
    };
}

/**
 * The unit type step: the built-in types the tier allows, then those it does
 * not (each with its reason), then the player's own saved types.
 */
export function typeSection(
    squad: Stand[],
    index: number,
    limits: Limits,
    mine: SavedType[] = [],
): PickSection {
    const unit = squad[index];
    const option = optionMaker(squad, index, limits);
    const presets = presetsFor(limits.rating);
    const open = new Set(presets.map((p) => p.id));
    const builtIn = (preset: Preset, locked?: string) =>
        option(
            `preset:${preset.id}`,
            "preset",
            preset.name,
            { ...preset.loadout },
            priceOf(preset.loadout),
            !!unit && sameLoadout(preset.loadout, unit),
            { role: preset.role, ...(locked ? { locked } : {}) },
        );
    const options = [
        ...presets.map((preset) => builtIn(preset)),
        ...PRESETS.filter((p) => !open.has(p.id)).map((preset) =>
            builtIn(preset, unlockText(unlockTierOf(preset.loadout)?.name)),
        ),
        ...mine.map((type) => {
            const locked = lockedReason(type.loadout, limits.rating);
            return option(
                `mine:${type.id}`,
                "preset",
                type.name,
                { ...type.loadout },
                priceOf(type.loadout),
                !!unit && sameLoadout(type.loadout, unit),
                { mine: true, ...(locked ? { locked } : {}) },
            );
        }),
    ];
    return { group: "preset", title: "Unit type", options };
}

/** The equipment step: weapon, armor and utility for the unit's type. Empty for a place with no unit. */
export function gearSections(squad: Stand[], index: number, limits: Limits): PickSection[] {
    const unit = squad[index];
    if (!unit) return [];
    const { rating } = limits;
    const option = optionMaker(squad, index, limits);
    const sections: PickSection[] = [];
    for (const slot of SLOTS) {
        const have = unit[slot];
        const listed = itemsFor(rating, slot);
        // What the unit carries stays on the list even when the tier no longer lists it.
        const items =
            have && !listed.some((item) => item.id === have)
                ? [...listed, ...(itemOf(have) ? [itemOf(have)!] : [])]
                : listed;
        const options = items.map((item) =>
            option(
                `${slot}:${item.id}`,
                slot,
                item.name,
                withItem(unit, slot, item.id),
                item.price,
                item.id === have,
                {
                    description: item.description,
                    ...(tierOf(rating).items.includes(item.id)
                        ? {}
                        : { locked: unlockText(TIERS.find((t) => t.id === item.tier)?.name) }),
                },
            ),
        );
        if (slot === "utility")
            options.push(
                option("utility:none", slot, "None", withItem(unit, slot, null), 0, !have, {
                    description: "Nothing in the utility slot",
                }),
            );
        const shown = new Set(items.map((item) => item.id));
        const later = allItems()
            .filter((item) => item.slot === slot && !shown.has(item.id))
            .map((item) =>
                option(
                    `${slot}:${item.id}`,
                    slot,
                    item.name,
                    withItem(unit, slot, item.id),
                    item.price,
                    false,
                    {
                        description: item.description,
                        locked: unlockText(TIERS.find((t) => t.id === item.tier)?.name),
                    },
                ),
            );
        const swappable = canSwap(unit, slot, rating);
        const preset = presetOf(rating, unit.preset);
        sections.push({
            group: slot,
            title: SLOT_NAMES[slot],
            fixed: swappable ? undefined : `Fixed on ${preset?.name ?? "this type"}`,
            options: swappable ? [...options, ...later] : options.filter((o) => o.current),
        });
    }
    return sections;
}

/** Both steps at the tier's budget: the types first, then each slot. */
export function pickSections(
    squad: Stand[],
    index: number,
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): PickSection[] {
    if (!squad[index]) return [];
    const limits = { rating, mode, budget };
    return [typeSection(squad, index, limits), ...gearSections(squad, index, limits)];
}

/** Apply a picker option to the squad: a type starts the unit over, an item swaps its slot. */
export function applyOption<T extends Stand>(
    squad: T[],
    index: number,
    option: PickOption,
    rating: number,
): (T | Loadout)[] {
    if (option.locked || index < 0 || index >= squad.length) return squad;
    if (option.group === "preset") {
        if (option.mine) return replaceAt<T | Loadout>(squad, index, { ...option.unit });
        const preset = presetOf(rating, option.key.slice("preset:".length));
        return preset ? choosePreset(squad, index, preset) : squad;
    }
    const id = option.key.slice(option.group.length + 1);
    return swapItem(squad, index, option.group, id === "none" ? null : id, rating);
}

/* === Stats ============================================================ */

export type StatLine = {
    key: string;
    label: string;
    short: string;
    /** Display text: `10`, `3–5`. */
    text: string;
    /** One number to compare by (the middle of a range). */
    value: number;
};

const LABELS: Record<string, [label: string, short: string]> = {
    hp: ["Health", "HP"],
    armor: ["Armor", "ARM"],
    mobility: ["Mobility", "MOV"],
    aim: ["Aim", "AIM"],
    damage: ["Damage", "DMG"],
    range: ["Range", "RNG"],
    dodge: ["Dodge", "DOD"],
    critChance: ["Crit chance", "CRT"],
    ammo: ["Ammo", "AMO"],
    grenades: ["Grenades", "GRE"],
};

const round = (n: number) => Math.round(n * 10) / 10;

/** Whatever numbers the economy reports for a unit, in its own order. */
export function statLines(stats: UnitStats): StatLine[] {
    const lines: StatLine[] = [];
    for (const [key, raw] of Object.entries(stats as Record<string, unknown>)) {
        const [label, short] = LABELS[key] ?? [
            key.charAt(0).toUpperCase() + key.slice(1),
            key.slice(0, 3).toUpperCase(),
        ];
        if (typeof raw === "number") {
            lines.push({ key, label, short, text: String(round(raw)), value: raw });
        } else if (
            Array.isArray(raw) &&
            raw.length === 2 &&
            raw.every((n) => typeof n === "number")
        ) {
            const [lo, hi] = raw as [number, number];
            lines.push({ key, label, short, text: `${lo}–${hi}`, value: (lo + hi) / 2 });
        }
    }
    return lines;
}

export type StatChange = StatLine & {
    /** Change against the base; 0 when the stat is the same. */
    delta: number;
};

/** The stats of `after` with their change from `before`. */
export function statChanges(before: Loadout, after: Loadout): StatChange[] {
    const was = new Map(statLines(unitStats(before)).map((line) => [line.key, line.value]));
    return statLines(unitStats(after)).map((line) => ({
        ...line,
        delta: round(line.value - (was.get(line.key) ?? line.value)),
    }));
}

/** `+20`, `−10`, `0`. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** A short account of what a stat change does: `Damage +1 · Mobility −1`. */
export function changeSummary(changes: StatChange[], max = 2): string {
    return changes
        .filter((c) => c.delta !== 0)
        .slice(0, max)
        .map((c) => `${c.label} ${signed(c.delta)}`)
        .join(" · ");
}

/* === Start ============================================================ */

export type Gate = { ok: true } | { ok: false; reason: string };

/**
 * Everything wrong with the squad, each unit's issues naming its place
 * (`unit` is the place's index, empty places included), then the budget.
 * The economy checks each unit; the budget is the one given (null: none).
 */
export function squadIssues(
    squad: Stand[],
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): Issue[] {
    const issues: Issue[] = [];
    if (squad.length !== squadSize(mode))
        issues.push({ kind: "size", message: `A ${mode} squad has ${squadSize(mode)} units` });
    squad.forEach((unit, i) => {
        if (!unit) {
            issues.push({ kind: "illegal", unit: i, message: `Choose a type for unit ${i + 1}` });
            return;
        }
        for (const issue of validateSquad([unit], rating, "3x3")) {
            if (issue.kind === "size" || issue.kind === "over-budget") continue;
            issues.push({
                ...issue,
                unit: i,
                message: issue.message.replace(/^Unit 1\b/, `Unit ${i + 1}`),
            });
        }
    });
    const spent = squadCost(squad);
    if (budget !== null && spent > budget)
        issues.push({
            kind: "over-budget",
            message: `${cr(spent - budget)} over the ${cr(budget)} budget`,
        });
    return issues;
}

export const issueText = (issue: Issue): string =>
    issue.unit === undefined || /^Unit \d/.test(issue.message) || /unit \d+\.$/.test(issue.message)
        ? issue.message
        : `Unit ${issue.unit + 1}: ${issue.message}`;

/** Whether the squad may go into the queue; if not, the first thing wrong with it. */
export function startGate(
    squad: Stand[],
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): Gate {
    const issues = squadIssues(squad, rating, mode, budget);
    return issues.length === 0 ? { ok: true } : { ok: false, reason: issueText(issues[0]) };
}

/** The issues that name a unit, by place. */
export function unitIssues(
    squad: Stand[],
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): Map<number, Issue[]> {
    const byUnit = new Map<number, Issue[]>();
    for (const issue of squadIssues(squad, rating, mode, budget)) {
        if (issue.unit === undefined) continue;
        byUnit.set(issue.unit, [...(byUnit.get(issue.unit) ?? []), issue]);
    }
    return byUnit;
}

/* === What the device remembers ======================================== */

const isLoadout = (x: unknown): x is Loadout => {
    if (!x || typeof x !== "object") return false;
    const u = x as Record<string, unknown>;
    return (
        typeof u.preset === "string" &&
        typeof u.weapon === "string" &&
        typeof u.armor === "string" &&
        (u.utility === null || typeof u.utility === "string")
    );
};

/** A saved unit still makes sense: every item it names is in the catalog. */
const known = (unit: Loadout): boolean =>
    !!itemOf(unit.weapon) &&
    !!itemOf(unit.armor) &&
    (unit.utility === null || !!itemOf(unit.utility));

export const emptySaved = (): Saved => ({ v: 1, mode: "3x3", squads: {}, seen: null });

/** Read what was stored; anything unreadable or out of date reads as nothing. */
export function parseSaved(raw: string | null): Saved {
    if (!raw) return emptySaved();
    try {
        const data = JSON.parse(raw) as Partial<Saved>;
        if (!data || data.v !== 1) return emptySaved();
        const squads: Squads = {};
        for (const mode of SIZES) {
            const list = data.squads?.[mode];
            if (
                Array.isArray(list) &&
                list.length > 0 &&
                list.some((unit) => unit !== null) &&
                list.every((unit) => unit === null || (isLoadout(unit) && known(unit)))
            )
                squads[mode] = list.map((unit: Stand) => (unit ? { ...unit } : null));
        }
        const seen = data.seen;
        return {
            v: 1,
            mode: SIZES.includes(data.mode as Mode) ? (data.mode as Mode) : "3x3",
            squads,
            seen:
                seen &&
                typeof seen.tier === "string" &&
                typeof seen.name === "string" &&
                typeof seen.budget === "number"
                    ? { tier: seen.tier, name: seen.name, budget: seen.budget }
                    : null,
        };
    } catch {
        return emptySaved();
    }
}

export const serializeSaved = (saved: Saved): string => JSON.stringify(saved);

/** The squad to show for a size: the one remembered, else what fits from the other size, else the default. */
export function squadFor(
    saved: Saved,
    rating: number,
    mode: Mode,
    budget: number | null = budgetOf(rating, mode),
): Stand[] {
    const own = saved.squads[mode];
    if (own) return fitSquad(own, rating, mode, budget);
    const other = SIZES.map((m) => saved.squads[m]).find((s) => s && s.length > 0);
    return other
        ? fitSquad(other, rating, mode, budget)
        : defaultSquad(rating, mode, budget ?? Number.POSITIVE_INFINITY);
}

/** Switch size: the squad that was last built for it comes back; the first time, the other one's units carry over. */
export function switchMode(
    saved: Saved,
    rating: number,
    from: Mode,
    squad: Stand[],
    to: Mode,
): Saved {
    const squads: Squads = { ...saved.squads, [from]: squad };
    const next: Saved = { ...saved, mode: to, squads };
    return { ...next, squads: { ...squads, [to]: squadFor(next, rating, to) } };
}

/* === After a match ==================================================== */

/**
 * A sentence for the player when their tier is not the one the builder last
 * saw: the new budget, and whether the squad no longer fits or has room.
 */
export function tierNotice(
    saved: Saved,
    rating: number,
    mode: Mode,
    squad: Stand[],
): string | null {
    const tier = tierOf(rating);
    const was = saved.seen;
    if (!was || was.tier === tier.id) return null;
    const { budget, left, over } = budgetView(squad, rating, mode);
    const lead = `You are now ${tier.name}. The ${mode} budget is ${cr(budget ?? 0)}`;
    const rest = left ?? 0;
    if (over)
        return `${lead}, ${cr(-rest)} less than this squad costs. Trim it before the next match`;
    if ((budget ?? 0) > was.budget && rest > 0) return `${lead}, with ${cr(rest)} left to spend`;
    return `${lead}`;
}

export const seenNow = (rating: number, mode: Mode): Saved["seen"] => {
    const tier = tierOf(rating);
    return { tier: tier.id, name: tier.name, budget: budgetOf(rating, mode) };
};

/* === Saved squads against the current limits ========================== */

/**
 * Why a saved squad cannot be loaded under these limits, or null: a unit
 * with gear the tier has not unlocked first, then the budget.
 */
export function savedSquadRefusal(
    units: Stand[],
    rating: number,
    mode: Mode,
    budget: number | null,
): string | null {
    const issues = squadIssues(units, rating, mode, budget);
    const first =
        issues.find((i) => i.kind === "locked") ??
        issues.find((i) => i.kind !== "over-budget") ??
        issues[0];
    if (!first) return null;
    if (first.kind === "over-budget" && budget !== null) {
        const spent = squadCost(units);
        return `Costs ${cr(spent)}: ${cr(spent - budget)} over the budget`;
    }
    return issueText(first);
}

/** The type's name for a unit: the saved type it is exactly, else its preset (`Assault · modified`). */
export function typeName(unit: Loadout, rating: number, mine: SavedType[] = []): string {
    const own = mine.find((t) => sameLoadout(t.loadout, unit));
    if (own) return own.name;
    const preset = presetOf(rating, unit.preset);
    const name = preset?.name ?? unit.preset.charAt(0).toUpperCase() + unit.preset.slice(1);
    const base = preset?.loadout;
    return base && !sameLoadout(base, unit) ? `${name} · modified` : name;
}

/** The unit's gear in the economy's names: `Standard Rifle · Light Armor · No utility`. */
export function gearText(unit: Loadout): string {
    const name = (id: string | null) => (id ? (itemOf(id)?.name ?? id) : null);
    return [name(unit.weapon), name(unit.armor), name(unit.utility) ?? "No utility"].join(" · ");
}
