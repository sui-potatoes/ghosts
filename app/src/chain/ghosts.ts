// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ghosts Move package frontend behind Headquarters: the shared `Registry`
 * (account directory plus the hire presets) and the player's `Account` with
 * its recruits, armory and upgrades. Reads decode BCS like everything else in
 * this folder; writes are small transactions run through `useGhostsAction`,
 * which waits for the chain and refreshes every ghosts read before it
 * settles. Ids come from `GHOSTS` in `src/constants.ts`; `ghostsEnabled`
 * answers whether they are set.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { BcsType } from "@mysten/sui/bcs";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveDynamicFieldID } from "@mysten/sui/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { VisualAreas } from "@ghosts/squad/appearance/codec";
import { GHOSTS } from "../constants";
import { Account, AccountRecord, Armor, Recruit, Registry, Weapon } from "./bcs";
import { useBcsObject } from "./objects";
import { sendTransaction } from "./sender";

type Client = ReturnType<typeof useCurrentClient>;

/** Whether the package ids are configured (set after publish). */
export const ghostsEnabled = !!GHOSTS.package && !!GHOSTS.registry;

/** The squad an `Account` can hold hired for free (`FREE_RECRUITS`). */
export const FREE_RECRUITS = 4;

/** Voice configurations: four on chain, the interface ships the first two. */
export const VOICES = [
    { id: 0, label: "Male · 01", available: true },
    { id: 1, label: "Female · 01", available: true },
    { id: 2, label: "Male · 02", available: false },
    { id: 3, label: "Female · 02", available: false },
] as const;

/** A weapon upgrade's mint function in `ghosts::items`, by catalog family. */
export const UPGRADE_MINTS = {
    scope: "scope",
    laser: "laser_sight",
    stock: "stock",
    clip: "expanded_clip",
} as const;

export type ChainRecruit = ReturnType<typeof Recruit.parse> & { objectId: string };
export type ChainWeapon = ReturnType<typeof Weapon.parse> & { objectId: string };
export type ChainArmor = ReturnType<typeof Armor.parse> & { objectId: string };
export type ChainAccount = ReturnType<typeof Account.parse>;
export type ChainUpgrade = ChainAccount["upgrades"][number];

// === Reads ===

/** The shared `Registry`: the accounts table and the hire presets. */
export function useRegistry() {
    return useBcsObject({ id: ghostsEnabled ? GHOSTS.registry : null, schema: Registry });
}

/** The `Account` id `owner` holds, read from `Registry.accounts`; null when none. */
export async function fetchAccountId(client: Client, owner: string): Promise<string | null> {
    const { object } = await client.core.getObject({
        objectId: GHOSTS.registry,
        include: { content: true },
    });
    const table = Registry.parse(object.content).accounts.id;
    const fieldId = deriveDynamicFieldID(table, "address", bcs.Address.serialize(owner).toBytes());
    try {
        const { object: field } = await client.core.getObject({
            objectId: fieldId,
            include: { content: true },
        });
        return AccountRecord.parse(field.content).value;
    } catch {
        return null; // no account for this address yet
    }
}

/** The connected player's `Account` id; `data` is null once the registry says there is none. */
export function useAccountId() {
    const client = useCurrentClient();
    const owner = useCurrentAccount()?.address;
    return useQuery({
        queryKey: ["ghosts", "account-id", owner],
        enabled: ghostsEnabled && !!owner,
        queryFn: () => fetchAccountId(client, owner!),
    });
}

/** The player's `Account` object. */
export function useGhostsAccount(id?: string | null) {
    return useBcsObject({ id, schema: Account });
}

/**
 * Every object stored in an `ObjectTable`, decoded. `size` is the table's
 * length as its parent reports it: listing lags the parent by a moment after
 * a write, so a short listing is retried until it catches up.
 */
async function listTable<T, Input>(
    client: Client,
    tableId: string,
    size: number,
    schema: BcsType<T, Input>,
): Promise<(T & { objectId: string })[]> {
    let ids: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        ids = [];
        let cursor: string | undefined;
        do {
            const page = await client.core.listDynamicFields({ parentId: tableId, cursor });
            for (const field of page.dynamicFields)
                if (field.$kind === "DynamicObject") ids.push(field.childId);
            cursor = page.hasNextPage ? (page.cursor ?? undefined) : undefined;
        } while (cursor);
        if (ids.length >= size) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    return Promise.all(
        ids.map(async (objectId) => {
            const { object } = await client.core.getObject({
                objectId,
                include: { content: true },
            });
            return { ...schema.parse(object.content), objectId };
        }),
    );
}

function useTable<T, Input>(
    name: string,
    table: { id: string; size: string } | undefined,
    schema: BcsType<T, Input>,
) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["ghosts", name, table?.id, table?.size],
        enabled: !!table,
        placeholderData: (previous) => previous,
        queryFn: () => listTable(client, table!.id, Number(table!.size), schema),
    });
}

/** The recruits stored in an `Account`. */
export function useChainRecruits(account?: ChainAccount) {
    return useTable("recruits", account?.recruits, Recruit);
}

/** The armory: unequipped weapons and armor stored in an `Account`. */
export function useArmory(account?: ChainAccount) {
    const weapons = useTable("weapons", account?.weapons, Weapon);
    const armors = useTable("armors", account?.armors, Armor);
    return { weapons: weapons.data ?? [], armors: armors.data ?? [] };
}

// === Writes ===

export interface Step {
    /** What the overlay says while this transaction is in flight. */
    label: string;
    /** Builds the transaction; may read the chain (results of earlier steps). */
    build: () => Transaction | Promise<Transaction>;
}

/**
 * Runs transactions one after the other — each signed, executed and waited
 * for — then refreshes every ghosts read, so the screen shows the outcome
 * when `busy` clears. `busy` carries the current step's label.
 */
export function useGhostsAction() {
    const client = useCurrentClient();
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState("");

    async function run(steps: Step[]): Promise<boolean> {
        setError("");
        try {
            for (const step of steps) {
                setBusy(step.label);
                const sent = sendTransaction(await step.build());
                if (!sent) throw new Error("Sign in to send transactions.");
                const { digest } = await sent;
                await client.core.waitForTransaction({ digest });
            }
            setBusy("Updating headquarters");
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["ghosts"] }),
                queryClient.invalidateQueries({ queryKey: ["object"] }),
            ]);
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setBusy(null);
        }
    }

    return { busy, error, clearError: () => setError(""), run, client };
}

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** Create the player's `Account` — one per address, held by the `Registry`. */
export function createAccountTx(): Transaction {
    const tx = new Transaction();
    tx.moveCall({ target: target("new_account"), arguments: [tx.object(GHOSTS.registry)] });
    return tx;
}

/** Top the squad up to four free recruits; names, looks and voices are rolled on chain. */
export function hireRecruitsTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("hire_recruits"),
        arguments: [tx.object(accountId), tx.object(GHOSTS.registry), tx.object.random()],
    });
    return tx;
}

/** Save a recruit's looks (the codec's five areas) and voice. */
export function editRecruitTx(
    accountId: string,
    recruitId: string,
    areas: VisualAreas,
    voice: number,
): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("edit_recruit"),
        arguments: [
            tx.object(accountId),
            tx.pure.id(recruitId),
            tx.pure.vector("u8", areas.head),
            tx.pure.vector("u8", areas.face),
            tx.pure.vector("u8", areas.eyes),
            tx.pure.vector("u8", areas.body),
            tx.pure.vector("u8", areas.outfit),
            tx.pure.u8(voice),
        ],
    });
    return tx;
}

/** Return a recruit's weapon to the armory. */
export function unequipWeaponTx(accountId: string, recruitId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("unequip_weapon"),
        arguments: [tx.object(accountId), tx.pure.id(recruitId)],
    });
    return tx;
}

/** Return a recruit's armor to the armory. */
export function unequipArmorTx(accountId: string, recruitId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("unequip_armor"),
        arguments: [tx.object(accountId), tx.pure.id(recruitId)],
    });
    return tx;
}

/** A requested weapon fitting: its upgrade name, family and tier. */
export interface Fitting {
    name: string;
    family: keyof typeof UPGRADE_MINTS;
    tier: number;
}

/**
 * Bring a weapon's fittings to `desired` in one transaction: an issued weapon
 * comes off its recruit first (the chain only modifies armory weapons),
 * unwanted fittings go back to stock, wanted ones come from stock — minted
 * on the spot when there is none (testnet requisition) — and the weapon goes
 * back to its recruit. Indices are tracked against a local copy of the
 * account's upgrade vector, mirroring `remove`/`push_back` on chain.
 */
export function fittingsTx(
    accountId: string,
    weapon: { id: string; upgrades: { name: string }[] },
    stock: { name: string }[],
    desired: Fitting[],
    carrier: string | null,
): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    const wid = tx.pure.id(weapon.id);
    const pool = stock.map((u) => u.name);
    const wanted = [...desired];

    if (carrier)
        tx.moveCall({ target: target("unequip_weapon"), arguments: [acc, tx.pure.id(carrier)] });

    // keep fittings still wanted; strip the rest, highest index first
    const fitted = weapon.upgrades.map((u) => u.name);
    for (let i = fitted.length - 1; i >= 0; i--) {
        const keep = wanted.findIndex((f) => f.name === fitted[i]);
        if (keep >= 0) {
            wanted.splice(keep, 1);
            continue;
        }
        tx.moveCall({
            target: target("detach_upgrade"),
            arguments: [acc, wid, tx.pure.u8(i)],
        });
        pool.push(fitted[i]);
    }

    for (const fitting of wanted) {
        let index = pool.indexOf(fitting.name);
        if (index < 0) {
            const [upgrade] = tx.moveCall({
                target: `${GHOSTS.package}::items::${UPGRADE_MINTS[fitting.family]}`,
                arguments: [tx.pure.u8(fitting.tier)],
            });
            tx.moveCall({ target: target("add_upgrade"), arguments: [acc, upgrade] });
            pool.push(fitting.name);
            index = pool.length - 1;
        }
        tx.moveCall({
            target: target("attach_upgrade"),
            arguments: [acc, wid, tx.pure.u64(index)],
        });
        pool.splice(index, 1);
    }

    if (carrier)
        tx.moveCall({
            target: target("equip_weapon"),
            arguments: [acc, tx.pure.id(carrier), wid],
        });
    return tx;
}

/**
 * Hand a weapon or armor to `to` in one transaction: off its current carrier
 * (when issued), the target's own piece back to the armory (when they have
 * one), then onto the target.
 */
export function issueTx(
    accountId: string,
    kind: "weapon" | "armor",
    itemId: string,
    from: string | null,
    to: { id: string; equipped: boolean },
): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    if (from)
        tx.moveCall({ target: target(`unequip_${kind}`), arguments: [acc, tx.pure.id(from)] });
    if (to.equipped && to.id !== from)
        tx.moveCall({ target: target(`unequip_${kind}`), arguments: [acc, tx.pure.id(to.id)] });
    tx.moveCall({
        target: target(`equip_${kind}`),
        arguments: [acc, tx.pure.id(to.id), tx.pure.id(itemId)],
    });
    return tx;
}

export type Requisition =
    { kind: "rifle" | "armor"; tier: number } | { kind: keyof typeof UPGRADE_MINTS; tier: number };

/**
 * Testnet requisition: mint gear with `ghosts::items` and deposit it into the
 * account. Free until the economy lands.
 */
export function requisitionTx(accountId: string, { kind, tier }: Requisition): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    const items = (fn: string) => `${GHOSTS.package}::items::${fn}`;
    if (kind === "rifle" || kind === "armor") {
        const [item] = tx.moveCall({ target: items(kind), arguments: [tx.pure.u8(tier)] });
        tx.moveCall({
            target: target(kind === "rifle" ? "add_weapon" : "add_armor"),
            arguments: [acc, item],
        });
    } else {
        const [upgrade] = tx.moveCall({
            target: items(UPGRADE_MINTS[kind]),
            arguments: [tx.pure.u8(tier)],
        });
        tx.moveCall({ target: target("add_upgrade"), arguments: [acc, upgrade] });
    }
    return tx;
}
