// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { argon2d } from "hash-wasm";

import { FaucetError, requestTestnetSui, type FaucetRequest } from "../src/chain/faucet.ts";
import {
    grind,
    leading64,
    preimage,
    thresholdFor,
    type Challenge,
} from "../src/chain/faucet-pow.ts";

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

const request = (patch: Partial<FaucetRequest>): FaucetRequest => ({
    address: ADDRESS,
    baseUrl: BASE,
    balance: balances(0n),
    solve: async () => ({ nonce: "7", hashHex: "ab".repeat(32) }),
    sleep: async () => {},
    pollMs: 1,
    ...patch,
});

const failsWith = (kind: string, retryAfterSeconds?: number) => (e: unknown) => {
    assert.ok(e instanceof FaucetError, String(e));
    assert.equal(e.kind, kind);
    if (retryAfterSeconds !== undefined) assert.equal(e.retryAfterSeconds, retryAfterSeconds);
    return true;
};

test("success: challenge, proof, payout, then the balance shows the funds", async () => {
    const { fetch, calls } = faucet([
        json(200, challenge()),
        json(200, { status: "success", digest: "D1", amountMist: "1000000000" }),
    ]);
    const result = await requestTestnetSui(
        request({ fetch, balance: balances(0n, 0n, 1_000_000_000n) }),
    );
    assert.deepEqual(result, { digest: "D1", amount: 1_000_000_000n, arrived: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url, `${BASE}/v3/challenge?recipient=${ADDRESS}`);
    assert.equal(calls[1].url, `${BASE}/v3/gas`);
    // The address is the only thing about the player that goes out.
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
        json(200, { status: "success", digest: "D", amountMist: "1" }),
    ]);
    await requestTestnetSui(
        request({ fetch, address: "0x5", balance: balances(0n, 1n), arrivalTimeoutMs: 50 }),
    );
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

test("rate limited: says so with the faucet's retry-after, and does not retry", async () => {
    const { fetch, calls } = faucet([
        json(429, { error: "slow down" }, { "retry-after": "42" }),
        json(200, challenge()),
    ]);
    await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("rate_limited", 42));
    assert.equal(calls.length, 1);
});

test("rate limited without a hint falls back to a minute", async () => {
    const { fetch } = faucet([json(429, {})]);
    await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("rate_limited", 60));
});

test("service error: out of funds, not ready, or a plain 500, each unavailable and not retried", async () => {
    for (const [status, code] of [
        [503, "funds_unavailable"],
        [503, "not_ready"],
        [500, "internal"],
    ] as const) {
        const { fetch, calls } = faucet([
            json(200, challenge()),
            json(status, { code, error: "later" }),
            json(200, { status: "success", digest: "never", amountMist: "1" }),
        ]);
        await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("unavailable"));
        assert.equal(calls.length, 2);
    }
});

test("an unreachable faucet is a network error", async () => {
    const { fetch } = faucet([new TypeError("Failed to fetch")]);
    await assert.rejects(requestTestnetSui(request({ fetch })), failsWith("network"));
});

test("a faucet that never answers times out", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        })) as unknown as typeof fetch;
    await assert.rejects(
        requestTestnetSui(request({ fetch: hang, callTimeoutMs: 20 })),
        failsWith("timeout"),
    );
});

test("a proof that never comes times out as a whole", async () => {
    const { fetch } = faucet([json(200, challenge())]);
    await assert.rejects(
        requestTestnetSui(
            request({
                fetch,
                timeoutMs: 20,
                solve: (_c, signal) =>
                    new Promise((_resolve, reject) =>
                        signal.addEventListener("abort", () => reject(signal.reason)),
                    ),
            }),
        ),
        failsWith("timeout"),
    );
});

test("a stale proof gets one fresh challenge, no more", async () => {
    const stale = {
        code: "stale_checkpoint",
        error: "old",
        challenge: challenge({ checkpointSeq: "200" }),
    };
    const { fetch, calls } = faucet([
        json(200, challenge()),
        json(409, stale),
        json(200, { status: "success", digest: "D2", amountMist: "1000000000" }),
    ]);
    const result = await requestTestnetSui(
        request({ fetch, balance: balances(0n, 1_000_000_000n) }),
    );
    assert.equal(result.digest, "D2");
    assert.equal(JSON.parse(calls[2].body!).checkpointSeq, "200");

    const twice = faucet([json(200, challenge()), json(409, stale), json(409, stale)]);
    await assert.rejects(requestTestnetSui(request({ fetch: twice.fetch })), failsWith("rejected"));
    assert.equal(twice.calls.length, 3);
});

test("a proof the faucet already paid is a success, not a second request", async () => {
    const { fetch, calls } = faucet([
        json(200, challenge()),
        json(409, { code: "already_used", digest: "D3" }),
    ]);
    const result = await requestTestnetSui(
        request({ fetch, balance: balances(0n, 1_000_000_000n) }),
    );
    assert.equal(result.digest, "D3");
    assert.equal(calls.length, 2);
});

test("a payout that may or may not have happened only waits for the balance", async () => {
    const { fetch, calls } = faucet([
        json(200, challenge()),
        json(502, { code: "payout_status_unknown", digest: "D4" }),
    ]);
    const result = await requestTestnetSui(
        request({ fetch, balance: balances(0n), arrivalTimeoutMs: 5 }),
    );
    assert.equal(result.digest, "D4");
    assert.equal(result.arrived, false);
    assert.equal(calls.length, 2);
});

test("a challenge for another network, account or protocol is refused before any work", async () => {
    for (const patch of [
        { network: "mainnet" },
        { recipient: "0x" + "33".repeat(32) },
        { memorySize: 1 << 20 },
        { domain: "sui-faucet-pow/2" },
    ]) {
        let solved = false;
        const { fetch } = faucet([json(200, challenge(patch))]);
        await assert.rejects(
            requestTestnetSui(
                request({
                    fetch,
                    solve: async () => {
                        solved = true;
                        return { nonce: "0", hashHex: "" };
                    },
                }),
            ),
            failsWith("rejected"),
        );
        assert.equal(solved, false);
    }
});

test("an unreadable balance is a network error, not a request", async () => {
    const { fetch, calls } = faucet([]);
    await assert.rejects(
        requestTestnetSui(
            request({
                fetch,
                balance: async () => {
                    throw new Error("rpc down");
                },
            }),
        ),
        failsWith("network"),
    );
    assert.equal(calls.length, 0);
});

// --- the proof of work, against the faucet's published conformance vector ---

test("preimage, hash and threshold match the faucet's conformance vector", async () => {
    const c = challenge({
        chainId: "8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v",
        checkpointSeq: "1713342",
        checkpointDigest: "GzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb",
        randomBytes: "mJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3",
        faucetAddress: "0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4",
        recipient: "0x" + "11".repeat(32),
    });
    const text = preimage(c, 0n);
    assert.equal(text.split("\n").length, 8);
    assert.equal(text.split("\n")[7], "0");
    const hash = await argon2d({
        password: text,
        salt: new TextEncoder().encode(c.salt),
        memorySize: 8192,
        iterations: 1,
        parallelism: 1,
        hashLength: 32,
        outputType: "hex",
    });
    assert.equal(hash, "31f6ec0e9169705f6105219eebbbc77420f1d9273d407db5df17b4d090afb92d");
    assert.equal(thresholdFor(3000n), 6148914691236517n);
});

// The published vectors, https://faucet.sui.io/pow-spec/pow-vectors.json (identical to docs/pow-vectors.json in
// the station's repository). Each case is checked on the exact preimage, the 32-byte hash and the leading u64.
const VECTOR_INPUTS = {
    chainId: "8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v",
    checkpointSeq: "1713342",
    checkpointDigest: "GzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb",
    faucetAddress: "0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4",
    recipient: "0x" + "11".repeat(32),
};
const VECTORS = [
    {
        note: "randomness present",
        randomBytes: "mJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3",
        nonce: "0",
        preimage:
            "sui-faucet-pow/1\n8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v\n1713342\nGzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb\nmJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3\n0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4\n0x1111111111111111111111111111111111111111111111111111111111111111\n0",
        hash: "31f6ec0e9169705f6105219eebbbc77420f1d9273d407db5df17b4d090afb92d",
        v: "3600324499442593887",
    },
    {
        note: "randomness present",
        randomBytes: "mJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3",
        nonce: "42",
        preimage:
            "sui-faucet-pow/1\n8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v\n1713342\nGzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb\nmJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3\n0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4\n0x1111111111111111111111111111111111111111111111111111111111111111\n42",
        hash: "959c60b9062203b7739fb94aa3577a6173fa36f0cec60e55ce714402b36ffa28",
        v: "10780597955806233527",
    },
    {
        note: "randomness present, valid at difficulty 256 and the first solution found grinding up from zero",
        randomBytes: "mJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3",
        nonce: "201",
        preimage:
            "sui-faucet-pow/1\n8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v\n1713342\nGzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb\nmJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3\n0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4\n0x1111111111111111111111111111111111111111111111111111111111111111\n201",
        hash: "0008faf113e0b071f5f9d5d6e1dc9321890ecb7e81059f07dedbd3dec5e902bb",
        v: "2527713141239921",
    },
    {
        note: "randomness present, maximum u64 nonce",
        randomBytes: "mJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3",
        nonce: "18446744073709551615",
        preimage:
            "sui-faucet-pow/1\n8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v\n1713342\nGzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb\nmJ4ZqDXQasy17GTiGfp0/OYAGCR+7reLM5+Gb39YtoAIaPuh1wj+z5J7po+eSze3\n0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4\n0x1111111111111111111111111111111111111111111111111111111111111111\n18446744073709551615",
        hash: "6f8096ffd12d6c2fe93d8bb12c6b9544e6aa00ed8ee8fcdbe5ebec12000d5dcd",
        v: "8034587760699206703",
    },
    {
        note: "randomness absent, so the field is empty and the digest carries the unpredictability",
        randomBytes: "",
        nonce: "0",
        preimage:
            "sui-faucet-pow/1\n8wWZfv1HjQxjB5ncmC9CQqqRqUMBiEZXnc5FhS9zRe1v\n1713342\nGzBdc9tbUe3s2PK1iVJcyQBj5TvdX7bJiAHWbhBDYiYb\n\n0x949cd75a2485cc18b8258634ffd9b849a687e2e2a0b4c2444a21f007fc79adc4\n0x1111111111111111111111111111111111111111111111111111111111111111\n0",
        hash: "d8430e5471f4fba3c3c67a253f15dc72588d87c364117e1f138e26387050ec60",
        v: "15583314891483970467",
    },
];

for (const v of VECTORS) {
    test(`published vector: nonce ${v.nonce}, ${v.note.slice(0, 40)}`, async () => {
        const c = challenge({ ...VECTOR_INPUTS, randomBytes: v.randomBytes });
        assert.equal(preimage(c, BigInt(v.nonce)), v.preimage);
        const hash = await argon2d({
            password: v.preimage,
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

const THRESHOLDS = {
    "2": "9223372036854775808",
    "3": "6148914691236517205",
    "7": "2635249153387078802",
    "256": "72057594037927936",
    "724": "25478928278604353",
    "725": "25443784929254553",
    "1000": "18446744073709551",
    "11586": "1592158128233173",
    "281474976710656": "65536",
};
test("published thresholds: floor(2^64 / difficulty), integer division", () => {
    for (const [difficulty, threshold] of Object.entries(THRESHOLDS))
        assert.equal(String(thresholdFor(BigInt(difficulty))), threshold, difficulty);
});

test("the vector at difficulty 256 is the first solution grinding up from zero", async () => {
    const case201 = VECTORS.find((v) => v.nonce === "201")!;
    const c = challenge({
        ...VECTOR_INPUTS,
        randomBytes: case201.randomBytes,
        difficulty: "256",
        threshold: "72057594037927936",
    });
    const found = await grind({
        argon2d: (o) => argon2d({ ...o, outputType: "binary" }),
        challenge: c,
        startNonce: 0n,
    });
    assert.equal(found?.nonce, "201");
    assert.equal(found?.hashHex, case201.hash);
});

test("a challenge whose threshold or difficulty breaks the spec is refused before any work", async () => {
    for (const patch of [
        { threshold: "1" },
        { difficulty: "1", threshold: String(1n << 64n) },
        { difficulty: String((1n << 48n) + 1n), threshold: "0" },
        { difficulty: "abc" },
    ]) {
        let solved = false;
        const { fetch } = faucet([json(200, challenge(patch))]);
        await assert.rejects(
            requestTestnetSui(
                request({
                    fetch,
                    solve: async () => {
                        solved = true;
                        return { nonce: "0", hashHex: "" };
                    },
                }),
            ),
            failsWith("rejected"),
        );
        assert.equal(solved, false);
    }
});

test("grind finds a nonce under an easy threshold and stops when told", async () => {
    const easy = challenge({ difficulty: "2", threshold: "9223372036854775808" });
    const found = await grind({
        argon2d: (o) => argon2d({ ...o, outputType: "binary" }),
        challenge: easy,
        startNonce: 0n,
    });
    assert.ok(found && found.hashHex.length === 64);
    const hopeless = await grind({
        argon2d: async () => new Uint8Array(32).fill(255),
        challenge: easy,
        startNonce: 0n,
        shouldStop: () => true,
    });
    assert.equal(hopeless, null);
});

// --- the service worker leaves the faucet alone ---

test("the service worker never intercepts a request to another origin", () => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const sandbox: Record<string, unknown> = {
        self: {
            addEventListener: (type: string, fn: (event: unknown) => void) =>
                (listeners[type] = fn),
            location: { origin: "https://game.test" },
        },
        caches: {},
        URL,
        fetch: async () => {
            throw new Error("offline");
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), sandbox);
    let answered = false;
    for (const [method, url] of [
        ["GET", "https://faucet.testnet.sui.io/v3/challenge?recipient=0x1"],
        ["POST", "https://faucet.testnet.sui.io/v3/gas"],
    ]) {
        listeners.fetch({
            request: { method, url, mode: "cors", headers: { has: () => false } },
            waitUntil: () => {},
            respondWith: () => (answered = true),
        });
    }
    assert.equal(answered, false);
});
