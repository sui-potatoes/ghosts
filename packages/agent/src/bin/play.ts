#!/usr/bin/env -S node --no-warnings --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { agentFromEnv } from "../config.ts";
import { errorView, parseCommand, runCommand, USAGE } from "../play.ts";
import { pollingWake } from "../wake.ts";

// One JSON value on stdout per call; a refusal exits 1 with {error, message, retryable}.
const fail = (body: unknown): never => {
    console.log(JSON.stringify(body));
    process.exit(1);
};

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
}

try {
    // State lives on chain, so the sandbox would forget everything between calls.
    process.env.GHOSTS_NETWORK ??= "testnet";
    const seat = process.env.GHOSTS_SEAT;
    if (seat && !process.env.GHOSTS_KEY_FILE) {
        if (!/^\d+$/.test(seat)) throw new Error("GHOSTS_SEAT is a seat number, like 3.");
        const file = join(homedir(), ".config", "ghosts", "fleet", `agent-${seat}.key`);
        // Never create a key by accident: a missing seat is a mistake.
        if (!existsSync(file)) throw new Error(`No key for seat ${seat}.`);
        process.env.GHOSTS_KEY_FILE = file;
    }
    const parsed = parseCommand(argv);
    const agent = agentFromEnv();
    // A poll reads the account and the game: keep it at one every 2.5s or so.
    agent.wake = pollingWake(2_500);
    console.log(JSON.stringify(await runCommand(agent, parsed)));
    process.exit(0);
} catch (error) {
    fail(errorView(error));
}
