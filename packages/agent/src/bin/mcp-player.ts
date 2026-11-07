#!/usr/bin/env -S node --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A scripted player that goes through the MCP server the way an LLM does: its own
 * `ghosts-mcp` over stdio and nothing but the tools. It proves the whole path
 * without spending a token, and it's a floor for an LLM to beat.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { LegalAction } from "../rules.ts";

const { values } = parseArgs({
    options: { games: { type: "string", default: "1" }, name: { type: "string" } },
});
const games = Number(values.games);

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
        "--no-warnings",
        "--experimental-strip-types",
        resolve(dirname(fileURLToPath(import.meta.url)), "mcp.ts"),
    ],
    env: process.env as Record<string, string>,
    stderr: "inherit",
});
const client = new Client({ name: "ghosts-mcp-player", version: "0.0.0" });
await client.connect(transport);

type Reply = Record<string, any> & { error?: string; message?: string };

async function call(name: string, args: Record<string, unknown> = {}): Promise<Reply> {
    const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: 120_000,
    });
    const [first] = result.content as { text: string }[];
    return JSON.parse(first.text);
}

/** Shoot when it's worth it, else close in, else make the most of what is left. */
function choose(actions: LegalAction[], chain: boolean): string[] {
    const of = (kind: LegalAction["kind"]) => actions.filter((a) => a.kind === kind);
    const attacks = of("attack").sort((a, b) => (b.hitChance ?? 0) - (a.hitChance ?? 0));
    const blast = of("grenade").find((a) => (a.enemiesHit ?? 0) >= 2 && !a.alliesHit);
    if (blast) return [blast.id];

    const shot = (attacks[0]?.hitChance ?? 0) >= 35 ? attacks[0] : undefined;
    const moves = of("move");
    if (shot) {
        // Another unit can close in within the same transaction as the shot.
        const other = moves.find((m) => String(m.unit) !== String(shot.unit));
        return chain && other ? [other.id, shot.id] : [shot.id];
    }
    if (moves[0]) return [moves[0].id];
    return [(attacks[0] ?? of("reload")[0] ?? of("next_turn")[0] ?? actions[0]).id];
}

const played = (reply: Reply) => {
    const score = reply.account?.score;
    return score ? score.wins + score.losses + score.draws : 0;
};

const start = played(await call("ghosts_status"));
let attempt = 0;
let chain = true;

while (true) {
    const situation = await call("ghosts_wait", { seconds: 30 });
    let reply: Reply = {};
    switch (situation.phase) {
        case "no_name":
            attempt++;
            reply = await call("ghosts_set_name", {
                name: attempt === 1 ? values.name : `${values.name}-${attempt}`,
            });
            break;
        case "no_account":
        case "no_squad":
            reply = await call("ghosts_setup");
            break;
        case "idle": {
            const status = await call("ghosts_status");
            if (played(status) - start >= games) {
                console.log(JSON.stringify({ done: true, name: status.name, ...status.account }));
                await client.close();
                process.exit(0);
            }
            await call("ghosts_setup");
            reply = await call("ghosts_find_game");
            break;
        }
        case "deploy":
            reply = await call("ghosts_act", { actions: ["deploy"] });
            break;
        case "deployment_over":
        case "opponent_timed_out":
            reply = await call("ghosts_act", { actions: ["next_turn"] });
            break;
        case "your_turn": {
            const { actions } = await call("ghosts_legal_actions", { limit: 20 });
            const ids = choose(actions, chain);
            reply = await call("ghosts_act", { actions: ids });
            // A move can block the shot chained behind it: send one at a time after that.
            chain = !reply.error;
            const records = reply.receipt?.records?.map((r: { kind: string }) => r.kind);
            console.log(`turn ${ids.join(" + ")} ${records?.join(" ") ?? ""}`);
            break;
        }
        case "game_over":
            console.log(`game over: ${situation.result}`);
            reply = await call("ghosts_act", { actions: ["complete"] });
            break;
        case "suspended":
            console.log(`suspended: ${situation.next}`);
            await client.close();
            process.exit(1);
        // eslint-disable-next-line no-fallthrough
        default:
            break;
    }
    if (reply.error) {
        console.log(`refused in ${situation.phase}: ${reply.error}: ${reply.message}`);
        if (reply.error === "low_balance") {
            await client.close();
            process.exit(1);
        }
        await new Promise((done) => setTimeout(done, 1_000));
    }
}
