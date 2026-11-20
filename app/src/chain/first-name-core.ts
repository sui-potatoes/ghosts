// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The first-sign-in name, apart from React and the network so the rules can be
 * tested: waiting for gas without ever sending a write that cannot pay, and
 * the one combined save (the name, and the player's `Account` in the same
 * transaction when there is none yet). `first-name.tsx` binds them to the
 * chain client.
 */

import { GAS_FLOOR } from "./funds-core.ts";

/** How long a save waits for the top-up before giving up. */
export const GAS_WAIT_MS = 60_000;
/** How often the balance is read while waiting. */
export const GAS_POLL_MS = 1_000;

/** The balance never reached the floor in time. */
export class GasTimeout extends Error {
    constructor() {
        super("Could not save the name");
    }
}

export interface GasDeps {
    /** Total balance in MIST; null when unreadable (the write then finds out). */
    balance(): Promise<bigint | null>;
    /** Ask for the top-up (joins the keeper that sign-in started); rejects when it cannot pay. */
    ensure(): Promise<void>;
    now(): number;
    sleep(ms: number): Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
    /** The balance cannot pay yet: the save is waiting for the top-up. */
    waiting?(): void;
}

/**
 * Resolves as soon as the balance can pay for a write (`GAS_FLOOR`). A short
 * balance asks for the top-up once and polls until it lands; a top-up that
 * failed ends the wait at once, and so does the timeout, with a `GasTimeout`.
 */
export async function waitForGas(deps: GasDeps): Promise<void> {
    const { timeoutMs = GAS_WAIT_MS, pollMs = GAS_POLL_MS } = deps;
    const start = deps.now();
    let asked = false;
    let failure: unknown = null;
    for (;;) {
        const balance = await deps.balance();
        if (balance === null || balance >= GAS_FLOOR) return;
        if (!asked) {
            asked = true;
            deps.waiting?.();
            deps.ensure().catch((e: unknown) => {
                failure = e ?? new GasTimeout();
            });
        }
        if (failure) throw failure;
        if (deps.now() - start >= timeoutMs) throw new GasTimeout();
        await deps.sleep(pollMs);
    }
}

export interface SaveDeps<Tx> {
    /** Resolves once a write can pay; rejects otherwise. */
    gas(): Promise<void>;
    /** The player has an `Account`, or the game has none to create. */
    hasAccount(): Promise<boolean>;
    /** One transaction: the name's calls, and the account's when `withAccount`. */
    build(name: string, withAccount: boolean): Promise<Tx>;
    send(tx: Tx): Promise<unknown>;
    /** After the chain accepted it: caches and the local copy. */
    saved(name: string, withAccount: boolean): Promise<void>;
}

/**
 * The first name as one send: gas first (nothing is built or signed before the
 * balance can pay), then the name and, when there is no `Account`, its
 * creation in the same transaction: one signature.
 */
export async function saveFirstName<Tx>(
    deps: SaveDeps<Tx>,
    name: string,
): Promise<{ account: boolean }> {
    await deps.gas();
    const withAccount = !(await deps.hasAccount());
    await deps.send(await deps.build(name, withAccount));
    await deps.saved(name, withAccount);
    return { account: withAccount };
}
