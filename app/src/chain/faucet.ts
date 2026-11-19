// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Test SUI straight from the testnet faucet (Mysten's `faucet-station`): no page
 * to visit, no address to paste. The faucet asks for a little computation instead
 * of an account or a key (`faucet-pow.ts`), pays 1 SUI into the address's balance,
 * and answers every call from any origin. The player's own address is the only
 * thing sent.
 *
 * One request is: fetch a challenge, solve it, post the proof, then wait until
 * the balance shows the funds. Nothing is retried but the one thing the faucet
 * asks for (a proof that went stale gets one fresh challenge); a failed request
 * is reported, never repeated.
 */

import { normalizeSuiAddress } from "@mysten/sui/utils";

import { checkChallenge, type Challenge, type Proof } from "./faucet-pow.ts";

/** The faucet's address: `VITE_FAUCET_URL` at build time, Mysten's testnet faucet otherwise. */
export const FAUCET_URL: string =
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FAUCET_URL ||
    "https://faucet.testnet.sui.io";

/** Why a request failed, in terms the interface can word. */
export type FaucetFailure =
    /** Too many requests, from this device or this network; `retryAfterSeconds` says when. */
    | "rate_limited"
    /** The faucet is down, out of funds or not ready. */
    | "unavailable"
    /** The faucet could not be reached. */
    | "network"
    /** No answer or no proof in time. */
    | "timeout"
    /** The faucet refused the request itself. */
    | "rejected";

export class FaucetError extends Error {
    readonly kind: FaucetFailure;
    readonly retryAfterSeconds?: number;

    constructor(kind: FaucetFailure, message: string, retryAfterSeconds?: number) {
        super(message);
        this.name = "FaucetError";
        this.kind = kind;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export interface FaucetResult {
    /** The transaction that paid, when a request was made. */
    digest: string | null;
    /** What the faucet paid, in MIST; 0 when no request was needed. */
    amount: bigint;
    /** The balance showed the funds within the wait; false only when it is yet to catch up. */
    arrived: boolean;
}

export interface FaucetRequest {
    address: string;
    /** The address's total SUI balance in MIST. */
    balance: () => Promise<bigint>;
    baseUrl?: string;
    fetch?: typeof fetch;
    /** Solves a challenge; the browser's workers by default. */
    solve?: (challenge: Challenge, signal: AbortSignal) => Promise<Proof>;
    signal?: AbortSignal;
    /** Skip the request when the balance is already this much (MIST). */
    skipAtOrAbove?: bigint;
    /** How long to wait for the balance to show the funds after a payout. */
    arrivalTimeoutMs?: number;
    pollMs?: number;
    /** The whole request, proof included. */
    timeoutMs?: number;
    /** One HTTP call. */
    callTimeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
    arrivalTimeoutMs: 20_000,
    pollMs: 1_500,
    timeoutMs: 120_000,
    callTimeoutMs: 15_000,
};

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ErrorBody {
    code?: string;
    error?: string;
    digest?: string;
    challenge?: Challenge;
}

/** `Retry-After` as whole seconds, from either of its forms. */
function retryAfter(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const at = Date.parse(header);
    return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** One call: JSON out of a good answer, a typed error out of a bad one. */
async function call<T>(
    fetchImpl: typeof fetch,
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    callTimeoutMs: number,
): Promise<{ ok: true; body: T } | { ok: false; status: number; body: ErrorBody; wait?: number }> {
    let response: Response;
    try {
        response = await fetchImpl(url, {
            ...init,
            signal: AbortSignal.any([signal, AbortSignal.timeout(callTimeoutMs)]),
        });
    } catch (e) {
        if (signal.aborted) throw signal.reason;
        if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"))
            throw new FaucetError("timeout", "The faucet did not answer in time.");
        throw new FaucetError("network", "Could not reach the faucet.");
    }
    let body: unknown = {};
    try {
        body = await response.json();
    } catch {
        // an error page without JSON still has its status
    }
    if (response.ok) return { ok: true, body: body as T };
    return {
        ok: false,
        status: response.status,
        body: (body ?? {}) as ErrorBody,
        wait: retryAfter(response.headers.get("retry-after")),
    };
}

/** A failed answer as the error the interface words. */
function failure(status: number, body: ErrorBody, wait?: number): FaucetError {
    if (status === 429) return new FaucetError("rate_limited", "Too many requests.", wait ?? 60);
    if (status === 503 || status === 502 || status >= 500)
        return new FaucetError("unavailable", body.error ?? "The faucet is unavailable.", wait);
    return new FaucetError("rejected", body.error ?? "The faucet refused the request.");
}

/**
 * Request test SUI for `address` and resolve once the balance shows it. Resolves
 * at once, without a request, when the balance already meets `skipAtOrAbove`.
 * Rejects with a `FaucetError`; an aborted `signal` rejects with its own reason.
 */
export async function requestTestnetSui(request: FaucetRequest): Promise<FaucetResult> {
    const config = { ...DEFAULTS, ...request };
    const fetchImpl = request.fetch ?? fetch;
    const sleep = request.sleep ?? sleepFor;
    const base = (request.baseUrl ?? FAUCET_URL).replace(/\/+$/, "");
    const recipient = normalizeSuiAddress(request.address);

    const deadline = new AbortController();
    const timer = setTimeout(
        () => deadline.abort(new FaucetError("timeout", "The faucet took too long.")),
        config.timeoutMs,
    );
    const signal = request.signal
        ? AbortSignal.any([request.signal, deadline.signal])
        : deadline.signal;

    try {
        const before = await readBalance(request.balance);
        if (request.skipAtOrAbove !== undefined && before >= request.skipAtOrAbove)
            return { digest: null, amount: 0n, arrived: true };

        const solve = request.solve ?? (await import("./faucet-solver.ts")).solveInWorkers;

        let challenge = await fetchChallenge();
        let paid: { digest: string; amount: bigint } | null = null;
        for (let attempt = 0; !paid; attempt++) {
            const proof = await solve(challenge, signal);
            const answer = await call<{ digest: string; amountMist: string }>(
                fetchImpl,
                `${base}/v3/gas`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        recipient,
                        checkpointSeq: challenge.checkpointSeq,
                        nonce: proof.nonce,
                        hashHex: proof.hashHex,
                    }),
                },
                signal,
                config.callTimeoutMs,
            );
            if (answer.ok) {
                paid = {
                    digest: answer.body.digest,
                    amount: BigInt(answer.body.amountMist ?? challenge.amountMist),
                };
            } else if (answer.body.code === "already_used" && answer.body.digest) {
                // This very proof paid already; the answer was lost on the way.
                paid = { digest: answer.body.digest, amount: BigInt(challenge.amountMist) };
            } else if (
                answer.body.code === "stale_checkpoint" &&
                answer.body.challenge &&
                attempt === 0
            ) {
                // The proof took longer than its checkpoint stays fresh: one fresh challenge.
                challenge = accept(answer.body.challenge);
            } else if (answer.body.code === "payout_status_unknown" && answer.body.digest) {
                // It may have paid: never ask again, only watch the balance.
                paid = { digest: answer.body.digest, amount: BigInt(challenge.amountMist) };
            } else throw failure(answer.status, answer.body, answer.wait);
        }

        const arrived = await waitForFunds(before + paid.amount);
        return { digest: paid.digest, amount: paid.amount, arrived };
    } finally {
        clearTimeout(timer);
    }

    async function fetchChallenge(): Promise<Challenge> {
        const answer = await call<Challenge>(
            fetchImpl,
            `${base}/v3/challenge?recipient=${encodeURIComponent(recipient)}`,
            { method: "GET" },
            signal,
            config.callTimeoutMs,
        );
        if (!answer.ok) throw failure(answer.status, answer.body, answer.wait);
        return accept(answer.body);
    }

    /** A challenge for this address on testnet, in the protocol version this client speaks. */
    function accept(challenge: Challenge): Challenge {
        try {
            checkChallenge(challenge);
        } catch {
            throw new FaucetError("rejected", "The faucet speaks a protocol this app does not.");
        }
        if (challenge.network !== "testnet" || challenge.recipient !== recipient)
            throw new FaucetError("rejected", "The faucet answered for another account.");
        return challenge;
    }

    async function waitForFunds(target: bigint): Promise<boolean> {
        const until = Date.now() + config.arrivalTimeoutMs;
        for (;;) {
            if ((await readBalance(request.balance).catch(() => 0n)) >= target) return true;
            if (Date.now() >= until) return false;
            await sleep(config.pollMs);
            if (signal.aborted) throw signal.reason;
        }
    }
}

async function readBalance(balance: () => Promise<bigint>): Promise<bigint> {
    try {
        return await balance();
    } catch {
        throw new FaucetError("network", "Could not read the balance.");
    }
}
