// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What each fitting does to a weapon's stats: the base, the total with what is
 * fitted, the total with a draft, and one line per upgrade. Pure and
 * data-driven: modifiers come from the decoded upgrade objects (signed bytes,
 * `0x80 | n` is −n) or, for an upgrade not yet minted, from its catalog entry.
 */

import { add, STAT_KEYS, VISIBLE, type StatKey, type Stats } from "@ghosts/squad/stats";

/** One upgrade and the modifier it carries. `slot` is null for one the catalog does not know. */
export interface ModFitting<S extends string = string> {
    slot: S | null;
    name: string;
    modifier: Stats;
}

/** `fitted`: on the weapon now and staying; `drafted`: to be fitted; `removed`: to come off. */
export type FittingState = "fitted" | "drafted" | "removed";

export interface FittingLine<S extends string = string> extends ModFitting<S> {
    state: FittingState;
}

export interface WeaponProfile<S extends string = string> {
    /** The weapon without any upgrade. */
    base: Stats;
    /** With what is fitted. */
    now: Stats;
    /** With the draft. */
    next: Stats;
    /** One line per upgrade involved, in slot order; removed ones sit beside their replacement. */
    lines: FittingLine<S>[];
}

/** `stats::negate`: every byte's sign flipped. */
export const negate = (s: Stats): Stats =>
    Object.fromEntries(STAT_KEYS.map((k) => [k, s[k] === 0 ? 0 : -s[k]])) as Stats;

/** The weapon as it would be without these modifiers, the way `remove_upgrade` takes them off. */
export const withoutModifiers = (total: Stats, modifiers: Stats[]): Stats =>
    modifiers.reduce((stats, m) => add(stats, negate(m)), total);

/**
 * The weapon's base from the chain's total. Taking modifiers off is lossy where
 * the chain floored a stat at zero (a −5 aim on a weapon with 0 aim), so a known
 * `preset` wins when applying the modifiers to it gives exactly the total.
 */
export function baseFromTotal(total: Stats, modifiers: Stats[], preset?: Stats): Stats {
    if (preset) {
        const rebuilt = modifiers.reduce((stats, m) => add(stats, m), preset);
        if (STAT_KEYS.every((k) => rebuilt[k] === total[k])) return preset;
    }
    return withoutModifiers(total, modifiers);
}

const applyAll = (base: Stats, fittings: ModFitting[]): Stats =>
    fittings.reduce((stats, f) => add(stats, f.modifier), base);

/**
 * The profile of a weapon. `fitted` are the upgrades on it now, `draft` the
 * ones wanted (a draft entry equal in slot and name to a fitted one is that
 * fitting, kept). `slots` orders the lines.
 */
export function weaponProfile<S extends string>(input: {
    base: Stats;
    fitted: ModFitting<S>[];
    draft: ModFitting<S>[];
    slots: readonly S[];
}): WeaponProfile<S> {
    const { base, fitted, draft, slots } = input;
    const lines: FittingLine<S>[] = [];
    const keptDraft: ModFitting<S>[] = [];
    for (const f of fitted) {
        if (f.slot === null) {
            lines.push({ ...f, state: "fitted" });
            keptDraft.push(f);
        }
    }
    for (const slot of slots) {
        const on = fitted.find((f) => f.slot === slot);
        const want = draft.find((f) => f.slot === slot);
        if (on && want && on.name === want.name) {
            lines.push({ ...on, state: "fitted" });
            keptDraft.push(on);
            continue;
        }
        if (on) lines.push({ ...on, state: "removed" });
        if (want) {
            lines.push({ ...want, state: "drafted" });
            keptDraft.push(want);
        }
    }
    return { base, now: applyAll(base, fitted), next: applyAll(base, keptDraft), lines };
}

/** A modifier as readable parts: "+10%" "aim", "−1" "mobility". */
export interface ModifierPart {
    key: StatKey;
    label: string;
    text: string;
    /** 1 for a buff, −1 for a nerf. */
    sign: 1 | -1;
}

/** `+10%`, `+2`, `−1`: a signed amount with the row's unit. */
export function signed(n: number, unit?: string): string {
    return `${n < 0 ? "−" : "+"}${Math.abs(n)}${unit === "%" ? "%" : ""}`;
}

/** The modifier's non-zero stats, labelled and signed; nerfs come out as nerfs. */
export function modifierParts(modifier: Stats): ModifierPart[] {
    return STAT_KEYS.filter((k) => modifier[k] !== 0).map((key) => {
        const row = VISIBLE.find((r) => r.key === key);
        return {
            key,
            label: row?.label ?? key,
            text: signed(modifier[key], row?.unit),
            sign: modifier[key] < 0 ? -1 : 1,
        };
    });
}
