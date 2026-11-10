// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ghosts Move package frontend behind Headquarters: the shared `Registry`
 * (account directory plus the hire presets) and the player's `Account` with
 * its recruits, armory and upgrades. Reads decode BCS like everything else in
 * this folder; writes are small transactions run through `useGhostsAction`,
 * which reads what each one wrote straight into those reads before it
 * settles. Ids come from `GHOSTS` in `src/constants.ts`; `ghostsEnabled`
 * answers whether they are set.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { BcsType } from "@mysten/sui/bcs";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveDynamicFieldID } from "@mysten/sui/utils";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { VisualAreas } from "@ghosts/squad/appearance/codec";
import { GHOSTS } from "../constants";
import { Account, AccountRecord, Armor, Recruit, Registry, Weapon } from "./bcs";
import type { ExecutedOrder } from "./fast-lane";
import { RANKS } from "./match-rules";
import { absorbWrites, current, useBcsObject } from "./objects";
import { trackSaving } from "./saving";
import { sendOrder } from "./sender";

type Client = ReturnType<typeof useCurrentClient>;

/** Whether the package ids are configured (set after publish). */
export const ghostsEnabled = !!GHOSTS.package && !!GHOSTS.registry;

/** The squad an `Account` can always hold for free (`FREE_RECRUITS`). */
export const FREE_RECRUITS = 3;
/** How many recruits an `Account` can hold, paid for past the free squad. */
export const MAX_RECRUITS = 8;
/** What a recruit costs past the free squad. */
export const HIRE_PRICE = 50;

/** Voice configurations: the four on chain, all recorded. */
export const VOICES = [
    { id: 0, label: "Male · 01", available: true },
    { id: 1, label: "Female · 01", available: true },
    { id: 2, label: "Male · 02", available: true },
    { id: 3, label: "Female · 02", available: true },
] as const;

/** A weapon upgrade's mint function in `ghosts::items`, by catalog family. */
/** The upgrade kinds of `ghosts::items`. */
export const UPGRADE_KINDS = { scope: 0, laser: 1, stock: 2, clip: 3 } as const;

/** What gear costs in `ghosts::items`, by tier. */
const PRICES = {
    rifle: [100, 300, 800],
    armor: [100, 250, 500],
    upgrade: [75, 150, 300],
};

/** The rank needed to be issued gear from `ghosts::items`, by tier. */
const REQUIRED_RANKS = {
    rifle: ["Rookie", "Corporal", "Lieutenant"],
    armor: ["Rookie", "Squaddie", "Sergeant"],
} as const;

/** What a piece of gear costs. */
export function priceOf({ kind, tier }: Requisition): number {
    return (kind === "rifle" || kind === "armor" ? PRICES[kind] : PRICES.upgrade)[tier - 1];
}

/** The rank needed to be issued a piece of gear from the catalog. */
export function rankFor({ kind, tier }: Requisition): string {
    return kind === "rifle" || kind === "armor" ? REQUIRED_RANKS[kind][tier - 1] : "Rookie";
}

/** Whether a recruit's rank allows being issued the gear. */
export function rankAllows(
    recruit: { rank: { $kind: string } },
    gear: { requiredRank?: { $kind: string } },
): boolean {
    const order = RANKS as readonly string[];
    return order.indexOf(recruit.rank.$kind) >= order.indexOf(gear.requiredRank?.$kind ?? "Rookie");
}

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
/** The registry's table of accounts; it never moves. */
let accountTable: Promise<string> | null = null;
/** Accounts found by address: one never changes once opened. */
const accountIds = new Map<string, string>();

/** Where the registry files the `Account` of `owner`. */
async function accountFieldId(client: Client, owner: string): Promise<string> {
    accountTable ??= client.core
        .getObject({ objectId: GHOSTS.registry, include: { content: true } })
        .then(({ object }) => Registry.parse(object.content).accounts.id);
    accountTable.catch(() => (accountTable = null));
    return deriveDynamicFieldID(
        await accountTable,
        "address",
        bcs.Address.serialize(owner).toBytes(),
    );
}

/**
 * The `Account` id of `owner`, or null without one. `opened`: one was just
 * opened, so a node a moment behind is asked again before taking no for an answer.
 */
export async function fetchAccountId(
    client: Client,
    owner: string,
    opened = false,
): Promise<string | null> {
    const fieldId = accountIds.has(owner) ? "" : await accountFieldId(client, owner);
    for (let attempt = 0; ; attempt++) {
        const known = accountIds.get(owner);
        if (known) return known;
        try {
            const { object: field } = await client.core.getObject({
                objectId: fieldId,
                include: { content: true },
            });
            const id = AccountRecord.parse(field.content).value;
            accountIds.set(owner, id);
            return id;
        } catch {
            // no account for this address yet
            if (!opened || attempt >= 6) return null;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
}

/**
 * A write that opened the player's `Account`: file its id and the account
 * itself from the response, so the steps after it and the screens have both
 * without a read.
 */
async function noteOpenedAccount(
    client: Client,
    queryClient: QueryClient,
    owner: string,
    { written }: ExecutedOrder,
) {
    if (accountIds.has(owner)) return;
    const fieldId = await accountFieldId(client, owner).catch(() => "");
    const record = written.find((object) => object.objectId === fieldId)?.contents;
    if (!record) return;
    const id = AccountRecord.parse(record).value;
    accountIds.set(owner, id);
    queryClient.setQueryData(["ghosts", "account-id", owner], id);
    const account = written.find((object) => object.objectId === id);
    if (account?.contents && current(id, account.version))
        queryClient.setQueryData(["object", id], Account.parse(account.contents));
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

/** The player's `Account` object, re-read every `refetchInterval` while given. */
export function useGhostsAccount(id?: string | null, refetchInterval?: number) {
    return useBcsObject({ id, schema: Account, refetchInterval });
}

/** An entry of an `ObjectTable`: the object, and the dynamic field holding it. */
type Entry<T> = T & { objectId: string; fieldId?: string };

/**
 * Every object stored in an `ObjectTable`, decoded. `size` is the table's
 * length as its parent reports it: a node a moment behind lists fewer entries,
 * or an entry as it was before a write, so either is read again until it
 * catches up.
 */
async function listTable<T, Input>(
    client: Client,
    tableId: string,
    size: number,
    schema: BcsType<T, Input>,
): Promise<Entry<T>[]> {
    let entries: Entry<T>[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        const fields: { objectId: string; fieldId: string }[] = [];
        let cursor: string | undefined;
        do {
            const page = await client.core.listDynamicFields({ parentId: tableId, cursor });
            for (const field of page.dynamicFields)
                if (field.$kind === "DynamicObject")
                    fields.push({ objectId: field.childId, fieldId: field.fieldId });
            cursor = page.hasNextPage ? (page.cursor ?? undefined) : undefined;
        } while (cursor);
        let behind = fields.length < size;
        if (!behind) {
            entries = await Promise.all(
                fields.map(async ({ objectId, fieldId }) => {
                    const { object } = await client.core.getObject({
                        objectId,
                        include: { content: true },
                    });
                    if (!current(objectId, object.version)) behind = true;
                    return { ...schema.parse(object.content), objectId, fieldId };
                }),
            );
        }
        if (!behind || attempt === 5) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    return entries;
}

/** How each table's entries decode, so a write can be read straight into it. */
const tables = new Map<string, { name: string; schema: BcsType<unknown> }>();

export function useTable<T, Input>(
    name: string,
    table: { id: string; size: string } | undefined,
    schema: BcsType<T, Input>,
) {
    const client = useCurrentClient();
    if (table) tables.set(table.id, { name, schema: schema as BcsType<unknown> });
    return useQuery({
        queryKey: ["ghosts", name, table?.id, table?.size],
        enabled: !!table,
        placeholderData: (previous) => previous,
        queryFn: () => listTable(client, table!.id, Number(table!.size), schema),
    });
}

/**
 * Bring every table read in line with what a write left: entries it changed are
 * decoded from the response, entries it took out are dropped, and entries it put
 * in are found by the dynamic field it made for them. The result is filed under
 * the table's new size, which is what the screens ask for next; a table the
 * response cannot account for is read again.
 */
function absorbTables(queryClient: QueryClient, { written, removed }: ExecutedOrder) {
    const byId = new Map(written.map((object) => [object.objectId, object]));
    const gone = new Set(removed);
    for (const [tableId, { name, schema }] of tables) {
        const queries = queryClient
            .getQueryCache()
            .findAll({ queryKey: ["ghosts", name, tableId] })
            .filter((query) => query.state.data !== undefined);
        if (!queries.length) continue;
        const latest = queries.reduce((a, b) =>
            b.state.dataUpdatedAt > a.state.dataUpdatedAt ? b : a,
        );
        const before = latest.state.data as Entry<unknown>[];
        let touched = false;
        let unaccounted = false;
        const after: Entry<unknown>[] = [];
        for (const entry of before) {
            const object = byId.get(entry.objectId);
            const { fieldId } = entry;
            if (gone.has(entry.objectId) || (fieldId && gone.has(fieldId))) touched = true;
            else if (!object) after.push(entry);
            else if (!fieldId || !object.contents) {
                after.push(entry);
                unaccounted = true;
            } else if (object.parent !== fieldId) touched = true;
            else {
                touched = true;
                after.push({
                    ...(schema.parse(object.contents) as object),
                    objectId: entry.objectId,
                    fieldId,
                });
            }
        }
        const held = new Set(after.map((entry) => entry.objectId));
        for (const object of written) {
            const field = object.parent ? byId.get(object.parent) : undefined;
            if (field?.parent !== tableId || held.has(object.objectId)) continue;
            touched = true;
            if (!object.contents) unaccounted = true;
            else
                after.push({
                    ...(schema.parse(object.contents) as object),
                    objectId: object.objectId,
                    fieldId: field.objectId,
                });
        }
        if (unaccounted)
            void queryClient.invalidateQueries({ queryKey: ["ghosts", name, tableId] });
        else if (touched)
            queryClient.setQueryData(["ghosts", name, tableId, String(after.length)], after);
    }
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

/**
 * Every read Headquarters and the Armory open on — account id, account,
 * recruits, armory — kept warm while a wallet is connected. The shell mounts
 * `SquadPreload`, so the squad is in the cache before anyone opens it and the
 * screens start on data instead of a loader; writes refresh the same queries.
 */
export function SquadPreload() {
    const accountId = useAccountId();
    const account = useGhostsAccount(accountId.data);
    useChainRecruits(account.data);
    useArmory(account.data);
    return null;
}

// === Writes ===

/** Builds one transaction; may read the chain (results of earlier steps). */
export type Step = () => Transaction | Promise<Transaction>;

/**
 * Runs transactions one after the other, each signed and executed in one call,
 * and reads what each wrote straight into the screens' reads, so the screen
 * shows the outcome when `busy` clears. The whole run counts as saving for the
 * corner spinner.
 */
export function useGhostsAction() {
    const client = useCurrentClient();
    const owner = useCurrentAccount()?.address;
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function steps(list: Step[]) {
        let digest = "";
        for (const build of list) {
            const sent = sendOrder(await build());
            if (!sent) throw new Error("Sign in to continue.");
            const executed = await sent;
            digest = executed.digest;
            absorbWrites(queryClient, executed.written);
            absorbTables(queryClient, executed);
            if (owner) await noteOpenedAccount(client, queryClient, owner, executed);
        }
        // An `Account` the response did not account for: wait for it and look again.
        if (owner && digest && !queryClient.getQueryData(["ghosts", "account-id", owner])) {
            await client.core.waitForTransaction({ digest });
            await queryClient.invalidateQueries({ queryKey: ["ghosts", "account-id", owner] });
        }
    }

    async function run(list: Step[]): Promise<boolean> {
        setError("");
        setBusy(true);
        try {
            await trackSaving(steps(list));
            return true;
        } catch (e) {
            setError(friendlyError(e));
            return false;
        } finally {
            setBusy(false);
        }
    }

    return { busy, error, clearError: () => setError(""), run, client };
}

/** A failed save in the player's terms; the raw message when nothing matches. */
export function friendlyError(e: unknown): string {
    const message = e instanceof Error ? e.message : String(e);
    if (
        /insufficient SUI balance|gas selection|InsufficientGas|InsufficientCoinBalance/i.test(
            message,
        )
    )
        return "Not enough SUI for the network fee. Add test funds in Settings.";
    if (/reject|cancel|abort(ed)? by user|NotAllowedError/i.test(message)) return "Cancelled.";
    if (/Failed to fetch|NetworkError|timed? ?out/i.test(message))
        return "Connection lost. Try again.";
    if (/function_name: Some\("(hire_recruit|buy_\w+|spend)"\).*, 7\)/.test(message))
        return "Not enough credits.";
    if (/function_name: Some\("equip_\w+"\).*, 8\)/.test(message))
        return "That recruit's rank is too low for this gear.";
    if (/function_name: Some\("cancel_search"\).*, 25\)/.test(message))
        return "A match was just found: joining it.";
    return message;
}

const target = (fn: string) => `${GHOSTS.package}::account::${fn}`;

/** Create the player's `Account` — one per address, held by the `Registry`. */
export function createAccountTx(): Transaction {
    const tx = new Transaction();
    tx.moveCall({ target: target("new_account"), arguments: [tx.object(GHOSTS.registry)] });
    return tx;
}

/** One more recruit past the free squad, for `HIRE_PRICE` credits. */
export function hireRecruitTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("hire_recruit"),
        arguments: [tx.object(accountId), tx.object(GHOSTS.registry), tx.object.random()],
    });
    return tx;
}

/** Top the squad up to the free recruits; names, looks and voices are rolled on chain. */
export function hireRecruitsTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("hire_recruits"),
        arguments: [tx.object(accountId), tx.object(GHOSTS.registry), tx.object.random()],
    });
    return tx;
}

/** Dismiss a recruit for good; their weapon and armor go back to the armory. */
export function dismissRecruitTx(accountId: string, recruitId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("dismiss_recruit"),
        arguments: [tx.object(accountId), tx.pure.id(recruitId)],
    });
    return tx;
}

/** A recruit's looks (the codec's five areas) and voice, as `edit_recruit` takes them. */
export interface RecruitEdit {
    recruitId: string;
    areas: VisualAreas;
    voice: number;
}

/** Save looks and voice for any number of recruits in one transaction. */
export function editRecruitsTx(accountId: string, edits: RecruitEdit[]): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    for (const { recruitId, areas, voice } of edits)
        tx.moveCall({
            target: target("edit_recruit"),
            arguments: [
                acc,
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
    family: keyof typeof UPGRADE_KINDS;
    tier: number;
}

/**
 * Bring a weapon's fittings to `desired` in one transaction: an issued weapon
 * comes off its recruit first (the chain only modifies armory weapons),
 * unwanted fittings go back to stock, wanted ones come from stock — minted
 * on the spot when there is none, for its price — and the weapon goes
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
            tx.moveCall({
                target: target("buy_upgrade"),
                arguments: [
                    acc,
                    tx.pure.u8(UPGRADE_KINDS[fitting.family]),
                    tx.pure.u8(fitting.tier),
                ],
            });
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
    { kind: "rifle" | "armor"; tier: number } | { kind: keyof typeof UPGRADE_KINDS; tier: number };

/** Buy a piece of gear, into the racks. */
export function requisitionTx(accountId: string, { kind, tier }: Requisition): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    if (kind === "rifle" || kind === "armor") {
        tx.moveCall({
            target: target(kind === "rifle" ? "buy_rifle" : "buy_armor"),
            arguments: [acc, tx.pure.u8(tier)],
        });
    } else {
        tx.moveCall({
            target: target("buy_upgrade"),
            arguments: [acc, tx.pure.u8(UPGRADE_KINDS[kind]), tx.pure.u8(tier)],
        });
    }
    return tx;
}
