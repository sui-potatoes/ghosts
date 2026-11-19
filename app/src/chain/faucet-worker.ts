// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** One faucet proof-of-work grinder, off the main thread: see `faucet-solver.ts`. */

import { argon2d } from "hash-wasm";

import { grind, type Challenge } from "./faucet-pow.ts";

const scope = self as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown): void;
};

let stopped = false;

scope.onmessage = async (
    event: MessageEvent<{ challenge: Challenge; startNonce: string } | "stop">,
) => {
    if (event.data === "stop") {
        stopped = true;
        return;
    }
    try {
        const found = await grind({
            argon2d,
            challenge: event.data.challenge,
            startNonce: BigInt(event.data.startNonce),
            shouldStop: () => stopped,
            onProgress: (attempts) => scope.postMessage({ attempts }),
        });
        scope.postMessage(found ? { proof: { nonce: found.nonce, hashHex: found.hashHex } } : {});
    } catch (e) {
        scope.postMessage({ error: e instanceof Error ? e.message : String(e) });
    }
};
