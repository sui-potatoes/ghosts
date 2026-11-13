// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The armory's model: every weapon and armor the account holds — stored or
 * issued — and a weapon's fit, one tier per attachment family. A fit maps
 * family to tier, so "one of each family" holds by construction; the limit
 * of `MAX_FITTINGS` is checked where fits change. Stats come from the catalog
 * presets, which mirror what `ghosts::items` mints.
 */

import { ATTACHMENTS, ATTACHMENT_SLOTS } from "@ghosts/squad/catalog";
import { EMPTY, ITEM_STATS, unpack, type Stats } from "@ghosts/squad/stats";
import type { Attachment, AttachmentSlot, WeaponAttachments } from "@ghosts/squad/types";

import type { ChainRecruit, Fitting } from "../../chain";
import {
    modifierParts,
    weaponProfile,
    baseFromTotal,
    type ModFitting,
    type WeaponProfile,
} from "./fittings";
import { armorModel, upgradeModel, weaponModel } from "./mapping";

/** Fittings a weapon takes (`weapon::add_upgrade`): one per kind, three in all. */
export const MAX_FITTINGS = 3;

/** A weapon's fittings: tier by attachment family. */
export type Fit = Partial<Record<AttachmentSlot, number>>;

/** A packed `ghosts::stats::Stats`, as the BCS decoder returns it. */
export interface PackedStats {
    value: string | bigint;
}
export interface GearUpgrade {
    name: string;
    /** The modifier the upgrade carries. */
    modifier?: PackedStats;
}
export interface Gear {
    id: string;
    name: string;
    /** The item's stats as the chain holds them: a weapon's include its upgrades. */
    stats?: PackedStats;
    upgrades?: GearUpgrade[];
    requiredRank?: { $kind: string };
}
/** A weapon or armor with where it is: the armory, or a recruit. */
export interface Held<T extends Gear> {
    item: T;
    carrier: ChainRecruit | null;
}

export const attachmentFor = (slot: AttachmentSlot, tier: number): Attachment | undefined =>
    ATTACHMENTS.find((a) => a.slot === slot && a.tier === tier);

/** The fit a list of on-chain upgrades amounts to. */
export function fitOf(upgrades: GearUpgrade[] = []): Fit {
    const fit: Fit = {};
    for (const u of upgrades) {
        const model = upgradeModel(u);
        if (model && fit[model.slot] === undefined) fit[model.slot] = model.tier;
    }
    return fit;
}

export const fitCount = (fit: Fit) => ATTACHMENT_SLOTS.filter((s) => fit[s]).length;

export const sameFit = (a: Fit, b: Fit) =>
    ATTACHMENT_SLOTS.every((s) => (a[s] ?? 0) === (b[s] ?? 0));

/** The fit as the studio's attachment ids, for the 3D preview. */
export function fitAttachments(fit: Fit): WeaponAttachments {
    const out: WeaponAttachments = {};
    for (const slot of ATTACHMENT_SLOTS) {
        const tier = fit[slot];
        if (tier) out[slot] = attachmentFor(slot, tier)?.id ?? null;
    }
    return out;
}

/** The fit as `fittingsTx` takes it. */
export function fittingsOf(fit: Fit): Fitting[] {
    return ATTACHMENT_SLOTS.flatMap((slot) => {
        const a = fit[slot] ? attachmentFor(slot, fit[slot]!) : undefined;
        return a ? [{ name: a.name, family: slot, tier: a.tier }] : [];
    });
}

const statsOf = (packed: PackedStats): Stats => unpack(BigInt(packed.value));

/** What an upgrade does: the chain object's modifier, else its catalog entry's. */
export const upgradeModifier = (u: GearUpgrade): Stats => {
    if (u.modifier) return statsOf(u.modifier);
    const model = upgradeModel(u);
    return model ? unpack(model.packed) : EMPTY;
};

/** A catalog attachment as a fitting, with the modifier the mint functions give it. */
export const attachmentFitting = (a: Attachment): ModFitting<AttachmentSlot> => ({
    slot: a.slot,
    name: a.name,
    modifier: unpack(a.packed),
});

/** The mod's modifier as text: "+2 Range", "−5% Aim". */
export const modifierSummary = (modifier: Stats): string =>
    modifierParts(modifier)
        .map((m) => `${m.text} ${m.label}`)
        .join(" · ");

/**
 * A weapon's stats: the base weapon, what its fitted upgrades make of it, and
 * what the draft would. The chain's `Weapon.stats` already include the fitted
 * upgrades (`add_upgrade`), so the base is that total with their modifiers taken
 * off again; a weapon without chain stats starts from the catalog preset.
 */
export function weaponView(weapon: Gear, draft: Fit): WeaponProfile<AttachmentSlot> {
    const upgrades = weapon.upgrades ?? [];
    const fitted: ModFitting<AttachmentSlot>[] = upgrades.map((u) => ({
        slot: upgradeModel(u)?.slot ?? null,
        name: u.name,
        modifier: upgradeModifier(u),
    }));
    const preset = ITEM_STATS[weaponModel(weapon)];
    const base = weapon.stats
        ? baseFromTotal(
              statsOf(weapon.stats),
              fitted.map((f) => f.modifier),
              preset,
          )
        : (preset ?? EMPTY);
    const wanted = ATTACHMENT_SLOTS.flatMap((slot) => {
        const a = draft[slot] ? attachmentFor(slot, draft[slot]!) : undefined;
        return a ? [attachmentFitting(a)] : [];
    });
    return weaponProfile({ base, fitted, draft: wanted, slots: ATTACHMENT_SLOTS });
}

/** An armor's modifier: the chain's stats, else the catalog preset. */
export const armorStats = (armor: Gear): Stats =>
    armor.stats ? statsOf(armor.stats) : (ITEM_STATS[armorModel(armor)] ?? EMPTY);

/** Every weapon the account holds: issued ones first, then the armory's. */
export function weaponInventory<T extends Gear>(
    stored: T[],
    recruits: ChainRecruit[],
): Held<Gear>[] {
    const issued = recruits.flatMap((r) => (r.weapon ? [{ item: r.weapon, carrier: r }] : []));
    return [...issued, ...stored.map((item) => ({ item: item as Gear, carrier: null }))];
}

/** Every armor the account holds: worn ones first, then the armory's. */
export function armorInventory<T extends Gear>(
    stored: T[],
    recruits: ChainRecruit[],
): Held<Gear>[] {
    const worn = recruits.flatMap((r) => (r.armor ? [{ item: r.armor, carrier: r }] : []));
    return [...worn, ...stored.map((item) => ({ item: item as Gear, carrier: null }))];
}

/** Upgrades in stock (unfitted), counted by catalog attachment id. */
export function stockCounts(upgrades: GearUpgrade[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const u of upgrades) {
        const model = upgradeModel(u);
        if (model) counts[model.id] = (counts[model.id] ?? 0) + 1;
    }
    return counts;
}
