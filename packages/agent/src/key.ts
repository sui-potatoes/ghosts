// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const DEFAULT_KEY_FILE = join(homedir(), ".config", "ghosts", "agent.key");

/**
 * The agent's key, created on first use and kept on this machine in a file only
 * this user can read. No SDK or MCP call returns it. Its worth is bounded by
 * design: gear can't leave the game, the address should hold only a gas float, and
 * a recovery wallet can take the `Account` back if the key leaks.
 */
export function loadOrCreateKey(path: string = DEFAULT_KEY_FILE): Ed25519Keypair {
    try {
        if (statSync(path).mode & 0o077) {
            throw new Error(`${path} is readable by other users: chmod 600 it first.`);
        }
        return Ed25519Keypair.fromSecretKey(readFileSync(path, "utf8").trim());
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const key = Ed25519Keypair.generate();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // `wx` refuses to overwrite, so two agents starting together can't swap a key out.
    writeFileSync(path, `${key.getSecretKey()}\n`, { mode: 0o600, flag: "wx" });
    return key;
}
