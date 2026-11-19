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
    budgetOf,
    defaultSquad,
    itemOf,
    itemsFor,
    presetsFor,
    priceOf,
    squadSize,
    tierOf,
    unitStats,
    validateSquad,
    type Issue,
    type Loadout,
    type Mode,
    type Preset,
    type Slot,
    type UnitStats,
} from "../economy/index.ts";

export const SIZES: Mode[] = ["3x3", "4x4"];
export const SLOTS: Slot[] = ["weapon", "armor", "utility"];
export const SLOT_NAMES: Record<Slot, string> = {
    weapon: "Weapon",
    armor: "Armor",
    utility: "Utility",
};

export const STORE_KEY = "ghosts:play-ranked";

export type Squads = Partial<Record<Mode, Loadout[]>>;

/** What the builder keeps between visits. */
export type Saved = {
    v: 1;
    mode: Mode;
    squads: Squads;
    /** The tier the player last saw the builder in, to say when it changed. */
    seen: { tier: string; name: string; budget: number } | null;
};

/* === Credits ========================================================== */

export const squadCost = (squad: Loadout[]): number =>
    squad.reduce((sum, unit) => sum + priceOf(unit), 0);

export type BudgetView = {
    budget: number;
    spent: number;
    /** Negative when over. */
    left: number;
    over: boolean;
};

export function budgetView(squad: Loadout[], rating: number, mode: Mode): BudgetView {
    const budget = budgetOf(rating, mode);
    const spent = squadCost(squad);
    return { budget, spent, left: budget - spent, over: spent > budget };
}

/* === The squad ======================================================== */

/** A squad of the right size for `mode`: what fits is kept, new places are filled with the default. */
export function fitSquad(squad: Loadout[], rating: number, mode: Mode): Loadout[] {
    const size = squadSize(mode);
    if (squad.length === size) return squad;
    if (squad.length > size) return squad.slice(0, size);
    const fill = defaultSquad(rating, mode);
    return [...squad, ...fill.slice(squad.length, size)];
}

const replaceAt = (squad: Loadout[], index: number, unit: Loadout): Loadout[] =>
    squad.map((u, i) => (i === index ? unit : u));

export function presetOf(rating: number, id: string): Preset | undefined {
    return presetsFor(rating).find((preset) => preset.id === id);
}

/** Start the unit over from a preset. */
export function choosePreset(squad: Loadout[], index: number, preset: Preset): Loadout[] {
    if (index < 0 || index >= squad.length) return squad;
    return replaceAt(squad, index, { ...preset.loadout });
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
export function swapItem(
    squad: Loadout[],
    index: number,
    slot: Slot,
    id: string | null,
    rating: number,
): Loadout[] {
    const unit = squad[index];
    if (!unit || !canSwap(unit, slot, rating)) return squad;
    if (id !== null && !itemOf(id)) return squad;
    return replaceAt(squad, index, withItem(unit, slot, id));
}

/* === The picker's options ============================================= */

export type PickOption = {
    /** Unique within the picker: `preset:assault`, `weapon:rifle`, `utility:none`. */
    key: string;
    group: "preset" | Slot;
    name: string;
    /** The preset's role line; empty for items. */
    role: string;
    /** What the unit would carry if this were chosen. */
    unit: Loadout;
    /** The item's own price, or the whole unit's for a preset. */
    price: number;
    /** What the unit would cost more (+) or less (-) than it does now. */
    delta: number;
    /** Credits left for the squad if this were chosen. */
    leftAfter: number;
    current: boolean;
};

export type PickSection = {
    group: "preset" | Slot;
    title: string;
    /** Why nothing here can change, when that is so. */
    fixed?: string;
    options: PickOption[];
};

/** The sections of the picker for one unit: presets first, then each slot. */
export function pickSections(
    squad: Loadout[],
    index: number,
    rating: number,
    mode: Mode,
): PickSection[] {
    const unit = squad[index];
    if (!unit) return [];
    const now = priceOf(unit);
    const left = budgetView(squad, rating, mode).left;
    const option = (
        key: string,
        group: PickOption["group"],
        name: string,
        role: string,
        next: Loadout,
        price: number,
        current: boolean,
    ): PickOption => {
        const delta = priceOf(next) - now;
        return {
            key,
            group,
            name,
            role,
            unit: next,
            price,
            delta,
            leftAfter: left - delta,
            current,
        };
    };

    const presets = presetsFor(rating);
    const sections: PickSection[] = [
        {
            group: "preset",
            title: "Preset",
            options: presets.map((preset) =>
                option(
                    `preset:${preset.id}`,
                    "preset",
                    preset.name,
                    preset.role,
                    { ...preset.loadout },
                    priceOf(preset.loadout),
                    preset.id === unit.preset &&
                        SLOTS.every((slot) => preset.loadout[slot] === unit[slot]),
                ),
            ),
        },
    ];

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
                "",
                withItem(unit, slot, item.id),
                item.price,
                item.id === have,
            ),
        );
        if (slot === "utility")
            options.push(
                option("utility:none", slot, "None", "", withItem(unit, slot, null), 0, !have),
            );
        const swappable = canSwap(unit, slot, rating);
        const preset = presetOf(rating, unit.preset);
        sections.push({
            group: slot,
            title: SLOT_NAMES[slot],
            fixed: swappable ? undefined : `Fixed on ${preset?.name ?? "this preset"}`,
            options: swappable ? options : options.filter((o) => o.current),
        });
    }
    return sections;
}

/** Apply a picker option to the squad: a preset starts over, an item swaps its slot. */
export function applyOption(
    squad: Loadout[],
    index: number,
    option: PickOption,
    rating: number,
): Loadout[] {
    if (option.group === "preset") {
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

const issueText = (issue: Issue): string =>
    issue.unit === undefined ? issue.message : `Unit ${issue.unit + 1}: ${issue.message}`;

/** Whether the squad may go into the queue; if not, the first thing wrong with it. */
export function startGate(squad: Loadout[], rating: number, mode: Mode): Gate {
    const issues = validateSquad(squad, rating, mode);
    return issues.length === 0 ? { ok: true } : { ok: false, reason: issueText(issues[0]) };
}

/** The issues that name a unit, by unit index. */
export function unitIssues(squad: Loadout[], rating: number, mode: Mode): Map<number, Issue[]> {
    const byUnit = new Map<number, Issue[]>();
    for (const issue of validateSquad(squad, rating, mode)) {
        if (issue.unit === undefined) continue;
        byUnit.set(issue.unit, [...(byUnit.get(issue.unit) ?? []), issue]);
    }
    return byUnit;
}

const OPPONENTS = [
    "Marrow",
    "Quill",
    "Sable Run",
    "Halcyon",
    "Ninefold",
    "Vesper",
    "Kestrel",
    "Dross",
    "Lowlight",
    "Tern",
];

/** A made-up opponent a little either side of the player's rating. `roll` is in [0, 1). */
export function opponentFor(
    rating: number,
    roll: () => number = Math.random,
): { name: string; rating: number } {
    const name = OPPONENTS[Math.floor(roll() * OPPONENTS.length) % OPPONENTS.length];
    return { name, rating: Math.max(0, rating + Math.round((roll() - 0.5) * 120)) };
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
                list.every(isLoadout) &&
                list.every(known)
            )
                squads[mode] = list.map((unit) => ({ ...unit }));
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
export function squadFor(saved: Saved, rating: number, mode: Mode): Loadout[] {
    const own = saved.squads[mode];
    if (own) return fitSquad(own, rating, mode);
    const other = SIZES.map((m) => saved.squads[m]).find((s) => s && s.length > 0);
    return other ? fitSquad(other, rating, mode) : defaultSquad(rating, mode);
}

/** Switch size: the squad that was last built for it comes back; the first time, the other one's units carry over. */
export function switchMode(
    saved: Saved,
    rating: number,
    from: Mode,
    squad: Loadout[],
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
    squad: Loadout[],
): string | null {
    const tier = tierOf(rating);
    const was = saved.seen;
    if (!was || was.tier === tier.id) return null;
    const { budget, left, over } = budgetView(squad, rating, mode);
    const lead = `You are now ${tier.name}. The ${mode} budget is ${budget}`;
    if (over) return `${lead}, ${-left} less than this squad costs. Trim it before the next match.`;
    if (budget > was.budget && left > 0) return `${lead}, with ${left} left to spend.`;
    return `${lead}.`;
}

export const seenNow = (rating: number, mode: Mode): Saved["seen"] => {
    const tier = tierOf(rating);
    return { tier: tier.id, name: tier.name, budget: budgetOf(rating, mode) };
};
