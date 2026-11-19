// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Solves the faucet's proof of work in the browser: a few module workers, each
 * from its own random nonce, the first proof wins and the rest are stopped. The
 * page stays responsive; an abort ends every worker at once.
 */

import type { Challenge, Proof } from "./faucet-pow.ts";

/** Workers to grind with: all cores but one, between one and four. */
function workerCount(): number {
    const cores = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
    return Math.max(1, Math.min(4, cores - 1));
}

function randomNonce(): bigint {
    const words = new BigUint64Array(1);
    crypto.getRandomValues(words);
    return words[0];
}

/**
 * Without workers (or when one cannot start), grind on the main thread in short
 * slices: `grind` hands control back to the event loop every few hashes, so the
 * page keeps drawing, only slower to solve.
 */
async function solveInline(challenge: Challenge, signal: AbortSignal): Promise<Proof> {
    const [{ argon2d }, { grind }] = await Promise.all([
        import("hash-wasm"),
        import("./faucet-pow.ts"),
    ]);
    const found = await grind({
        argon2d,
        challenge,
        startNonce: randomNonce(),
        shouldStop: () => signal.aborted,
    });
    if (!found) throw signal.reason;
    return { nonce: found.nonce, hashHex: found.hashHex };
}

export function solveInWorkers(challenge: Challenge, signal: AbortSignal): Promise<Proof> {
    if (typeof Worker === "undefined") return solveInline(challenge, signal);
    return new Promise<Proof>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const workers: Worker[] = [];
        const finish = (done: () => void) => {
            signal.removeEventListener("abort", onAbort);
            workers.forEach((w) => w.terminate());
            done();
        };
        const onAbort = () => finish(() => reject(signal.reason));
        signal.addEventListener("abort", onAbort);
        let failures = 0;
        for (let i = 0; i < workerCount(); i++) {
            let worker: Worker;
            try {
                worker = new Worker(new URL("./faucet-worker.ts", import.meta.url), {
                    type: "module",
                });
            } catch {
                // A page that may not start workers: solve here instead.
                if (workers.length) break;
                finish(() => void solveInline(challenge, signal).then(resolve, reject));
                return;
            }
            workers.push(worker);
            worker.onmessage = (event: MessageEvent<{ proof?: Proof; error?: string }>) => {
                if (event.data.proof) {
                    const proof = event.data.proof;
                    finish(() => resolve(proof));
                } else if (event.data.error) fail(new Error(event.data.error));
            };
            worker.onerror = (event) => fail(new Error(event.message || "worker failed"));
            worker.postMessage({ challenge, startNonce: randomNonce().toString() });
        }
        function fail(error: Error) {
            // One worker down is not the end; all of them down is.
            if (++failures >= workers.length) finish(() => reject(error));
        }
    });
}
