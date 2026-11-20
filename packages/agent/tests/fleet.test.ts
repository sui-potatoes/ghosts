// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Fleet seats: ai-<word> names with "taken" retries, a seat made ready, the run loop, the stop. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GhostsAgent } from "../src/agent.ts";
import type { Backend } from "../src/backend.ts";
import {
    ensureFleetName,
    fleetName,
    FLEET_PREFIX,
    isFleetName,
    PAIR_ATTEMPTS,
    WORDS,
    wordOrder,
} from "../src/callsign.ts";
import { ensureSeat, readSeatRecord, runSeat, settleSeat } from "../src/fleet.ts";
import { nameProblem } from "../src/names.ts";
import { ALL_LOADOUTS, loadoutOfUnit, unitFromLoadout } from "../src/ranked.ts";
import { createSandbox, type SandboxOptions } from "../src/sandbox.ts";
import { ActionError } from "../src/types.ts";
import { pollingWake } from "../src/wake.ts";

const fast = { wake: pollingWake(1) };

test("the word list is plain, unique and fits the registry's rules", () => {
    assert.ok(WORDS.length >= 200, `${WORDS.length} words`);
    assert.equal(new Set(WORDS).size, WORDS.length, "no duplicates");
    for (const word of WORDS) {
        assert.match(word, /^[a-z]+$/, word);
        assert.equal(nameProblem(FLEET_PREFIX + word), null, word);
    }
});

test("fleet names are ai-<word>, repeat per seed and run through the seat's own order", () => {
    for (let seed = 1; seed <= 50; seed++) {
        const order = wordOrder(seed);
        assert.deepEqual([...order].sort(), [...WORDS].sort(), "a shuffle of the list");
        assert.deepEqual(wordOrder(seed), order);
        for (let attempt = 0; attempt < 5; attempt++) {
            const name = fleetName(seed, attempt);
            assert.equal(name, `ai-${order[attempt]}`, "the next word on each attempt");
            assert.match(name, /^ai-[a-z]+$/);
            assert.equal(nameProblem(name), null, name);
            assert.equal(fleetName(seed, attempt), name, "the same seed proposes the same name");
        }
    }
    assert.notEqual(fleetName(1, 0), fleetName(2, 0), "seats start on different words");
    assert.ok(isFleetName("ai-heron") && !isFleetName("ai-heron-2") && !isFleetName("fleet-mcp-3"));
    assert.ok(!isFleetName("ai-") && !isFleetName("ai-42") && !isFleetName(null));
});

test("past the last word a name is two words, never a number", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < WORDS.length + PAIR_ATTEMPTS; attempt++) {
        const name = fleetName(4, attempt);
        assert.equal(nameProblem(name), null, name);
        assert.match(name, /^ai-[a-z]+$/);
        seen.add(name);
    }
    assert.equal(seen.size, WORDS.length + PAIR_ATTEMPTS, "all different");
});

/** A sandbox whose name registration says "taken" for the first `taken` names. */
function takenBackend(taken: number, options: SandboxOptions = {}) {
    const backend = createSandbox(options);
    const tried: string[] = [];
    const wrapped: Backend = {
        ...backend,
        async setName(name) {
            tried.push(name);
            if (tried.length <= taken) throw new ActionError("name_taken", "That name is taken.");
            return backend.setName(name);
        },
    };
    return { wrapped, tried };
}

test("a seat with no name takes its first free word, the next one on taken", async () => {
    const { wrapped, tried } = takenBackend(2);
    const agent = new GhostsAgent(wrapped, fast);
    const outcome = await ensureFleetName(agent, 5);
    assert.deepEqual(tried, [fleetName(5, 0), fleetName(5, 1), fleetName(5, 2)]);
    assert.deepEqual(outcome, { kind: "named", name: fleetName(5, 2), from: null, tries: 3, combined: false });
    assert.equal(await agent.backend.name(), fleetName(5, 2));
    assert.deepEqual(await ensureFleetName(agent, 5), { kind: "kept", name: fleetName(5, 2) }, "idempotent");
    assert.equal(tried.length, 3, "a seat already ai-<word> sends nothing");
});

test("a seat with another name is renamed, one already ai-<word> is left alone", async () => {
    const tried: string[] = [];
    let current: string | null = "fleet-bot-1-67637";
    const sandbox = createSandbox();
    const backend: Backend = {
        ...sandbox,
        name: async () => current,
        async setName(name) {
            tried.push(name);
            if (tried.length === 1) throw new ActionError("name_taken", "That name is taken.");
            current = name;
            return sandbox.setName(name);
        },
    };
    const agent = new GhostsAgent(backend, fast);
    assert.deepEqual(await ensureFleetName(agent, 3), {
        kind: "named",
        name: fleetName(3, 1),
        from: "fleet-bot-1-67637",
        tries: 2,
        combined: false,
    });
    assert.deepEqual(tried, [fleetName(3, 0), fleetName(3, 1)]);
    assert.deepEqual(await ensureFleetName(agent, 3), { kind: "kept", name: fleetName(3, 1) });
    assert.equal(tried.length, 2);
    // a near miss is the wrong form too
    current = "ai-heron-2";
    assert.equal((await ensureFleetName(agent, 3)).kind, "named");
});

test("when every single word is taken the name is two words, and says so", async () => {
    const { wrapped, tried } = takenBackend(WORDS.length);
    const outcome = await ensureFleetName(new GhostsAgent(wrapped, fast), 2);
    assert.deepEqual(outcome, {
        kind: "named",
        name: fleetName(2, WORDS.length),
        from: null,
        tries: WORDS.length + 1,
        combined: true,
    });
    assert.equal(tried.length, WORDS.length + 1);
});

test("every name taken is a clear refusal; another error is not swallowed", async () => {
    const agent = new GhostsAgent(takenBackend(WORDS.length + PAIR_ATTEMPTS).wrapped, fast);
    await assert.rejects(ensureFleetName(agent, 1), /all taken/);
    const broken: Backend = {
        ...createSandbox(),
        setName: async () => {
            throw new ActionError("low_balance", "No gas.");
        },
    };
    await assert.rejects(ensureFleetName(new GhostsAgent(broken, fast), 1), /No gas/);
});

test("a network without the names registry is reported, not a failure", async () => {
    const backend: Backend = { ...createSandbox(), nameService: false, name: async () => "player-abc123" };
    const outcome = await ensureFleetName(new GhostsAgent(backend, fast), 1);
    assert.equal(outcome.kind, "no_registry");
    assert.match((outcome as { message: string }).message, /no name service/);
});

test("a seat is made ready where it plays: an Account, a name and a record of the package", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghosts-seat-"));
    try {
        const backend: Backend = { ...createSandbox(), packageId: "0xnew" };
        const agent = new GhostsAgent(backend, { ...fast, mode: { kind: "ranked", size: 3 } });
        const record = join(dir, "agent-1.deployment.json");
        const ready = await ensureSeat(agent, 1, record);
        assert.equal(ready.fresh, true, "no Account on this deployment: one is made");
        assert.equal(ready.name.kind, "named");
        assert.deepEqual(readSeatRecord(record), { package: "0xnew", account: ready.account, name: fleetName(1, 0) });
        const again = await ensureSeat(agent, 1, record);
        assert.deepEqual([again.fresh, again.name.kind], [false, "kept"]);
        assert.equal((await agent.backend.account())?.recruits, 0, "ranked seats hire nobody");
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("a unit's loadout is read back from the map, for every loadout", () => {
    for (const loadout of ALL_LOADOUTS) {
        const built = unitFromLoadout(loadout)!;
        assert.deepEqual(loadoutOfUnit({ stats: built.stats, actions: built.actions, hpMax: built.hp }), loadout);
    }
    assert.equal(ALL_LOADOUTS.length, 36);
});

test("the run loop plays games with pauses, logs a line each, and stops settled", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 4 }), { ...fast, mode: { kind: "ranked", size: 3 } });
    await agent.setName("loop-seat");
    await agent.setup();
    const stop = new AbortController();
    const lines: string[] = [];
    const pauses: number[] = [];
    const done = runSeat(agent, {
        signal: stop.signal,
        pauseMs: [10, 20],
        perHour: 50,
        log: (line) => {
            lines.push(line);
            if (lines.length === 3) stop.abort();
        },
        sleep: async (ms) => void pauses.push(ms),
    });
    const games = await done;
    assert.equal(games.length, 3);
    for (const line of games) {
        assert.equal(line.seat, "loop-seat");
        assert.equal(line.opponent, "sparring-partner");
        assert.equal(line.squad.split(" ").length, 3);
        assert.equal(line.opponentSquad.split(" ").length, 3);
        assert.ok(["won", "lost", "draw"].includes(line.result));
        assert.equal(line.rating.change, line.rating.after - line.rating.before);
    }
    assert.ok(pauses.every((ms) => ms >= 10 && ms <= 20));
    assert.deepEqual((await agent.backend.account())?.search, { kind: "idle" });
});

test("the hourly cap holds a seat back until the oldest game is an hour old", async () => {
    let clock = 0;
    const agent = new GhostsAgent(createSandbox({ seed: 6 }), { ...fast, mode: { kind: "ranked", size: 3 } });
    await agent.setName("capped-seat");
    await agent.setup();
    const stop = new AbortController();
    const waits: number[] = [];
    await runSeat(agent, {
        signal: stop.signal,
        perHour: 2,
        pauseMs: [0, 0],
        now: () => clock,
        log: () => {},
        sleep: async (ms) => {
            waits.push(ms);
            clock += Math.max(ms, 1);
            if (ms > 1_000_000) stop.abort();
        },
    });
    assert.ok(waits.some((ms) => ms > 3_000_000), "two games, then a wait for the hour");
});

test("stopping leaves no search behind", async () => {
    const agent = new GhostsAgent(createSandbox({ empty: true }), { ...fast, mode: { kind: "ranked", size: 3 } });
    await agent.setName("waiting-seat");
    await agent.setup();
    await agent.findRanked();
    assert.equal((await agent.backend.account())?.search.kind, "searching");
    await settleSeat(agent);
    assert.deepEqual((await agent.backend.account())?.search, { kind: "idle" });
});
