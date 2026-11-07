// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { GhostsAgent, playGames } from "../src/agent.ts";
import { referencePolicy } from "../src/bot.ts";
import {
    actionsTx,
    nameChangeTx,
    newAccountTx,
    releaseGameTx,
    startGameTx,
    TESTNET_NAMES,
    type Deployment,
} from "../src/contract.ts";
import { loadOrCreateKey } from "../src/key.ts";
import { createSandbox } from "../src/sandbox.ts";
import { createSuiBackend } from "../src/sui.ts";
import { ActionError, type Action, type GameState } from "../src/types.ts";
import { pollingWake } from "../src/wake.ts";

const fast = { wake: pollingWake(1) };

test("the reference bot plays whole games through the public SDK", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
        const agent = new GhostsAgent(createSandbox({ seed }), fast);
        const { played, results } = await playGames(agent, referencePolicy, {
            games: 2,
            name: "reference-bot",
            signal: AbortSignal.timeout(20_000),
        });
        assert.equal(played, 2);
        for (const result of results) assert.ok(["won", "lost", "draw"].includes(result!));

        const status = await agent.status();
        assert.equal(status.situation.phase, "idle");
        assert.ok(BigInt(status.balanceMist) < 10_000_000_000n, "gas is charged");
    }
});

test("an agent walks the phases, and refusals explain themselves", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 7 }), fast);
    assert.equal((await agent.situation()).phase, "no_name");
    assert.equal((await agent.setName("Null-Pointer")).phase, "no_account");
    assert.equal((await agent.setup()).phase, "idle");
    assert.equal((await agent.setup()).phase, "idle", "setup is safe to repeat");
    assert.equal((await agent.findGame()).phase, "deploy");

    await assert.rejects(agent.act(["next_turn"]), /still deploying/);
    await assert.rejects(agent.act(["reload:0,0"]), /still deploying/);
    // The player who was waiting goes first, so the opponent has moved by the time this returns.
    assert.equal((await agent.act(["deploy"])).situation.phase, "your_turn");

    const view = await agent.observe();
    assert.equal(view.yourTurn, true);
    assert.equal(view.turn, 1);
    assert.equal(view.you, "null-pointer", "names are normalized the way SuiNS would");
    assert.equal(view.opponent, "sparring-partner");
    assert.equal(view.units.filter((u) => u.mine).length, 3, "the map sets the squad size");
    assert.equal(view.map.length, 14);
    assert.ok(view.map.join("").includes("A"), "own units are on the map");
    assert.ok(
        view.recent.some((r) => r.kind === "next_turn"),
        "the opponent's turn is visible",
    );

    await assert.rejects(agent.act(["attack:9,9:0,0"]), (error: ActionError) => {
        assert.equal(error.code, "illegal_action");
        return true;
    });
    await assert.rejects(agent.act(["send_everything_to:0xbad"]), /Not an action id/);
});

test("an agent picks its own name before its first game, and can rename later", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 7 }), fast);
    await agent.backend.createAccount();
    await agent.backend.hireSquad();
    await assert.rejects(agent.findGame(), (error: ActionError) => error.code === "no_name");

    for (const bad of ["ab", "-edge-", "two words", "émigré", "x".repeat(64)]) {
        await assert.rejects(agent.setName(bad), (error: ActionError) => error.code === "bad_name");
    }
    await assert.rejects(
        agent.setName("sparring-partner"),
        (error: ActionError) => error.code === "name_taken",
    );
    assert.equal((await agent.situation()).phase, "no_name", "a refused name changes nothing");

    await agent.setName("first-choice");
    await agent.setName("second-thoughts");
    assert.equal((await agent.status()).name, "second-thoughts");
    assert.equal((await agent.findGame()).phase, "deploy");

    const unnamed = new GhostsAgent(createSandbox(), fast);
    await assert.rejects(playGames(unnamed, referencePolicy), /Pick a name/);
});

test("an opponent's name is read from their Account, once", async () => {
    const backend = createSandbox({ seed: 7 });
    const asked: string[] = [];
    const playerName = backend.playerName;
    backend.playerName = (id) => {
        asked.push(id);
        return playerName(id);
    };
    const agent = new GhostsAgent(backend, fast);
    await agent.setName("owner-name");
    await agent.setup();
    await agent.findGame();
    await agent.act(["deploy"]);

    assert.equal((await agent.observe()).opponent, "sparring-partner");
    assert.equal((await agent.observe()).opponent, "sparring-partner");
    const { state } = await agent.current();
    assert.deepEqual(asked, [state.players[0]], "looked up by Account, and only once");
});

test("a recovery wallet comes from spawn config, is set in setup and is set only once", async () => {
    const wallet = `0x${"ab".repeat(32)}`;
    const backend = createSandbox({ seed: 7 });
    const agent = new GhostsAgent(backend, { ...fast, recovery: "0xabc" });
    assert.throws(() => new GhostsAgent(backend, { recovery: "not-an-address" }), /recovery/);

    await agent.setName("spawned-agent");
    const none = new GhostsAgent(backend, fast);
    await none.setup();
    assert.equal((await none.status()).account?.recovery, null, "recovery is optional");

    const spawned = new GhostsAgent(backend, { ...fast, recovery: wallet });
    await spawned.setup();
    assert.equal((await spawned.status()).account?.recovery, wallet);

    // A later agent on the account can't replace it, and setup doesn't try.
    await agent.setup();
    assert.equal((await agent.status()).account?.recovery, wallet);
    await assert.rejects(backend.setRecovery(`0x${"cd".repeat(32)}`), /Only that wallet/);
});

test("an alias acts as the owner: the owner's address is the agent's", () => {
    const deployment: Deployment = {
        package: "0x1",
        registry: "0x2",
        matchmaker: "0x3",
        preset: "0x4",
        names: TESTNET_NAMES,
    };
    const signer = Ed25519Keypair.generate();
    const owner = `0x${"ee".repeat(32)}`;

    const own = createSuiBackend({ network: "testnet", deployment, signer });
    assert.equal(own.address, signer.toSuiAddress());
    assert.equal(own.signer, signer.toSuiAddress());

    const aliased = createSuiBackend({ network: "testnet", deployment, signer, owner });
    assert.equal(aliased.address, owner);
    assert.equal(aliased.signer, signer.toSuiAddress());
});

test("legal action limits keep the best and count the rest", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 7 }), fast);
    await agent.setName("limit-tester");
    await agent.setup();
    await agent.findGame();
    await agent.act(["deploy"]);

    const all = await agent.legal();
    const top = await agent.legal({ limit: 2 });
    assert.equal(all.omitted, 0);
    assert.ok(top.actions.length < all.actions.length);
    assert.equal(top.actions.length + top.omitted, all.actions.length);

    const [{ unit }] = top.actions.filter((a) => a.unit);
    const one = await agent.legal({ unit, kind: "move" });
    assert.ok(one.actions.length > 0);
    assert.ok(one.actions.every((a) => a.kind === "move" && a.unit?.[0] === unit?.[0]));
});

test("three missed turns in a row lose the game", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const backend = createSandbox({ seed: 3, opponent: null, now });
    const agent = new GhostsAgent(backend, { ...fast, now });
    await agent.setName("clock-watcher");
    await agent.setup();
    await agent.findGame();
    await agent.act(["deploy"]);

    // Twice the silent opponent's turn runs out, and we pass ours straight back.
    for (let miss = 1; miss <= 2; miss++) {
        clock += 90_001;
        assert.equal((await agent.act(["next_turn"])).situation.phase, "your_turn");
        assert.deepEqual((await agent.current()).state.missed, [miss, 0]);
        assert.equal((await agent.act(["next_turn"])).situation.phase, "opponent_turn");
    }

    clock += 90_001;
    const over = (await agent.act(["next_turn"])).situation;
    assert.equal(over.phase, "game_over");
    assert.equal(over.result, "won");

    assert.equal((await agent.act(["complete"])).situation.phase, "idle");
    const { account } = await agent.status();
    assert.deepEqual(account?.score, { wins: 1, losses: 0, draws: 0 });
    assert.equal(account?.recruits, 4, "the squad came home");
    assert.equal(account?.rating, 1500, "only the score moves: nothing writes the rating");
});

test("a side that never deploys loses and is suspended", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const agent = new GhostsAgent(createSandbox({ seed: 3, now }), { ...fast, now });
    await agent.setName("no-show");
    await agent.setup();
    assert.equal((await agent.findGame()).phase, "deploy");

    clock += 120_001;
    assert.equal((await agent.situation()).phase, "deployment_over");
    await assert.rejects(agent.act(["deploy"]), /over/);
    const over = (await agent.act(["next_turn"])).situation;
    assert.equal(over.result, "lost");
    assert.equal((await agent.act(["complete"])).situation.phase, "suspended");
});

test("a found game the opponent left is released without a suspension", async () => {
    const agent = new GhostsAgent(createSandbox({ ghosted: true }), fast);
    await agent.setName("left-behind");
    await agent.setup();
    assert.equal((await agent.findGame()).phase, "idle");
    assert.equal((await agent.backend.account())?.suspendedUntilMs, 0);
});

test("the clock passes a turn: it doesn't end the game", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const backend = createSandbox({ seed: 3, opponent: null, now });
    const agent = new GhostsAgent(backend, { ...fast, now });
    await agent.setName("clock-watcher");
    await agent.setup();
    await agent.findGame();

    // The opponent goes first and stays silent.
    assert.equal((await agent.act(["deploy"])).situation.phase, "opponent_turn");
    await assert.rejects(agent.act(["next_turn"]), /still running/);
    assert.equal((await agent.wait({ timeoutMs: 5 })).actionable, false);

    clock += 90_001;
    assert.equal((await agent.wait({ timeoutMs: 5 })).phase, "opponent_timed_out");
    assert.deepEqual(
        (await agent.legal()).actions.map((a) => a.id),
        ["next_turn"],
    );
    assert.equal((await agent.act(["next_turn"])).situation.phase, "your_turn");

    // Past our own limit, the only order left is to pass.
    const { actions } = await agent.legal({ kind: "move", limit: 1 });
    clock += 90_001;
    await assert.rejects(agent.act([actions[0].id]), /ran out of time/);
    assert.deepEqual(
        (await agent.legal()).actions.map((a) => a.id),
        ["next_turn"],
    );
    assert.equal((await agent.act(["next_turn"])).situation.phase, "opponent_turn");
});

test("abandoning loses the game, brings the squad home and suspends the account", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const agent = new GhostsAgent(createSandbox({ seed: 3, opponent: null, now }), {
        ...fast,
        now,
    });
    await agent.setName("quitter");
    await agent.setup();
    await agent.findGame();
    await agent.act(["deploy"]);
    assert.equal(
        (await agent.status()).account?.recruits,
        1,
        "deployed recruits leave the account",
    );
    assert.ok(!(await agent.legal()).actions.some((a) => a.id === "abandon"), "never suggested");

    assert.equal((await agent.act(["abandon"])).situation.phase, "suspended");
    assert.equal((await agent.status()).account?.recruits, 4, "the squad came home");
    await assert.rejects(agent.findGame(), /suspended/);

    clock += 3_600_001;
    assert.equal((await agent.situation()).phase, "idle");
});

test("recruits who fall stay gone, and setup replaces them", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 1 }), fast);
    await playGames(agent, referencePolicy, {
        games: 1,
        name: "survivor",
        signal: AbortSignal.timeout(20_000),
    });
    const after = (await agent.status()).account!;
    assert.ok(after.recruits <= 4);
    await agent.setup();
    assert.equal((await agent.status()).account?.recruits, 4);
});

test("a search that nobody answers times out and frees the account", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const agent = new GhostsAgent(createSandbox({ empty: true, now }), { ...fast, now });
    await agent.setName("lonely-one");
    await agent.setup();
    assert.equal((await agent.findGame()).phase, "searching");
    assert.equal((await agent.wait({ timeoutMs: 5 })).phase, "searching");

    clock += 120_001;
    assert.equal((await agent.wait({ timeoutMs: 5 })).phase, "idle");
});

test("waiting ends on time and on abort", async () => {
    const backend = createSandbox({ seed: 3, opponent: null });
    const agent = new GhostsAgent(backend, fast);
    await agent.setName("patient-one");
    await agent.setup();
    await agent.findGame();
    await agent.act(["deploy"]);

    const started = Date.now();
    assert.equal((await agent.wait({ timeoutMs: 40 })).actionable, false);
    assert.ok(Date.now() - started < 2_000);

    const stop = new AbortController();
    setTimeout(() => stop.abort(), 10);
    const situation = await agent.wait({ timeoutMs: 60_000, signal: stop.signal });
    assert.equal(situation.phase, "opponent_turn");
});

test("a batch compiles to one transaction of the package's calls, in order", () => {
    const deployment: Deployment = {
        package: "0x1",
        registry: "0x2",
        matchmaker: "0x3",
        preset: "0x4",
        names: { package: "0x6", suins: "0x7", instance: "0x8", domain: "demo.ghosts.sui" },
    };
    const game = { id: `0x${"09".repeat(32)}`, players: ["0xa", "0xb"] } as GameState;
    const functions = (actions: Action[]) =>
        actionsTx(deployment, game, "0x5", actions)
            .getData()
            .commands.map((command) => command.MoveCall?.function);

    const batch: Action[] = [
        { kind: "move", x: 6, y: 5, path: [1, 8] },
        { kind: "reload", x: 5, y: 4 },
        { kind: "attack", x: 5, y: 4, tx: 0, ty: 3 },
    ];
    assert.deepEqual(functions(batch), ["move_unit", "perform_reload", "perform_attack"]);
    const data = actionsTx(deployment, game, "0x5", batch).getData();
    assert.equal(data.commands[0].MoveCall?.module, "ghosts");

    // Argument counts follow the `entry fun` signatures, without the `TxContext`.
    assert.equal(data.commands[0].MoveCall?.arguments.length, 4);
    assert.equal(data.commands[1].MoveCall?.arguments.length, 5);
    assert.equal(data.commands[2].MoveCall?.arguments.length, 8);

    assert.deepEqual(functions([{ kind: "next_turn" }]), ["next_turn"]);
    assert.deepEqual(functions([{ kind: "complete" }]), ["complete_game"]);
    assert.deepEqual(functions([{ kind: "abandon" }]), ["abandon_game", "complete_game"]);
    assert.deepEqual(functions([{ kind: "deploy", recruits: ["0xc"] }]), ["deploy_squad"]);
    assert.throws(() => functions([{ kind: "deploy" }]), /no recruits/);

    const start = startGameTx(deployment, "0x5", "0x6").getData().commands[0].MoveCall;
    assert.equal(start?.function, "start_game");
    assert.equal(start?.arguments.length, 4);
    const release = releaseGameTx(deployment, "0x5", "0x6").getData().commands[0].MoveCall;
    assert.equal(release?.function, "release_match");
    assert.equal(release?.arguments.length, 3);
    const completed = actionsTx(deployment, game, "0x5", [{ kind: "complete" }]).getData();
    assert.equal(completed.commands[0].MoveCall?.arguments.length, 4, "game, both accounts, clock");
    assert.equal(newAccountTx(deployment).getData().commands[0].MoveCall?.module, "account");
});

test("a name change takes the shape the registry state calls for", () => {
    const calls = (alreadyOurs: boolean, current: string | null) =>
        nameChangeTx(TESTNET_NAMES, "new-name", alreadyOurs, current)
            .getData()
            .commands.map((command) => command.MoveCall?.function);
    assert.deepEqual(calls(false, null), ["register", "set_default"]);
    assert.deepEqual(calls(false, "old-name"), ["rename", "set_default"]);
    assert.deepEqual(calls(true, "old-name"), ["remove", "set_default"]);
    assert.deepEqual(calls(true, null), ["set_default"]);
});

test("the key file is private, stable and refused if exposed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghosts-key-"));
    try {
        const path = join(dir, "nested", "agent.key");
        const key = loadOrCreateKey(path);
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.equal(loadOrCreateKey(path).toSuiAddress(), key.toSuiAddress());

        const loose = join(dir, "loose.key");
        writeFileSync(loose, `${key.getSecretKey()}\n`, { mode: 0o644 });
        assert.throws(() => loadOrCreateKey(loose), /readable by other users/);
    } finally {
        rmSync(dir, { recursive: true });
    }
});
