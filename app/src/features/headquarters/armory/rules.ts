// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Armory's rules as plain functions, tested in `tests/hq-armory.test.ts`:
 * drafting a weapon's mods (one per kind, three at most — the chain's own
 * `weapon::add_upgrade` rule), what applying a draft sends (kept, stripped,
 * taken from storage, requisitioned), what equipping an item on a recruit
 * does (equip, swap, the one utility slot), and how identical items stack
 * into one inventory row.
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

/** What equipping an item on a recruit does. */
export type IssueTo =
    /** The recruit has it equipped already. */
    | { verb: "Equipped" }
    /**
     * `from`: the carrier it comes off (null: out of storage). `replace`: a
     * utility taken off the target in the same transaction. `returns`: the
     * name of what goes back to storage.
     */
    | { verb: "Equip" | "Swap"; from: string | null; replace?: string; returns?: string };

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
        return { verb: "Equipped" };
    if (kind !== "utility") {
        const own = target.holding[0];
        return own
            ? { verb: "Swap", from: carrier, returns: own.name }
            : { verb: "Equip", from: carrier };
    }
    if (target.holding.length < slots) return { verb: "Equip", from: carrier };
    const out = target.holding[0];
    return { verb: "Swap", from: carrier, replace: out.id, returns: out.name };
}

/** An item as the inventory sees it: its object id, its name, and whether it is loose. */
export interface StackInput {
    id: string;
    name: string;
    /**
     * Interchangeable with every other loose item of its kind and name: in
     * storage, no fitted mods, no draft, no finish chosen.
     */
    loose: boolean;
}

/** One inventory row: a single item, or a stack of loose identical ones. */
export interface StackRow {
    /**
     * The row's id, stable while the row exists: `stack-<kind>-<name>` for a
     * stack (whatever its count), `item-<id>` for a single item.
     */
    key: string;
    /** Every object the row stands for; a single item has one. */
    ids: string[];
    /** The object an action on the row takes. */
    acting: string;
}

/**
 * Rows for one kind, in the order the items come: loose items of the same
 * name stack in the place of the first of them; anything else is its own
 * row. A stack acts with `prefer[key]` when that object is in it (a deep
 * link to it), otherwise with its lowest object id, so the choice does not
 * depend on the order the items were read in.
 */
export function stackRows(
    kind: string,
    items: StackInput[],
    prefer: Record<string, string> = {},
): StackRow[] {
    const rows: StackRow[] = [];
    const stacks = new Map<string, StackRow>();
    for (const item of items) {
        if (!item.loose) {
            rows.push({ key: `item-${item.id}`, ids: [item.id], acting: item.id });
            continue;
        }
        const key = `stack-${kind}-${item.name}`;
        const row = stacks.get(key);
        if (row) row.ids.push(item.id);
        else {
            const fresh = { key, ids: [item.id], acting: item.id };
            stacks.set(key, fresh);
            rows.push(fresh);
        }
    }
    for (const row of stacks.values()) {
        row.ids.sort();
        const wanted = prefer[row.key];
        row.acting = wanted && row.ids.includes(wanted) ? wanted : row.ids[0];
    }
    return rows;
}

/** The row that stands for an object, if any. */
export const rowOf = (rows: StackRow[], id: string) => rows.find((r) => r.ids.includes(id));

// === Bench commands =======================================================

/** The bits of a command the bench rules shape; the view's `Command` fits. */
export interface BenchCommand {
    action: "nav" | "confirm" | "reset" | "back";
    label: string;
    tone?: "primary" | "danger";
    deny?: string;
    click?: boolean;
}

/**
 * The command set of a row on a weapon's bench. With no draft a row keeps its
 * own (`own`: its primary Change / Fit / Equip, Back last). While the weapon
 * has unapplied mods Apply is the primary on every row (Confirm):
 * - a row whose own action waits on the draft (stats, Equipped by) gets
 *   Discard as the secondary (Reset);
 * - a slot or Finish row keeps its own action, demoted to the secondary
 *   (Reset, the inline chip and the right-click entry) and marked `click`, so
 *   a click still opens the picker and never applies by surprise. Its Clear
 *   waits (the picker's None clears), and Discard is the Discard row.
 * Back stays last either way: the bar's three slots are Confirm, Reset, Back.
 */
export function benchCommands<C extends BenchCommand>(
    dirty: boolean,
    own: C[],
    apply: C,
    discard: C,
    back: C,
    waits: boolean,
): C[] {
    if (!dirty) return own;
    if (waits) return [apply, discard, back];
    const action = own.find((c) => c.action === "confirm");
    if (!action) return [apply, discard, back];
    return [apply, { ...action, action: "reset", tone: undefined, click: true }, back];
}
