// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** One grinding thread of the faucet's proof of work: started by `faucet-solver.ts`, stopped by a message. */

import { parentPort } from "node:worker_threads";

import { argon2d } from "hash-wasm";

import { grind, type Challenge } from "./faucet-pow.ts";

let stopped = false;

parentPort?.on("message", (message: { stop: true } | { challenge: Challenge; startNonce: string }) => {
    if ("stop" in message) {
        stopped = true;
        return;
    }
    grind({
        argon2d,
        challenge: message.challenge,
        startNonce: BigInt(message.startNonce),
        shouldStop: () => stopped,
    }).then(
        (found) => {
            if (found) parentPort?.postMessage({ proof: { nonce: found.nonce, hashHex: found.hashHex } });
        },
        (error) => parentPort?.postMessage({ error: String(error?.message ?? error) }),
    );
});
