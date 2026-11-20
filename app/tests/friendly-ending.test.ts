// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * How a friendly game ended when it was deleted between two polls: the decision from the
 * transaction that wrapped it up and the game as last seen, and the two reads behind it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { callsOf, fetchEndingTx, vanishedOutcome, type EndingClient } from "../src/chain/ending.ts";

const ME = "0xa1";
const THEM = "0xb2";
const PKG = `0x${"ab".repeat(32)}`;

const playing = { $kind: "Playing", Playing: { startedMs: "0", missed: [0, 0] } };
const deploying = { $kind: "Deploying", Deploying: { untilMs: "0" } };
const unit = (owner: string) => ({ unit: { owner, recruit: `r-${owner}` } });
/** A game as last read: whose turn it is, who has units on the map, its state. */
const game = (state: object, turn = 0, deployed: string[] = [ME, THEM]) =>
    ({
        players: [ME, THEM],
        turn,
        state,
        map: { grid: { grid: [deployed.map(unit)] } },
    }) as never;
const tx = (sender: string, ...calls: string[]) => ({ sender, calls });

test("the opponent abandoned and wrapped up in one transaction: a win by their leaving", () => {
    const last = game(playing);
    assert.equal(
        vanishedOutcome(last, 0, tx(THEM, "abandon_game", "complete_game"), ME),
        "opponent-abandoned",
    );
    // seen from the other side, the same transaction is ours
    assert.equal(
        vanishedOutcome(last, 1, tx(THEM, "abandon_game", "complete_game"), THEM),
        "abandoned",
    );
    // wrapping up alone says nothing about how it ended
    assert.equal(vanishedOutcome(last, 0, tx(THEM, "complete_game"), ME), null);
});

test("a clock that ran out: the side on turn forfeited, a side that never deployed did not show", () => {
    assert.equal(
        vanishedOutcome(game(playing, 1), 0, tx(THEM, "next_turn", "complete_game"), ME),
        "opponent-forfeited",
    );
    assert.equal(
        vanishedOutcome(game(playing, 0), 0, tx(THEM, "next_turn", "complete_game"), ME),
        "forfeited",
    );
    assert.equal(
        vanishedOutcome(game(playing, 59), 0, tx(THEM, "next_turn", "complete_game"), ME),
        "stalemate",
    );

    assert.equal(
        vanishedOutcome(game(deploying, 0, [ME]), 0, tx(ME, "next_turn", "complete_game"), ME),
        "opponent-no-show",
    );
    assert.equal(
        vanishedOutcome(game(deploying, 0, [THEM]), 0, tx(THEM, "next_turn", "complete_game"), ME),
        "no-show",
    );
    assert.equal(
        vanishedOutcome(game(deploying, 0, []), 0, tx(THEM, "next_turn", "complete_game"), ME),
        "no-show",
    );
    // both deployed: it was only the start of the match
    assert.equal(
        vanishedOutcome(game(deploying), 0, tx(THEM, "next_turn", "complete_game"), ME),
        null,
    );
});

test("an action that finished it: its sender stood last", () => {
    assert.equal(
        vanishedOutcome(game(playing), 0, tx(THEM, "attack", "complete_game"), ME),
        "defeat",
    );
    assert.equal(
        vanishedOutcome(game(playing), 0, tx(ME, "attack", "complete_game"), ME),
        "victory",
    );
    assert.equal(vanishedOutcome(game(playing), 0, null, ME), null);
});

test("sender and ids compare without case", () => {
    assert.equal(
        vanishedOutcome(game(playing), 0, tx("0xA1", "abandon_game"), "0xa1"),
        "abandoned",
    );
});

test("a game that was seen over is not decided here", () => {
    const over = { $kind: "Over", Over: { $kind: "Won", Won: ME } };
    assert.equal(vanishedOutcome(game(over), 0, tx(THEM, "abandon_game"), ME), null);
});

test("calls are the game package's own, in order", () => {
    const move = (pkg: string, module: string, fn: string) => ({
        MoveCall: { package: pkg, module, function: fn },
    });
    const data = {
        sender: ME,
        commands: [
            move(PKG, "ghosts", "abandon_game"),
            { TransferObjects: {} },
            move("0x2", "coin", "zero"),
            move(PKG, "account", "rename"),
            move(PKG.slice(2), "ghosts", "complete_game"),
        ],
    };
    assert.deepEqual(callsOf(data, PKG), ["abandon_game", "complete_game"]);
});

test("the ending is the Account's previous transaction, its sender and calls", async () => {
    const asked: string[] = [];
    const client = {
        core: {
            getObjects: async (o: { objectIds: string[] }) => {
                asked.push(`object ${o.objectIds[0]}`);
                return { objects: [{ previousTransaction: "digest-1" }] };
            },
            getTransaction: async (o: { digest: string }) => {
                asked.push(`tx ${o.digest}`);
                return {
                    Transaction: {
                        transaction: {
                            sender: THEM,
                            commands: [
                                {
                                    MoveCall: {
                                        package: PKG,
                                        module: "ghosts",
                                        function: "abandon_game",
                                    },
                                },
                                {
                                    MoveCall: {
                                        package: PKG,
                                        module: "ghosts",
                                        function: "complete_game",
                                    },
                                },
                            ],
                        },
                    },
                };
            },
        },
    } as unknown as EndingClient;
    assert.deepEqual(await fetchEndingTx(client, "0xacc", PKG), {
        sender: THEM,
        calls: ["abandon_game", "complete_game"],
    });
    assert.deepEqual(asked, ["object 0xacc", "tx digest-1"]);

    const bare = {
        core: { getObjects: async () => ({ objects: [new Error("gone")] }) },
    } as unknown as EndingClient;
    assert.equal(await fetchEndingTx(bare, "0xacc", PKG), null);
});
