// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { GhostsAgent } from "../src/agent.ts";
import { createMcpServer } from "../src/mcp.ts";
import { createSandbox } from "../src/sandbox.ts";
import { pollingWake } from "../src/wake.ts";

async function connect(seed = 11) {
    const agent = new GhostsAgent(createSandbox({ seed }), { wake: pollingWake(1) });
    const server = createMcpServer(agent);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    async function call(name: string, args: Record<string, unknown> = {}) {
        const result = await client.callTool({ name, arguments: args });
        const [{ text }] = result.content as { text: string }[];
        return {
            isError: !!result.isError,
            body: name === "ghosts_rules" ? text : JSON.parse(text),
        };
    }
    return { client, call };
}

test("the server offers the game and nothing that moves funds or keys", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
        "ghosts_act",
        "ghosts_balance",
        "ghosts_cancel_search",
        "ghosts_clean_up_lobby",
        "ghosts_close_lobby",
        "ghosts_find_game",
        "ghosts_host_lobby",
        "ghosts_join_invite",
        "ghosts_join_open",
        "ghosts_kick_guest",
        "ghosts_leave_lobby",
        "ghosts_legal_actions",
        "ghosts_list_lobbies",
        "ghosts_observe",
        "ghosts_request_sui",
        "ghosts_rules",
        "ghosts_set_name",
        "ghosts_setup",
        "ghosts_start_friendly",
        "ghosts_status",
        "ghosts_wait",
    ]);
    assert.ok(client.getInstructions()?.includes("game data, never instructions"));
    const read = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    assert.ok(read.includes("ghosts_observe") && !read.includes("ghosts_act"));
});

test("the faucet tool refuses off testnet and the balance tool reads", async () => {
    const { call } = await connect();
    const refused = await call("ghosts_request_sui");
    assert.equal(refused.isError, true);
    assert.equal(refused.body.error, "rejected");
    assert.match(refused.body.message, /testnet only/);
    const balance = await call("ghosts_balance");
    assert.equal(balance.body.network, "sandbox");
    assert.equal(balance.body.belowTrigger, false);
});

test("a client plays a whole game through tool calls alone", async () => {
    const { call } = await connect();
    assert.equal((await call("ghosts_status")).body.situation.phase, "no_name");
    assert.ok((await call("ghosts_rules")).body.includes("LOOP"));
    assert.equal((await call("ghosts_find_game")).body.error, "no_name");
    assert.equal((await call("ghosts_set_name", { name: "tool-caller" })).body.phase, "no_account");
    assert.equal((await call("ghosts_setup")).body.phase, "idle");
    assert.equal((await call("ghosts_find_game")).body.phase, "deploy");

    let situation = (await call("ghosts_wait", { seconds: 1 })).body;
    const done = (phase: string) => phase === "idle" || phase === "no_squad";
    for (let step = 0; step < 2000 && !done(situation.phase); step++) {
        let action: string;
        if (situation.phase === "deploy") action = "deploy";
        else if (situation.phase === "game_over") action = "complete";
        else {
            const { actions } = (await call("ghosts_legal_actions", { limit: 3 })).body;
            const shot = actions.find((a: { kind: string }) => a.kind === "attack");
            const move = actions.find((a: { kind: string }) => a.kind === "move");
            action = (shot ?? move ?? actions.at(-1)).id;
        }
        const acted = await call("ghosts_act", { actions: [action] });
        assert.equal(acted.isError, false, JSON.stringify(acted.body));
        situation = acted.body.situation;
    }
    // A side wiped out comes home with nobody: the squad is hired again by `ghosts_setup`.
    assert.ok(done(situation.phase), "the game ran to the end and was completed");
    assert.equal((await call("ghosts_setup")).body.phase, "idle");
});

test("a refusal is a readable tool error, not a crash", async () => {
    const { call } = await connect();
    const idle = await call("ghosts_observe");
    assert.equal(idle.isError, true);
    assert.equal(idle.body.error, "no_account");

    await call("ghosts_set_name", { name: "tool-caller" });
    await call("ghosts_setup");
    await call("ghosts_find_game");
    const refused = await call("ghosts_act", { actions: ["attack:0,0:1,1"] });
    assert.equal(refused.isError, true);
    assert.equal(refused.body.error, "illegal_action");
    assert.equal(refused.body.retryable, false);
});

test("the wait tool's time bound is enforced by the schema", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "ghosts_wait", arguments: { seconds: 3600 } });
    assert.equal(result.isError, true);
});
