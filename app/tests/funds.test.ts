// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { FaucetError } from "../src/chain/faucet.ts";
import {
    createFunds,
    FAILURE_COOLDOWN_MS,
    MAX_REQUESTS_PER_CHECK,
    TARGET_BALANCE,
    TRIGGER_BALANCE,
    MIN_INTERVAL_MS,
    type FundsDeps,
} from "../src/chain/funds-core.ts";

const SUI = 1_000_000_000n;
const A = "0x" + "aa".repeat(32);
const B = "0x" + "bb".repeat(32);

/** A world: a balance each request raises by `payout`, a clock, a storage, and the requests made. */
function world(
    start: bigint,
    { payout = SUI, fail }: { payout?: bigint; fail?: () => Error | null } = {},
) {
    const state = {
        balance: start,
        now: 1_000_000,
        requests: [] as string[],
        inFlight: 0,
        peak: 0,
    };
    const store = new Map<string, string>();
    const deps: FundsDeps = {
        async request(address) {
            state.requests.push(address);
            state.peak = Math.max(state.peak, ++state.inFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            state.inFlight--;
            const error = fail?.();
            if (error) throw error;
            state.balance += payout;
            return { digest: "D", amount: payout, arrived: true };
        },
        balance: async () => state.balance,
        now: () => state.now,
        storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    };
    return { state, store, deps, funds: createFunds(deps) };
}

test("trigger 1 SUI, target 2 SUI", () => {
    assert.equal(TRIGGER_BALANCE, SUI);
    assert.equal(TARGET_BALANCE, 2n * SUI);
});

test("from 0 SUI: two requests on sign-in, 0 -> 1 -> 2", async () => {
    const w = world(0n);
    await w.funds.signedIn(A);
    assert.equal(w.state.requests.length, 2);
    assert.equal(w.state.balance, 2n * SUI);
});

test("at 0.99 SUI requests until the balance is at least 2 SUI; at 0.9 SUI the same", async () => {
    for (const start of [(SUI * 99n) / 100n, (SUI * 9n) / 10n]) {
        const w = world(start);
        await w.funds.signedIn(A);
        assert.equal(w.state.requests.length, 2);
        assert.ok(w.state.balance >= 2n * SUI);
    }
});

test("at exactly 1 SUI, and between 1 and 2 SUI, nothing is requested at any check point", async () => {
    for (const balance of [SUI, (SUI * 12n) / 10n, (SUI * 199n) / 100n]) {
        const w = world(balance);
        await w.funds.signedIn(A);
        await w.funds.beforeGame(A);
        await w.funds.ensureGas(A);
        await w.funds.afterTransaction(A);
        assert.equal(w.state.requests.length, 0);
    }
});

test("a top-up keeps asking until the target is reached, bounded", async () => {
    const w = world(0n);
    await w.funds.signedIn(A);
    assert.equal(w.state.balance, 2n * SUI);
    assert.equal(w.state.requests.length, 2);
    assert.equal(w.state.peak, 1);

    const tiny = world(0n, { payout: SUI / 100n });
    await tiny.funds.signedIn(A);
    assert.equal(tiny.state.requests.length, MAX_REQUESTS_PER_CHECK);
});

test("at or above 2 SUI nothing is requested, at any check point", async () => {
    for (const balance of [2n * SUI, 5n * SUI]) {
        const w = world(balance);
        await w.funds.signedIn(A);
        await w.funds.beforeGame(A);
        await w.funds.ensureGas(A);
        await w.funds.afterTransaction(A);
        assert.equal(w.state.requests.length, 0);
    }
});

test("sign-in happens once per address and session", async () => {
    const w = world(0n, { payout: SUI / 100n });
    await w.funds.signedIn(A);
    const made = w.state.requests.length;
    await w.funds.signedIn(A); // a double effect, a re-render
    assert.equal(w.state.requests.length, made);
});

test("after a transaction the balance is topped up only once it is under 1 SUI", async () => {
    const w = world(2n * SUI);
    await w.funds.afterTransaction(A);
    w.state.balance -= SUI / 50n; // a few cents spent: 1.98 SUI, no request
    w.state.now += MIN_INTERVAL_MS;
    await w.funds.afterTransaction(A);
    assert.equal(w.state.requests.length, 0);
    w.state.balance = (SUI * 99n) / 100n; // spent down under the trigger
    w.state.now += MIN_INTERVAL_MS;
    await w.funds.afterTransaction(A);
    assert.equal(w.state.requests.length, 2);
    assert.ok(w.state.balance >= 2n * SUI);
});

test("before a game under 1 SUI asks without holding up a balance that can pay", async () => {
    const w = world((SUI * 9n) / 10n);
    await w.funds.beforeGame(A); // returns at once: 1 SUI pays for the queue
    assert.equal(w.funds.waiting(), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(w.state.requests.length, 2);
    assert.ok(w.state.balance >= 2n * SUI);
});

test("a balance that cannot pay waits for the first request, with a pending flag", async () => {
    const w = world(0n);
    let flagged = false;
    w.funds.subscribe(() => (flagged ||= w.funds.waiting()));
    await w.funds.beforeGame(A);
    assert.equal(flagged, true);
    assert.equal(w.funds.waiting(), false);
    assert.ok(w.state.balance >= SUI);
});

test("a sign-in and a game close together collapse into one keeper", async () => {
    const w = world(0n);
    const signedIn = w.funds.signedIn(A);
    await w.funds.beforeGame(A);
    await signedIn;
    assert.equal(w.state.peak, 1);
    assert.equal(w.state.requests.length, 2); // one keeper, two requests to reach 2 SUI
    // a game again a moment later, balance full: nothing
    await w.funds.beforeGame(A);
    assert.equal(w.state.requests.length, 2);
});

test("no new keeper within the minimum interval, kept across a reload", async () => {
    const w = world(0n, { payout: SUI / 100n });
    await w.funds.signedIn(A);
    const made = w.state.requests.length;
    await w.funds.afterTransaction(A);
    assert.equal(w.state.requests.length, made);
    // a reload: new memory, same storage
    const again = createFunds(w.deps);
    await again.signedIn(A);
    assert.equal(w.state.requests.length, made);
    w.state.now += MIN_INTERVAL_MS;
    await again.afterTransaction(A);
    assert.ok(w.state.requests.length > made);
});

test("addresses are kept apart", async () => {
    const w = world(0n);
    await w.funds.signedIn(A);
    w.state.balance = 0n;
    await w.funds.signedIn(B);
    assert.deepEqual([...new Set(w.state.requests)], [A, B]);
});

test("a failed request is silent while the balance can pay, and is not repeated", async () => {
    const w = world((SUI * 9n) / 10n, { fail: () => new FaucetError("rate_limited", "slow", 120) });
    await w.funds.beforeGame(A);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(w.state.requests.length, 1);
    await w.funds.ensureGas(A); // still funded: goes through, no new request
    await w.funds.afterTransaction(A);
    assert.equal(w.state.requests.length, 1);
    w.state.now += MIN_INTERVAL_MS + 1; // past the interval, inside the cooldown
    await w.funds.beforeGame(A);
    assert.equal(w.state.requests.length, 1);
});

test("a balance that cannot pay after a failure stops the action with one line and the retry time", async () => {
    const w = world(0n, { fail: () => new FaucetError("rate_limited", "slow", 120) });
    await assert.rejects(
        w.funds.beforeGame(A),
        (e: Error) => e.message === "Not enough SUI for this action. Try again in 2 min",
    );
    assert.equal(w.state.requests.length, 1);
    const down = world(0n, { fail: () => new FaucetError("unavailable", "down") });
    await assert.rejects(down.funds.ensureGas(A), (e: Error) =>
        e.message.startsWith(
            `Not enough SUI for this action. Try again in ${FAILURE_COOLDOWN_MS / 1000} s`,
        ),
    );
    assert.equal(w.funds.waiting(), false);
});

test("an unreadable balance never blocks an action", async () => {
    const w = world(0n);
    w.deps.balance = async () => {
        throw new Error("rpc down");
    };
    const funds = createFunds(w.deps);
    await funds.signedIn(A);
    await funds.beforeGame(A);
    assert.equal(w.state.requests.length, 0);
});

// --- every way in lands on the one check ---

test("the shell mounts one sign-in check on the active address, whatever the sign-in method", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.match(app, /<FundsOnSignIn \/>/);
    const funds = readFileSync(new URL("../src/chain/funds.ts", import.meta.url), "utf8");
    // The only input is the dApp Kit's current account: passkey, zkLogin, wallet and session all set it.
    assert.match(funds, /useCurrentAccount\(\)\?\.address/);
    assert.match(funds, /funds\.signedIn\(address\)/);
});

test("a connected wallet that holds 1 SUI or more triggers nothing", async () => {
    const w = world(SUI);
    await w.funds.signedIn(A);
    assert.equal(w.state.requests.length, 0);
});

test("the sender checks after every transaction and Find Match before every game", () => {
    const sender = readFileSync(new URL("../src/chain/sender.tsx", import.meta.url), "utf8");
    assert.equal((sender.match(/afterTransaction\(owner\)/g) ?? []).length, 2);
    const match = readFileSync(new URL("../src/chain/matchmaking.ts", import.meta.url), "utf8");
    assert.match(match, /await beforeGame\(owner\)/);
});
