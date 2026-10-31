// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The device session key: an ephemeral ed25519 keypair that, once the owner
 * aliases it on chain (`sui::address_alias`), signs transactions AS the main
 * account without further passkey ceremonies.
 *
 * Security model — the strongest a web page can hold a signing key:
 * - The private key is a NON-EXTRACTABLE WebCrypto `CryptoKey`. Its bytes
 *   never exist in JavaScript: not at creation, not at signing, and no code
 *   path (including an XSS payload) can export them. A compromised page can
 *   at worst use the key while it runs; it cannot steal it for later.
 * - The key handle lives in IndexedDB, scoped to this origin and device, and
 *   never leaves the browser's own key store. Nothing is written to
 *   localStorage, nothing is serialized, there is no backup or export path:
 *   losing the device loses the key, which is the point — the on-chain alias
 *   is removed from any device that still has the passkey.
 * - Scope is bounded on chain, not in the browser: the key is powerful only
 *   while its address sits in the owner's `AddressAliases` set, and the
 *   Sessions panel shows every authorized key with its last action, so stale
 *   ones get terminated.
 */

import { Signer, type PublicKey, type SignatureScheme } from "@mysten/sui/cryptography";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";

const DB = "ghosts-session-key";
const STORE = "keys";
const SLOT = "current";

export interface StoredSessionKey {
    /** Non-extractable private key; only `sign` ever touches it. */
    privateKey: CryptoKey;
    /** Raw 32-byte ed25519 public key. */
    publicKey: Uint8Array;
    createdAt: number;
    lastUsedAt: number;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function inStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const request = run(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Whether this browser can hold a session key safely: WebCrypto ed25519 with
 * a non-extractable private key. Modern Safari, Chrome and Firefox do; where
 * it is missing the feature stays off rather than falling back to a softer
 * store.
 */
export async function supportsSessionKeys(): Promise<boolean> {
    try {
        const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
            "sign",
        ])) as CryptoKeyPair;
        return pair.privateKey.extractable === false;
    } catch {
        return false;
    }
}

/** The stored key for this device, or null when none was created yet. */
export async function loadSessionKey(): Promise<StoredSessionKey | null> {
    try {
        const row = await inStore<StoredSessionKey | undefined>("readonly", (s) => s.get(SLOT));
        return row ?? null;
    } catch {
        return null;
    }
}

/** Create (and persist) this device's session key; replaces any previous one. */
export async function createSessionKey(): Promise<StoredSessionKey> {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
        "sign",
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const row: StoredSessionKey = {
        privateKey: pair.privateKey,
        publicKey: raw,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
    };
    await inStore("readwrite", (s) => s.put(row, SLOT));
    return row;
}

/** Forget this device's key. The on-chain alias is removed separately. */
export async function clearSessionKey(): Promise<void> {
    await inStore("readwrite", (s) => s.delete(SLOT));
}

/** Record that the key just signed something; the panel shows this time. */
export async function touchSessionKey(): Promise<void> {
    const row = await loadSessionKey();
    if (row) await inStore("readwrite", (s) => s.put({ ...row, lastUsedAt: Date.now() }, SLOT));
}

/** The Sui address a stored key signs for (its own, not the aliased owner). */
export function sessionAddress(key: StoredSessionKey): string {
    return new Ed25519PublicKey(key.publicKey).toSuiAddress();
}

/**
 * Hard lifetime of a session key, from creation — not from last use, so a
 * copied browser profile goes dark on schedule no matter how busy it keeps
 * itself. Renewal is one passkey prompt, run automatically by the sender.
 */
export const SESSION_TTL_MS = 7 * 86_400_000;

/** Whether `key` is past its lifetime and must self-expire. */
export function sessionExpired(key: StoredSessionKey): boolean {
    return Date.now() - key.createdAt > SESSION_TTL_MS;
}

/** Signs with the non-extractable key; the bytes never surface. */
export class SessionSigner extends Signer {
    constructor(private readonly key: StoredSessionKey) {
        super();
    }

    getKeyScheme(): SignatureScheme {
        return "ED25519";
    }

    getPublicKey(): PublicKey {
        return new Ed25519PublicKey(this.key.publicKey);
    }

    async sign(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
        const signature = await crypto.subtle.sign(
            { name: "Ed25519" },
            this.key.privateKey,
            bytes as BufferSource,
        );
        void touchSessionKey();
        return new Uint8Array(signature as ArrayBuffer);
    }
}
