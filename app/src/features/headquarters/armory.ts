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
import { add, EMPTY, ITEM_STATS, unpack, type Stats } from "@ghosts/squad/stats";
import type { Attachment, AttachmentSlot, WeaponAttachments } from "@ghosts/squad/types";

import type { ChainRecruit, Fitting } from "../../chain";
import { armorModel, upgradeModel, weaponModel } from "./mapping";

/** Fittings a weapon takes (`weapon::add_upgrade`): one per kind, three in all. */
export const MAX_FITTINGS = 3;

/** A weapon's fittings: tier by attachment family. */
export type Fit = Partial<Record<AttachmentSlot, number>>;

export interface GearUpgrade {
    name: string;
}
export interface Gear {
    id: string;
    name: string;
    upgrades?: GearUpgrade[];
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

/** A weapon's stats with a fit: the base model, then each fitting's modifier. */
export function weaponStats(weapon: { name: string }, fit: Fit): Stats {
    let stats = ITEM_STATS[weaponModel(weapon)] ?? EMPTY;
    for (const slot of ATTACHMENT_SLOTS) {
        const a = fit[slot] ? attachmentFor(slot, fit[slot]!) : undefined;
        if (a) stats = add(stats, unpack(a.packed));
    }
    return stats;
}

export const armorStats = (armor: { name: string }): Stats =>
    ITEM_STATS[armorModel(armor)] ?? EMPTY;

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
