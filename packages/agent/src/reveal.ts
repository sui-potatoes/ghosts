// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Where a ranked search keeps its secret between `find_ranked` and `reveal_squad`: the squad and
 * the salt the commitment hashes. A waiter that loses them cannot reveal, and a seat it cannot
 * reveal is a no-show, so a bot keeps them in memory and in a state file next to its key, written
 * before the search is sent: a restart can still reveal. The salt is never logged; the store holds
 * the only copy, and each entry goes once its search is over.
 */

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { fromHex, normalizeSuiAddress, toHex } from "@mysten/sui/utils";

/** The secret of one ranked search, keyed by its commitment. */
export interface PendingReveal {
    /** `blake2b256(squad ‖ salt)`, as `Searching.commitment` holds it. */
    commitment: string;
    squad: Uint8Array;
    salt: Uint8Array;
    /** Units a side. */
    size: number;
    /** When it was kept, by `Date.now`. */
    savedAtMs: number;
}

export interface RevealStore {
    /** Keep a secret; called before the search that commits to it is sent. */
    save(entry: PendingReveal): void;
    /** The secret behind a commitment, if this store holds it. */
    find(commitment: string): PendingReveal | null;
    /** Drop a secret: revealed, or its search is over. */
    forget(commitment: string): void;
    /**
     * Drop the secrets saved before `before` (ms, by `Date.now`), but the one of `keep` (the
     * search on the `Account`). A fresh one is kept: its search may still be on its way.
     */
    prune(keep: string | null, before: number): void;
}

const key = (commitment: string) => normalizeSuiAddress(commitment);

/** A store in memory only: for the sandbox and short-lived agents. */
export function memoryRevealStore(): RevealStore {
    const entries = new Map<string, PendingReveal>();
    return {
        save: (entry) => void entries.set(key(entry.commitment), entry),
        find: (commitment) => entries.get(key(commitment)) ?? null,
        forget: (commitment) => void entries.delete(key(commitment)),
        prune(keep, before) {
            for (const [id, entry] of [...entries]) {
                if (id !== (keep && key(keep)) && entry.savedAtMs < before) entries.delete(id);
            }
        },
    };
}

interface StoredReveal {
    commitment: string;
    squad: string;
    salt: string;
    size: number;
    savedAtMs: number;
}

/**
 * A store in a JSON file, readable by its owner only (0600), rewritten atomically on every
 * change, with an in-memory copy in front. A few secrets at most are ever in it: one per search,
 * pruned as searches end.
 */
export function fileRevealStore(path: string): RevealStore {
    const memory = memoryRevealStore();
    const all = new Map<string, PendingReveal>();
    if (existsSync(path)) {
        try {
            const stored = JSON.parse(readFileSync(path, "utf8")) as { pending?: StoredReveal[] };
            for (const entry of stored.pending ?? []) {
                const restored: PendingReveal = {
                    commitment: entry.commitment,
                    squad: fromHex(entry.squad),
                    salt: fromHex(entry.salt),
                    size: entry.size,
                    savedAtMs: entry.savedAtMs,
                };
                all.set(key(entry.commitment), restored);
                memory.save(restored);
            }
        } catch {
            // an unreadable file holds nothing usable; it is rewritten on the next save
        }
    }
    const flush = () => {
        const pending: StoredReveal[] = [...all.values()].map((entry) => ({
            commitment: entry.commitment,
            squad: toHex(entry.squad),
            salt: toHex(entry.salt),
            size: entry.size,
            savedAtMs: entry.savedAtMs,
        }));
        const temp = `${path}.tmp`;
        writeFileSync(temp, JSON.stringify({ pending }), { mode: 0o600 });
        chmodSync(temp, 0o600);
        renameSync(temp, path);
    };
    return {
        save(entry) {
            all.set(key(entry.commitment), entry);
            memory.save(entry);
            flush();
        },
        find: (commitment) => memory.find(commitment),
        forget(commitment) {
            if (!all.delete(key(commitment))) return;
            memory.forget(commitment);
            flush();
        },
        prune(keep, before) {
            const count = all.size;
            for (const [id, entry] of [...all]) {
                if (id !== (keep && key(keep)) && entry.savedAtMs < before) all.delete(id);
            }
            memory.prune(keep, before);
            if (all.size !== count) flush();
        },
    };
}
