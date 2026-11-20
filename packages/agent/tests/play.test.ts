// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Transaction } from "@mysten/sui/transactions";

import { GhostsAgent, playGames } from "../src/agent.ts";
import { referencePolicy } from "../src/bot.ts";
import {
    acceptSeatsTx,
    actionsTx,
    armSquadTx,
    cancelSearchTx,
    findGameTx,
    hireRecruitsTx,
    nameChangeTx,
    newAccountTx,
    TESTNET_NAMES,
    type Deployment,
    type PendingSeat,
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

test("a match that finds you seats you: accept the seat and you go first", async () => {
    const backend = createSandbox({ seed: 5, seated: true });
    const agent = new GhostsAgent(backend, fast);
    await agent.setName("waiting-player");
    await agent.setup();

    // `find_game` finds nobody: the account is on its search, and the game isn't its own yet.
    assert.equal((await agent.findGame()).phase, "deploy", "the seat is taken on the way");
    const { state, side } = await agent.current();
    assert.equal(side, 0, "the player who waited goes first");
    assert.equal(state.players[0], (await agent.backend.account())?.id);
    assert.equal(state.squads[1].length, 3, "the finder deployed in the call that started it");

    assert.equal((await agent.act(["deploy"])).situation.phase, "your_turn");
    assert.equal(await backend.acceptSeat(), null, "nothing left to accept");
});

test("a search a match answered can't be cancelled before its seat is accepted", async () => {
    const backend = createSandbox({ seed: 5, seated: true });
    await backend.createAccount();
    await backend.hireSquad();
    await backend.findGame();
    const searching = await backend.account();
    assert.equal(searching?.search.kind, "searching");
    await assert.rejects(backend.cancelSearch(), /accept its seat first/);

    assert.ok(await backend.acceptSeat());
    assert.equal((await backend.account())?.search.kind, "playing");
});

test("a fresh hire carries a rifle but no grenade: a shot, no throw", async () => {
    const backend = createSandbox({ seed: 7 });
    const agent = new GhostsAgent(backend, fast);
    await agent.setName("rifle-only");
    await backend.createAccount();
    await backend.hireSquad();
    await agent.findGame();
    await agent.act(["deploy"]);

    const kinds = new Set((await agent.legal()).actions.map((a) => a.kind));
    assert.ok(kinds.has("move"));
    assert.ok(kinds.has("attack") || kinds.has("reload"), "the hire's rifle shoots");
    assert.ok(!kinds.has("grenade"));
    const unit = (await agent.observe()).units.find((unit) => unit.mine)!;
    assert.ok(!unit.grenade, "a grenade is not part of the hire");

    // Fitting takes one transaction, and only while someone at home lacks gear:
    // a match deploys three of the four, so the fourth still has a free slot.
    assert.notEqual(await backend.armSquad(), null, "the recruit left at home gets a grenade");
    assert.equal(await backend.armSquad(), null, "everyone at home is fitted or deployed");
});

test("setup arms a hired squad, once", async () => {
    const backend = createSandbox({ seed: 7 });
    const agent = new GhostsAgent(backend, fast);
    await agent.setName("armorer");
    await agent.setup();
    assert.equal(await backend.armSquad(), null, "setup armed them");
    await agent.findGame();
    await agent.act(["deploy"]);
    const kinds = new Set((await agent.legal()).actions.map((a) => a.kind));
    assert.ok(kinds.has("attack") || kinds.has("reload"));
    const unit = (await agent.observe()).units.find((unit) => unit.mine)!;
    assert.ok(unit.grenade, "setup equipped a frag grenade too");
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
        "deployed recruits leave the account, the fourth stays home",
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

test("two sides that only pass end in a stalemate at turn 60, a draw", async () => {
    const backend = createSandbox({ seed: 3, opponent: () => ["next_turn"] });
    const agent = new GhostsAgent(backend, fast);
    await agent.setName("pacifist");
    await agent.setup();
    await agent.findGame();
    let situation = (await agent.act(["deploy"])).situation;
    for (let step = 0; step < 100 && situation.phase === "your_turn"; step++) {
        situation = (await agent.act(["next_turn"])).situation;
    }
    assert.equal(situation.phase, "game_over");
    assert.equal(situation.result, "draw");
    assert.equal(situation.ending, "stalemate");
    assert.equal((await agent.current()).state.turn, 60);

    await agent.act(["complete"]);
    const { account } = await agent.status();
    assert.deepEqual(account?.score, { wins: 0, losses: 0, draws: 1 });
    assert.equal(account?.recruits, 4);
    assert.equal(await agent.backend.account().then((a) => a?.suspendedUntilMs), 0, "no blame");
});

test("a kill takes the unit off the map but buries it only at the next turn change", async () => {
    let seen = false;
    for (let seed = 1; seed <= 30 && !seen; seed++) {
        const agent = new GhostsAgent(createSandbox({ seed }), fast);
        await agent.setName("sniper");
        await agent.setup();
        await agent.findGame();
        let situation = (await agent.act(["deploy"])).situation;
        for (let step = 0; step < 400 && situation.phase === "your_turn" && !seen; step++) {
            const { state, side } = await agent.current();
            const legal = await agent.legal({ limit: 2 });
            const shot = legal.actions.find((a) => a.kind === "attack");
            const id = shot?.id ?? legal.actions.find((a) => a.kind === "move")?.id ?? "next_turn";
            const before = state.squads.flat().length;
            situation = (await agent.act([id])).situation;
            const after = await agent.current().catch(() => null);
            if (!after || after.state.fallen.length === 0) continue;

            seen = true;
            const fallen = after.state.fallen[0];
            assert.equal(after.state.squads.flat().length, before - 1, "off the map at once");
            assert.ok(!after.state.squads.flat().includes(fallen));
            assert.ok(!after.state.units.some((unit) => unit.recruit === fallen));
            assert.ok(after.state.history.some((r) => r.kind === "kia" && r.recruit === fallen));
            if (after.state.status.kind === "active" && after.state.active === side) {
                await agent.act(["next_turn"]);
                const buried = (await agent.current()).state.fallen;
                assert.deepEqual(buried, [], "buried on the turn change");
            }
        }
    }
    assert.ok(seen, "some seed in the range kills someone");
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

/**
 * Each Move call of a transaction with its arguments' kinds, so the builders are pinned
 * to the entry functions' signatures in `ghosts::ghosts` and `ghosts::account`: how many
 * arguments, in which order, and whether each is an object, a `Receiving`, a pure value,
 * the `Random` (0x8), the `Clock` (0x6) or another call's result.
 */
function calls(tx: Transaction): string[] {
    const data = tx.getData();
    const kind = (argument: { $kind: string; Input?: number }) => {
        if (argument.$kind === "Input") {
            const input = data.inputs[argument.Input!];
            if (input.$kind === "Pure") return "pure";
            if (input.$kind === "Object") return "receiving";
            const id = input.UnresolvedObject?.objectId ?? "";
            return id.endsWith("08") ? "random" : id.endsWith("06") ? "clock" : "object";
        }
        return "result";
    };
    return data.commands.map((command) => {
        if (command.MakeMoveVec) return `vec<${command.MakeMoveVec.type}>`;
        const call = command.MoveCall!;
        const args = call.arguments.map(kind).join(", ");
        return `${call.module}::${call.function}(${args})`;
    });
}

const DEPLOYMENT: Deployment = {
    package: "0x1",
    registry: "0x2",
    matchmaker: "0x3",
    preset: "0x4",
    names: { package: "0x6", suins: "0x7", instance: "0x8", domain: "demo.ghosts.sui" },
};
const REF = { objectId: `0x${"cc".repeat(32)}`, version: "5", digest: "1".repeat(32) };

test("the orders compile to the calls and argument kinds of the package's entry functions", () => {
    const game = { id: `0x${"09".repeat(32)}`, players: ["0xa", "0xb"] } as GameState;
    const build = (actions: Action[], seats: PendingSeat[] = []) =>
        calls(actionsTx(DEPLOYMENT, game, "0x5", actions, seats));

    const batch: Action[] = [
        { kind: "move", x: 6, y: 5, path: [1, 8] },
        { kind: "reload", x: 5, y: 4 },
        { kind: "attack", x: 5, y: 4, tx: 0, ty: 3 },
    ];
    assert.deepEqual(build(batch), [
        "ghosts::move_unit(object, object, clock, pure)",
        "ghosts::perform_reload(object, object, clock, pure, pure)",
        "ghosts::perform_attack(object, object, random, clock, pure, pure, pure, pure)",
    ]);
    assert.deepEqual(build([{ kind: "grenade", x: 1, y: 1, tx: 2, ty: 2 }]), [
        "ghosts::perform_grenade(object, object, random, clock, pure, pure, pure, pure)",
    ]);
    // the flashbang and the smoke grenade roll nothing: no `Random`, and a roll can follow them
    assert.deepEqual(
        build([
            { kind: "flashbang", x: 1, y: 1, tx: 2, ty: 2 },
            { kind: "smoke_grenade", x: 1, y: 2, tx: 2, ty: 2 },
            { kind: "attack", x: 5, y: 4, tx: 0, ty: 3 },
        ]),
        [
            "ghosts::perform_flashbang(object, object, clock, pure, pure, pure, pure)",
            "ghosts::perform_smoke_grenade(object, object, clock, pure, pure, pure, pure)",
            "ghosts::perform_attack(object, object, random, clock, pure, pure, pure, pure)",
        ],
    );
    assert.deepEqual(build([{ kind: "next_turn" }]), ["ghosts::next_turn(object, object, clock)"]);

    // `deploy_squad` takes the recruits as `Receiving` tickets, taken off the `Account`.
    assert.deepEqual(build([{ kind: "deploy", recruits: [REF] }]), [
        `vec<0x2::transfer::Receiving<0x1::recruit::Recruit>>`,
        "ghosts::deploy_squad(object, object, clock, result)",
    ]);
    assert.throws(() => build([{ kind: "deploy" }]), /no recruits/);

    // `complete_game` takes the game and both accounts, by value and by reference.
    assert.deepEqual(build([{ kind: "complete" }]), [
        "ghosts::complete_game(object, object, object, clock)",
    ]);
    // `abandon_game` takes no clock, and `complete_game` follows in the same transaction.
    assert.deepEqual(build([{ kind: "abandon" }]), [
        "ghosts::abandon_game(object, object)",
        "ghosts::complete_game(object, object, object, clock)",
    ]);
    // A seat the other player never accepted comes first: wrapping up needs both in.
    assert.deepEqual(build([{ kind: "complete" }], [{ account: "0xb", seat: REF }]), [
        "ghosts::accept_seat(object, receiving)",
        "ghosts::complete_game(object, object, object, clock)",
    ]);
});

test("matchmaking, seats, hiring and arming follow the package's signatures", () => {
    assert.deepEqual(calls(newAccountTx(DEPLOYMENT)), ["account::new_account(object)"]);
    assert.deepEqual(calls(hireRecruitsTx(DEPLOYMENT, "0x5")), [
        "account::hire_recruits(object, object, random)",
    ]);
    // `find_game` takes the queue, the account, the frozen preset, `Random` and the `Clock`.
    assert.deepEqual(calls(findGameTx(DEPLOYMENT, "0x5")), [
        "ghosts::find_game(object, object, object, random, clock)",
    ]);
    assert.deepEqual(calls(cancelSearchTx(DEPLOYMENT, "0x5")), [
        "ghosts::cancel_search(object, object, clock)",
    ]);
    assert.deepEqual(calls(acceptSeatsTx(DEPLOYMENT, [{ account: "0x5", seat: REF }])), [
        "ghosts::accept_seat(object, receiving)",
    ]);
    // What each recruit lacks: requisitioned, equipped while borrowed, and handed back.
    const fittings = [
        { recruit: REF, rifle: true, grenade: true },
        { recruit: REF, rifle: false, grenade: true },
    ];
    assert.deepEqual(calls(armSquadTx(DEPLOYMENT, "0x5", fittings)), [
        "account::borrow_recruit(object, receiving)",
        "account::requisition_rifle(object, pure)",
        "account::equip_weapon(result, result)",
        "account::requisition_utility(object, pure)",
        "account::equip_utility(result, result)",
        "account::return_recruit(result, result)",
        "account::borrow_recruit(object, receiving)",
        "account::requisition_utility(object, pure)",
        "account::equip_utility(result, result)",
        "account::return_recruit(result, result)",
    ]);
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
