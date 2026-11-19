// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The balance keeper: the signed-in address is held at `TARGET_BALANCE_SUI`,
 * topped up from the testnet faucet in the background once it falls under
 * `TRIGGER_BALANCE_SUI` (nothing happens at or above the trigger). Apart from React and the
 * network, so the rules can be tested.
 *
 * Checked right after sign-in (`signedIn`), before every game (`beforeGame`),
 * before a write (`ensureGas`) and after every transaction the app sent
 * (`afterTransaction`). At a check, a balance under the trigger asks for SUI; if
 * one request leaves it short of the target (a request pays less than the gap), the next goes
 * out once the first has landed, at most `MAX_REQUESTS_PER_CHECK` in all.
 *
 * Never in the way: an action the balance can pay (`GAS_FLOOR`) goes ahead while
 * the top-up runs; one it cannot pay waits for the first request to land.
 *
 * Guards: one keeper per address (a check made meanwhile joins it); no new keeper
 * within `MIN_INTERVAL_MS` of the last one, kept across reloads in storage;
 * nothing retried after a failure. A failure is silent while the balance can pay;
 * otherwise the action stops with one line, and when to try again.
 */

import type { FaucetResult } from "./faucet.ts";
import { FaucetError } from "./faucet.ts";

const MIST = 1_000_000_000n;

/** A balance under this starts a top-up; at or above it the keeper does nothing. */
export const TRIGGER_BALANCE_SUI = 1;
/** Once started, a top-up goes on until the balance is at least this. */
export const TARGET_BALANCE_SUI = 2;
export const TRIGGER_BALANCE = BigInt(TRIGGER_BALANCE_SUI) * MIST;
export const TARGET_BALANCE = BigInt(TARGET_BALANCE_SUI) * MIST;
/** Below this the next write cannot be trusted to pay (a write may be budgeted up to 0.1 SUI). */
export const GAS_FLOOR = MIST / 10n;
/** Requests one check may make: each lands before the next goes out. */
export const MAX_REQUESTS_PER_CHECK = 3;
/** No new keeper this soon after the last one started: sign-in and the first game collapse into one. */
export const MIN_INTERVAL_MS = 30_000;
/** After a failed request nothing asks again for at least this long, or the faucet's retry-after if longer. */
export const FAILURE_COOLDOWN_MS = 45_000;

export interface FundsDeps {
    /** One faucet request; resolves when the funds show in the balance. */
    request(address: string): Promise<FaucetResult>;
    /** Total SUI balance in MIST. */
    balance(address: string): Promise<bigint>;
    now(): number;
    /** Survives a reload: when each address was last asked for. Null when unavailable. */
    storage: { get(key: string): string | null; set(key: string, value: string): void } | null;
    /** The balance changed under the screens' feet. */
    refreshed?(address: string): void;
}

export interface Funds {
    signedIn(address: string): Promise<void>;
    beforeGame(address: string): Promise<void>;
    ensureGas(address: string): Promise<void>;
    afterTransaction(address: string): Promise<void>;
    /** An action is waiting for SUI right now. */
    waiting(): boolean;
    subscribe(listener: () => void): () => void;
}

const storageKey = (address: string) => `ghosts:funds:${address}`;

/** A span as the player reads it: `45 s`, `3 min`. */
export function span(ms: number): string {
    const s = Math.max(1, Math.ceil(ms / 1000));
    return s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`;
}

export function createFunds(deps: FundsDeps): Funds {
    const keeping = new Map<string, Promise<void>>();
    const startedAt = new Map<string, number>();
    const blockedUntil = new Map<string, number>();
    const funded = new Map<string, Set<() => void>>();
    const welcomed = new Set<string>();
    const listeners = new Set<() => void>();
    let waiting = 0;

    const bump = (by: number) => {
        waiting += by;
        for (const listener of listeners) listener();
    };

    const read = (address: string) => deps.balance(address).catch(() => null);

    function lastStart(address: string): number {
        let stored = 0;
        try {
            stored = Number(deps.storage?.get(storageKey(address)) ?? 0) || 0;
        } catch {
            // storage may be blocked
        }
        return Math.max(startedAt.get(address) ?? 0, stored);
    }

    /** Hold the address at the minimum: at most `MAX_REQUESTS_PER_CHECK`, one at a time. Never rejects. */
    function keep(address: string): Promise<void> {
        const running = keeping.get(address);
        if (running) return running;
        const now = deps.now();
        if (now < (blockedUntil.get(address) ?? 0) || now - lastStart(address) < MIN_INTERVAL_MS)
            return Promise.resolve();
        const job = (async () => {
            for (let n = 0; n < MAX_REQUESTS_PER_CHECK; n++) {
                const balance = await read(address);
                // Start under the trigger; once started, go on up to the target.
                if (balance === null || balance >= (n === 0 ? TRIGGER_BALANCE : TARGET_BALANCE))
                    return;
                if (n === 0) {
                    const at = deps.now();
                    startedAt.set(address, at);
                    try {
                        deps.storage?.set(storageKey(address), String(at));
                    } catch {
                        // storage may be blocked
                    }
                }
                try {
                    await deps.request(address);
                } catch (error) {
                    const wait =
                        error instanceof FaucetError && error.retryAfterSeconds !== undefined
                            ? error.retryAfterSeconds * 1000
                            : 0;
                    blockedUntil.set(address, deps.now() + Math.max(wait, FAILURE_COOLDOWN_MS));
                    return;
                } finally {
                    deps.refreshed?.(address);
                }
                for (const wake of funded.get(address) ?? []) wake();
            }
        })().finally(() => keeping.delete(address));
        keeping.set(address, job);
        return job;
    }

    function cannotPay(address: string): Error {
        const at = blockedUntil.get(address);
        const when =
            at && at > deps.now() ? `Try again in ${span(at - deps.now())}.` : "Try again shortly.";
        return new Error(`Not enough SUI for this action. ${when}`);
    }

    /**
     * Check the balance, keep it topped up, and let an action through: at once when
     * the balance can pay for it, after the first request lands when it cannot,
     * and with one line of error when it still cannot.
     */
    async function gate(address: string): Promise<void> {
        const balance = await read(address);
        const job = keep(address);
        if (balance === null || balance >= GAS_FLOOR) return; // unreadable: the write finds out
        bump(1);
        try {
            await new Promise<void>((resolve) => {
                const wake = () => {
                    funded.get(address)?.delete(wake);
                    resolve();
                };
                funded.set(address, (funded.get(address) ?? new Set()).add(wake));
                void job.then(wake);
            });
        } finally {
            bump(-1);
        }
        const after = await read(address);
        if (after !== null && after < GAS_FLOOR) throw cannotPay(address);
    }

    return {
        async signedIn(address) {
            if (welcomed.has(address)) return;
            welcomed.add(address);
            await keep(address);
        },
        beforeGame: gate,
        ensureGas: gate,
        afterTransaction: (address) => keep(address),
        waiting: () => waiting > 0,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
