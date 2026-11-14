// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Armory's entries: what the account holds per tab (in storage or
 * carried), the supply catalog in the same shape, and the catalog copy.
 * Item descriptions are the catalog's (`packages/catalog`), matched by the
 * names the contracts mint.
 */

import { ATTACHMENTS, itemById } from "@ghosts/squad/catalog";
import type { Attachment } from "@ghosts/squad/types";

import actionsCatalog from "../../../../../packages/catalog/actions.json";
import itemsCatalog from "../../../../../packages/catalog/items.json";
import type {
    ChainArmor,
    ChainRecruit,
    ChainUpgrade,
    ChainUtility,
    ChainWeapon,
} from "../../../chain";
import { fitOf, stockCounts, type Gear } from "../armory";
import { armorModel, utilityModel, weaponModel } from "../mapping";
import { weaponName } from "../squad/rules";
import { REQUISITIONABLE } from "../utilities";
import { MOD_SLOTS } from "./rules";
import type { Order } from "./types";

export type Tab = "weapons" | "armor" | "mods" | "utilities";

export const TABS: { id: Tab; label: string }[] = [
    { id: "weapons", label: "Weapons" },
    { id: "armor", label: "Armor" },
    { id: "mods", label: "Mods" },
    { id: "utilities", label: "Utilities" },
];

interface RawItem {
    type: string;
    status: string;
    name: string;
    description: string;
    tier?: number;
    actions?: { kind: string; uses: number | null }[];
}
const ITEMS = (itemsCatalog.items as RawItem[]).filter((i) => i.status === "chain");

/** The catalog's description of an item, by the name the contracts mint. */
export const describe = (name: string): string | undefined =>
    ITEMS.find((i) => i.name === name)?.description;

const usesLabel = (uses: number | null) => (uses === null ? "Unlimited" : `${uses} per match`);

/** What a utility grants, by action: "Throw grenade · 1 per match". */
export function grants(actions: { kind: string; uses: number | null }[]): string[] {
    return actions.map((a) => {
        const name =
            (actionsCatalog.actions as { id: string; name: string }[]).find((x) => x.id === a.kind)
                ?.name ?? a.kind;
        return `${name} · ${usesLabel(a.uses)}`;
    });
}

/** A utility object's actions as `grants` takes them. */
export const utilityGrants = (u: { actions: ChainUtility["actions"] }) =>
    grants(u.actions.map((a) => ({ kind: a.kind.$kind, uses: a.uses })));

/** A weapon, armor or utility the account holds, and who carries it. */
export type HeldEntry = {
    kind: "weapon" | "armor" | "utility";
    /** The object id (the row's and the deep link's). */
    id: string;
    name: string;
    /** The catalog id for thumbnails and the stage; none for a utility without a model. */
    model?: string;
    carrier: ChainRecruit | null;
    /** The weapon or armor as `armory.ts` reads it. */
    gear?: Gear;
    utility?: ChainUtility;
};

/** A mod kind and tier the account holds: in storage, fitted, or both. */
export type ModEntry = {
    kind: "mod";
    id: string;
    name: string;
    attachment: Attachment;
    stock: number;
    /** The weapons it is fitted on. */
    fittedOn: HeldEntry[];
};

export type Entry = HeldEntry | ModEntry;

/** One line of the supply catalog. */
export type SupplyEntry = {
    kind: "supply";
    tab: Tab;
    id: string;
    name: string;
    /** The catalog id for the thumbnail and the stage. */
    model?: string;
    attachment?: Attachment;
    order: Order;
    /** The utility's actions, from the catalog. */
    actions?: { kind: string; uses: number | null }[];
};

const recruitsCarrying = <T>(recruits: ChainRecruit[], pick: (r: ChainRecruit) => T[]) =>
    recruits.flatMap((r) => pick(r).map((item) => ({ item, carrier: r })));

export function heldEntries(
    storage: { weapons: ChainWeapon[]; armors: ChainArmor[]; utilities: ChainUtility[] },
    recruits: ChainRecruit[],
) {
    const weapons: HeldEntry[] = [
        ...recruitsCarrying(recruits, (r) => (r.weapon ? [r.weapon] : [])),
        ...storage.weapons.map((item) => ({ item, carrier: null })),
    ].map(({ item, carrier }) => ({
        kind: "weapon",
        id: item.id,
        name: weaponName(item),
        model: weaponModel(item),
        carrier,
        gear: item,
    }));
    const armors: HeldEntry[] = [
        ...recruitsCarrying(recruits, (r) => (r.armor ? [r.armor] : [])),
        ...storage.armors.map((item) => ({ item, carrier: null })),
    ].map(({ item, carrier }) => ({
        kind: "armor",
        id: item.id,
        name: item.name,
        model: armorModel(item),
        carrier,
        gear: item,
    }));
    const utilities: HeldEntry[] = [
        ...recruitsCarrying(recruits, (r) =>
            r.utilities.map((u) => ({ ...u, objectId: u.id }) as ChainUtility),
        ),
        ...storage.utilities.map((item) => ({ item, carrier: null })),
    ].map(({ item, carrier }) => ({
        kind: "utility",
        id: item.id,
        name: item.name,
        model: utilityModel(item),
        carrier,
        utility: item,
    }));
    return { weapons, armors, utilities };
}

/** Every mod kind and tier held: in storage (counted) or fitted somewhere. */
export function modEntries(upgrades: ChainUpgrade[], weapons: HeldEntry[]): ModEntry[] {
    const stock = stockCounts(upgrades);
    return ATTACHMENTS.flatMap((a) => {
        const fittedOn = weapons.filter((w) => fitOf(w.gear?.upgrades)[a.slot] === a.tier);
        const count = stock[a.id] ?? 0;
        return count || fittedOn.length
            ? [
                  {
                      kind: "mod" as const,
                      id: a.id,
                      name: a.name,
                      attachment: a,
                      stock: count,
                      fittedOn,
                  },
              ]
            : [];
    }).sort((x, y) => MOD_SLOTS.indexOf(x.attachment.slot) - MOD_SLOTS.indexOf(y.attachment.slot));
}

const RIFLES = ITEMS.filter((i) => i.type === "weapon");
const ARMORS = ITEMS.filter((i) => i.type === "armor");

/** The supply catalog per tab, in the catalog's order. */
export const SUPPLY: Record<Tab, SupplyEntry[]> = {
    weapons: RIFLES.map((i) => ({
        kind: "supply",
        tab: "weapons",
        id: `rifle-${i.tier}`,
        name: i.name,
        model: weaponModel(i),
        order: { kind: "rifle", tier: i.tier ?? 1 },
    })),
    armor: ARMORS.map((i) => ({
        kind: "supply",
        tab: "armor",
        id: `armor-${i.tier}`,
        name: i.name,
        model: armorModel(i),
        order: { kind: "armor", tier: i.tier ?? 1 },
    })),
    mods: [...ATTACHMENTS]
        .sort((x, y) => MOD_SLOTS.indexOf(x.slot) - MOD_SLOTS.indexOf(y.slot) || x.tier - y.tier)
        .map((a) => ({
            kind: "supply",
            tab: "mods",
            id: a.id,
            name: a.name,
            model: a.id,
            attachment: a,
            order: { kind: a.slot, tier: a.tier },
        })),
    utilities: REQUISITIONABLE.map((u) => ({
        kind: "supply",
        tab: "utilities",
        id: `utility-${u.kind}`,
        name: u.name,
        model: utilityModel(u),
        order: { utility: u.kind },
        actions: ITEMS.find((i) => i.name === u.name)?.actions,
    })),
};

/** The stage model of a catalog id (`rifle`, `grenade`, …). */
export const stageModel = (catalogId: string | undefined) =>
    catalogId ? itemById(catalogId)?.model : undefined;
