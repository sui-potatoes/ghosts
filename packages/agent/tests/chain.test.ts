// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The decoders against bytes Move wrote (`fixtures.ts`), so a change to a Move
 * struct fails here instead of passing a round-trip through the SDK's own layout.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bcs } from "@mysten/sui/bcs";

import {
    AccountBcs,
    decodeAccount,
    decodeEnding,
    decodeGame,
    decodeRecord,
    EndingBcs,
    GameBcs,
    GameStateBcs,
    MapBcs,
    RecordBcs,
    RecruitBcs,
    SeatBcs,
    winnerOf,
} from "../src/bcs.ts";
import { BLACK_RAIN, DEMO_1, DEMO_2 } from "../src/maps.ts";
import { FIXTURES } from "./fixtures.ts";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

const ALICE = "0x63d9a65220318469fb169034d8a011eae3f014fed2a1f8c006183e2ece3c3975";
const BOB = "0xdba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97";
const GAME = "0x19d966d8856a28c89a061055fa1c3e2bcd332143429d45c4a4c80b48c2a5c862";
const ALICE_RECRUIT = "0x75c3360eb19fd2c20fbba5e2da8cf1a39cdb1ee913af3802ba330b852e459e05";
const BOB_RECRUIT = "0x1611edd9a9d42dbcd9ae773ffa22be0f6017b00590959dd5c767e4efcd34cd0b";

test("every Move-written value reserializes to the same bytes under the SDK's schema", () => {
    const schemas = [
        [GameBcs, FIXTURES.gameDeploying],
        [GameBcs, FIXTURES.gamePlayingT0],
        [GameBcs, FIXTURES.gamePlayingT1Moved],
        [GameBcs, FIXTURES.gamePlayingMissed],
        [GameBcs, FIXTURES.gameOverWonFallen],
        [GameBcs, FIXTURES.gameOverAbandoned],
        [AccountBcs, FIXTURES.accountIdle],
        [AccountBcs, FIXTURES.accountSearching],
        [AccountBcs, FIXTURES.accountPlaying],
        [AccountBcs, FIXTURES.accountAfterLoss],
        [AccountBcs, FIXTURES.accountAfterWin],
        [AccountBcs, FIXTURES.accountSuspended],
        [SeatBcs, FIXTURES.seat],
        [RecruitBcs, FIXTURES.recruitHired],
        [RecruitBcs, FIXTURES.recruitUnarmed],
        [RecruitBcs, FIXTURES.recruitArmed],
        [RecruitBcs, FIXTURES.recruitGrenadier],
        [GameStateBcs, FIXTURES.stateDeploying],
        [GameStateBcs, FIXTURES.statePlaying],
        [GameStateBcs, FIXTURES.stateOverWon],
        [GameStateBcs, FIXTURES.stateOverDraw],
        [GameStateBcs, FIXTURES.stateOverStalemate],
        [GameStateBcs, FIXTURES.stateOverAbandoned],
        [GameStateBcs, FIXTURES.stateOverForfeited],
        [GameStateBcs, FIXTURES.stateOverNoshow],
        [GameStateBcs, FIXTURES.stateOverNobodyshowed],
    ] as const;
    for (const [schema, hex] of schemas) {
        // Parsing alone ignores trailing bytes, so the bytes coming back out is the proof.
        const parsed = (schema as typeof GameBcs).parse(bytes(hex));
        assert.equal(Buffer.from(schema.serialize(parsed as never).toBytes()).toString("hex"), hex);
    }
});

test("a game just matched is deploying, with the clock running and nobody on the map", () => {
    const game = decodeGame(bytes(FIXTURES.gameDeploying), "7");
    assert.equal(game.id, GAME);
    assert.equal(game.version, "7");
    assert.deepEqual(game.players, [ALICE, BOB], "turn order: the player who waited is first");
    assert.deepEqual(game.status, { kind: "deploying" });
    assert.equal(game.deadlineMs, 120_000, "`Deploying.until_ms`");
    assert.deepEqual([game.rows, game.cols, game.turn, game.active], [7, 7, 0, 0]);
    assert.deepEqual(game.positions, [[[0, 3]], [[6, 5]]]);
    assert.deepEqual(game.squads, [[], []]);
    assert.deepEqual(game.units, []);
    assert.deepEqual(game.missed, [0, 0]);
});

test("units carry their owner, and squads come from the units on the map", () => {
    const game = decodeGame(bytes(FIXTURES.gamePlayingT0), "1");
    assert.deepEqual(game.status, { kind: "active" });
    assert.equal(game.deadlineMs, 91_000, "`Playing.started_ms` plus the 90s turn");
    assert.deepEqual(game.squads, [[ALICE_RECRUIT], [BOB_RECRUIT]]);
    assert.deepEqual(game.history, [
        { kind: "placed", x: 0, y: 3 },
        { kind: "placed", x: 6, y: 5 },
    ]);

    const [alice, bob] = game.units;
    assert.deepEqual(
        [alice.recruit, alice.owner, alice.side, alice.x, alice.y],
        [ALICE_RECRUIT, ALICE, 0, 0, 3],
    );
    assert.deepEqual([bob.recruit, bob.owner, bob.side, bob.x, bob.y], [BOB_RECRUIT, BOB, 1, 6, 5]);
    // base, weapon, then the frag grenade's action with its one use
    assert.deepEqual(alice.actions, [
        { kind: "move", uses: null },
        { kind: "attack", uses: null },
        { kind: "reload", uses: null },
        { kind: "grenade", uses: 1 },
    ]);
    assert.deepEqual([alice.ap, alice.apMax, alice.hp, alice.ammo], [2, 2, 10, 3]);
    // `Unit.stats` is the recruit with a Plasma rifle and Medium armor.
    assert.deepEqual(
        [alice.stats.armor, alice.stats.damage, alice.stats.range, alice.stats.critChance],
        [2, 6, 5, 30],
    );
});

test("AP is what the chain holds: a move costs one, and nothing resets lazily", () => {
    const game = decodeGame(bytes(FIXTURES.gamePlayingT1Moved), "1");
    assert.equal(game.turn, 1);
    assert.equal(game.active, 1, "Bob's turn");
    const bob = game.units.find((unit) => unit.recruit === BOB_RECRUIT)!;
    assert.deepEqual([bob.x, bob.y, bob.ap], [3, 1, 1]);
    assert.deepEqual(game.history.slice(-2), [
        { kind: "next_turn", turn: 1 },
        { kind: "move", path: [6, 5, 1, 1, 8, 8, 8, 8, 1] },
    ]);
});

test("missed turns and the clock come from `State::Playing`", () => {
    const game = decodeGame(bytes(FIXTURES.gamePlayingMissed), "1");
    assert.equal(game.turn, 3);
    assert.deepEqual(game.missed, [1, 0]);
    assert.equal(game.deadlineMs, 271_002, "the turn started when Bob passed Alice's");
    assert.equal(game.status.kind, "active");
});

test("a kill leaves the unit in `Map.fallen` until the next turn change", () => {
    const game = decodeGame(bytes(FIXTURES.gameOverWonFallen), "1");
    assert.deepEqual(game.fallen, [ALICE_RECRUIT]);
    assert.deepEqual(game.squads, [[], [BOB_RECRUIT]], "off its tile, the unit is off the squad");
    assert.deepEqual(game.status, {
        kind: "finished",
        winner: BOB,
        ending: { kind: "won", by: BOB },
    });
    assert.equal(game.abandonedBy, null);
    assert.equal(game.deadlineMs, 0);
    assert.deepEqual(game.missed, [0, 0]);
});

test("abandoning hands the win to the other side and pins the blame", () => {
    const game = decodeGame(bytes(FIXTURES.gameOverAbandoned), "1");
    assert.deepEqual(game.status, {
        kind: "finished",
        winner: BOB,
        ending: { kind: "abandoned", by: ALICE },
    });
    assert.equal(game.abandonedBy, ALICE);
    assert.equal(game.squads.flat().length, 2, "the units are still on the map until `complete`");
});

test("every `State` and `Ending` decodes, and `winner` follows the Move one", () => {
    const state = (hex: string) => GameStateBcs.parse(bytes(hex));
    assert.deepEqual(state(FIXTURES.stateDeploying).Deploying, { untilMs: "120000" });
    assert.deepEqual(state(FIXTURES.statePlaying).Playing, { startedMs: "5000", missed: [0, 2] });

    const id = (suffix: string) => `0x${suffix.padStart(64, "0")}`;
    const [a1, a2, a3] = [id("a1"), id("a2"), id("a3")];
    const pair = [a1, a2];
    const ending = (hex: string) => {
        const decoded = state(hex);
        assert.equal(decoded.$kind, "Over");
        return decodeEnding(decoded.Over!);
    };
    const won = ending(FIXTURES.stateOverWon);
    assert.deepEqual(won, { kind: "won", by: a1 });
    assert.equal(winnerOf(won, pair), a1, "the side with someone left");
    assert.deepEqual(ending(FIXTURES.stateOverDraw), { kind: "draw", by: null });
    assert.deepEqual(ending(FIXTURES.stateOverStalemate), { kind: "stalemate", by: null });
    assert.deepEqual(ending(FIXTURES.stateOverNobodyshowed), { kind: "nobody_showed", by: null });

    // abandoned, forfeited and no-show hand the game to whoever is not to blame
    const abandoned = ending(FIXTURES.stateOverAbandoned);
    assert.deepEqual(abandoned, { kind: "abandoned", by: a1 });
    assert.equal(winnerOf(abandoned, pair), a2);
    const forfeited = ending(FIXTURES.stateOverForfeited);
    assert.deepEqual(forfeited, { kind: "forfeited", by: a2 });
    assert.equal(winnerOf(forfeited, pair), a1);
    const noShow = ending(FIXTURES.stateOverNoshow);
    assert.equal(noShow.kind, "no_show");
    assert.equal(winnerOf(noShow, [a1, a3]), a1);
    for (const draw of ["draw", "stalemate", "nobody_showed"] as const) {
        assert.equal(winnerOf({ kind: draw, by: null }, pair), null);
    }
    // The enum order is the tag: a variant added in the middle would shift these.
    assert.deepEqual(
        EndingBcs.serialize({ NobodyShowed: true }).toBytes(),
        bytes("06"),
        "`NobodyShowed` is the seventh variant",
    );
});

test("an Account's state decodes from Idle through Playing and Suspended", () => {
    const idle = decodeAccount(bytes(FIXTURES.accountIdle));
    assert.equal(idle.id, ALICE);
    assert.equal(idle.owner, `0x${"a11ce".padStart(64, "0")}`);
    assert.deepEqual(idle.search, { kind: "idle" });
    assert.deepEqual([idle.rating, idle.deviation, idle.recruits], [1500, 350, 1]);
    assert.equal(idle.suspendedUntilMs, 0);

    const searching = decodeAccount(bytes(FIXTURES.accountSearching));
    assert.equal(searching.search.kind, "searching");
    if (searching.search.kind === "searching") assert.equal(searching.search.sinceMs, 0);

    const playing = decodeAccount(bytes(FIXTURES.accountPlaying));
    assert.deepEqual(playing.search, { kind: "playing", game: GAME });
    assert.equal(playing.recruits, 1, "`recruits` counts the ones at home");

    // Winning and losing move the score and the rating, as `complete_game` does.
    const lost = decodeAccount(bytes(FIXTURES.accountAfterLoss));
    assert.deepEqual(lost.score, { wins: 0, losses: 1, draws: 0 });
    assert.deepEqual([lost.rating, lost.recruits], [1338, 0], "the fallen is gone for good");
    const won = decodeAccount(bytes(FIXTURES.accountAfterWin));
    assert.deepEqual(won.score, { wins: 1, losses: 0, draws: 0 });
    assert.deepEqual([won.rating, won.recruits], [1662, 1], "the survivor came home");

    // Abandoning suspends for a minute from `complete_game` (the clock read 3s).
    const suspended = decodeAccount(bytes(FIXTURES.accountSuspended));
    assert.deepEqual(suspended.search, { kind: "idle" });
    assert.equal(suspended.suspendedUntilMs, 63_000);
});

test("a Seat names the game, and a Recruit shows what it carries", () => {
    assert.equal(SeatBcs.parse(bytes(FIXTURES.seat)).game, GAME);
    const hired = RecruitBcs.parse(bytes(FIXTURES.recruitHired));
    assert.equal(hired.weapon?.name, "Standard Rifle", "`hire_recruits` arms every recruit");
    assert.deepEqual(hired.weapon?.upgrades, []);
    assert.equal(hired.armor, null);
    assert.deepEqual(hired.utilities, []);
    const unarmed = RecruitBcs.parse(bytes(FIXTURES.recruitUnarmed));
    assert.equal(unarmed.weapon, null, "a recruit whose rifle was taken off has no weapon");
    const armed = RecruitBcs.parse(bytes(FIXTURES.recruitArmed));
    assert.equal(armed.weapon?.name, "Standard Rifle");
    assert.equal(armed.armor?.name, "Medium Armor");
    assert.deepEqual(armed.utilities, [], "no utility until one is equipped");
    const grenadier = RecruitBcs.parse(bytes(FIXTURES.recruitGrenadier));
    assert.equal(grenadier.utilities.length, 1);
    assert.equal(grenadier.utilities[0].name, "Frag Grenade");
    assert.deepEqual(
        grenadier.utilities[0].actions.map(({ kind, uses }) => [kind.$kind, uses]),
        [["Grenade", 1]],
    );
    assert.equal(grenadier.utilities[0].stats, "0", "a grenade adds nothing to its carrier");
});

test("every history record decodes, in the contract's variant order", () => {
    const records = bcs.vector(RecordBcs).parse(bytes(FIXTURES.records));
    assert.deepEqual(
        records.map((record) => record.$kind),
        [
            "Reload",
            "NextTurn",
            "Move",
            "Attack",
            "RecruitPlaced",
            "Damage",
            "Miss",
            "Explosion",
            "CriticalHit",
            "Grenade",
            "UnitKIA",
            "Dodged",
        ],
    );
    assert.deepEqual(records.map(decodeRecord), [
        { kind: "reload", x: 5, y: 4 },
        { kind: "next_turn", turn: 7 },
        { kind: "move", path: [6, 5, 1, 8] },
        { kind: "attack", from: [5, 4], to: [0, 3] },
        { kind: "placed", x: 11, y: 6 },
        { kind: "damage", amount: 3 },
        { kind: "miss" },
        { kind: "explosion", x: 2, y: 3, radius: 2 },
        { kind: "critical_hit", amount: 6 },
        { kind: "grenade", from: [1, 1], to: [2, 2] },
        { kind: "kia", recruit: `0x${"abc".padStart(64, "0")}`, x: 3, y: 1 },
        { kind: "dodged" },
    ]);
});

test("the preset maps are the ones Move builds, with nobody fallen", () => {
    for (const hex of [DEMO_1, DEMO_2, BLACK_RAIN]) {
        const map = MapBcs.parse(bytes(hex));
        assert.deepEqual(map.fallen, []);
        // Move's `from_bytes` takes all the bytes: the map is the whole of them.
        assert.equal(Buffer.from(MapBcs.serialize(map).toBytes()).toString("hex"), hex);
    }
});
