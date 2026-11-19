// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The proof of work the testnet faucet asks for before it pays (its protocol
 * version 1): an Argon2d hash of eight newline-joined fields, under a threshold
 * derived from the quoted difficulty. Pure and free of browser APIs, so the page's
 * workers and the tests share one implementation.
 */

/** What `GET /v3/challenge` returns. */
export interface Challenge {
    version: number;
    domain: string;
    algorithm: string;
    argon2Version: number;
    memorySize: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
    salt: string;
    network: string;
    chainId: string;
    checkpointSeq: string;
    checkpointDigest: string;
    randomBytes: string;
    faucetAddress: string;
    recipient: string;
    difficulty: string;
    threshold: string;
    windowSeconds: number;
    amountMist: string;
}

/** A solved proof: the winning nonce and the full 32-byte hash, as the faucet takes them. */
export interface Proof {
    nonce: string;
    hashHex: string;
}

/** The hash `argon2d` of hash-wasm computes; injected so tests can stand in for it. */
export type Argon2d = (options: {
    password: string;
    salt: Uint8Array;
    memorySize: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
    outputType: "binary";
}) => Promise<Uint8Array>;

/** The parameters of protocol version 1; a challenge that differs is refused, never ground. */
const V1 = {
    version: 1,
    domain: "sui-faucet-pow/1",
    algorithm: "argon2d",
    argon2Version: 19,
    memorySize: 8192,
    iterations: 1,
    parallelism: 1,
    hashLength: 32,
    salt: "sui-faucet-pow-1",
} as const;

const U64 = 1n << 64n;

/** Throws unless `challenge` is exactly protocol version 1, so a hostile server cannot pick our cost. */
export function checkChallenge(challenge: Challenge): Challenge {
    for (const [key, expected] of Object.entries(V1)) {
        const got = key === "version" ? Number(challenge[key]) : challenge[key as keyof Challenge];
        if (got !== expected) throw new Error(`faucet challenge ${key} is not ${expected}`);
    }
    // Spec section 4: the difficulty is in 2..2^48 and the threshold follows from it by integer division.
    const difficulty = /^[0-9]+$/.test(challenge.difficulty) ? BigInt(challenge.difficulty) : 0n;
    if (difficulty < 2n || difficulty > 1n << 48n)
        throw new Error("faucet challenge difficulty is out of range");
    if (challenge.threshold !== String(thresholdFor(difficulty)))
        throw new Error("faucet challenge threshold does not follow from its difficulty");
    return challenge;
}

/** The eight fields of the faucet's preimage, joined by newlines (spec section 2). */
export function preimage(challenge: Challenge, nonce: bigint): string {
    return [
        challenge.domain,
        challenge.chainId,
        challenge.checkpointSeq,
        challenge.checkpointDigest,
        challenge.randomBytes,
        challenge.faucetAddress,
        challenge.recipient,
        String(nonce),
    ].join("\n");
}

/** `floor(2^64 / difficulty)`, by integer division (spec section 4). */
export function thresholdFor(difficulty: bigint): bigint {
    const clamped = difficulty < 2n ? 2n : difficulty > 1n << 48n ? 1n << 48n : difficulty;
    return U64 / clamped;
}

/** The first eight bytes of a hash, big-endian. */
export function leading64(hash: Uint8Array): bigint {
    let value = 0n;
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(hash[i]);
    return value;
}

export const toHex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export interface GrindOptions {
    argon2d: Argon2d;
    challenge: Challenge;
    startNonce: bigint;
    /** Polled every few hashes; true ends the search with null. */
    shouldStop?: () => boolean;
    /** Called with the hashes tried so far, every few hashes. */
    onProgress?: (attempts: number) => void;
}

/** Hash nonce after nonce from `startNonce` until one falls under the threshold. */
export async function grind(options: GrindOptions): Promise<(Proof & { attempts: number }) | null> {
    const { argon2d, challenge, shouldStop, onProgress } = options;
    checkChallenge(challenge);
    const threshold = thresholdFor(BigInt(challenge.difficulty));
    const salt = new TextEncoder().encode(challenge.salt);
    let nonce = options.startNonce;
    for (let attempts = 1; ; attempts++) {
        const hash = await argon2d({
            password: preimage(challenge, nonce),
            salt,
            memorySize: challenge.memorySize,
            iterations: challenge.iterations,
            parallelism: challenge.parallelism,
            hashLength: challenge.hashLength,
            outputType: "binary",
        });
        if (leading64(hash) < threshold)
            return { nonce: String(nonce), hashHex: toHex(hash), attempts };
        nonce = (nonce + 1n) % U64;
        if (attempts % 4 === 0) {
            onProgress?.(attempts);
            if (shouldStop?.()) return null;
            // Let the worker hear a stop message between hashes.
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
}
