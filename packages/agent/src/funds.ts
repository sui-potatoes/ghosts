// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The balance rule, as the app keeps it: nothing happens at or above `TRIGGER_BALANCE_SUI`; under
 * it the faucet is asked for SUI, and asked again (once each lands) until the balance is at least
 * `TARGET_BALANCE_SUI`, at most `MAX_REQUESTS` times in all. A failed request is never repeated.
 * Gas is paid from the address balance, which is what the faucet fills and what these read.
 */

import type { FaucetError, FaucetResult } from "./faucet.ts";

const MIST = 1_000_000_000n;

/** A balance under this starts a top-up; at or above it nothing happens. */
export const TRIGGER_BALANCE_SUI = 1;
/** Once started, a top-up goes on until the balance is at least this. */
export const TARGET_BALANCE_SUI = 2;
export const TRIGGER_BALANCE = BigInt(TRIGGER_BALANCE_SUI) * MIST;
export const TARGET_BALANCE = BigInt(TARGET_BALANCE_SUI) * MIST;
/** Below this the next transaction cannot be trusted to pay. */
export const GAS_FLOOR = MIST / 10n;
/** Requests one check may make: each lands before the next goes out. */
export const MAX_REQUESTS = 3;

export interface FundsDeps {
    /** Total SUI balance in MIST. */
    balance(): Promise<bigint>;
    /** One faucet request; resolves when the funds show in the balance. */
    request(): Promise<FaucetResult>;
}

export interface FundsOutcome {
    /** The balance at the end, in MIST; null when it could not be read. */
    balance: bigint | null;
    /** Faucet requests that paid. */
    requests: number;
    /** Why the top-up stopped short, when it did. */
    error: FaucetError | Error | null;
}

/** Whether a balance is under the trigger. */
export const belowTrigger = (balance: bigint) => balance < TRIGGER_BALANCE;

/** Hold the balance at the target once it is under the trigger. Never rejects. */
export async function ensureFunds(deps: FundsDeps): Promise<FundsOutcome> {
    let balance: bigint | null;
    try {
        balance = await deps.balance();
    } catch (error) {
        return { balance: null, requests: 0, error: error as Error };
    }
    let requests = 0;
    for (let n = 0; n < MAX_REQUESTS; n++) {
        if (balance >= (n === 0 ? TRIGGER_BALANCE : TARGET_BALANCE)) break;
        let result: FaucetResult;
        try {
            result = await deps.request();
        } catch (error) {
            const now = await deps.balance().catch(() => balance);
            return { balance: now, requests, error: error as Error };
        }
        requests++;
        // The payout has not shown in the balance yet: asking again would pay twice.
        if (!result.arrived) break;
        try {
            balance = await deps.balance();
        } catch (error) {
            return { balance: null, requests, error: error as Error };
        }
    }
    return { balance, requests, error: null };
}
