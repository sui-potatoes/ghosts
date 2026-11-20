// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The one way this package reaches a fullnode. Every gRPC-web request goes out through
 * `resilientFetch`, which waits for a token of the process's `RateLimiter` first and retries what
 * is transient: a rate limit (HTTP 429, `RESOURCE_EXHAUSTED`), a node that is down or slow
 * (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, a 5xx), a connection reset or a timeout. Retries back off
 * exponentially with full jitter, wait out a `Retry-After`, and stop at a per-call cap long enough
 * to ride out a rate-limit window; what still fails is thrown as a transient error, which the play
 * loop retries again rather than letting a seat die of it.
 *
 * A write (`ExecuteTransaction`) is resent here only when the node refused it before running it
 * (a 429): any other failure may hide an executed transaction, so it goes up to the sender, which
 * looks the digest up before it sends the same bytes again (`executeSafely`).
 *
 * The limiter is a token bucket shared by every call of a process, and adaptive: a 429 halves the
 * rate and pauses the bucket, and quiet time brings the rate slowly back. A fleet splits one
 * budget between its seats by `GHOSTS_RPC_RPS`, which the fleet sets per seat process.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Requests a second a process sends by default: a quarter of what the public testnet node took. */
export const DEFAULT_RPS = 5;
/** Tokens the bucket holds: a burst a turn's few calls can spend at once. */
export const DEFAULT_BURST = 5;
/** The rate never drops below this share of the configured one. */
const MIN_RATE_SHARE = 0.1;
/** After a 429 the rate grows back by this share of the configured rate per quiet second. */
const RECOVERY_SHARE = 0.05;
/** How long a 429 keeps the rate from growing back. */
const RECOVERY_HOLD_MS = 10_000;

/** How long one call keeps retrying before it gives up (and says it is transient). */
export const DEFAULT_CALL_CAP_MS = 180_000;
/** The first backoff, doubling per attempt up to `DEFAULT_BACKOFF_CAP_MS`, jittered in full. */
export const DEFAULT_BACKOFF_BASE_MS = 500;
export const DEFAULT_BACKOFF_CAP_MS = 30_000;
/** One attempt's own timeout: a node that answers nothing is a transient failure too. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
/** A `Retry-After` longer than this is capped: a call never sleeps past its own cap anyway. */
const MAX_RETRY_AFTER_MS = 120_000;

/** What every error a retry gave up on carries: callers test for it with `isTransient`. */
export const TRANSIENT_MARK = "[rpc transient]";

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
/** gRPC status codes, numbered and named: DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, UNAVAILABLE. */
const TRANSIENT_GRPC = new Set(["4", "8", "14"]);
const TRANSIENT_GRPC_NAMES = new Set(["DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "UNAVAILABLE"]);
const TRANSIENT_TEXT =
    /too many requests|resource.?exhausted|\bunavailable\b|deadline.?exceeded|\b429\b|\b50[234]\b|fetch failed|econnreset|econnrefused|etimedout|epipe|eai_again|socket hang up|network ?error|other side closed|timed? ?out|aborted due to timeout|und_err/i;

/** Whether an error is worth trying again: a rate limit, a busy or unreachable node, a reset. */
export function isTransient(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const { code, message, retryable, cause } = error as {
        code?: unknown;
        message?: unknown;
        retryable?: unknown;
        cause?: unknown;
    };
    // an `ActionError` says so itself
    if (typeof retryable === "boolean" && (error as Error).name === "ActionError") return retryable;
    if (typeof code === "string" && TRANSIENT_GRPC_NAMES.has(code)) return true;
    const text = typeof message === "string" ? message : "";
    if (text.includes(TRANSIENT_MARK) || TRANSIENT_TEXT.test(text)) return true;
    return cause !== undefined && cause !== error && isTransient(cause);
}

/** Whether an error is the node refusing for load: these lower the limiter's rate. */
export function isRateLimit(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (code === "RESOURCE_EXHAUSTED") return true;
    return typeof message === "string" && /too many requests|resource.?exhausted|\b429\b/i.test(message);
}

/** Full jitter: a random wait in `[0, min(cap, base * 2^attempt))`. */
export function backoffMs(
    attempt: number,
    random: () => number = Math.random,
    baseMs = DEFAULT_BACKOFF_BASE_MS,
    capMs = DEFAULT_BACKOFF_CAP_MS,
): number {
    const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
    return Math.floor(random() * ceiling);
}

/** `Retry-After` as milliseconds: seconds, or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(value: string | null | undefined, now: number = Date.now()): number | null {
    if (!value) return null;
    const seconds = Number(value.trim());
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (!Number.isFinite(ms)) return null;
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

/** Counts of what went out and came back, per process: what a seat reports per minute. */
export interface RpcStats {
    startedMs: number;
    /** Attempts sent, retries included. */
    requests: number;
    /** Rate limits seen: HTTP 429 or `RESOURCE_EXHAUSTED`. */
    limited: number;
    /** Other transient failures seen: 5xx, resets, timeouts. */
    failures: number;
    /** Attempts that were retries. */
    retries: number;
    /** Calls that gave up at their cap, thrown as transient. */
    gaveUp: number;
}

export function newStats(now: number = Date.now()): RpcStats {
    return { startedMs: now, requests: 0, limited: 0, failures: 0, retries: 0, gaveUp: 0 };
}

/** Requests a minute since the stats began. */
export function perMinute(stats: RpcStats, now: number = Date.now()): number {
    const minutes = Math.max(1 / 60, (now - stats.startedMs) / 60_000);
    return Math.round((stats.requests / minutes) * 10) / 10;
}

/** Calls made inside `urgent` jump the limiter's queue: the reads and sends a turn needs. */
const priority = new AsyncLocalStorage<number>();

export function urgent<T>(run: () => Promise<T>): Promise<T> {
    return priority.run(1, run);
}

const currentPriority = () => priority.getStore() ?? 0;

export interface LimiterOptions {
    /** Tokens a second. */
    rps?: number;
    burst?: number;
    now?: () => number;
    /** Timers, for tests. */
    setTimer?: (run: () => void, ms: number) => unknown;
}

/**
 * A token bucket, with a queue served by priority then arrival. `penalize` (a 429) halves the
 * rate, empties the bucket and pauses it; `rate` climbs back by `RECOVERY_SHARE` of the
 * configured rate per second once `RECOVERY_HOLD_MS` passed without another one.
 */
export class RateLimiter {
    readonly baseRate: number;
    readonly burst: number;
    rate: number;
    private tokens: number;
    private last: number;
    private pausedUntil = 0;
    private lastPenalty = -Infinity;
    private queue: { priority: number; resolve: () => void }[] = [];
    private timer: unknown = null;
    private now: () => number;
    private setTimer: (run: () => void, ms: number) => unknown;

    constructor(options: LimiterOptions = {}) {
        this.baseRate = Math.max(0.01, options.rps ?? DEFAULT_RPS);
        this.burst = Math.max(1, options.burst ?? DEFAULT_BURST);
        this.rate = this.baseRate;
        this.now = options.now ?? Date.now;
        this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
        this.tokens = this.burst;
        this.last = this.now();
    }

    /** Resolves when a request may go out. */
    take(level: number = currentPriority()): Promise<void> {
        return new Promise((resolve) => {
            const at = this.queue.findIndex((entry) => entry.priority < level);
            const entry = { priority: level, resolve };
            if (at < 0) this.queue.push(entry);
            else this.queue.splice(at, 0, entry);
            this.pump();
        });
    }

    /** A 429: half the rate, an empty bucket, and no request before `pauseMs` (one token's time by default). */
    penalize(pauseMs?: number): void {
        const now = this.now();
        this.refill(now);
        this.rate = Math.max(this.baseRate * MIN_RATE_SHARE, this.rate / 2);
        this.tokens = 0;
        this.lastPenalty = now;
        this.pausedUntil = Math.max(this.pausedUntil, now + (pauseMs ?? 1000 / this.rate));
        this.pump();
    }

    /** Waiting callers: for reports. */
    get waiting(): number {
        return this.queue.length;
    }

    private refill(now: number) {
        const elapsed = Math.max(0, now - this.last) / 1000;
        this.last = now;
        if (now - this.lastPenalty > RECOVERY_HOLD_MS && this.rate < this.baseRate) {
            this.rate = Math.min(this.baseRate, this.rate + this.baseRate * RECOVERY_SHARE * elapsed);
        }
        this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    }

    private pump() {
        if (this.timer !== null) return;
        const now = this.now();
        this.refill(now);
        while (this.queue.length && now >= this.pausedUntil && this.tokens >= 1) {
            this.tokens -= 1;
            this.queue.shift()!.resolve();
        }
        if (!this.queue.length) return;
        const untilToken = ((1 - this.tokens) / this.rate) * 1000;
        const wait = Math.max(1, Math.ceil(Math.max(this.pausedUntil - now, untilToken)));
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.pump();
        }, wait);
    }
}

export interface ResilientOptions {
    limiter?: RateLimiter;
    stats?: RpcStats;
    fetch?: typeof fetch;
    callCapMs?: number;
    attemptTimeoutMs?: number;
    backoffBaseMs?: number;
    backoffCapMs?: number;
    random?: () => number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Told of each retry, for logs. */
    onRetry?: (event: { url: string; attempt: number; delayMs: number; reason: string }) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether a URL is a send: the one call that is not resent blindly. */
export const isWriteUrl = (url: string) => /\/ExecuteTransaction$/.test(url);

function urlOf(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return (input as Request).url;
}

/**
 * A `fetch` for the gRPC-web transport that waits its turn with the limiter and retries the
 * transient. A response it returns is either fine or a failure worth no retry (a gRPC error the
 * caller reads as it always did). What it throws is marked transient.
 */
export function resilientFetch(options: ResilientOptions = {}): typeof fetch {
    const limiter = options.limiter ?? processLimiter();
    const stats = options.stats ?? processStats();
    const inner = options.fetch ?? globalThis.fetch;
    const capMs = options.callCapMs ?? DEFAULT_CALL_CAP_MS;
    const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    const random = options.random ?? Math.random;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? realSleep;
    const base = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    const cap = options.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;

    return async function fetchWithRetry(input, init) {
        const url = urlOf(input);
        const write = isWriteUrl(url);
        const caller = init?.signal ?? null;
        const started = now();
        for (let attempt = 0; ; attempt++) {
            await limiter.take();
            stats.requests++;
            if (attempt > 0) stats.retries++;
            const timeout = AbortSignal.timeout(attemptTimeoutMs);
            const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
            let reason: string;
            let waitAtLeast = 0;
            // a write that failed past the node's door may have run: only the sender can tell
            let mayHaveRun = false;
            try {
                const response = await inner(input, { ...init, signal });
                const grpc = response.headers.get("grpc-status");
                const limited = response.status === 429 || grpc === "8";
                const transient = TRANSIENT_HTTP.has(response.status) || (grpc !== null && TRANSIENT_GRPC.has(grpc));
                if (!transient) return response;
                await response.arrayBuffer().catch(() => undefined);
                reason = limited ? "Too Many Requests" : `HTTP ${response.status}${grpc ? ` grpc ${grpc}` : ""}`;
                if (limited) {
                    stats.limited++;
                    const after = retryAfterMs(response.headers.get("retry-after"), now());
                    if (after !== null) waitAtLeast = after;
                    limiter.penalize(after ?? undefined);
                } else {
                    stats.failures++;
                    mayHaveRun = write;
                }
            } catch (error) {
                if (caller?.aborted) throw error;
                stats.failures++;
                reason = (error as Error)?.message ?? String(error);
                const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
                if (cause?.code || cause?.message) reason += ` (${cause.code ?? cause.message})`;
                // a refused connection never reached the node; anything else might have
                mayHaveRun = write && !/econnrefused|eai_again|enotfound/i.test(reason);
            }
            if (mayHaveRun) {
                stats.gaveUp++;
                throw new Error(`${TRANSIENT_MARK} send may have run: ${reason}`);
            }
            const left = capMs - (now() - started);
            if (left <= 0) {
                stats.gaveUp++;
                throw new Error(`${TRANSIENT_MARK} gave up after ${Math.round((now() - started) / 1000)} s: ${reason}`);
            }
            const delayMs = Math.min(left, Math.max(waitAtLeast, backoffMs(attempt, random, base, cap)));
            options.onRetry?.({ url, attempt: attempt + 1, delayMs, reason });
            await sleep(delayMs);
            if (caller?.aborted) throw caller.reason ?? new Error("aborted");
        }
    };
}

export interface SafeSendOptions<R> {
    /** Send the signed bytes. */
    execute: () => Promise<R>;
    /** The transaction by its digest, or null when the chain has not seen it. */
    lookup: () => Promise<R | null>;
    /** How long to keep at it. */
    capMs?: number;
    /** How long a send that may have run is looked for before the same bytes go again. */
    settleMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    onRetry?: (event: { attempt: number; reason: string; found: boolean }) => void;
}

/**
 * Send signed bytes at most once in effect: a transient failure is followed by a lookup of the
 * digest (the same bytes, the same digest), and only a transaction the chain does not know after
 * `settleMs` is sent again. Resending identical bytes cannot run them twice, and looking first
 * keeps a lost response from costing a second round trip through a busy node.
 */
export async function executeSafely<R>(options: SafeSendOptions<R>): Promise<R> {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? realSleep;
    const random = options.random ?? Math.random;
    const capMs = options.capMs ?? DEFAULT_CALL_CAP_MS;
    const settleMs = options.settleMs ?? 6_000;
    const started = now();
    for (let attempt = 0; ; attempt++) {
        let failure: unknown;
        try {
            return await options.execute();
        } catch (error) {
            if (!isTransient(error)) throw error;
            failure = error;
        }
        // it may have run: look before sending again, for a while
        const lookFrom = now();
        let looks = 0;
        while (now() - lookFrom < settleMs) {
            await sleep(Math.min(2_000, 500 + backoffMs(looks++, random, 250, 2_000)));
            let found: R | null = null;
            try {
                found = await options.lookup();
            } catch (error) {
                if (!isTransient(error)) throw error;
            }
            options.onRetry?.({ attempt: attempt + 1, reason: String((failure as Error)?.message), found: !!found });
            if (found) return found;
        }
        if (now() - started > capMs) throw failure;
        await sleep(backoffMs(attempt, random, 1_000, 15_000));
    }
}

let shared: { limiter: RateLimiter; stats: RpcStats } | null = null;

/** Limiter settings from the environment: `GHOSTS_RPC_RPS` and `GHOSTS_RPC_BURST`. */
export function limiterFromEnv(env: NodeJS.ProcessEnv = process.env): LimiterOptions {
    const rps = Number(env.GHOSTS_RPC_RPS);
    const burst = Number(env.GHOSTS_RPC_BURST);
    return {
        rps: Number.isFinite(rps) && rps > 0 ? rps : DEFAULT_RPS,
        burst: Number.isFinite(burst) && burst >= 1 ? burst : DEFAULT_BURST,
    };
}

function sharedState() {
    shared ??= { limiter: new RateLimiter(limiterFromEnv()), stats: newStats() };
    return shared;
}

/** The limiter every call of this process waits on. */
export const processLimiter = () => sharedState().limiter;
export const processStats = () => sharedState().stats;

/** Set the process's rate, as a fleet parent does for itself; resets the counts. */
export function configureProcessLimiter(options: LimiterOptions): RateLimiter {
    shared = { limiter: new RateLimiter({ ...limiterFromEnv(), ...options }), stats: newStats() };
    return shared.limiter;
}

/** One line of counts, as a seat logs it. */
export function statsLine(stats: RpcStats = processStats(), now: number = Date.now()) {
    return {
        minutes: Math.round(((now - stats.startedMs) / 60_000) * 10) / 10,
        requests: stats.requests,
        perMinute: perMinute(stats, now),
        limited: stats.limited,
        failures: stats.failures,
        retries: stats.retries,
        gaveUp: stats.gaveUp,
        rps: Math.round(processLimiter().rate * 100) / 100,
    };
}
