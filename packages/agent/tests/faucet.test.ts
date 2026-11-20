// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { argon2d } from "hash-wasm";

import { FaucetError, requestTestnetSui, type FaucetRequest } from "../src/faucet.ts";
import {
    checkChallenge,
    grind,
    leading64,
    preimage,
    thresholdFor,
    type Challenge,
} from "../src/faucet-pow.ts";
import { solveInWorkers } from "../src/faucet-solver.ts";

const ADDRESS = "0x" + "11".repeat(32);
const BASE = "https://faucet.test";

const challenge = (patch: Partial<Challenge> = {}): Challenge => ({
    version: 1,
    domain: "sui-faucet-pow/1",
    algorithm: "argon2d",
    argon2Version: 19,
    memorySize: 8192,
    iterations: 1,
    parallelism: 1,
    hashLength: 32,
    salt: "sui-faucet-pow-1",
    network: "testnet",
    chainId: "chain",
    checkpointSeq: "100",
    checkpointDigest: "digest",
    randomBytes: "cmFuZG9t",
    faucetAddress: "0x" + "22".repeat(32),
    recipient: ADDRESS,
    difficulty: "3000",
    threshold: "6148914691236517",
    windowSeconds: 60,
    amountMist: "1000000000",
    ...patch,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });

/** A faucet behind a script of answers, and the calls it saw. */
function faucet(answers: (Response | Error)[]) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string });
        const next = answers.shift();
        if (!next) throw new Error("unexpected call");
        if (next instanceof Error) throw next;
        return next;
    }) as typeof fetch;
    return { fetch: fetchStub, calls };
}

/** A balance that reads each value in turn, then the last one for ever. */
function balances(...values: bigint[]) {
    let i = 0;
    return async () => values[Math.min(i++, values.length - 1)];
}

const sleeps: number[] = [];
const request = (patch: Partial<FaucetRequest>): FaucetRequest => ({
    address: ADDRESS,
    baseUrl: BASE,
    balance: balances(0n),
    solve: async () => ({ nonce: "7", hashHex: "ab".repeat(32) }),
    sleep: async (ms) => void sleeps.push(ms),
    pollMs: 1,
    ...patch,
});

const failsWith = (kind: string, retryAfterSeconds?: number) => (e: unknown) => {
    assert.ok(e instanceof FaucetError, String(e));
    assert.equal(e.kind, kind);
    if (retryAfterSeconds !== undefined) assert.equal(e.retryAfterSeconds, retryAfterSeconds);
    return true;
};

const paid = { status: "success", digest: "D1", amountMist: "1000000000" };

// === The proof of work, against the faucet's published vectors ===

const VECTOR_INPUTS = {
    chainId: "8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v",
    checkpointSeq: "1713342",
    checkpointDigest: "GzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb",
    faucetAddress: "0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4",
    recipient: "0x" + "11".repeat(32),
};
const RANDOM = "mJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3";
const VECTORS = [
    { randomBytes: RANDOM, nonce: "0", hash: "31f6ec0e9169705f6105219eebbbc77420f1d9273d407db5df17b4d090afb92d", v: "3600324499442593887" },
    { randomBytes: RANDOM, nonce: "42", hash: "959c60b9062203b7739fb94aa3577a6173fa36f0cec60e55ce714402b36ffa28", v: "10780597955806233527" },
    { randomBytes: RANDOM, nonce: "201", hash: "0008faf113e0b071f5f9d5d6e1dc9321890ecb7e81059f07dedbd3dec5e902bb", v: "2527713141239921" },
    { randomBytes: RANDOM, nonce: "18446744073709551615", hash: "6f8096ffd12d6c2fe93d8bb12c6b9544e6aa00ed8ee8fcdbe5ebec12000d5dcd", v: "8034587760699206703" },
    { randomBytes: "", nonce: "0", hash: "d8430e5471f4fba3c3c67a253f15dc72588d87c364117e1f138e26387050ec60", v: "15583314891483970467" },
];

const hasher = (o: Parameters<typeof argon2d>[0]) => argon2d({ ...o, outputType: "binary" });

for (const v of VECTORS) {
    test(`published vector: nonce ${v.nonce}${v.randomBytes ? "" : ", no randomness"}`, async () => {
        const c = challenge({ ...VECTOR_INPUTS, randomBytes: v.randomBytes });
        const text = preimage(c, BigInt(v.nonce));
        assert.equal(text.split("\n").length, 8);
        assert.ok(!text.endsWith("\n"));
        const hash = await hasher({
            password: text,
            salt: new TextEncoder().encode("sui-faucet-pow-1"),
            memorySize: 8192,
            iterations: 1,
            parallelism: 1,
            hashLength: 32,
            outputType: "binary",
        });
        assert.equal(Buffer.from(hash).toString("hex"), v.hash);
        assert.equal(String(leading64(hash)), v.v);
    });
}

test("published thresholds: floor(2^64 / difficulty), integer division", () => {
    const thresholds = {
        "2": "9223372036854775808",
        "3": "6148914691236517205",
        "256": "72057594037927936",
        "724": "25478928278604353",
        "1000": "18446744073709551",
        "281474976710656": "65536",
    };
    for (const [difficulty, threshold] of Object.entries(thresholds)) {
        assert.equal(String(thresholdFor(BigInt(difficulty))), threshold, difficulty);
    }
});

test("grinding up from zero at difficulty 256 finds the published nonce 201", async () => {
    const c = challenge({
        ...VECTOR_INPUTS,
        randomBytes: RANDOM,
        difficulty: "256",
        threshold: "72057594037927936",
    });
    const found = await grind({ argon2d: hasher, challenge: c, startNonce: 0n });
    assert.equal(found?.nonce, "201");
    assert.equal(found?.hashHex, VECTORS[2].hash);
});

test("grinding stops when told to", async () => {
    const c = challenge({ difficulty: "281474976710656", threshold: "65536" });
    const found = await grind({ argon2d: hasher, challenge: c, startNonce: 0n, shouldStop: () => true });
    assert.equal(found, null);
});

test("worker threads solve the same challenge, from any start", async () => {
    const c = challenge({
        ...VECTOR_INPUTS,
        randomBytes: RANDOM,
        difficulty: "256",
        threshold: "72057594037927936",
    });
    const proof = await solveInWorkers(c, new AbortController().signal, 2);
    const hash = await hasher({
        password: preimage(c, BigInt(proof.nonce)),
        salt: new TextEncoder().encode(c.salt),
        memorySize: 8192,
        iterations: 1,
        parallelism: 1,
        hashLength: 32,
        outputType: "binary",
    });
    assert.equal(Buffer.from(hash).toString("hex"), proof.hashHex);
    assert.ok(leading64(hash) < thresholdFor(256n));
});

test("an aborted solve ends its workers", async () => {
    const c = challenge({ difficulty: "281474976710656", threshold: "65536" });
    const abort = new AbortController();
    const solving = solveInWorkers(c, abort.signal, 1);
    setTimeout(() => abort.abort(new Error("stop")), 50);
    await assert.rejects(solving, /stop/);
});

test("a challenge that breaks the spec is refused before any work", () => {
    for (const patch of [
        { threshold: "1" },
        { difficulty: "1", threshold: String(1n << 64n) },
        { difficulty: String((1n << 48n) + 1n), threshold: "0" },
        { domain: "sui-faucet-pow/2" },
        { memorySize: 1 << 30 },
        { salt: "other" },
        { version: 2 },
    ]) {
        assert.throws(() => checkChallenge(challenge(patch as Partial<Challenge>)), /faucet challenge/);
    }
    assert.doesNotThrow(() => checkChallenge(challenge()));
});

// === The client, against a faucet that is mocked ===

test("success: challenge, proof, payout, then the balance shows the funds", async () => {
    const { fetch, calls } = faucet([json(200, challenge()), json(200, paid)]);
    const result = await requestTestnetSui(request({ fetch, balance: balances(0n, 0n, 1_000_000_000n) }));
    assert.deepEqual(result, { digest: "D1", amount: 1_000_000_000n, arrived: true });
    assert.equal(calls[0].url, `${BASE}/v3/challenge?recipient=${ADDRESS}`);
    assert.equal(calls[1].url, `${BASE}/v3/gas`);
    assert.deepEqual(JSON.parse(calls[1].body!), {
        recipient: ADDRESS,
        checkpointSeq: "100",
        nonce: "7",
        hashHex: "ab".repeat(32),
    });
});

test("a short address is normalized before it is sent", async () => {
    const { fetch, calls } = faucet([
        json(200, challenge({ recipient: "0x" + "0".repeat(63) + "5" })),
        json(200, paid),
    ]);
    await requestTestnetSui(request({ fetch, address: "0x5", balance: balances(0n, 1n << 40n) }));
    assert.match(calls[0].url, /recipient=0x0{63}5$/);
});

test("already funded: no request at all", async () => {
    const { fetch, calls } = faucet([]);
    const result = await requestTestnetSui(
        request({ fetch, balance: balances(2_000_000_000n), skipAtOrAbove: 500_000_000n }),
    );
    assert.deepEqual(result, { digest: null, amount: 0n, arrived: true });
    assert.equal(calls.length, 0);
});

test("rate limited: says so with the retry-after, and does not retry", async () => {
    const { fetch, calls } = faucet([json(429, { error: "slow down" }, { "retry-after": "42" })]);
    await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("rate_limited", 42));
    assert.equal(calls.length, 1);
});

test("rate limited at the payout, without a hint, falls back to a minute", async () => {
    const { fetch, calls } = faucet([json(200, challenge()), json(429, {})]);
    await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("rate_limited", 60));
    assert.equal(calls.length, 2);
});

test("out of funds, a plain 500 and unknown codes are reported at once", async () => {
    for (const [status, code, kind] of [
        [503, "funds_unavailable", "unavailable"],
        [500, "internal", "unavailable"],
        [400, "something_new", "rejected"],
        [400, "invalid_proof", "rejected"],
        [400, "insufficient_work", "rejected"],
        [400, "invalid_request", "rejected"],
        [502, "payout_failed", "unavailable"],
    ] as const) {
        const { fetch, calls } = faucet([
            json(200, challenge()),
            json(status, { code, error: "later", ...(code === "payout_failed" ? { digest: "X" } : {}) }),
            json(200, paid),
        ]);
        await assert.rejects(requestTestnetSui(request({ fetch })), failsWith(kind), code);
        assert.equal(calls.length, 2, code);
    }
});

test("a busy faucet is retried after a backoff, twice at most", async () => {
    sleeps.length = 0;
    const busy = json(503, { code: "overloaded" }, { "retry-after": "3" });
    const ok = faucet([json(200, challenge()), busy, json(200, paid)]);
    const result = await requestTestnetSui(request({ fetch: ok.fetch, balance: balances(0n, 1n << 40n) }));
    assert.equal(result.digest, "D1");
    assert.equal(sleeps[0], 3000);

    const never = faucet([
        json(200, challenge()),
        json(503, { code: "not_ready" }),
        json(503, { code: "not_ready" }),
        json(503, { code: "not_ready" }),
        json(200, paid),
    ]);
    await assert.rejects(requestTestnetSui(request({ fetch: never.fetch })), failsWith("unavailable"));
    assert.equal(never.calls.length, 4);
});

test("a payout that failed before it ran is retried; one with a digest is not", async () => {
    const retried = faucet([json(200, challenge()), json(502, { code: "payout_failed" }), json(200, paid)]);
    const result = await requestTestnetSui(request({ fetch: retried.fetch, balance: balances(0n, 1n << 40n) }));
    assert.equal(result.digest, "D1");
});

test("a busy challenge endpoint is retried too, then gives up", async () => {
    const { fetch, calls } = faucet([json(503, {}), json(503, {}), json(503, {}), json(200, challenge())]);
    await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("unavailable"));
    assert.equal(calls.length, 3);
});

test("an unreachable faucet is a network error; a silent one times out", async () => {
    await assert.rejects(
        requestTestnetSui(request({ fetch: faucet([new TypeError("fetch failed")]).fetch })),
        failsWith("network"),
    );
    const hang = ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        })) as unknown as typeof fetch;
    await assert.rejects(requestTestnetSui(request({ fetch: hang, callTimeoutMs: 20 })), failsWith("timeout"));
});

test("a proof that never comes times out as a whole", async () => {
    const { fetch } = faucet([json(200, challenge())]);
    await assert.rejects(
        requestTestnetSui(
            request({
                fetch,
                timeoutMs: 20,
                solve: (_c, signal) =>
                    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
            }),
        ),
        failsWith("timeout"),
    );
});

test("a stale proof gets fresh challenges, but not for ever", async () => {
    const stale = (seq: string) => ({
        code: "stale_checkpoint",
        challenge: challenge({ checkpointSeq: seq }),
    });
    const { fetch, calls } = faucet([
        json(200, challenge()),
        json(409, stale("200")),
        json(200, paid),
    ]);
    await requestTestnetSui(request({ fetch, balance: balances(0n, 1n << 40n) }));
    assert.equal(JSON.parse(calls[2].body!).checkpointSeq, "200");

    const endless = faucet([
        json(200, challenge()),
        json(409, stale("200")),
        json(409, stale("300")),
        json(409, stale("400")),
        json(200, paid),
    ]);
    await assert.rejects(requestTestnetSui(request({ fetch: endless.fetch })), failsWith("rejected"));
    assert.equal(endless.calls.length, 4);
});

test("a lost answer: already_used or payout_status_unknown with a digest count as paid, never resent", async () => {
    for (const code of ["already_used", "payout_status_unknown"]) {
        const { fetch, calls } = faucet([json(200, challenge()), json(code === "already_used" ? 409 : 502, { code, digest: "D9" })]);
        const result = await requestTestnetSui(request({ fetch, balance: balances(0n, 1n << 40n) }));
        assert.equal(result.digest, "D9");
        assert.equal(calls.length, 2);
    }
});

test("a balance that is slow to show the payout reports arrived: false", async () => {
    const { fetch } = faucet([json(200, challenge()), json(200, paid)]);
    const result = await requestTestnetSui(request({ fetch, balance: balances(0n), arrivalTimeoutMs: 5 }));
    assert.equal(result.arrived, false);
});

test("a challenge for another network, address or protocol is refused", async () => {
    for (const patch of [{ network: "mainnet" }, { recipient: "0x" + "33".repeat(32) }, { domain: "x" }]) {
        const { fetch, calls } = faucet([json(200, challenge(patch))]);
        await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("rejected"));
        assert.equal(calls.length, 1);
    }
});
