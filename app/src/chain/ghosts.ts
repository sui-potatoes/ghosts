// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ghosts Move package frontend behind Headquarters: the shared `Registry`
 * (account directory plus the hire presets) and the player's `Account`, with
 * the recruits, armory and stock of upgrades sent to it. Reads decode BCS like
 * everything else in this folder; writes are small transactions run through
 * `useGhostsAction`, which reads what each one wrote straight into those reads
 * before it settles. What an `Account` holds goes into a transaction by its id
 * alone: the fast lane passes it by the newest reference it knows, to be
 * received. Ids come from `GHOSTS` in `src/constants.ts`; `ghostsEnabled`
 * answers whether they are set.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { BcsType } from "@mysten/sui/bcs";
import { bcs } from "@mysten/sui/bcs";
import {
    Transaction,
    type TransactionArgument,
    type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
    deriveDynamicFieldID,
    normalizeStructTag,
    normalizeSuiAddress,
    normalizeSuiObjectId,
} from "@mysten/sui/utils";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { VisualAreas } from "@ghosts/squad/appearance/codec";
import { GHOSTS } from "../constants";
import {
    Account,
    AccountRecord,
    Armor,
    Recruit,
    Registry,
    Utility,
    Weapon,
    WeaponUpgrade,
} from "./bcs";
import { movedOn, noteOwned, type ExecutedOrder } from "./fast-lane";
import { lobbyRefusal } from "./lobby-core";
import { rankedRefusal } from "./ranked-core";
import { ensureGas } from "./funds";
import { absorbWrites, current, useBcsObject } from "./objects";
import { trackSaving } from "./saving";
import { sendOrder } from "./sender";

type Client = ReturnType<typeof useCurrentClient>;

/** Whether the package ids are configured (set after publish). */
export const ghostsEnabled = !!GHOSTS.package && !!GHOSTS.registry;

/** The squad an `Account` holds, hired for free (`FREE_RECRUITS`): also the most it can hold. */
export const FREE_RECRUITS = 4;

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

export type ChainRecruit = ReturnType<typeof Recruit.parse> & { objectId: string };
export type ChainWeapon = ReturnType<typeof Weapon.parse> & { objectId: string };
export type ChainArmor = ReturnType<typeof Armor.parse> & { objectId: string };
export type ChainAccount = ReturnType<typeof Account.parse>;
export type ChainUtility = ReturnType<typeof Utility.parse> & { objectId: string };
export type ChainUpgrade = ReturnType<typeof WeaponUpgrade.parse> & { objectId: string };

// === Reads ===

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

/** An object the `Account` holds: decoded, with its id. */
type Entry<T> = T & { objectId: string };

/** What an `Account` holds, by kind: each one is sent to it, and received when used. */
const HELD = {
    recruits: { type: "recruit::Recruit", schema: Recruit as BcsType<unknown> },
    weapons: { type: "weapon::Weapon", schema: Weapon as BcsType<unknown> },
    armors: { type: "armor::Armor", schema: Armor as BcsType<unknown> },
    utilities: { type: "utility::Utility", schema: Utility as BcsType<unknown> },
    upgrades: { type: "weapon_upgrade::WeaponUpgrade", schema: WeaponUpgrade as BcsType<unknown> },
};
type Held = keyof typeof HELD;
const heldType = (kind: Held) => normalizeStructTag(`${GHOSTS.package}::${HELD[kind].type}`);

/**
 * Every object of a kind the `Account` holds, decoded. `size`, where the
 * `Account` counts them: a node a moment behind lists fewer, or one as it was
 * before a write, or one a write has since taken out, so it is read again until
 * it catches up.
 */
async function listHeld(
    client: Client,
    accountId: string,
    kind: Held,
    size?: number,
): Promise<Entry<unknown>[]> {
    let entries: Entry<unknown>[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        const objects = [];
        let cursor: string | undefined;
        do {
            const page = await client.core.listOwnedObjects({
                owner: accountId,
                type: heldType(kind),
                include: { content: true },
                cursor,
            });
            objects.push(...page.objects);
            cursor = page.hasNextPage ? (page.cursor ?? undefined) : undefined;
        } while (cursor);
        let behind = size !== undefined && objects.length !== size;
        entries = objects.map(({ objectId, version, digest, content }) => {
            if (!current(objectId, version) || movedOn(objectId, version)) behind = true;
            else noteOwned({ objectId, version, digest }, accountId);
            return { ...(HELD[kind].schema.parse(content) as object), objectId };
        });
        if (!behind || attempt === 5) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    return entries;
}

/** The query a kind of held objects is filed under; recruits by how many the `Account` counts. */
const heldKey = (kind: Held, accountId?: string, size?: string) =>
    size === undefined ? ["ghosts", kind, accountId] : ["ghosts", kind, accountId, size];

function useHeld<T>(kind: Held, accountId?: string, size?: string) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: heldKey(kind, accountId, size),
        enabled: !!accountId,
        placeholderData: (previous) => previous,
        queryFn: async () =>
            (await listHeld(
                client,
                accountId!,
                kind,
                size === undefined ? undefined : Number(size),
            )) as Entry<T>[],
    });
}

/**
 * Bring every read of what an `Account` holds in line with what a write left:
 * objects it left with the `Account` are decoded from the response, and objects it
 * took out (into a recruit, a game, or gone) are dropped. Recruits are filed under
 * their new count, which is what the screens ask for next.
 */
function absorbHeld(queryClient: QueryClient, { written, removed }: ExecutedOrder) {
    const gone = new Set(removed.map((id) => normalizeSuiObjectId(id)));
    for (const kind of Object.keys(HELD) as Held[]) {
        const type = heldType(kind);
        const latest = new Map<string, Entry<unknown>[]>();
        const updated = new Map<string, number>();
        for (const query of queryClient.getQueryCache().findAll({ queryKey: ["ghosts", kind] })) {
            const accountId = query.queryKey[2] as string | undefined;
            const data = query.state.data as Entry<unknown>[] | undefined;
            if (!accountId || !data) continue;
            if ((updated.get(accountId) ?? -1) >= query.state.dataUpdatedAt) continue;
            updated.set(accountId, query.state.dataUpdatedAt);
            latest.set(accountId, data);
        }
        for (const [accountId, before] of latest) {
            const home = normalizeSuiAddress(accountId);
            const after = new Map(before.map((e) => [normalizeSuiObjectId(e.objectId), e]));
            let touched = false;
            let unaccounted = false;
            for (const id of gone) touched = after.delete(id) || touched;
            for (const object of written) {
                const id = normalizeSuiObjectId(object.objectId);
                if (object.owner !== home || object.type !== type) {
                    touched = after.delete(id) || touched;
                } else if (!object.contents) {
                    unaccounted = true;
                } else {
                    touched = true;
                    const decoded = HELD[kind].schema.parse(object.contents) as object;
                    after.set(id, { ...decoded, objectId: object.objectId });
                }
            }
            if (unaccounted)
                void queryClient.invalidateQueries({ queryKey: heldKey(kind, accountId) });
            else if (touched) {
                const size = kind === "recruits" ? String(after.size) : undefined;
                queryClient.setQueryData(heldKey(kind, accountId, size), [...after.values()]);
            }
        }
    }
}

/** The recruits at home in an `Account`. */
export function useChainRecruits(account?: ChainAccount) {
    return useHeld<ReturnType<typeof Recruit.parse>>("recruits", account?.id, account?.recruits);
}

/** The armory: unequipped weapons, armor and utilities, and the stock of upgrades, sent to an `Account`. */
export function useArmory(account?: ChainAccount) {
    const weapons = useHeld<ReturnType<typeof Weapon.parse>>("weapons", account?.id);
    const armors = useHeld<ReturnType<typeof Armor.parse>>("armors", account?.id);
    const utilities = useHeld<ReturnType<typeof Utility.parse>>("utilities", account?.id);
    const upgrades = useHeld<ReturnType<typeof WeaponUpgrade.parse>>("upgrades", account?.id);
    return {
        weapons: weapons.data ?? [],
        armors: armors.data ?? [],
        utilities: utilities.data ?? [],
        upgrades: upgrades.data,
    };
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
            absorbHeld(queryClient, executed);
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
            // A balance that cannot pay waits for the faucet request, then the write goes on.
            if (owner) await trackSaving(ensureGas(owner));
            await trackSaving(steps(list));
            return true;
        } catch (e) {
            setError(friendlyError(e));
            return false;
        } finally {
            setBusy(false);
        }
    }

    /**
     * `run` for a caller that decides what a refusal means (a ranked search choosing
     * its branch again): the raw failure comes back instead of becoming `error`.
     */
    async function attempt(list: Step[]): Promise<{ ok: true } | { ok: false; message: string }> {
        setBusy(true);
        try {
            if (owner) await trackSaving(ensureGas(owner));
            await trackSaving(steps(list));
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
        } finally {
            setBusy(false);
        }
    }

    return {
        busy,
        error,
        setError,
        clearError: () => setError(""),
        run,
        attempt,
        client,
    };
}

/** A failed save in the player's terms; the raw message when nothing matches. */
export function friendlyError(e: unknown): string {
    const message = e instanceof Error ? e.message : String(e);
    if (
        /insufficient SUI balance|gas selection|InsufficientGas|InsufficientCoinBalance/i.test(
            message,
        )
    )
        return "Not enough SUI for this action. Try again shortly.";
    if (/reject|cancel|abort(ed)? by user|NotAllowedError/i.test(message)) return "Cancelled.";
    if (/Failed to fetch|NetworkError|timed? ?out/i.test(message))
        return "Connection lost. Try again.";
    if (/function_name: Some\("cancel_(search|ranked)"\).*, 25\)/.test(message))
        return "A match was just found: joining it.";
    return lobbyRefusal(message) ?? rankedRefusal(message) ?? message;
}

const target = (fn: string) => `${GHOSTS.package}::account::${fn}`;

/** Create the player's `Account` — one per address, held by the `Registry`. */
export function createAccountTx(): Transaction {
    const tx = new Transaction();
    tx.moveCall({ target: target("new_account"), arguments: [tx.object(GHOSTS.registry)] });
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

/** Dismiss a recruit for good; their weapon, armor and utilities go back to the armory. */
export function dismissRecruitTx(accountId: string, recruitId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("dismiss_recruit"),
        arguments: [tx.object(accountId), tx.object(recruitId)],
    });
    return tx;
}

/**
 * Borrow a recruit from the `Account`, change them with `change`, and send them
 * back to it: any number of changes, one receipt. The chain takes nothing else
 * for the `Borrow`, and a recruit is borrowed once per transaction.
 */
function withRecruit(
    tx: Transaction,
    acc: TransactionArgument,
    recruitId: string,
    change: (recruit: TransactionArgument) => void,
) {
    const [recruit, borrow] = tx.moveCall({
        target: target("borrow_recruit"),
        arguments: [acc, tx.object(recruitId)],
    });
    change(recruit);
    tx.moveCall({ target: target("return_recruit"), arguments: [recruit, borrow] });
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
        withRecruit(tx, acc, recruitId, (recruit) =>
            tx.moveCall({
                target: target("edit_recruit"),
                arguments: [
                    recruit,
                    tx.pure.vector("u8", areas.head),
                    tx.pure.vector("u8", areas.face),
                    tx.pure.vector("u8", areas.eyes),
                    tx.pure.vector("u8", areas.body),
                    tx.pure.vector("u8", areas.outfit),
                    tx.pure.u8(voice),
                ],
            }),
        );
    return tx;
}

/** Return a recruit's weapon or armor to the armory: whatever is sent to the `Account`. */
function unequipTx(accountId: string, recruitId: string, kind: "weapon" | "armor") {
    const tx = new Transaction();
    withRecruit(tx, tx.object(accountId), recruitId, (recruit) => {
        const [item] = tx.moveCall({ target: target(`unequip_${kind}`), arguments: [recruit] });
        tx.transferObjects([item], accountId);
    });
    return tx;
}

export const unequipWeaponTx = (accountId: string, recruitId: string): Transaction =>
    unequipTx(accountId, recruitId, "weapon");

export const unequipArmorTx = (accountId: string, recruitId: string): Transaction =>
    unequipTx(accountId, recruitId, "armor");

/** Take a utility off a recruit, by its id, into the armory. */
export function unequipUtilityTx(
    accountId: string,
    recruitId: string,
    utilityId: string,
): Transaction {
    const tx = new Transaction();
    withRecruit(tx, tx.object(accountId), recruitId, (recruit) => {
        const [item] = tx.moveCall({
            target: target("unequip_utility"),
            arguments: [recruit, tx.pure.id(utilityId)],
        });
        tx.transferObjects([item], accountId);
    });
    return tx;
}

/**
 * Fit a recruit with a utility out of the armory. The chain aborts if their
 * utility slots are full: take one off first (`unequipUtilityTx`), or pass the
 * carried one as `replaceId` to swap in the same transaction (it goes to the armory).
 */
export function equipUtilityTx(
    accountId: string,
    recruitId: string,
    utilityId: string,
    replaceId?: string,
) {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    withRecruit(tx, acc, recruitId, (recruit) => {
        if (replaceId) {
            const [old] = tx.moveCall({
                target: target("unequip_utility"),
                arguments: [recruit, tx.pure.id(replaceId)],
            });
            tx.transferObjects([old], accountId);
        }
        const [item] = tx.moveCall({
            target: target("take_utility"),
            arguments: [acc, tx.object(utilityId)],
        });
        tx.moveCall({ target: target("equip_utility"), arguments: [recruit, item] });
    });
    return tx;
}

/**
 * Move a utility from one recruit to another in one transaction: off `fromId`,
 * onto `toId`; a carried one passed as `replaceId` comes off `toId` first and
 * goes to the armory.
 */
export function moveUtilityTx(
    accountId: string,
    fromId: string,
    toId: string,
    utilityId: string,
    replaceId?: string,
) {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    withRecruit(tx, acc, fromId, (from) => {
        const [item] = tx.moveCall({
            target: target("unequip_utility"),
            arguments: [from, tx.pure.id(utilityId)],
        });
        withRecruit(tx, acc, toId, (to) => {
            if (replaceId) {
                const [old] = tx.moveCall({
                    target: target("unequip_utility"),
                    arguments: [to, tx.pure.id(replaceId)],
                });
                tx.transferObjects([old], accountId);
            }
            tx.moveCall({ target: target("equip_utility"), arguments: [to, item] });
        });
    });
    return tx;
}

/** The utility kinds of `ghosts::items`. */
export const UTILITY_KINDS = { fragGrenade: 0, flashbang: 1, smokeGrenade: 2 } as const;

/** Requisition a utility into the armory: sent to the `Account`. */
export function requisitionUtilityTx(
    accountId: string,
    kind: (typeof UTILITY_KINDS)[keyof typeof UTILITY_KINDS],
): Transaction {
    const tx = new Transaction();
    const [item] = tx.moveCall({
        target: target("requisition_utility"),
        arguments: [tx.object(accountId), tx.pure.u8(kind)],
    });
    tx.transferObjects([item], accountId);
    return tx;
}

/** A requested weapon fitting: its upgrade name, family and tier. */
export interface Fitting {
    name: string;
    family: keyof typeof UPGRADE_KINDS;
    tier: number;
}

/**
 * Bring a weapon's fittings to `desired` in one transaction: the weapon is taken
 * out of the armory, or off its carrier, unwanted fittings go to the stock,
 * wanted ones come out of it — requisitioned on the spot when there is none —
 * and the weapon goes back where it came from. Fittings come off by their index
 * on the weapon, highest first, so the ones still to go keep theirs.
 */
export function fittingsTx(
    accountId: string,
    weapon: { id: string; upgrades: { name: string }[] },
    stock: { name: string; objectId: string }[],
    desired: Fitting[],
    carrier: string | null,
): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    const pool = [...stock];
    const wanted = [...desired];

    const refit = (rifle: TransactionArgument) => {
        // keep fittings still wanted; strip the rest into the stock
        const fitted = weapon.upgrades.map((u) => u.name);
        const stripped: TransactionObjectArgument[] = [];
        for (let i = fitted.length - 1; i >= 0; i--) {
            const keep = wanted.findIndex((f) => f.name === fitted[i]);
            if (keep >= 0) wanted.splice(keep, 1);
            else
                stripped.push(
                    tx.moveCall({
                        target: `${GHOSTS.package}::weapon::remove_upgrade`,
                        arguments: [rifle, tx.pure.u8(i)],
                    })[0],
                );
        }
        if (stripped.length) tx.transferObjects(stripped, accountId);

        for (const fitting of wanted) {
            const at = pool.findIndex((u) => u.name === fitting.name);
            const [upgrade] =
                at >= 0
                    ? tx.moveCall({
                          target: target("take_upgrade"),
                          arguments: [acc, tx.object(pool.splice(at, 1)[0].objectId)],
                      })
                    : tx.moveCall({
                          target: target("requisition_upgrade"),
                          arguments: [
                              acc,
                              tx.pure.u8(UPGRADE_KINDS[fitting.family]),
                              tx.pure.u8(fitting.tier),
                          ],
                      });
            tx.moveCall({
                target: `${GHOSTS.package}::weapon::add_upgrade`,
                arguments: [rifle, upgrade],
            });
        }
    };

    if (carrier)
        withRecruit(tx, acc, carrier, (recruit) => {
            const [rifle] = tx.moveCall({ target: target("unequip_weapon"), arguments: [recruit] });
            refit(rifle);
            tx.moveCall({ target: target("equip_weapon"), arguments: [recruit, rifle] });
        });
    else {
        const [rifle] = tx.moveCall({
            target: target("take_weapon"),
            arguments: [acc, tx.object(weapon.id)],
        });
        refit(rifle);
        tx.transferObjects([rifle], accountId);
    }
    return tx;
}

/**
 * Hand a weapon or armor to `to` in one transaction: out of the armory or off its
 * current carrier, onto the target, whose own piece goes to the armory.
 */
export function issueTx(
    accountId: string,
    kind: "weapon" | "armor",
    itemId: string,
    from: string | null,
    to: string,
): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    const equip = (recruit: TransactionArgument, item: TransactionArgument) =>
        tx.moveCall({ target: target(`equip_${kind}`), arguments: [recruit, item] });
    withRecruit(tx, acc, to, (recruit) => {
        if (from === to) return;
        if (from)
            withRecruit(tx, acc, from, (carrier) => {
                const [item] = tx.moveCall({
                    target: target(`unequip_${kind}`),
                    arguments: [carrier],
                });
                equip(recruit, item);
            });
        else {
            const [item] = tx.moveCall({
                target: target(`take_${kind}`),
                arguments: [acc, tx.object(itemId)],
            });
            equip(recruit, item);
        }
    });
    return tx;
}

export type Requisition =
    { kind: "rifle" | "armor"; tier: number } | { kind: keyof typeof UPGRADE_KINDS; tier: number };

/** Requisition a piece of gear, into the racks or the stock: sent to the `Account`. */
export function requisitionTx(accountId: string, { kind, tier }: Requisition): Transaction {
    const tx = new Transaction();
    const acc = tx.object(accountId);
    const [item] =
        kind === "rifle" || kind === "armor"
            ? tx.moveCall({
                  target: target(kind === "rifle" ? "requisition_rifle" : "requisition_armor"),
                  arguments: [acc, tx.pure.u8(tier)],
              })
            : tx.moveCall({
                  target: target("requisition_upgrade"),
                  arguments: [acc, tx.pure.u8(UPGRADE_KINDS[kind]), tx.pure.u8(tier)],
              });
    tx.transferObjects([item], accountId);
    return tx;
}
