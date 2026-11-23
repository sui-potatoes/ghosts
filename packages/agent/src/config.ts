// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { GhostsAgent, type PlayMode } from "./agent.ts";
import {
    TESTNET_DEPLOYMENT,
    TESTNET_NAMES,
    type Deployment,
    type NameRegistry,
} from "./contract.ts";
import { DEFAULT_KEY_FILE, loadOrCreateKey } from "./key.ts";
import { fileRevealStore } from "./reveal.ts";
import { createSandbox } from "./sandbox.ts";
import { createSuiBackend } from "./sui.ts";
import { feedWake, pollingWake } from "./wake.ts";

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} is required when GHOSTS_NETWORK is not sandbox.`);
    return value;
}

/** `GHOSTS_RANKED_<n>`: the ranked queue of each size the environment names. */
function rankedQueuesFrom(env: NodeJS.ProcessEnv): Record<number, string> | undefined {
    const queues: Record<number, string> = {};
    for (const [name, value] of Object.entries(env)) {
        const size = /^GHOSTS_RANKED_(\d+)$/.exec(name)?.[1];
        if (size && value) queues[Number(size)] = value;
    }
    return Object.keys(queues).length ? queues : undefined;
}

/**
 * `GHOSTS_MODE`: what `playGames` queues for and what `setup` prepares. `ranked` (3 a side),
 * `ranked:4`, or `stakes` (owned recruits, which setup hires). Stakes when unset.
 */
export function playModeFrom(value: string | undefined): PlayMode {
    if (!value || value === "stakes") return { kind: "stakes" };
    const ranked = /^ranked(?::(\d+))?$/.exec(value);
    if (!ranked) throw new Error(`Unknown GHOSTS_MODE: ${value}. Use stakes, ranked or ranked:4.`);
    return { kind: "ranked", size: ranked[1] ? Number(ranked[1]) : 3 };
}

/**
 * Build an agent from the environment. It defaults to the sandbox, so nothing
 * spends real gas or creates a key unless a network was asked for by name.
 *
 * `localnet` is a local node for tests: it takes every id from the environment, `GHOSTS_RPC_URL`
 * and `GHOSTS_FAUCET_URL` (the local faucet), and has no name service unless one is named.
 */
export function agentFromEnv(env: NodeJS.ProcessEnv = process.env): GhostsAgent {
    const network = env.GHOSTS_NETWORK ?? "sandbox";
    const recovery = env.GHOSTS_RECOVERY;
    const mode = playModeFrom(env.GHOSTS_MODE);
    if (network === "sandbox") {
        const seed = env.GHOSTS_SEED ? Number(env.GHOSTS_SEED) : undefined;
        return new GhostsAgent(createSandbox({ seed }), { wake: pollingWake(50), recovery, mode });
    }
    if (network !== "testnet" && network !== "mainnet" && network !== "localnet") {
        throw new Error(`Unknown GHOSTS_NETWORK: ${network}`);
    }

    // Testnet shares the app's name registry; mainnet has to name its own; a local node has none.
    const names: NameRegistry | null =
        network === "testnet" && !env.GHOSTS_NAMES_INSTANCE
            ? TESTNET_NAMES
            : network === "localnet" && !env.GHOSTS_NAMES_INSTANCE
              ? null
              : {
                    package: required(env, "GHOSTS_NAMES_PACKAGE"),
                    suins: required(env, "GHOSTS_NAMES_SUINS"),
                    instance: required(env, "GHOSTS_NAMES_INSTANCE"),
                    domain: required(env, "GHOSTS_NAMES_DOMAIN"),
                };
    // Testnet defaults to the published package; set GHOSTS_PACKAGE for another one. The ranked
    // objects can be named on their own, for a deployment whose defaults do not have them yet.
    const base: Deployment =
        network === "testnet" && !env.GHOSTS_PACKAGE
            ? { ...TESTNET_DEPLOYMENT, names }
            : {
                  package: required(env, "GHOSTS_PACKAGE"),
                  registry: required(env, "GHOSTS_REGISTRY"),
                  matchmaker: required(env, "GHOSTS_MATCHMAKER"),
                  preset: required(env, "GHOSTS_PRESET"),
                  friendlyLevel: env.GHOSTS_FRIENDLY_LEVEL || undefined,
                  lobbies: required(env, "GHOSTS_LOBBIES"),
                  names,
              };
    const deployment: Deployment = {
        ...base,
        rules: env.GHOSTS_RULES || base.rules,
        rankedQueues: rankedQueuesFrom(env) ?? base.rankedQueues,
    };

    const keyFile = env.GHOSTS_KEY_FILE ?? DEFAULT_KEY_FILE;
    const backend = createSuiBackend({
        network,
        deployment,
        signer: loadOrCreateKey(keyFile),
        owner: env.GHOSTS_OWNER,
        rpcUrl: env.GHOSTS_RPC_URL,
        maxGasMist: env.GHOSTS_MAX_GAS_MIST ? BigInt(env.GHOSTS_MAX_GAS_MIST) : undefined,
        faucetUrl: env.GHOSTS_FAUCET_URL,
    });

    let known: string | null = null;
    const wake = env.GHOSTS_FEED_URL ? feedWake(env.GHOSTS_FEED_URL, () => known) : pollingWake();
    // A ranked search's secret outlives a restart in a file next to the key, readable by its owner.
    const reveals = fileRevealStore(env.GHOSTS_RANKED_STATE ?? `${keyFile}.ranked.json`);
    const agent = new GhostsAgent(backend, { wake, recovery, mode, reveals });
    // The feed is keyed by account, which the agent only learns on first read.
    if (env.GHOSTS_FEED_URL) {
        void backend.account().then(
            (account) => (known = account?.id ?? known),
            () => {},
        );
    }
    return agent;
}
