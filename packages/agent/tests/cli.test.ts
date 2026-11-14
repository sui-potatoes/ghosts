// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { GhostsAgent } from "../src/agent.ts";
import { orderIds, parseCommand, runCommand, summarize } from "../src/play.ts";
import { createSandbox } from "../src/sandbox.ts";
import { ActionError } from "../src/types.ts";
import { pollingWake } from "../src/wake.ts";

const agent = (seed = 7) => new GhostsAgent(createSandbox({ seed }), { wake: pollingWake(1) });
const run = (a: GhostsAgent, ...argv: string[]) => runCommand(a, parseCommand(argv)) as Promise<any>;

test("arguments become action ids and bad ones are refused", () => {
    const ids = (...argv: string[]) => orderIds(parseCommand(argv));
    assert.deepEqual(ids("move", "6,5", "uull"), ["move:6,5:uull"]);
    assert.deepEqual(ids("attack", "3,1", "0,3"), ["attack:3,1:0,3"]);
    assert.deepEqual(ids("grenade", "3,1", "0,3"), ["grenade:3,1:0,3"]);
    assert.deepEqual(ids("reload", "3,1"), ["reload:3,1"]);
    assert.deepEqual(ids("end"), ["next_turn"]);
    assert.deepEqual(ids("act", "reload:1,1", "next_turn"), ["reload:1,1", "next_turn"]);
    assert.equal(ids("whoami"), null);
    const bads = [
        [],
        ["move", "6,5"],
        ["move", "6;5", "u"],
        ["attack", "1,1"],
        ["wait", "--timeout", "0"],
        ["legal", "--kind", "fly"],
        ["act"],
    ];
    for (const bad of bads) {
        assert.throws(() => orderIds(parseCommand(bad)), ActionError, bad.join(" "));
    }
    assert.deepEqual(parseCommand(["legal", "--unit", "2,3", "--limit", "4"]).flags, {
        unit: [2, 3],
        limit: 4,
    });
});

test("records fold into a hit, miss, damage and kill summary", () => {
    assert.deepEqual(
        summarize([
            { kind: "attack", from: [1, 1], to: [2, 2] },
            { kind: "damage", amount: 3 },
            { kind: "critical_hit", amount: 5 },
            { kind: "miss" },
            { kind: "dodged" },
            { kind: "kia", recruit: "0x1", x: 2, y: 2 },
        ]),
        { hits: 1, crits: 1, misses: 1, dodges: 1, damage: 8, kills: [[2, 2]] },
    );
});

test("a whole sandbox game runs on shell commands alone", async () => {
    const a = agent();
    assert.equal((await run(a, "whoami")).situation.phase, "no_name");
    await run(a, "name", "shell-player");
    const set = await run(a, "setup");
    assert.equal(set.situation.phase, "idle");
    assert.equal(set.account.recruits, 4);
    assert.equal((await run(a, "find")).phase, "deploy");

    const dep = await run(a, "deploy");
    assert.equal(dep.ok, true);
    assert.ok(dep.digest && typeof dep.outcome.damage === "number" && Array.isArray(dep.log));

    let sawState = false;
    for (let i = 0; i < 4000; i++) {
        const w = await run(a, "wait", "--timeout", "1");
        if (w.phase === "game_over") break;
        if (w.timedOut) continue;
        const s = await run(a, "state");
        if (!sawState && s.yourTurn) {
            sawState = true;
            assert.ok(s.map.length > 0 && s.units.some((u: any) => u.mine && u.actions.length));
            const mine = s.units.filter((u: any) => u.mine);
            for (const u of mine) {
                const orders = s.orders[u.at.join(",")];
                if (u.ap > 0) assert.ok(orders.moves.length <= 6 && orders.moves[0].id);
            }
            assert.deepEqual(s.open, ["next_turn"]);
            const legal = await run(a, "legal", "--kind", "move", "--limit", "2");
            assert.ok(legal.actions.every((x: any) => x.kind === "move"));
        }
        const shot = Object.values(s.orders as Record<string, any>)
            .flatMap((o) => o.attacks ?? [])
            .at(0);
        const result = shot ? await run(a, "act", shot.id) : await run(a, "end");
        assert.equal(result.ok, true);
    }
    assert.ok(sawState);
    const over = await run(a, "status");
    assert.equal(over.phase, "game_over");
    await run(a, "complete");
    assert.equal((await run(a, "status")).phase, "idle");
});

test("a refused order comes back as a readable error", async () => {
    const a = agent();
    await run(a, "name", "shell-player");
    await run(a, "setup");
    await run(a, "find");
    await assert.rejects(
        run(a, "attack", "0,0", "1,1"),
        (e: ActionError) => e.code === "illegal_action",
    );
});
