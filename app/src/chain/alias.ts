// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The `sui::address_alias` plumbing shared by the sender and the Sessions
 * panel: where an owner's alias set lives (a derived object, one fetch), how
 * a transaction references it (party-owned, so shared-style with its
 * consensus start version), and whether THIS device currently holds an
 * authorized session key — the question the sender asks before every
 * transaction to skip the passkey ceremony.
 */

import { useCurrentClient } from "@mysten/dapp-kit-react";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID } from "@mysten/sui/utils";

import {
    clearSessionKey,
    createSessionKey,
    loadSessionKey,
    sessionAddress,
    sessionExpired,
    SessionSigner,
    type StoredSessionKey,
} from "./session-key";

type Client = ReturnType<typeof useCurrentClient>;

/** The `AddressAliasState` singleton; a protocol object, same id everywhere. */
export const ALIAS_STATE = "0x000000000000000000000000000000000000000000000000000000000000000a";

export const AddressAliases = bcs.struct("AddressAliases", {
    id: bcs.Address,
    aliases: bcs.struct("VecSet", { contents: bcs.vector(bcs.Address) }),
});

/** Where `owner`'s alias set lives — derived, so one fetch answers it. */
export function aliasesObjectId(owner: string): string {
    return deriveObjectID(
        ALIAS_STATE,
        "0x2::address_alias::AliasKey",
        bcs.Address.serialize(owner).toBytes(),
    );
}

/**
 * The `AddressAliases` object is party-owned (`ConsensusAddressOwner`), so a
 * transaction references it like a shared object, with the version it joined
 * the consensus stream at — an owned-object reference is rejected outright.
 */
export async function aliasesRef(client: Client, id: string) {
    const { object } = await client.core.getObject({ objectId: id });
    if (object.owner.$kind !== "ConsensusAddressOwner") {
        throw new Error(`alias set has unexpected owner: ${object.owner.$kind}`);
    }
    return {
        objectId: id,
        initialSharedVersion: object.owner.ConsensusAddressOwner.startVersion,
        mutable: true,
    };
}

export type AliasesRef = Awaited<ReturnType<typeof aliasesRef>>;

/** The owner's alias set as one fetch: reference and members; null = never enabled. */
export async function aliasesState(
    client: Client,
    owner: string,
): Promise<{ ref: AliasesRef; members: string[] } | null> {
    const id = aliasesObjectId(owner);
    let object;
    try {
        ({ object } = await client.core.getObject({ objectId: id, include: { content: true } }));
    } catch {
        return null;
    }
    if (object.owner.$kind !== "ConsensusAddressOwner") {
        throw new Error(`alias set has unexpected owner: ${object.owner.$kind}`);
    }
    return {
        ref: {
            objectId: id,
            initialSharedVersion: object.owner.ConsensusAddressOwner.startVersion,
            mutable: true,
        },
        members: AddressAliases.parse(object.content).aliases.contents,
    };
}

export function enableTx(): Transaction {
    const tx = new Transaction();
    tx.moveCall({ target: "0x2::address_alias::enable", arguments: [tx.object(ALIAS_STATE)] });
    return tx;
}

export function addTx(ref: AliasesRef, alias: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: "0x2::address_alias::add",
        arguments: [tx.sharedObjectRef(ref), tx.pure.address(alias)],
    });
    return tx;
}

export function removeTx(ref: AliasesRef, alias: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: "0x2::address_alias::remove",
        arguments: [tx.sharedObjectRef(ref), tx.pure.address(alias)],
    });
    return tx;
}

/**
 * A key past its lifetime de-escalates itself: while its alias still stands,
 * the key signs its own `remove` — dropping authority needs no ceremony —
 * and is wiped only once the alias is gone, so the pair never diverges. Safe
 * to call anytime; does nothing while the key is fresh.
 */
export async function expireSessionKey(client: Client, owner: string): Promise<void> {
    const key = await loadSessionKey();
    if (!key || !sessionExpired(key)) return;
    const address = sessionAddress(key);
    const state = await aliasesState(client, owner).catch(() => null);
    if (state?.members.includes(address)) {
        const tx = removeTx(state.ref, address);
        tx.setSender(owner);
        const result = await client.core.signAndExecuteTransaction({
            transaction: tx,
            signer: new SessionSigner(key),
            include: { effects: true },
        });
        if (result.FailedTransaction) {
            // The alias outlives this attempt; keep the key so the next
            // sweep retries, and the panel still shows the session.
            console.warn("session self-expiry failed:", result.FailedTransaction.status.error);
            return;
        }
    }
    await clearSessionKey();
    forgetSessionStatus();
}

/**
 * Authorize this device for `owner`: create the session key if needed and
 * put its address into the on-chain alias set, `sign`ing the enable/add
 * transactions with the wallet (the passkey's one job). Returns the signer
 * for the session, ready to sign the transaction that triggered this.
 */
export async function authorizeDevice(
    client: Client,
    owner: string,
    sign: (tx: Transaction) => Promise<void>,
): Promise<SessionSigner> {
    let key: StoredSessionKey | null = await loadSessionKey();
    if (key && sessionExpired(key)) {
        await expireSessionKey(client, owner);
        key = await loadSessionKey();
    }
    key ??= await createSessionKey();
    const address = sessionAddress(key);
    let state = await aliasesState(client, owner);
    if (!state) {
        await sign(enableTx());
        state = await aliasesState(client, owner);
        if (!state) throw new Error("alias set missing after enable");
    }
    if (!state.members.includes(address)) await sign(addTx(state.ref, address));
    forgetSessionStatus();
    return new SessionSigner(key);
}

// The sender asks before every transaction; the alias set answers from the
// chain at most every half minute, and a key change invalidates right away.
let membership: { stamp: string; until: number; ok: boolean } | null = null;

/** Drop the cached membership (after authorize / terminate). */
export function forgetSessionStatus(): void {
    membership = null;
}

/**
 * This device's signer for transactions sent AS `owner`: its session key,
 * when one exists and its address is in the owner's on-chain alias set.
 * Null means the caller falls back to the wallet ceremony.
 */
export async function activeSessionSigner(
    client: Client,
    owner: string,
): Promise<SessionSigner | null> {
    const key = await loadSessionKey();
    if (!key || sessionExpired(key)) return null;
    const address = sessionAddress(key);
    const stamp = `${owner}:${address}`;
    if (!membership || membership.stamp !== stamp || Date.now() > membership.until) {
        const state = await aliasesState(client, owner).catch(() => null);
        membership = {
            stamp,
            until: Date.now() + 30_000,
            ok: !!state?.members.includes(address),
        };
    }
    return membership.ok ? new SessionSigner(key) : null;
}
