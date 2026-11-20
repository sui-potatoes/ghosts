// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    GasTimeout,
    saveFirstName,
    waitForGas,
    type GasDeps,
    type SaveDeps,
} from "../src/chain/first-name-core.ts";
import { GAS_FLOOR } from "../src/chain/funds-core.ts";
import {
    askNow,
    menuRoute,
    nameLine,
    needsName,
    saveDeny,
    skip,
    TAKEN_LINE,
    wasSkipped,
    type AskState,
} from "../src/features/name-step/rules.ts";

const A = "0x" + "aa".repeat(32);
const B = "0x" + "bb".repeat(32);
const fresh: AskState = { address: A, assigned: null, localName: false, skipped: false };

test("detection: no name on the address asks", () => {
    assert.equal(needsName(fresh), true);
});

test("detection: a named address, a local name, signed out or still loading never ask", () => {
    assert.equal(needsName({ ...fresh, assigned: "kestrel" }), false);
    assert.equal(needsName({ ...fresh, localName: true }), false);
    assert.equal(needsName({ ...fresh, address: null }), false);
    assert.equal(needsName({ ...fresh, assigned: undefined }), false);
});

test("detection: skipped is per address on the device", () => {
    const map = new Map<string, string>();
    const store = {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
    };
    assert.equal(wasSkipped(store, "testnet", A), false);
    skip(store, "testnet", A);
    assert.equal(wasSkipped(store, "testnet", A), true);
    assert.equal(wasSkipped(store, "testnet", B), false);
    assert.equal(wasSkipped(store, "mainnet", A), false);
    assert.equal(needsName({ ...fresh, skipped: wasSkipped(store, "testnet", A) }), false);
    assert.equal(
        needsName({ ...fresh, address: B, skipped: wasSkipped(store, "testnet", B) }),
        true,
    );
    assert.equal(wasSkipped(null, "testnet", A), false);
});

test("deferral: menu screens ask, a match, the viewer and the editor wait", () => {
    for (const p of [
        "/",
        "/play",
        "/play/friendly",
        "/play/ranked",
        "/leaderboard",
        "/watch",
        "/settings",
        "/headquarters/armory",
    ])
        assert.equal(askNow(fresh, p), true, p);
    for (const p of ["/match", "/watch/0xabc", "/demo", "/demo-2", "/editor"])
        assert.equal(askNow(fresh, p), false, p);
    assert.equal(menuRoute("/watch/"), true);
    assert.equal(askNow({ ...fresh, assigned: "kestrel" }, "/"), false);
});

test("lines: each problem, the taken line, none for an empty or fine draft", () => {
    assert.equal(nameLine("", "At least 3 characters", false), null);
    assert.equal(nameLine("ab", "At least 3 characters", false), "At least 3 characters");
    assert.equal(nameLine("kestrel", null, true), TAKEN_LINE);
    assert.equal(nameLine("kestrel", null, false), null);
    assert.equal(TAKEN_LINE, "This name is taken");
    for (const line of [TAKEN_LINE]) assert.ok(!line.endsWith("."));
});

test("save: refused with the reason, pending says Saving name, a lookup in flight never refuses", () => {
    assert.equal(saveDeny(null, false, false), undefined);
    assert.equal(saveDeny("At least 3 characters", false, false), "At least 3 characters");
    assert.equal(saveDeny(null, true, false), TAKEN_LINE);
    assert.equal(saveDeny(null, false, true), "Saving name");
});

/** A balance that changes with the clock. */
function clock(balanceAt: (t: number) => bigint | null, over: Partial<GasDeps> = {}) {
    let t = 0;
    const asked: number[] = [];
    const deps: GasDeps = {
        balance: async () => balanceAt(t),
        ensure: async () => void asked.push(t),
        now: () => t,
        sleep: async (ms) => void (t += ms),
        timeoutMs: 10_000,
        pollMs: 1_000,
        ...over,
    };
    return { deps, asked, time: () => t };
}

test("gas: funded at once goes ahead without asking", async () => {
    const w = clock(() => GAS_FLOOR);
    await waitForGas(w.deps);
    assert.deepEqual(w.asked, []);
    assert.equal(w.time(), 0);
});

test("gas: waits for the top-up, asks once, goes ahead the second it lands", async () => {
    const w = clock((t) => (t >= 4_000 ? 2_000_000_000n : 0n), {
        ensure: () => new Promise(() => {}),
    });
    let waiting = 0;
    await waitForGas({ ...w.deps, waiting: () => waiting++ });
    assert.equal(w.time(), 4_000);
    assert.equal(waiting, 1);
});

test("gas: never funded times out", async () => {
    const w = clock(() => 0n, { ensure: () => new Promise(() => {}) });
    await assert.rejects(waitForGas(w.deps), GasTimeout);
    assert.equal(w.time(), 10_000);
});

test("gas: a failed top-up ends the wait at once", async () => {
    const w = clock(() => 0n, { ensure: async () => Promise.reject(new Error("Not enough SUI")) });
    await assert.rejects(waitForGas(w.deps), /Not enough SUI/);
    assert.ok(w.time() <= 3_000);
});

test("gas: an unreadable balance lets the write find out", async () => {
    await waitForGas(clock(() => null).deps);
});

function saving(over: Partial<SaveDeps<string>> = {}) {
    const log: string[] = [];
    const deps: SaveDeps<string> = {
        gas: async () => void log.push("gas"),
        hasAccount: async () => false,
        build: async (name, withAccount) => {
            log.push(`build ${name} ${withAccount}`);
            return `tx:${name}:${withAccount}`;
        },
        send: async (tx) => void log.push(`send ${tx}`),
        saved: async (name, withAccount) => void log.push(`saved ${name} ${withAccount}`),
        ...over,
    };
    return { deps, log };
}

test("save: no account yet is one transaction with the name and the account", async () => {
    const s = saving();
    assert.deepEqual(await saveFirstName(s.deps, "kestrel"), { account: true });
    assert.deepEqual(s.log, [
        "gas",
        "build kestrel true",
        "send tx:kestrel:true",
        "saved kestrel true",
    ]);
    assert.equal(s.log.filter((l) => l.startsWith("send")).length, 1);
});

test("save: an existing account is left alone", async () => {
    const s = saving({ hasAccount: async () => true });
    assert.deepEqual(await saveFirstName(s.deps, "kestrel"), { account: false });
    assert.ok(s.log.includes("build kestrel false"));
});

test("save: nothing is built or sent when gas never comes", async () => {
    const s = saving({ gas: async () => Promise.reject(new GasTimeout()) });
    await assert.rejects(saveFirstName(s.deps, "kestrel"), /Could not save the name/);
    assert.deepEqual(s.log, []);
});

test("save: a refused send keeps the caches untouched", async () => {
    const s = saving({ send: async () => Promise.reject(new Error("abort")) });
    await assert.rejects(saveFirstName(s.deps, "kestrel"), /abort/);
    assert.ok(!s.log.some((l) => l.startsWith("saved")));
});
