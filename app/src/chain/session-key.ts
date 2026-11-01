// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Creates and stores an Ed25519 session key in IndexedDB. The private key is
 * generated as a non-extractable WebCrypto CryptoKey; the public key and
 * creation and last-use timestamps are stored alongside it.
 *
 * SessionSigner signs bytes with the stored key and updates its last-use
 * timestamp. The alias and sender modules handle on-chain authorization and
 * renewal; this module exposes the key's age check and local deletion.
 */

import { Signer, type PublicKey, type SignatureScheme } from "@mysten/sui/cryptography";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";

const DB = "ghosts-session-key";
const STORE = "keys";
const SLOT = "current";

export interface StoredSessionKey {
    /** Non-extractable WebCrypto private key used by SessionSigner.sign. */
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
 * Attempts to generate an Ed25519 keypair and returns whether its private
 * key is non-extractable. Returns false if generation fails.
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
 * Local expiry threshold measured from key creation, used by sessionExpired.
 * On-chain alias removal is handled separately by the alias module.
 */
export const SESSION_TTL_MS = 7 * 86_400_000;

/** Whether the key's age exceeds SESSION_TTL_MS. */
export function sessionExpired(key: StoredSessionKey): boolean {
    return Date.now() - key.createdAt > SESSION_TTL_MS;
}

/** Signs bytes with the stored WebCrypto key and records the last-use time. */
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
