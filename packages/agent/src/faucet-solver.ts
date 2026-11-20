// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Solves the faucet's proof of work on worker threads: each from its own random nonce, the first
 * proof wins and the rest are terminated. An abort ends every worker at once.
 */

import { randomBytes } from "node:crypto";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import type { Challenge, Proof } from "./faucet-pow.ts";

/** Threads to grind with: all cores but one, between one and four. */
export function workerCount(): number {
    return Math.max(1, Math.min(4, availableParallelism() - 1));
}

export function solveInWorkers(
    challenge: Challenge,
    signal: AbortSignal,
    threads: number = workerCount(),
): Promise<Proof> {
    return new Promise<Proof>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const workers: Worker[] = [];
        let failures = 0;
        const finish = (done: () => void) => {
            signal.removeEventListener("abort", onAbort);
            for (const worker of workers) void worker.terminate();
            done();
        };
        const onAbort = () => finish(() => reject(signal.reason));
        signal.addEventListener("abort", onAbort);
        const fail = (error: Error) => {
            // One thread down is not the end; all of them down is.
            if (++failures >= workers.length) finish(() => reject(error));
        };
        for (let i = 0; i < threads; i++) {
            const worker = new Worker(new URL("./faucet-worker.ts", import.meta.url));
            workers.push(worker);
            worker.on("message", (message: { proof?: Proof; error?: string }) => {
                if (message.proof) {
                    const proof = message.proof;
                    finish(() => resolve(proof));
                } else if (message.error) fail(new Error(message.error));
            });
            worker.on("error", (error: Error) => fail(error));
            worker.postMessage({
                challenge,
                startNonce: randomBytes(8).readBigUInt64BE().toString(),
            });
        }
    });
}
