// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { GhostsAgent } from "../src/agent.ts";
import { FaucetError, type FaucetResult } from "../src/faucet.ts";
import { belowTrigger, ensureFunds, MAX_REQUESTS, TARGET_BALANCE, TRIGGER_BALANCE } from "../src/funds.ts";
import { createSandbox } from "../src/sandbox.ts";
import { createMcpServer } from "../src/mcp.ts";
import { runCommand } from "../src/play.ts";

const SUI = 1_000_000_000n;
const arrived: FaucetResult = { digest: "D", amount: SUI, arrived: true };

/** A faucet that pays 1 SUI a request into a balance that starts at `start`. */
function wallet(start: bigint, fail?: Error) {
    let balance = start;
    let requests = 0;
    return {
        deps: {
            balance: async () => balance,
            request: async () => {
                requests++;
                if (fail) throw fail;
                balance += SUI;
                return arrived;
            },
        },
        requests: () => requests,
    };
}

test("the thresholds are the app's: ask under 1 SUI, stop at 2", () => {
    assert.equal(TRIGGER_BALANCE, SUI);
    assert.equal(TARGET_BALANCE, 2n * SUI);
    assert.ok(belowTrigger(SUI - 1n));
    assert.ok(!belowTrigger(SUI));
});

test("at or above the trigger nothing is requested", async () => {
    for (const start of [SUI, SUI + 1n, 5n * SUI]) {
        const w = wallet(start);
        const outcome = await ensureFunds(w.deps);
        assert.deepEqual(outcome, { balance: start, requests: 0, error: null });
        assert.equal(w.requests(), 0);
    }
});

test("under the trigger it asks until the target, and no further", async () => {
    const empty = wallet(0n);
    assert.deepEqual(await ensureFunds(empty.deps), { balance: 2n * SUI, requests: 2, error: null });
    // Just under the trigger is still short of the target after one request: a second goes out.
    const nearly = wallet(SUI - 1n);
    assert.equal((await ensureFunds(nearly.deps)).requests, 2);
});

test("a request pays less than the gap: at most MAX_REQUESTS in all", async () => {
    let balance = 0n;
    let requests = 0;
    const outcome = await ensureFunds({
        balance: async () => balance,
        request: async () => {
            requests++;
            balance += SUI / 10n;
            return arrived;
        },
    });
    assert.equal(requests, MAX_REQUESTS);
    assert.equal(outcome.requests, MAX_REQUESTS);
});

test("a failed request is reported, never repeated", async () => {
    const error = new FaucetError("rate_limited", "slow", 30);
    const w = wallet(0n, error);
    const outcome = await ensureFunds(w.deps);
    assert.equal(outcome.error, error);
    assert.equal(outcome.requests, 0);
    assert.equal(outcome.balance, 0n);
    assert.equal(w.requests(), 1);
});

test("a payout the balance has not shown yet is not asked for twice", async () => {
    let requests = 0;
    const outcome = await ensureFunds({
        balance: async () => 0n,
        request: async () => {
            requests++;
            return { digest: "D", amount: SUI, arrived: false };
        },
    });
    assert.equal(requests, 1);
    assert.equal(outcome.error, null);
});

test("an unreadable balance asks for nothing", async () => {
    const outcome = await ensureFunds({
        balance: async () => {
            throw new Error("rpc down");
        },
        request: async () => assert.fail("no request"),
    });
    assert.equal(outcome.balance, null);
    assert.match(String(outcome.error), /rpc down/);
});

test("the agent refuses the faucet off testnet, with a clear error", async () => {
    const agent = new GhostsAgent(createSandbox());
    await assert.rejects(agent.requestFunds(), /testnet only; this agent is on sandbox/);
    await assert.rejects(runCommand(agent, { command: "faucet", positionals: [], flags: {} } as never), /testnet only/);
    const balance = await agent.balance();
    assert.equal(balance.network, "sandbox");
    assert.equal(balance.belowTrigger, false);
});

test("a testnet agent funds itself before setup and reports a refusal as an answer", async () => {
    const sandbox = createSandbox();
    let balance = 0n;
    let asked = 0;
    const backend = {
        ...sandbox,
        network: "testnet",
        balanceMist: async () => balance,
        requestFaucet: async () => {
            asked++;
            balance += 2n * SUI;
            return arrived;
        },
    };
    const agent = new GhostsAgent(backend as never);
    const answer = await agent.requestFunds();
    assert.equal(answer.requested, true);
    assert.equal(answer.balanceSui, 2);
    assert.equal(answer.error, null);
    // Funded now: setup asks for nothing more.
    await agent.setup();
    assert.equal(asked, 1);

    // A rate limit with SUI to spare is no obstacle; without any it stops the action.
    const limited = new FaucetError("rate_limited", "wait 30 s", 30);
    const refuse = async () => {
        throw limited;
    };
    balance = SUI / 2n;
    const spare = new GhostsAgent({ ...backend, requestFaucet: refuse } as never);
    const result = await spare.requestFunds();
    assert.equal(result.kind, "rate_limited");
    assert.equal(result.retryAfterSeconds, 30);
    await spare.setup();
    balance = 0n;
    await assert.rejects(spare.setup(), (e: { code?: string }) => e.code === "low_balance");
});

test("the MCP server offers a balance read and a faucet request", () => {
    const server = createMcpServer(new GhostsAgent(createSandbox())) as unknown as {
        _registeredTools: Record<string, unknown>;
    };
    assert.ok("ghosts_balance" in server._registeredTools);
    assert.ok("ghosts_request_sui" in server._registeredTools);
});
