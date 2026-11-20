// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked on chain as the app reads and writes it (`src/chain/ranked-core.ts`, the new
 * and changed schemas in `src/chain/bcs.ts`, the economy's `rulesFromChain`). The bytes
 * come from the Move package itself (`tests/ranked-fixtures.ts`, printed by its tests),
 * or are written out by hand from the Move layout, never produced by the code under test.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Account, Game, GameEnded, GameStarted, Rules, Seat } from "../src/chain/bcs.ts";
import { unitsOnMap } from "../src/chain/match-rules.ts";
import {
    branchOf,
    budgetAt,
    checkSquad,
    commitmentOf,
    decodeSquad,
    encodeSquad,
    forgetSquad,
    keepSquad,
    keptSquad,
    levelOf,
    newSalt,
    NO_UTILITY,
    queueOf,
    raceLost,
    rankedRefusal,
    searchKind,
    sizeOfQueue,
    sweepSquads,
    tierIndex,
    type KeyStore,
} from "../src/chain/ranked-core.ts";
import { DEFAULT_RULES, rulesFromChain } from "../src/features/play/economy/index.ts";
import { rankedSide, unitLoadout } from "../src/features/play/ranked/kit.ts";
import { FIXTURES as F } from "./ranked-fixtures.ts";

const unhex = (s: string) => new Uint8Array(Buffer.from(s.replace(/^0x/, ""), "hex"));
const addr = (s: string) => `0x${s}`;
/** `SALT` in the package's ranked tests. */
const SALT = unhex("5a17" + "00".repeat(28) + "5a17");
const RULES = Rules.parse(unhex(F.rulesInitial));

test("the Rules the package publishes with are the economy's built-in default", () => {
    assert.equal(RULES.version, 1);
    assert.equal(RULES.tiers.length, 4);
    assert.deepEqual(
        RULES.sizes.map((s) => [s.units, !!s.level]),
        [
            [3, true],
            [4, false],
        ],
    );
    assert.equal(RULES.placementGames, 5);
    assert.equal(RULES.placementTier, 1);
    assert.equal(RULES.revealLimitMs, "60000");
    assert.equal(RULES.resetCooldownMs, String(7 * 86_400_000));
    // Everything but the version: the default stands for the published object.
    assert.deepEqual({ ...rulesFromChain(RULES), version: 0 }, DEFAULT_RULES);
});

test("tiers as `rules::tier_of`: the bands, and the placement floor", () => {
    assert.equal(tierIndex(RULES, 0, 9), 0);
    assert.equal(tierIndex(RULES, 1399, 9), 0);
    assert.equal(tierIndex(RULES, 1400, 9), 1);
    assert.equal(tierIndex(RULES, 1649, 9), 1);
    assert.equal(tierIndex(RULES, 1650, 9), 2);
    assert.equal(tierIndex(RULES, 1900, 9), 3);
    assert.equal(tierIndex(RULES, 99_999, 9), 3);
    assert.equal(tierIndex(RULES, 1340, 4), 1, "placing: Contractor at least");
    assert.equal(tierIndex(RULES, 1340, 5), 0);
    assert.equal(tierIndex(RULES, 1700, 0), 2, "the floor never lowers");
    assert.equal(budgetAt(RULES, 1, 3), 150);
    assert.equal(budgetAt(RULES, 3, 4), 320);
    assert.equal(budgetAt(RULES, 1, 5), null);
});

test("the squad bytes: rifle, armor, utility a unit; the package's own squad", () => {
    const alice = [
        { weapon: "rifle-1", armor: "armor-2", utility: "frag-grenade" },
        { weapon: "rifle-2", armor: "armor-1", utility: null },
        { weapon: "rifle-1", armor: "armor-1", utility: "flashbang" },
    ];
    assert.deepEqual(encodeSquad(alice), unhex(F.aliceSquad));
    assert.deepEqual(decodeSquad(unhex(F.aliceSquad)), alice);
    assert.equal(unhex(F.aliceSquad)[5], NO_UTILITY);
    assert.deepEqual(
        encodeSquad([{ weapon: "rifle-3", armor: "armor-3", utility: "smoke-grenade" }]),
        unhex("030302"),
    );
    assert.throws(() => encodeSquad([{ weapon: "railgun", armor: "armor-1", utility: null }]));
    assert.equal(decodeSquad(unhex("0101")), null);
    assert.equal(decodeSquad(unhex("040101")), null);
    assert.equal(decodeSquad(unhex("010103")), null);
});

test("the commitment is the package's: blake2b256(squad ‖ salt)", () => {
    assert.equal(commitmentOf(unhex(F.aliceSquad), SALT), addr(F.commitment));
    const salt = newSalt();
    assert.equal(salt.length, 32);
    assert.notDeepEqual(salt, newSalt());
    assert.notEqual(commitmentOf(unhex(F.aliceSquad), salt), addr(F.commitment));
});

test("`check_squad` in its order: size, then unit by unit unknown and locked, then budget", () => {
    const squad = unhex(F.aliceSquad);
    assert.deepEqual(checkSquad(RULES, 3, 1, squad), { ok: true, cost: 145, budget: 150 });
    assert.deepEqual(
        checkSquad(RULES, 3, 0, squad),
        { ok: false, code: 2, unit: 1 },
        "rifle-2 at Rookie",
    );
    assert.deepEqual(checkSquad(RULES, 3, 1, new Uint8Array()), { ok: false, code: 0 });
    assert.deepEqual(checkSquad(RULES, 3, 1, unhex("010100")), { ok: false, code: 0 });
    assert.deepEqual(checkSquad(RULES, 3, 3, unhex("0401ff0101ff0101ff")), {
        ok: false,
        code: 1,
        unit: 0,
    });
    assert.deepEqual(checkSquad(RULES, 3, 3, unhex("0101ff0101ff010103")), {
        ok: false,
        code: 1,
        unit: 2,
    });
    // Locked before over budget, on an earlier unit first.
    assert.deepEqual(checkSquad(RULES, 3, 1, unhex("030300030300030300")), {
        ok: false,
        code: 2,
        unit: 0,
    });
    assert.deepEqual(checkSquad(RULES, 3, 3, unhex("030300030300030300")), { ok: false, code: 3 });
    assert.deepEqual(checkSquad(RULES, 5, 1, squad), { ok: false, code: 7 });
});

test("an Account searching the ranked queue holds the queue and the commitment", () => {
    const three = addr(F.threeId);
    const acc = Account.parse(unhex(F.accountSearchingRanked));
    assert.equal(acc.id, addr(F.aliceId));
    assert.equal(acc.state.$kind, "Searching");
    if (acc.state.$kind !== "Searching") return;
    assert.equal(acc.state.Searching.queue, three);
    assert.equal(acc.state.Searching.commitment, addr(F.commitment));
    assert.equal(acc.suspendedUntil, "0");
    assert.equal(acc.resets, 0);
    assert.equal(acc.lastResetMs, "0");
    // Where it waits, by the rules and the build's ids.
    assert.equal(queueOf(RULES, 3) === null, false);
    const rules = Rules.parse(unhex(F.rulesFixture));
    assert.equal(sizeOfQueue(rules, three), 3);
    assert.deepEqual(searchKind(three, { stakes: "0x1", lobbies: "0x2", rules }), {
        kind: "ranked",
        size: 3,
    });
    assert.deepEqual(searchKind("0x1", { stakes: "0x1", lobbies: "0x2", rules }), {
        kind: "stakes",
    });
    assert.deepEqual(searchKind("0x2", { stakes: "0x1", lobbies: "0x2", rules }), {
        kind: "lobby",
    });
    assert.deepEqual(searchKind(three, { stakes: "0x1", lobbies: "0x2", rules: null }), {
        kind: "unknown",
    });
    assert.equal(levelOf(rules, 4), null, "four has no level");
    assert.notEqual(levelOf(rules, 3), null);
});

test("an Account after a ranked walkout: suspended in its own field, idle, ranked score", () => {
    const alice = Account.parse(unhex(F.accountAliceAfter));
    assert.equal(alice.state.$kind, "Idle");
    assert.ok(Number(alice.suspendedUntil) > 0);
    assert.equal(alice.score.losses, "1");
    const bob = Account.parse(unhex(F.accountBobAfter));
    assert.equal(bob.suspendedUntil, "0");
    assert.equal(bob.score.wins, "1");
    assert.ok(Number(bob.rating.rating) > 1500 && Number(alice.rating.rating) < 1500);
    const idle = Account.parse(unhex(F.accountIdle));
    assert.equal(idle.state.$kind, "Idle");
});

test("seats: a place in a game, or a notice with none", () => {
    const seat = Seat.parse(unhex(F.seatGame));
    const started = GameStarted.parse(unhex(F.gameStarted));
    assert.equal(seat.game, started.game);
    assert.equal(Seat.parse(unhex(F.seatNotice)).game, null);
    // By hand: id, then `Option<ID>` none.
    assert.equal(Seat.parse(unhex("ab".repeat(32) + "00")).game, null);
});

test("a ranked game: its mode, the finder's virtual units and their loadouts", () => {
    const game = Game.parse(unhex(F.gameRankedDeploying));
    assert.deepEqual(game.mode, { $kind: "Ranked", Ranked: { size: 3, tier: 1 } });
    assert.equal(game.state.$kind, "Deploying");
    assert.equal(game.recruits.size, "0");
    const bob = addr(F.bobId);
    const units = unitsOnMap(game).map(({ unit }) => unit);
    assert.equal(units.length, 3);
    assert.ok(units.every((u) => u.owner === bob));
    // Bob's squad: Assault with smoke, Assault with a frag grenade, Runner with a frag grenade.
    const gear = units
        .map(unitLoadout)
        .map((l) => `${l.weapon} ${l.armor} ${l.utility}`)
        .sort();
    assert.deepEqual(gear, [
        "rifle-1 armor-1 frag-grenade",
        "rifle-1 armor-2 frag-grenade",
        "rifle-1 armor-2 smoke-grenade",
    ]);
    const names = rankedSide(units, null).names.sort();
    assert.deepEqual(names, ["Assault", "Assault-2", "Runner"]);
    // After the reveal both squads stand, Alice's read back as she built it.
    const playing = Game.parse(unhex(F.gameRankedPlaying));
    const alice = unitsOnMap(playing)
        .map(({ unit }) => unit)
        .filter((u) => u.owner === addr(F.aliceId))
        .map(unitLoadout)
        .map((l) => [l.weapon, l.armor, l.utility]);
    assert.deepEqual(
        alice.sort(),
        [
            ["rifle-1", "armor-1", "flashbang"],
            ["rifle-1", "armor-2", "frag-grenade"],
            ["rifle-2", "armor-1", null],
        ].sort(),
    );
});

test("the two events: who plays, the mode, listed; and how it ended", () => {
    const started = GameStarted.parse(unhex(F.gameStarted));
    assert.deepEqual(started.players, [addr(F.aliceId), addr(F.bobId)]);
    assert.deepEqual(started.mode, { $kind: "Ranked", Ranked: { size: 3, tier: 1 } });
    assert.equal(started.listed, true);
    const ended = GameEnded.parse(unhex(F.gameEnded));
    assert.equal(ended.game, started.game);
    assert.deepEqual(ended.ending, { $kind: "Abandoned", Abandoned: addr(F.aliceId) });
});

/** A storage in memory, as `sessionStorage` and `localStorage` are. */
function memory(): KeyStore & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        get length() {
            return map.size;
        },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: (k) => void map.delete(k),
    };
}

test("the salt is kept in both stores under the commitment, and goes with the search", () => {
    const session = memory();
    const local = memory();
    const stores = [session, local];
    const kept = {
        account: "0xa",
        squad: F.aliceSquad,
        salt: "5a17",
        size: 3,
        labels: ["Assault"],
        at: 1_000,
    };
    keepSquad(stores, addr(F.commitment), kept);
    assert.equal(session.map.size, 1);
    assert.equal(local.map.size, 1);
    // A closed tab loses the session's: the device's still reveals.
    session.map.clear();
    assert.deepEqual(keptSquad(stores, addr(F.commitment)), kept);
    // Nothing else is written: no salt in a key, no other store.
    assert.ok([...local.map.keys()].every((k) => !k.includes("5a17")));
    forgetSquad(stores, addr(F.commitment));
    assert.equal(keptSquad(stores, addr(F.commitment)), null);
    // A store that throws is skipped.
    const broken: KeyStore = {
        ...memory(),
        setItem: () => {
            throw new Error("full");
        },
    };
    keepSquad([broken, local], "0x1", kept);
    assert.deepEqual(keptSquad([broken, local], "0x1"), kept);
});

test("the sweep drops what no search needs, never the current one or a fresh one", () => {
    const store = memory();
    const at = (commitment: string, account: string, when: number) =>
        keepSquad([store], commitment, {
            account,
            squad: "",
            salt: "",
            size: 3,
            labels: [],
            at: when,
        });
    const now = 10_000_000;
    at("0x1", "0xa", now - 600_000); // the account's, settled
    at("0x2", "0xa", now - 30_000); // the account's, just sent
    at("0x3", "0xa", now - 900_000); // the account's current search
    at("0x4", "0xb", now - 600_000); // another account's
    at("0x5", "0xb", now - 7_200_000); // anyone's, long over
    sweepSquads([store], "0xa", "0x3", now);
    const left = [...store.map.keys()].map((k) => k.slice(-1));
    assert.deepEqual(left.sort(), ["2", "3", "4"]);
});

test("the dry run picks the branch; a lost race sends the other one", () => {
    assert.deepEqual(branchOf(null), { kind: "wait" });
    assert.deepEqual(branchOf({ module: "rules", fn: "check_squad", code: 0 }), { kind: "match" });
    const refused = branchOf({ module: "rules", fn: "level_of", code: 5 });
    assert.equal(refused.kind, "refused");
    assert.equal(refused.kind === "refused" && refused.line, "No level for this size yet");
    const shown =
        'MoveAbort(MoveLocation { module: ModuleId { address: ab, name: Identifier("ghosts") }, function: 3, instruction: 9, function_name: Some("find_ranked") }, 32) in command 0';
    assert.equal(raceLost(shown), "wait");
    const size =
        'MoveAbort(MoveLocation { module: ModuleId { address: ab, name: Identifier("rules") }, function: 1, instruction: 9, function_name: Some("check_squad") }, 0) in command 0';
    assert.equal(raceLost(size), "match");
    assert.equal(raceLost("abort code: 9, in '0x1::ghosts::find_ranked'"), null);
});

test("every refusal of a ranked search, a reveal or a reset in plain words", () => {
    const line = (module: string, code: number) =>
        rankedRefusal(`abort code: ${code}, in '0x1::${module}::f'`);
    assert.equal(line("rules", 3), "The squad costs more than your budget");
    assert.equal(line("rules", 2), "The squad carries an item your tier has not unlocked");
    assert.equal(line("rules", 5), "No level for this size yet");
    assert.equal(line("ghosts", 9), "You are suspended from matchmaking");
    assert.equal(line("ghosts", 6), "You are already searching or in a match");
    assert.equal(line("account", 10), "Only a rating above 1500 can be reset");
    assert.equal(line("account", 12), "The rating was reset recently");
    assert.equal(line("matchmaker", 1), null);
    for (const module of ["rules", "ghosts", "account"])
        for (let code = 0; code < 40; code++) {
            const text = line(module, code);
            if (text) assert.doesNotMatch(text, /chain|testnet|!|preview/i);
        }
});
