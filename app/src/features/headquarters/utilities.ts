// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The armory's utilities: what the account holds (stored or carried), the
 * copy the catalog has for each, and what a utility grants, read from the
 * decoded object (its actions and their uses) rather than from its name.
 */

import { STAT_KEYS, unpack, VISIBLE, type StatKey } from "@ghosts/squad/stats";

import actionsCatalog from "../../../../packages/catalog/actions.json";
import itemsCatalog from "../../../../packages/catalog/items.json";
import {
    UTILITY_KINDS,
    type ChainRecruit,
    type ChainUtility,
    type Step,
    equipUtilityTx,
    unequipUtilityTx,
} from "../../chain";
import type { Held } from "./armory";

/** Utilities a recruit carries at once (`recruit::MAX_UTILITIES`). */
export const MAX_UTILITIES = 1;

export interface UtilityCatalogEntry {
    id: string;
    name: string;
    description: string;
    /** The kind id `requisition_utility` takes. */
    kind: number;
}

interface RawItem {
    id: string;
    type: string;
    status: string;
    name: string;
    description: string;
    kind?: number;
}

/** Utilities the contracts create, from the catalog (the requisition list). */
export const UTILITY_CATALOG: UtilityCatalogEntry[] = (itemsCatalog.items as RawItem[])
    .filter((i) => i.type === "utility" && i.status === "chain" && i.kind !== undefined)
    .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        kind: i.kind!,
    }));

// The tx builder knows the same kinds; the catalog must not offer one it lacks.
const BUILDER_KINDS: number[] = Object.values(UTILITY_KINDS);
export type UtilityKind = (typeof UTILITY_KINDS)[keyof typeof UTILITY_KINDS];
export const REQUISITIONABLE = UTILITY_CATALOG.filter((u) =>
    BUILDER_KINDS.includes(u.kind),
) as (UtilityCatalogEntry & { kind: UtilityKind })[];

/** Catalog copy for an on-chain utility, matched by the name the contract gives it. */
export const catalogFor = (utility: { name: string }) =>
    UTILITY_CATALOG.find((u) => u.name === utility.name);

export interface ActionInfo {
    name: string;
    description: string;
    /** "1 use per match", "Unlimited". */
    uses: string;
}

interface RawAction {
    id: string;
    name: string;
    description: string;
}

const usesLabel = (uses: number | null) =>
    uses === null ? "Unlimited" : `${uses} ${uses === 1 ? "use" : "uses"} per match`;

/** The actions a utility grants, with the uses it comes with. */
export function utilityActions(utility: ChainUtility): ActionInfo[] {
    return utility.actions.map((a) => {
        const info = (actionsCatalog.actions as RawAction[]).find((x) => x.id === a.kind.$kind);
        return {
            name: info?.name ?? a.kind.$kind,
            description: info?.description ?? "",
            uses: usesLabel(a.uses),
        };
    });
}

/** The utility's stat modifiers that are not zero, labelled. */
export function utilityModifiers(utility: ChainUtility): { label: string; value: string }[] {
    const stats = unpack(BigInt(utility.stats.value));
    return STAT_KEYS.filter((k: StatKey) => stats[k] !== 0).map((k) => {
        const row = VISIBLE.find((r) => r.key === k);
        const n = stats[k];
        return {
            label: row?.label ?? k,
            value: `${n > 0 ? "+" : ""}${n}${row?.unit === "%" ? "%" : ""}`,
        };
    });
}

/** Every utility the account holds: carried ones first, then the armory's. */
export function utilityInventory(
    stored: ChainUtility[],
    recruits: ChainRecruit[],
): Held<ChainUtility>[] {
    const carried = recruits.flatMap((r) =>
        r.utilities.map((u) => ({
            item: { ...u, objectId: u.id } as ChainUtility,
            carrier: r,
        })),
    );
    return [...carried, ...stored.map((item) => ({ item, carrier: null }))];
}

/**
 * Issue a utility to `to`: off its carrier or out of the armory, with the
 * target's own utilities (past the cap) going back to the armory first.
 * Separate transactions in order; the contract has no combined move.
 */
export function issueUtilitySteps(
    accountId: string,
    held: Held<ChainUtility>,
    to: ChainRecruit,
): Step[] {
    const steps: Step[] = [];
    if (held.carrier)
        steps.push(() => unequipUtilityTx(accountId, held.carrier!.objectId, held.item.id));
    const making = to.utilities.length - MAX_UTILITIES + 1;
    for (const u of to.utilities.slice(0, Math.max(0, making)))
        steps.push(() => unequipUtilityTx(accountId, to.objectId, u.id));
    steps.push(() => equipUtilityTx(accountId, to.objectId, held.item.id));
    return steps;
}
