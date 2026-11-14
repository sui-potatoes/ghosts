// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Armory's rules as plain functions, tested in `tests/hq-armory.test.ts`:
 * drafting a weapon's mods (one per kind, three at most — the chain's own
 * `weapon::add_upgrade` rule), what applying a draft sends (kept, stripped,
 * taken from storage, requisitioned), and what issuing an item to a recruit
 * does (issue, swap, the one utility slot).
 */

import { ATTACHMENTS } from "@ghosts/squad/catalog";
import type { Attachment, AttachmentSlot } from "@ghosts/squad/types";

/** Mods a weapon takes in all (`weapon::add_upgrade`). */
export const MAX_FITTINGS = 3;

/** The four mod kinds, in the order the bench lists them. */
export const MOD_SLOTS: AttachmentSlot[] = ["scope", "laser", "stock", "clip"];

/** A weapon's mods: tier by kind, so one per kind holds by construction. */
export type Fit = Partial<Record<AttachmentSlot, number>>;

export const attachmentFor = (slot: AttachmentSlot, tier: number): Attachment | undefined =>
    ATTACHMENTS.find((a) => a.slot === slot && a.tier === tier);

export const fitCount = (fit: Fit) => MOD_SLOTS.filter((s) => fit[s]).length;

export const sameFit = (a: Fit, b: Fit) => MOD_SLOTS.every((s) => (a[s] ?? 0) === (b[s] ?? 0));

/** The refusal when a fourth kind is drafted. */
export const LIMIT_REASON = "Three mods at most. Clear one first";

/**
 * Put `tier` of a kind into a draft (null clears the kind). A tier replaces
 * the kind's current one; a new kind past the limit is refused with the reason.
 */
export function draftMod(
    fit: Fit,
    slot: AttachmentSlot,
    tier: number | null,
): { fit: Fit } | { deny: string } {
    if (tier === null) {
        const next = { ...fit };
        delete next[slot];
        return { fit: next };
    }
    if (!fit[slot] && fitCount(fit) >= MAX_FITTINGS) return { deny: LIMIT_REASON };
    return { fit: { ...fit, [slot]: tier } };
}

/** What applying a draft does, by mod name, the way `fittingsTx` builds it. */
export interface FitPlan {
    /** Fitted and still wanted: untouched. */
    keep: string[];
    /** Fitted and not wanted: back into storage. */
    strip: string[];
    /** Wanted and in storage: taken from there. */
    take: string[];
    /** Wanted and not in storage: requisitioned on the spot, free. */
    requisition: string[];
}

/**
 * `fitted`: the names of the mods on the weapon; `draft`: the wanted fit;
 * `stock`: names of the mods in storage (one entry per object). A stripped
 * mod goes to storage only after the wanted ones are taken, as in the
 * transaction, so it is never reused within the same apply.
 */
export function fitPlan(fitted: string[], draft: Fit, stock: string[]): FitPlan {
    const wanted = MOD_SLOTS.flatMap((slot) => {
        const a = draft[slot] ? attachmentFor(slot, draft[slot]!) : undefined;
        return a ? [a.name] : [];
    });
    const keep: string[] = [];
    const strip: string[] = [];
    const rest = [...wanted];
    for (const name of fitted) {
        const at = rest.indexOf(name);
        if (at >= 0) {
            rest.splice(at, 1);
            keep.push(name);
        } else strip.push(name);
    }
    const pool = [...stock];
    const take: string[] = [];
    const requisition: string[] = [];
    for (const name of rest) {
        const at = pool.indexOf(name);
        if (at >= 0) {
            pool.splice(at, 1);
            take.push(name);
        } else requisition.push(name);
    }
    return { keep, strip, take, requisition };
}

/** The draft's changes in the bar's words: "2 changes · 1 requisitioned". */
export function planSummary(plan: FitPlan): string {
    const changes = plan.strip.length + plan.take.length + plan.requisition.length;
    if (!changes) return "No changes";
    const parts = [`${changes} ${changes === 1 ? "change" : "changes"}`];
    if (plan.requisition.length) parts.push(`${plan.requisition.length} requisitioned, free`);
    return parts.join(" · ");
}

/** What a recruit holds in the slot an item would go into. */
export interface Holder {
    id: string;
    name: string;
    /** The item(s) in that slot now, in slot order. */
    holding: { id: string; name: string }[];
}

/** What issuing an item to a recruit does. */
export type IssueTo =
    /** The recruit carries it already. */
    | { verb: "Carrying" }
    /**
     * `from`: the carrier it comes off (null: out of storage). `replace`: a
     * utility taken off the target in the same transaction. `returns`: the
     * name of what goes back to storage.
     */
    | { verb: "Issue" | "Swap"; from: string | null; replace?: string; returns?: string };

/**
 * `carrier`: who holds the item now (null: storage). For a utility, a full
 * slot (`slots` utilities) swaps its first one out; weapons and armor swap
 * the target's own piece.
 */
export function issueTo(
    kind: "weapon" | "armor" | "utility",
    itemId: string,
    carrier: string | null,
    target: Holder,
    slots = 1,
): IssueTo {
    if (carrier === target.id || target.holding.some((h) => h.id === itemId))
        return { verb: "Carrying" };
    if (kind !== "utility") {
        const own = target.holding[0];
        return own
            ? { verb: "Swap", from: carrier, returns: own.name }
            : { verb: "Issue", from: carrier };
    }
    if (target.holding.length < slots) return { verb: "Issue", from: carrier };
    const out = target.holding[0];
    return { verb: "Swap", from: carrier, replace: out.id, returns: out.name };
}
