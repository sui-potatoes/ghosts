// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The transport under rate limits: transient errors classified and retried with bounded,
 * jittered backoff, `Retry-After` honoured, the limiter's rate and its drop on a 429, a send whose
 * answer was lost not sent twice, the play loop riding out a burst of 429s mid-match, seats
 * resuming where their Account is, and the fleet parent restarting a dead seat.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { GhostsAgent, playGames } from "../src/agent.ts";
import type { Backend } from "../src/backend.ts";
import { referencePolicy } from "../src/bot.ts";
import { superviseSeats, type SeatChild } from "../src/fleet.ts";
import {
    backoffMs,
    executeSafely,
    isTransient,
    RateLimiter,
    resilientFetch,
    retryAfterMs,
    newStats,
    TRANSIENT_MARK,
} from "../src/rpc.ts";
import { createSandbox, type SandboxOptions } from "../src/sandbox.ts";
import { ActionError } from "../src/types.ts";
import { pollFactor, pollingWake } from "../src/wake.ts";

const fast = { wake: pollingWake(1) };
const noSleep = async () => {};

/** An RpcError as protobuf-ts throws it for a 429. */
function rpcError(code: string, message: string) {
    return Object.assign(new Error(message), { name: "RpcError", code, methodName: "BatchGetObjects" });
}

test("transient errors are told apart from refusals", () => {
    assert.ok(isTransient(rpcError("RESOURCE_EXHAUSTED", "Too Many Requests")));
    assert.ok(isTransient(rpcError("UNAVAILABLE", "upstream connect error")));
    assert.ok(isTransient(rpcError("DEADLINE_EXCEEDED", "deadline")));
    assert.ok(isTransient(new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNRESET" }) })));
    assert.ok(isTransient(new Error(`${TRANSIENT_MARK} gave up after 180 s: Too Many Requests`)));
    assert.ok(isTransient(new ActionError("congested", "The network is busy: try again.", true)));
    assert.ok(!isTransient(new ActionError("rejected", "Too Many Requests in a name", false)));
    assert.ok(!isTransient(rpcError("NOT_FOUND", "Object not found")));
    assert.ok(!isTransient(new Error("MoveAbort in ghosts")));
});

test("backoff is full jitter, doubling to its cap", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
        const ceiling = Math.min(30_000, 500 * 2 ** attempt);
        assert.equal(backoffMs(attempt, () => 0), 0);
        assert.ok(backoffMs(attempt, () => 0.999999) < ceiling);
        assert.ok(backoffMs(attempt, () => 0.999999) >= ceiling - 1);
    }
    assert.ok(backoffMs(40, () => 0.999999) < 30_000, "never past the cap");
    assert.equal(retryAfterMs("3"), 3_000);
    assert.equal(retryAfterMs(null), null);
    assert.equal(retryAfterMs("soon"), null);
    assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
    assert.equal(retryAfterMs("100000"), 120_000, "capped");
});

/** A clock whose sleeps advance it at once, and which runs on with real time between them. */
function clock() {
    const start = Date.now();
    let t = 0;
    return {
        now: () => t + Date.now() - start,
        sleep: async (ms: number) => void (t += ms),
        advance: (ms: number) => void (t += ms),
    };
}

const response = (status: number, headers: Record<string, string> = {}) =>
    new Response(status === 200 ? "ok" : "busy", { status, headers });

test("429s, resets and 503s are retried, Retry-After honoured, and nothing escapes uncaught", async () => {
    const time = clock();
    const script: (() => Response | Error)[] = [
        () => response(429, { "retry-after": "2" }),
        () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
        () => response(503),
        () => response(200, { "grpc-status": "8" }),
        () => response(200),
    ];
    const delays: number[] = [];
    const stats = newStats(0);
    const limiter = new RateLimiter({ rps: 1000, burst: 1000, now: time.now });
    const fetch = resilientFetch({
        limiter,
        stats,
        now: time.now,
        sleep: time.sleep,
        random: () => 0.5,
        fetch: async () => {
            const next = script.shift()!();
            if (next instanceof Error) throw next;
            return next;
        },
        onRetry: ({ delayMs }) => delays.push(delayMs),
    });
    const ok = await fetch("https://node/sui.rpc.v2.LedgerService/BatchGetObjects", { method: "POST" });
    assert.equal(ok.status, 200);
    assert.equal(stats.requests, 5);
    assert.equal(stats.retries, 4);
    assert.equal(stats.limited, 2);
    assert.ok(delays[0] >= 2_000, `Retry-After is waited out: ${delays[0]}`);
    assert.ok(delays.every((d) => d <= 30_000));
    assert.ok(limiter.rate < 1000, "a 429 lowers the rate");
});

test("a call that never gets through gives up at its cap, as a transient error", async () => {
    const time = clock();
    const fetch = resilientFetch({
        limiter: new RateLimiter({ rps: 1000, now: time.now }),
        stats: newStats(0),
        now: time.now,
        sleep: time.sleep,
        callCapMs: 60_000,
        fetch: async () => response(429),
    });
    await assert.rejects(fetch("https://node/x/BatchGetObjects"), (error) => {
        assert.ok(isTransient(error));
        assert.match((error as Error).message, /gave up/);
        return true;
    });
    assert.ok(time.now() >= 60_000 && time.now() < 75_000, `${time.now()}`);
});

test("a send is resent only on a 429; a reset after it went out goes up to the sender", async () => {
    const time = clock();
    let calls = 0;
    const fetch = resilientFetch({
        limiter: new RateLimiter({ rps: 1000, now: time.now }),
        stats: newStats(0),
        now: time.now,
        sleep: time.sleep,
        fetch: async () => {
            calls++;
            if (calls === 1) return response(429);
            throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        },
    });
    const url = "https://node/sui.rpc.v2.TransactionExecutionService/ExecuteTransaction";
    await assert.rejects(fetch(url), (error) => {
        assert.ok(isTransient(error));
        assert.match((error as Error).message, /may have run/);
        return true;
    });
    assert.equal(calls, 2, "resent after the 429, not after the reset");
});

test("the limiter keeps its rate, serves the urgent first, halves on a 429 and recovers slowly", async () => {
    let t = 0;
    const timers: { at: number; run: () => void }[] = [];
    const limiter = new RateLimiter({
        rps: 2,
        burst: 2,
        now: () => t,
        setTimer: (run, ms) => timers.push({ at: t + ms, run }),
    });
    const order: string[] = [];
    const take = (name: string, level = 0) => limiter.take(level).then(() => order.push(name));
    const all = [take("a"), take("b"), take("c"), take("d"), take("urgent", 1)];
    const tick = async (ms: number) => {
        t += ms;
        for (const timer of timers.splice(0).sort((x, y) => x.at - y.at)) {
            if (timer.at <= t) timer.run();
            else timers.push(timer);
        }
        await new Promise((resolve) => setImmediate(resolve));
    };
    await tick(0);
    assert.deepEqual(order, ["a", "b"], "the burst goes at once");
    await tick(500);
    assert.deepEqual(order, ["a", "b", "urgent"], "then a token every 500 ms, the urgent one first");
    await tick(500);
    await tick(500);
    await Promise.all(all);
    assert.deepEqual(order, ["a", "b", "urgent", "c", "d"]);

    limiter.penalize();
    assert.equal(limiter.rate, 1);
    limiter.penalize();
    assert.equal(limiter.rate, 0.5);
    for (let i = 0; i < 50; i++) limiter.penalize();
    assert.equal(limiter.rate, 0.2, "never below a tenth");
    t += 5_000;
    void limiter.take().then(() => {});
    await tick(0);
    assert.equal(limiter.rate, 0.2, "no recovery right after a 429");
    t += 20_000;
    void limiter.take();
    await tick(0);
    assert.ok(limiter.rate > 0.2 && limiter.rate <= 2, `${limiter.rate}`);
});

test("a send whose answer was lost but which ran is found by digest, not sent twice", async () => {
    const time = clock();
    const chain = new Set<string>();
    let sends = 0;
    const receipt = await executeSafely({
        now: time.now,
        sleep: time.sleep,
        execute: async () => {
            sends++;
            chain.add("digest");
            throw new Error(`${TRANSIENT_MARK} send may have run: ECONNRESET`);
        },
        lookup: async () => (chain.has("digest") ? { digest: "digest" } : null),
    });
    assert.deepEqual(receipt, { digest: "digest" });
    assert.equal(sends, 1);

    // never reached the chain: the same bytes go again once the lookup finds nothing
    let tries = 0;
    const second = await executeSafely({
        now: time.now,
        sleep: time.sleep,
        execute: async () => {
            if (++tries < 3) throw rpcError("UNAVAILABLE", "unavailable");
            return "ran";
        },
        lookup: async () => null,
    });
    assert.equal(second, "ran");
    assert.equal(tries, 3);

    // a refusal is never retried
    await assert.rejects(
        executeSafely({
            execute: async () => {
                throw new ActionError("rejected", "no", false);
            },
            lookup: async () => null,
        }),
        /no/,
    );
});

/**
 * A sandbox whose reads and sends fail with a 429 while `burst` says so: what a busy public node
 * does to a seat.
 */
function flaky(options: SandboxOptions, burst: (call: string) => boolean): Backend & { limited: number } {
    const inner = createSandbox(options);
    let limited = 0;
    const wrapped = new Proxy(inner, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== "function" || key === "constructor") return value;
            return async (...args: unknown[]) => {
                if (burst(String(key))) {
                    limited++;
                    throw rpcError("RESOURCE_EXHAUSTED", "Too Many Requests");
                }
                return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
        },
    });
    return Object.defineProperty(wrapped, "limited", { get: () => limited }) as Backend & { limited: number };
}

test("the play loop rides out a burst of 429s mid-match and still plays its games to the end", async () => {
    let calls = 0;
    let inGame = false;
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    // a third of the calls fail for a long stretch once the match is on
    const backend = flaky({ seed: 3 }, (call) => {
        calls++;
        if (call === "game") inGame = true;
        return inGame && calls < 1500 && random() < 0.35;
    });
    const agent = new GhostsAgent(backend, fast);
    const transients: boolean[] = [];
    const ended: string[] = [];
    const { played, results } = await playGames(agent, referencePolicy, {
        games: 2,
        name: "flaky-seat",
        sleep: noSleep,
        onTransient: ({ inMatch }) => transients.push(inMatch),
        onResult: ({ ending }) => ended.push(ending ?? "unknown"),
    });
    assert.equal(played, 2);
    assert.equal(results.length, 2);
    assert.ok(backend.limited > 10, `${backend.limited} 429s`);
    assert.ok(transients.some((inMatch) => inMatch), `some were inside the match: ${transients}`);
    assert.ok(!ended.includes("forfeited") && !ended.includes("abandoned"), ended.join());
});

test("outside a match a lasting failure ends the loop only after giving up", async () => {
    const backend = flaky({ seed: 1 }, () => true);
    const agent = new GhostsAgent(backend, fast);
    let t = 0;
    const realNow = Date.now;
    Date.now = () => realNow() + t;
    try {
        await assert.rejects(
            playGames(agent, referencePolicy, {
                games: 1,
                name: "down",
                giveUpMs: 60_000,
                sleep: async (ms) => void (t += ms),
            }),
            (error) => isTransient(error),
        );
    } finally {
        Date.now = realNow;
    }
    assert.ok(t >= 60_000, "it backed off for the whole window first");
});

test("a seat resumes from where its Account is: a search, a dropped search, a match", async () => {
    // a search already queued: the loop waits on it, then plays
    {
        const agent = new GhostsAgent(createSandbox({ seed: 2, seated: true }), fast);
        await agent.setName("resumer");
        await agent.setup();
        await agent.backend.findGame();
        assert.equal((await agent.backend.account())?.search.kind, "searching");
        const { played } = await playGames(new GhostsAgent(agent.backend, fast), referencePolicy, { games: 1 });
        assert.equal(played, 1);
    }
    // mid-match: a fresh agent on the same Account plays it out
    {
        const backend = createSandbox({ seed: 4 });
        const first = new GhostsAgent(backend, fast);
        await first.setName("midgame");
        await first.setup();
        await first.findMatch();
        assert.equal((await backend.account())?.search.kind, "playing");
        const { played } = await playGames(new GhostsAgent(backend, fast), referencePolicy, { games: 1 });
        assert.equal(played, 1);
        assert.equal((await backend.account())?.search.kind, "idle");
    }
    // a dropped search (a notice) is dismissed, and a new search plays
    {
        let now = Date.now();
        const backend = createSandbox({ seed: 5, empty: true, now: () => now });
        const agent = new GhostsAgent(backend, { ...fast, now: () => now });
        await agent.setName("noticed");
        await agent.setup();
        await agent.findMatch();
        now += 10 * 60_000;
        const situation = await agent.wait({ timeoutMs: 50 });
        assert.notEqual(situation.phase, "notice", "the notice is dismissed on the way");
    }
});

test("polls slow down where nothing is due, and a suspension says until when", async () => {
    assert.equal(pollFactor({ phase: "your_turn" }), 1);
    assert.equal(pollFactor({ phase: "opponent_turn" }), 2);
    assert.equal(pollFactor({ phase: "searching", searchingMs: 0 }), 1);
    assert.ok(pollFactor({ phase: "searching", searchingMs: 120_000 }) > 2);
    assert.equal(pollFactor({ phase: "searching", searchingMs: 3_600_000 }), 6);
    assert.ok(pollFactor({ phase: "suspended" }) > 6);
});

/** A child process stand-in: prints lines, exits with a code when told. */
function fakeChild(lines: string[], code: number): SeatChild & { killed: string[] } {
    const events = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const killed: string[] = [];
    setImmediate(() => {
        for (const line of lines) stdout.write(`${line}\n`);
        if (code !== 0) stderr.write("stopped: congested: The network is busy\n");
        stdout.end();
        stderr.end();
        setImmediate(() => events.emit("close", code, null));
    });
    return {
        stdout,
        stderr,
        killed,
        kill: (signal) => (killed.push(String(signal)), true),
        on: (event, listener) => events.on(event, listener),
    };
}

test("the fleet parent restarts a seat that died, for the games it still owes, and ends", async () => {
    const starts: [number, number][] = [];
    const result = (game: string) => `result {"game":"${game}","result":"won","ending":"won"}`;
    const summaries = await superviseSeats({
        seats: [1, 2],
        games: 3,
        staggerMs: [0, 0],
        restartDelayMs: () => 0,
        sleep: noSleep,
        start(seat, remaining) {
            starts.push([seat, remaining]);
            // seat 1 dies after one game, then plays the other two
            if (seat === 1 && remaining === 3) return fakeChild([result("a")], 1);
            return fakeChild(Array.from({ length: remaining }, (_, i) => result(`${seat}-${i}`)), 0);
        },
    });
    assert.deepEqual(starts, [
        [1, 3],
        [2, 3],
        [1, 2],
    ]);
    assert.deepEqual(
        summaries.map((s) => [s.seat, s.played, s.restarts, s.end]),
        [
            [1, 3, 1, "done"],
            [2, 3, 0, "done"],
        ],
    );
});

test("a seat out of restarts is reported failed, and stopping kills nothing twice", async () => {
    const summaries = await superviseSeats({
        seats: [1],
        games: 1,
        staggerMs: [0, 0],
        maxRestarts: 2,
        restartDelayMs: () => 0,
        sleep: noSleep,
        start: () => fakeChild([], 1),
    });
    assert.equal(summaries[0].end, "failed");
    assert.equal(summaries[0].restarts, 2);
    assert.match(summaries[0].reason ?? "", /congested/);

    const stop = new AbortController();
    const children: (SeatChild & { killed: string[] })[] = [];
    const running = superviseSeats({
        seats: [1],
        games: 1,
        staggerMs: [0, 0],
        signal: stop.signal,
        start: () => {
            // a child that only ends when killed
            const events = new EventEmitter();
            const child = {
                killed: [] as string[],
                kill(signal?: NodeJS.Signals) {
                    child.killed.push(String(signal));
                    setImmediate(() => events.emit("close", null, signal));
                    return true;
                },
                on: (event: "close", listener: (...args: any[]) => void) => events.on(event, listener),
            };
            children.push(child as never);
            return child as never;
        },
    });
    await new Promise((resolve) => setImmediate(resolve));
    stop.abort();
    const [stopped] = await running;
    assert.equal(stopped.end, "stopped");
    assert.deepEqual(children[0].killed.slice(0, 1), ["SIGTERM"]);
});
