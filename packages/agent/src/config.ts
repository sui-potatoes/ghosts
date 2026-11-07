// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { GhostsAgent } from "./agent.ts";
import { TESTNET_DEPLOYMENT, TESTNET_NAMES, type NameRegistry } from "./contract.ts";
import { DEFAULT_KEY_FILE, loadOrCreateKey } from "./key.ts";
import { createSandbox } from "./sandbox.ts";
import { createSuiBackend } from "./sui.ts";
import { feedWake, pollingWake } from "./wake.ts";

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} is required when GHOSTS_NETWORK is not sandbox.`);
    return value;
}

/**
 * Build an agent from the environment. It defaults to the sandbox, so nothing
 * spends real gas or creates a key unless a network was asked for by name.
 */
export function agentFromEnv(env: NodeJS.ProcessEnv = process.env): GhostsAgent {
    const network = env.GHOSTS_NETWORK ?? "sandbox";
    const recovery = env.GHOSTS_RECOVERY;
    if (network === "sandbox") {
        const seed = env.GHOSTS_SEED ? Number(env.GHOSTS_SEED) : undefined;
        return new GhostsAgent(createSandbox({ seed }), { wake: pollingWake(50), recovery });
    }
    if (network !== "testnet" && network !== "mainnet") {
        throw new Error(`Unknown GHOSTS_NETWORK: ${network}`);
    }

    // Testnet shares the app's name registry; mainnet has to name its own.
    const names: NameRegistry =
        network === "testnet" && !env.GHOSTS_NAMES_INSTANCE
            ? TESTNET_NAMES
            : {
                  package: required(env, "GHOSTS_NAMES_PACKAGE"),
                  suins: required(env, "GHOSTS_NAMES_SUINS"),
                  instance: required(env, "GHOSTS_NAMES_INSTANCE"),
                  domain: required(env, "GHOSTS_NAMES_DOMAIN"),
              };
    // Testnet defaults to the published package; set GHOSTS_PACKAGE for another one.
    const deployment =
        network === "testnet" && !env.GHOSTS_PACKAGE
            ? { ...TESTNET_DEPLOYMENT, names }
            : {
                  package: required(env, "GHOSTS_PACKAGE"),
                  registry: required(env, "GHOSTS_REGISTRY"),
                  matchmaker: required(env, "GHOSTS_MATCHMAKER"),
                  preset: required(env, "GHOSTS_PRESET"),
                  names,
              };

    const backend = createSuiBackend({
        network,
        deployment,
        signer: loadOrCreateKey(env.GHOSTS_KEY_FILE ?? DEFAULT_KEY_FILE),
        owner: env.GHOSTS_OWNER,
        rpcUrl: env.GHOSTS_RPC_URL,
        maxGasMist: env.GHOSTS_MAX_GAS_MIST ? BigInt(env.GHOSTS_MAX_GAS_MIST) : undefined,
    });

    let known: string | null = null;
    const wake = env.GHOSTS_FEED_URL ? feedWake(env.GHOSTS_FEED_URL, () => known) : pollingWake();
    const agent = new GhostsAgent(backend, { wake, recovery });
    // The feed is keyed by account, which the agent only learns on first read.
    void backend.account().then(
        (account) => (known = account?.id ?? known),
        () => {},
    );
    return agent;
}
