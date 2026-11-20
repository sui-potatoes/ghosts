// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked play: the new layouts against bytes Move wrote (`fixtures.ts`), the squad bytes, the
 * commitment, the squad check and the tier in the contract's order, the virtual unit against
 * `unit::from_loadout` for every loadout, the Glicko port against the ratings Move wrote, the
 * call shapes, the squad generator, the kept secrets, and the agent through the sandbox.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Transaction } from "@mysten/sui/transactions";

import { GhostsAgent, playGames, type RankedEvent } from "../src/agent.ts";
import type { Backend } from "../src/backend.ts";
import {
    AccountBcs,
    decodeAccount,
    decodeGame,
    decodeGameEnded,
    decodeGameStarted,
    decodeMatchmaker,
    decodeRules,
    encodeStats,
    GameBcs,
    GameEndedBcs,
    GameStartedBcs,
    MatchmakerBcs,
    RulesBcs,
    SeatBcs,
    UnitBcs,
} from "../src/bcs.ts";
import { referencePolicy } from "../src/bot.ts";
import { agentFromEnv, playModeFrom } from "../src/config.ts";
import {
    actionsTx,
    cancelRankedTx,
    checkSquadTx,
    dismissSeatTx,
    findRankedTx,
    resetRatingTx,
    revealSquadTx,
    takeSeatTx,
    type Deployment,
} from "../src/contract.ts";
import { computeRatings, defaultRating } from "../src/glicko.ts";
import { createMcpServer } from "../src/mcp.ts";
import { parseCommand, runCommand } from "../src/play.ts";
import {
    autoSquad,
    budgetOf,
    checkSquad,
    decodeSquad,
    describeSquad,
    encodeSquad,
    LOADOUT_PRESETS,
    newSquadSalt,
    parseSquad,
    PRESET_IDS,
    squadCommitment,
    squadPrice,
    tierOf,
    unitFromLoadout,
    type Loadout,
    type RankedRules,
} from "../src/ranked.ts";
import { fileRevealStore, memoryRevealStore } from "../src/reveal.ts";
import { createSandbox, SANDBOX_RANKED_QUEUES, SANDBOX_RULES, type SandboxOptions } from "../src/sandbox.ts";
import { ActionError, isAbort, type GameState } from "../src/types.ts";
import { pollingWake } from "../src/wake.ts";
import { FIXTURES, LOADOUT_UNITS, RANKED } from "./fixtures.ts";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fast = { wake: pollingWake(1) };
const NONE = 0xff;

// === Layouts against Move's bytes ===

test("every ranked value Move wrote reserializes to the same bytes", () => {
    const schemas = [
        [RulesBcs, FIXTURES.rules],
        [MatchmakerBcs, FIXTURES.rankedQueueOne],
        [GameStartedBcs, FIXTURES.eventRankedStarted],
        [GameEndedBcs, FIXTURES.eventRankedEnded],
        [GameEndedBcs, FIXTURES.eventRankedNoShow],
        [SeatBcs, FIXTURES.seatRanked],
        [SeatBcs, FIXTURES.noticeSeat],
        [GameBcs, FIXTURES.gameRankedRevealWait],
        [GameBcs, FIXTURES.gameRankedPlaying],
        [GameBcs, FIXTURES.gameRankedOver],
        [GameBcs, FIXTURES.gameRankedNoShow],
        [AccountBcs, FIXTURES.accountRankedSearching],
        [AccountBcs, FIXTURES.accountRankedFinder],
        [AccountBcs, FIXTURES.accountRankedRevealWaiting],
        [AccountBcs, FIXTURES.accountRankedPlaying],
        [AccountBcs, FIXTURES.accountRankedAfterLoss],
        [AccountBcs, FIXTURES.accountRankedAfterWin],
        [AccountBcs, FIXTURES.accountRankedReset],
        [AccountBcs, FIXTURES.accountRankedDropped],
        [AccountBcs, FIXTURES.accountRankedNoShow],
        [AccountBcs, FIXTURES.accountRankedNoShowWinner],
    ] as const;
    for (const [schema, value] of schemas) {
        const parsed = (schema as typeof GameBcs).parse(bytes(value));
        assert.equal(hex(schema.serialize(parsed as never).toBytes()), value);
    }
});

test("the Rules decode to the initial economy, with the queue and level of each size", () => {
    const rules = decodeRules(bytes(FIXTURES.rules));
    const { id, sizes, ...rest } = rules;
    const { id: _id, sizes: _sizes, ...expected } = SANDBOX_RULES;
    assert.deepEqual(rest, expected, "the sandbox's rules are the package's initial ones");
    assert.match(id, /^0x[0-9a-f]{64}$/);
    assert.deepEqual(sizes, [
        { units: 3, queue: RANKED.three, level: RANKED.level },
        { units: 4, queue: RANKED.four, level: null },
    ]);
    const queue = decodeMatchmaker(bytes(FIXTURES.rankedQueueOne));
    assert.deepEqual(queue, {
        id: RANKED.three,
        waiting: 1,
        ticketTtlMs: 300_000,
        bucketSize: 100,
        maxWindow: 1_000,
    });
});

test("a ranked search names its queue and holds the commitment; the finder plays at once", () => {
    const searching = decodeAccount(bytes(FIXTURES.accountRankedSearching));
    assert.deepEqual(searching.search, {
        kind: "searching",
        order: (searching.search as { order: string }).order,
        sinceMs: 0,
        queue: RANKED.three,
        commitment: RANKED.commitment,
    });
    assert.equal(squadCommitment(bytes(RANKED.aliceSquad), bytes(RANKED.salt)), RANKED.commitment);

    const waiting = decodeAccount(bytes(FIXTURES.accountRankedRevealWaiting));
    assert.equal(waiting.search.kind === "searching" && waiting.search.commitment, RANKED.commitment);
    const finder = decodeAccount(bytes(FIXTURES.accountRankedFinder));
    assert.deepEqual(finder.search, { kind: "playing", game: RANKED.game });
    assert.deepEqual(decodeAccount(bytes(FIXTURES.accountRankedPlaying)).search, {
        kind: "playing",
        game: RANKED.game,
    });
    assert.equal(SeatBcs.parse(bytes(FIXTURES.seatRanked)).game, RANKED.game);
});

test("a ranked game waits for the reveal with the finder's squad on the map, then plays", () => {
    const started = decodeGameStarted(bytes(FIXTURES.eventRankedStarted));
    assert.deepEqual(started.mode, { kind: "ranked", size: 3, tier: 1 });
    assert.equal(started.game, RANKED.game);
    assert.equal(started.listed, true);
    assert.deepEqual([...started.players].sort(), [RANKED.alice, RANKED.bob].sort());

    const wait = decodeGame(bytes(FIXTURES.gameRankedRevealWait), "1");
    assert.deepEqual(wait.players, started.players, "the event has the drawn turn order");
    assert.deepEqual(wait.mode, { kind: "ranked", size: 3, tier: 1 });
    assert.deepEqual(wait.status, { kind: "deploying" });
    assert.equal(wait.deadlineMs, 1_000 + 60_000, "the reveal limit from the match");
    const bob = wait.players.indexOf(RANKED.bob);
    const alice = 1 - bob;
    assert.equal(wait.squads[bob].length, 3);
    assert.deepEqual(wait.squads[alice], []);
    // the first unit goes to the side's last spawn; every unit is what its loadout makes
    const spawns = [
        [[11, 6], [12, 8], [11, 10]],
        [[4, 11], [5, 14], [3, 6]],
    ];
    const placed = (state: GameState, side: number, squad: Loadout[]) =>
        squad.forEach((loadout, i) => {
            const [x, y] = spawns[side][2 - i];
            const unit = state.units.find((u) => u.x === x && u.y === y)!;
            const built = unitFromLoadout(loadout)!;
            assert.equal(unit.owner, state.players[side]);
            assert.deepEqual(unit.stats, built.stats);
            assert.deepEqual(unit.actions, built.actions);
            assert.deepEqual([unit.hp, unit.hpMax, unit.ammo, unit.ap], [built.hp, built.hp, built.ammo, 2]);
        });
    placed(wait, bob, decodeSquad(bytes(RANKED.bobSquad)));
    assert.equal(GameBcs.parse(bytes(FIXTURES.gameRankedRevealWait)).recruits.size, "0");

    const playing = decodeGame(bytes(FIXTURES.gameRankedPlaying), "2");
    assert.deepEqual(playing.status, { kind: "active" });
    assert.equal(playing.deadlineMs, 2_000 + 120_000, "the first turn from the reveal");
    placed(playing, alice, decodeSquad(bytes(RANKED.aliceSquad)));

    const over = decodeGame(bytes(FIXTURES.gameRankedOver), "3");
    assert.deepEqual(over.status, { kind: "finished", winner: RANKED.bob, ending: { kind: "won", by: RANKED.bob } });
    assert.deepEqual(decodeGameEnded(bytes(FIXTURES.eventRankedEnded)), {
        game: RANKED.game,
        ending: { kind: "won", by: RANKED.bob },
    });
});

test("a ranked game moves score and rating, as the Glicko port computes them", () => {
    const wait = decodeGame(bytes(FIXTURES.gameRankedRevealWait), "1");
    const lost = decodeAccount(bytes(FIXTURES.accountRankedAfterLoss));
    const won = decodeAccount(bytes(FIXTURES.accountRankedAfterWin));
    assert.deepEqual(lost.score, { wins: 0, losses: 1, draws: 0 });
    assert.deepEqual(won.score, { wins: 1, losses: 0, draws: 0 });
    assert.equal(lost.recruits, won.recruits, "no recruit went in or came out");
    assert.equal(lost.suspendedUntilMs, 0);

    const bobFirst = wait.players[0] === RANKED.bob;
    const [first, second] = computeRatings(defaultRating(), defaultRating(), bobFirst ? "win" : "loss", 5_000);
    const [bob, alice] = bobFirst ? [first, second] : [second, first];
    assert.deepEqual([won.rating, won.deviation, won.ratedGames, won.lastPlayedMs], [bob.rating, bob.deviation, 1, 5_000]);
    assert.deepEqual([lost.rating, lost.deviation, lost.ratedGames], [alice.rating, alice.deviation, 1]);
    assert.ok(won.rating > 1500 && lost.rating < 1500);
});

test("a rating reset goes back to the default, counts, and keeps the score", () => {
    const reset = decodeAccount(bytes(FIXTURES.accountRankedReset));
    assert.deepEqual([reset.rating, reset.deviation, reset.ratedGames, reset.lastPlayedMs], [1500, 350, 0, 0]);
    assert.deepEqual([reset.resets, reset.lastResetMs], [1, 9_000]);
    assert.deepEqual(reset.score, { wins: 1, losses: 0, draws: 0 });
});

test("a dropped search waits on a notice, a seat in no game", () => {
    assert.equal(SeatBcs.parse(bytes(FIXTURES.noticeSeat)).game, null);
    const dropped = decodeAccount(bytes(FIXTURES.accountRankedDropped));
    assert.equal(dropped.search.kind, "searching", "until the notice is dismissed");
    assert.equal(dropped.search.kind === "searching" && dropped.search.commitment, RANKED.commitment);
});

test("a ranked no-show loses, is suspended, and the finder wins", () => {
    const game = decodeGame(bytes(FIXTURES.gameRankedNoShow), "1");
    assert.deepEqual(game.status, {
        kind: "finished",
        winner: RANKED.bob,
        ending: { kind: "no_show", by: RANKED.alice },
    });
    assert.equal(game.abandonedBy, RANKED.alice);
    assert.deepEqual(decodeGameEnded(bytes(FIXTURES.eventRankedNoShow)).ending, {
        kind: "no_show",
        by: RANKED.alice,
    });
    const alice = decodeAccount(bytes(FIXTURES.accountRankedNoShow));
    const bob = decodeAccount(bytes(FIXTURES.accountRankedNoShowWinner));
    assert.equal(alice.suspendedUntilMs, 60_001 + 60_000);
    assert.deepEqual([alice.score.losses, bob.score.wins], [1, 1]);
    assert.equal(bob.suspendedUntilMs, 0);
    const bobFirst = game.players[0] === RANKED.bob;
    const [first, second] = computeRatings(defaultRating(), defaultRating(), bobFirst ? "win" : "loss", 60_001);
    assert.equal(bob.rating, (bobFirst ? first : second).rating);
    assert.equal(alice.rating, (bobFirst ? second : first).rating);
});

test("a virtual unit is `unit::from_loadout`, byte for byte, for all 36 loadouts", () => {
    const one = `0x${"1".padStart(64, "0")}`;
    const two = `0x${"2".padStart(64, "0")}`;
    let checked = 0;
    for (const rifle of [1, 2, 3]) {
        for (const armor of [1, 2, 3]) {
            for (const utility of [0, 1, 2, null]) {
                const unit = unitFromLoadout({ rifle, armor, utility })!;
                const kinds = { move: "Move", attack: "Attack", reload: "Reload", grenade: "Grenade", flashbang: "Flashbang", smoke_grenade: "SmokeGrenade" } as const;
                const written = UnitBcs.serialize({
                    recruit: one,
                    owner: two,
                    ap: { value: unit.ap, maxValue: unit.ap },
                    hp: { value: unit.hp, maxValue: unit.hp },
                    ammo: { value: unit.ammo, maxValue: unit.ammo },
                    stats: encodeStatsOf(unit.stats),
                    actions: unit.actions.map(({ kind, uses }) => ({ uses, kind: { [kinds[kind]]: true } as never })),
                    effects: [],
                }).toBytes();
                const key = `${rifle}${armor}${utility ?? "n"}`;
                assert.equal(hex(written), LOADOUT_UNITS[key], `loadout ${key}`);
                checked++;
            }
        }
    }
    assert.equal(checked, 36);
    assert.equal(unitFromLoadout({ rifle: 4, armor: 1, utility: null }), null);
    // heavy armor costs a tile of mobility and all the dodge light armor would give
    const heavy = unitFromLoadout({ rifle: 3, armor: 3, utility: null })!;
    assert.deepEqual([heavy.stats.mobility, heavy.stats.health, heavy.stats.armor, heavy.stats.dodge], [6, 11, 3, 0]);
});

const encodeStatsOf = (stats: Parameters<typeof encodeStats>[0]) => encodeStats(stats).toString();

// === Squad bytes and the check ===

test("a squad is three bytes a unit, and the commitment hashes it with the salt", () => {
    const squad: Loadout[] = [
        { rifle: 1, armor: 2, utility: 0 },
        { rifle: 2, armor: 1, utility: null },
        { rifle: 1, armor: 1, utility: 1 },
    ];
    assert.equal(hex(encodeSquad(squad)), RANKED.aliceSquad.slice(2));
    assert.deepEqual(decodeSquad(encodeSquad(squad)), squad);
    assert.equal(describeSquad(squad), "1/2/frag 2/1/- 1/1/flashbang");
    const salt = newSquadSalt();
    assert.equal(salt.length, 32);
    assert.notDeepEqual(salt, newSquadSalt(), "fresh randomness every time");
    assert.notEqual(squadCommitment(encodeSquad(squad), salt), squadCommitment(encodeSquad(squad), newSquadSalt()));
});

test("the squad check aborts in the contract's order, with its codes", () => {
    const rules = SANDBOX_RULES;
    const check = (tier: number, units: number[], size = 3) => checkSquad(rules, size, tier, Uint8Array.from(units));
    const code = (tier: number, units: number[], size = 3) => {
        const problem = check(tier, units, size);
        return problem && [problem.kind, problem.abort, problem.unit ?? null, problem.slot ?? null];
    };
    assert.equal(check(1, [1, 2, 0, 2, 1, NONE, 1, 1, 1]), null, "145 of 150 at Contractor");
    assert.equal(check(1, [1, 2, 2, 1, 2, 0, 1, 1, 0]), null, "150 of 150");
    assert.deepEqual(code(1, [1, 2, 0, 2, 1, NONE]), ["squad_size", 0, null, null], "short");
    assert.deepEqual(code(1, []), ["squad_size", 0, null, null], "empty: someone waits");
    assert.deepEqual(code(1, [1, 1, NONE, 1, 1, NONE, 1, 1, NONE, 1]), ["squad_size", 0, null, null], "a partial unit");
    assert.deepEqual(code(1, [0, 1, NONE, 1, 1, NONE, 1, 1, NONE]), ["unknown_item", 1, 0, "rifle"], "no rifle");
    assert.deepEqual(code(1, [4, 1, NONE, 1, 1, NONE, 1, 1, NONE]), ["unknown_item", 1, 0, "rifle"], "rifle 4");
    assert.deepEqual(code(1, [1, 0, NONE, 1, 1, NONE, 1, 1, NONE]), ["unknown_item", 1, 0, "armor"], "no armor");
    assert.deepEqual(code(1, [1, 1, 3, 1, 1, NONE, 1, 1, NONE]), ["unknown_item", 1, 0, "utility"], "utility 3");
    assert.deepEqual(code(0, [1, 1, NONE, 2, 1, NONE, 1, 1, NONE]), ["item_locked", 2, 1, "rifle"], "a Sniper at Rookie");
    assert.deepEqual(code(1, [1, 3, NONE, 1, 1, NONE, 1, 1, NONE]), ["item_locked", 2, 0, "armor"], "heavy armor at Contractor");
    // unit by unit: the first unit's lock comes before the second's unknown item
    assert.deepEqual(code(0, [2, 1, NONE, 9, 1, NONE, 1, 1, NONE]), ["item_locked", 2, 0, "rifle"]);
    // locked before the budget
    assert.deepEqual(code(1, [3, 3, NONE, 3, 3, NONE, 3, 3, NONE]), ["item_locked", 2, 0, "rifle"]);
    assert.deepEqual(code(2, [3, 3, NONE, 3, 3, NONE, 1, 1, NONE]), ["over_budget", 3, null, null]);
    assert.deepEqual(code(1, [1, 1, NONE], 5), ["no_size", 7, null, null]);
    assert.equal(check(9, [1, 1, NONE, 1, 1, NONE, 1, 1, NONE])?.kind, "bad_tier");
});

test("the tier is the highest the rating reaches, floored while placing", () => {
    const rules = SANDBOX_RULES;
    assert.equal(tierOf(rules, 1399, 5), 0);
    assert.equal(tierOf(rules, 1400, 5), 1);
    assert.equal(tierOf(rules, 1649, 5), 1);
    assert.equal(tierOf(rules, 1650, 5), 2);
    assert.equal(tierOf(rules, 1900, 9), 3);
    assert.equal(tierOf(rules, 0, 9), 0);
    assert.equal(tierOf(rules, 1340, 0), 1, "the placement floor: Contractor for the first five");
    assert.equal(tierOf(rules, 1340, 4), 1);
    assert.equal(tierOf(rules, 1340, 5), 0);
    assert.equal(tierOf(rules, 2000, 0), 3, "the floor never lowers");
    assert.equal(budgetOf(rules, 1, 3), 150);
    assert.equal(budgetOf(rules, 3, 4), 320);
    assert.equal(budgetOf(rules, 1, 5), null);
});

test("squads read as text: presets, RIFLE/ARMOR/UTILITY, or hex", () => {
    assert.deepEqual(parseSquad("assault, sniper runner"), [
        LOADOUT_PRESETS.assault,
        LOADOUT_PRESETS.sniper,
        LOADOUT_PRESETS.runner,
    ]);
    assert.deepEqual(parseSquad("2/1/-,1:2:smoke,3/3/flashbang"), [
        { rifle: 2, armor: 1, utility: null },
        { rifle: 1, armor: 2, utility: 2 },
        { rifle: 3, armor: 3, utility: 1 },
    ]);
    assert.deepEqual(parseSquad(RANKED.aliceSquad), decodeSquad(bytes(RANKED.aliceSquad)));
    assert.throws(() => parseSquad("tank"), /Not a unit/);
    assert.throws(() => parseSquad("1/1/laser"), /Not a utility/);
    assert.throws(() => parseSquad(""), /No units/);
});

// === The generator ===

test("an auto squad is valid over many seeds, every tier and both sizes, within budget", () => {
    for (const tier of [0, 1, 2, 3]) {
        for (const size of [3, 4]) {
            const budget = budgetOf(SANDBOX_RULES, tier, size)!;
            for (let seed = 0; seed < 300; seed++) {
                const built = autoSquad(SANDBOX_RULES, tier, size, { seed });
                assert.equal(checkSquad(SANDBOX_RULES, size, tier, built.bytes), null, `seed ${seed}`);
                assert.equal(built.squad.length, size);
                assert.ok(built.price <= budget, `${built.price} <= ${budget}`);
                assert.equal(built.price, squadPrice(SANDBOX_RULES, built.squad));
                // leftover credits are spent while an upgrade is affordable: less than the cheapest one left
                assert.ok(budget - built.price < 10 || cannotUpgrade(built.squad, tier, budget - built.price));
            }
        }
    }
});

/** Whether no unit of the squad can take a rifle, armor or utility step for `left` credits. */
function cannotUpgrade(squad: Loadout[], tier: number, left: number): boolean {
    const r = SANDBOX_RULES;
    return squad.every((unit) => {
        const rifle = r.weapons[unit.rifle];
        const armor = r.armor[unit.armor];
        const step = [
            rifle && rifle.minTier <= tier ? rifle.price - r.weapons[unit.rifle - 1].price : Infinity,
            armor && armor.minTier <= tier ? armor.price - r.armor[unit.armor - 1].price : Infinity,
            unit.utility === null ? 10 : Infinity,
        ];
        return step.every((cost) => cost > left);
    });
}

test("auto squads vary: compositions, utilities and upgrades, never all one archetype by default", () => {
    for (const tier of [1, 2, 3]) {
        const seen = new Set<string>();
        const archetypes = new Set<string>();
        const utilities = new Set<number | null>();
        for (let seed = 0; seed < 400; seed++) {
            const built = autoSquad(SANDBOX_RULES, tier, 3, { seed });
            seen.add(hex(built.bytes));
            built.archetypes.forEach((a) => archetypes.add(a));
            built.squad.forEach((u) => utilities.add(u.utility));
            const most = Math.max(...PRESET_IDS.map((id) => built.archetypes.filter((a) => a === id).length));
            assert.ok(most <= 2, `at most two of a kind: ${built.archetypes}`);
        }
        assert.ok(seen.size >= 25, `tier ${tier}: ${seen.size} different squads`);
        const open = PRESET_IDS.filter((id) => tier >= 2 || id !== "heavy");
        for (const id of open) assert.ok(archetypes.has(id), `tier ${tier} fields a ${id}`);
        for (const kind of [0, 1, 2]) assert.ok(utilities.has(kind), `tier ${tier} carries utility ${kind}`);
    }
    // a Rookie has no sniper or heavy
    for (let seed = 0; seed < 100; seed++) {
        const built = autoSquad(SANDBOX_RULES, 0, 3, { seed });
        assert.ok(built.squad.every((u) => u.rifle === 1 && u.armor <= 2));
    }
});

test("an auto squad is the same for the same seed, and follows the weights and the live rules", () => {
    assert.deepEqual(autoSquad(SANDBOX_RULES, 2, 4, { seed: 7 }), autoSquad(SANDBOX_RULES, 2, 4, { seed: 7 }));
    const snipers = autoSquad(SANDBOX_RULES, 1, 3, {
        seed: 3,
        weights: { recruit: 0, runner: 0, assault: 0, sniper: 1, heavy: 0 },
        maxSame: 3,
    });
    assert.deepEqual(snipers.archetypes, ["sniper", "sniper", "sniper"]);
    // a retune on chain: rifles twice the price, and frags locked for everyone
    const retuned: RankedRules = structuredClone(SANDBOX_RULES);
    retuned.weapons = retuned.weapons.map((w) => ({ ...w, price: w.price * 2 }));
    retuned.utilities[0].minTier = 9;
    for (let seed = 0; seed < 100; seed++) {
        const built = autoSquad(retuned, 1, 3, { seed });
        assert.equal(checkSquad(retuned, 3, 1, built.bytes), null);
        assert.ok(built.squad.every((u) => u.utility !== 0), "no frag once it is locked");
    }
    const broke: RankedRules = structuredClone(SANDBOX_RULES);
    broke.tiers[1].budgets = [80, 100];
    assert.throws(() => autoSquad(broke, 1, 3), /over the budget/);
    assert.throws(() => autoSquad(SANDBOX_RULES, 1, 5), /No budget/);
});

// === The calls ===

const D: Deployment = {
    package: "0x1",
    registry: "0x2",
    matchmaker: "0x3",
    preset: "0x4",
    lobbies: "0x5",
    rules: "0x9",
    names: null,
};
const REF = { objectId: `0x${"cc".repeat(32)}`, version: "5", digest: "1".repeat(32) };

function calls(tx: Transaction): string[] {
    const data = tx.getData();
    return data.commands.map((command) => {
        const call = command.MoveCall!;
        const args = call.arguments.map((argument) => {
            if (argument.$kind !== "Input") return "result";
            const input = data.inputs[argument.Input!];
            if (input.$kind === "Pure") return "pure";
            if (input.$kind === "Object") return "receiving";
            const id = BigInt(input.UnresolvedObject!.objectId);
            return id === 8n ? "random" : id === 6n ? "clock" : `0x${id.toString(16)}`;
        });
        return `${call.module}::${call.function}(${args.join(", ")})`;
    });
}

test("the ranked calls take their arguments in the package's order", () => {
    const ranked = { rules: "0x9", queue: "0xa3", level: "0xd3" };
    const squad = Uint8Array.from([1, 2, 0, 2, 1, NONE, 1, 1, 1]);
    const find = findRankedTx(D, "0x77", ranked, squad, `0x${"ab".repeat(32)}`);
    assert.deepEqual(calls(find), ["ghosts::find_ranked(0xa3, 0x77, 0x9, 0xd3, random, clock, pure, pure)"]);
    const pure = find.getData().inputs.filter((input) => input.$kind === "Pure");
    assert.equal(hex(Buffer.from(pure[0].Pure!.bytes, "base64")), `09${hex(squad)}`, "the squad as vector<u8>");
    assert.equal(hex(Buffer.from(pure[1].Pure!.bytes, "base64")), "ab".repeat(32), "the commitment as address");

    const seat = { account: "0x77", seat: REF, game: "0x99", ranked: true };
    const salt = new Uint8Array(32).fill(7);
    assert.deepEqual(calls(revealSquadTx(D, "0x9", seat, squad, salt)), [
        "ghosts::reveal_squad(0x99, 0x77, 0x9, receiving, clock, pure, pure)",
    ]);
    assert.deepEqual(calls(takeSeatTx(D, seat)), ["ghosts::take_seat(0x99, 0x77, receiving, clock)"]);
    assert.deepEqual(calls(dismissSeatTx(D, { account: "0x77", seat: REF, game: null })), [
        "ghosts::dismiss_seat(0x77, receiving)",
    ]);
    assert.deepEqual(calls(cancelRankedTx(D, "0xa3", "0x77")), ["ghosts::cancel_ranked(0xa3, 0x77, clock)"]);
    assert.deepEqual(calls(resetRatingTx(D, "0x9", "0x77")), ["account::reset_rating(0x77, 0x9, clock)"]);
    assert.deepEqual(calls(checkSquadTx(D, "0x9", 3, 1, squad)), ["rules::check_squad(0x9, pure, pure, pure)"]);
    assert.throws(() => revealSquadTx(D, "0x9", { ...seat, game: null }, squad, salt), /notice/);

    // wrapping up a ranked game the waiter never took a seat in takes it with `take_seat`
    const game = { id: "0x99", players: ["0xa", "0xb"] } as GameState;
    assert.deepEqual(calls(actionsTx(D, game, "0xa", [{ kind: "complete" }], [{ ...seat, account: "0xb" }])), [
        "ghosts::take_seat(0x99, 0xb, receiving, clock)",
        "ghosts::complete_game(0x99, 0xa, 0xb, clock)",
    ]);
});

// === Kept secrets ===

test("a ranked secret outlives a restart in its file, readable by its owner only", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghosts-reveal-"));
    try {
        const path = join(dir, "agent.key.ranked.json");
        const squad = bytes(RANKED.aliceSquad);
        const salt = bytes(RANKED.salt);
        const first = fileRevealStore(path);
        first.save({ commitment: RANKED.commitment, squad, salt, size: 3, savedAtMs: 1 });
        assert.equal(statSync(path).mode & 0o777, 0o600);

        const again = fileRevealStore(path);
        const found = again.find(RANKED.commitment.toUpperCase().replace("0X", "0x"));
        assert.deepEqual([found?.squad, found?.salt, found?.size], [squad, salt, 3]);
        // a fresh one is never pruned, the one in use never; an old other one is
        again.save({ commitment: `0x${"ee".repeat(32)}`, squad, salt, size: 3, savedAtMs: Date.now() });
        again.prune(RANKED.commitment, Date.now() - 1000);
        assert.ok(again.find(RANKED.commitment) && again.find(`0x${"ee".repeat(32)}`));
        again.prune(null, Date.now() - 1000);
        assert.equal(again.find(RANKED.commitment), null);
        again.forget(`0x${"ee".repeat(32)}`);
        assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { pending: [] });
    } finally {
        rmSync(dir, { recursive: true });
    }
});

// === The agent, through the sandbox ===

function rankedAgent(options: SandboxOptions = {}, events: RankedEvent[] = []) {
    const backend = createSandbox({ seed: 5, ...options });
    const agent = new GhostsAgent(backend, {
        ...fast,
        now: options.now,
        mode: { kind: "ranked", size: 3 },
        onRanked: (event) => events.push(event),
    });
    return { agent, backend, events };
}

async function ready(agent: GhostsAgent) {
    await agent.setName("ranked-one");
    return agent.setup();
}

test("ranked setup opens the account and hires nobody", async () => {
    const { agent } = rankedAgent();
    assert.equal((await ready(agent)).phase, "idle");
    assert.equal((await agent.backend.account())?.recruits, 0);
});

test("finding a waiting player shows the squad and starts the game", async () => {
    const { agent, events } = rankedAgent({ firstMover: "you" });
    await ready(agent);
    const situation = await agent.findRanked({ size: 3, squad: "auto" });
    assert.equal(situation.phase, "your_turn");
    const { state, side } = await agent.current();
    assert.deepEqual(state.mode, { kind: "ranked", size: 3, tier: 1 });
    assert.equal(state.units.filter((u) => u.side === side).length, 3);
    assert.equal(state.units.filter((u) => u.side !== side).length, 3, "the waiter revealed");
    assert.deepEqual(events.map((e) => e.kind), ["matched"]);
    assert.ok(events[0].kind === "matched" && events[0].squad.split(" ").length === 3);
    assert.equal(agent.reveals.find(`0x${"0".repeat(64)}`), null, "a finder keeps no secret");
});

test("a waiter reveals within the limit on its own while waiting", async () => {
    const { agent, events } = rankedAgent({ seated: true, firstMover: "you" });
    await ready(agent);
    const squad = parseSquad("assault,sniper,runner");
    const searching = await agent.findRanked({ squad });
    // the opponent found us at once: the seat waits, and wait reveals
    assert.equal(searching.phase, "your_turn", "advance revealed straight away");
    const { state, side } = await agent.current();
    assert.equal(state.status.kind, "active");
    const ranges = state.units.filter((u) => u.side === side).map((u) => u.stats.range);
    assert.deepEqual(ranges.sort(), [4, 4, 5], "two standard rifles and a sharpshooter");
    assert.deepEqual(events.map((e) => e.kind), ["queued", "revealed"]);
    assert.ok(events[1].kind === "revealed" && events[1].squad === "1/2/frag 2/1/- 1/1/frag");
});

test("a reveal the contract refuses gives the seat up: a no-show, a loss and a suspension", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const { agent, events } = rankedAgent({ seated: true, now });
    await ready(agent);
    // lose the secret: nothing to reveal with
    agent.reveals = { ...memoryRevealStore(), save: () => {} };
    await agent.findRanked();
    assert.deepEqual(events.map((e) => e.kind), ["queued", "gave_up"]);
    assert.equal((await agent.situation()).phase, "opponent_turn");
    clock += 60_001;
    const account = await agent.backend.account();
    assert.deepEqual(account?.search, { kind: "idle" });
    assert.deepEqual(account?.score, { wins: 0, losses: 1, draws: 0 });
    assert.ok(account!.rating < 1500);
    assert.equal(account?.suspendedUntilMs, clock + 60_000);
    assert.equal((await agent.situation()).phase, "suspended");
    await assert.rejects(agent.findRanked(), (e) => isAbort(e, "ghosts", 9));
});

test("a wrong salt is refused with the mismatch, and the agent gives up the seat", async () => {
    const { agent, backend } = rankedAgent({ seated: true });
    await ready(agent);
    // queue by hand, then reveal with another salt
    const squad = encodeSquad(parseSquad("assault,assault,runner"));
    const salt = newSquadSalt();
    await backend.findRanked(3, new Uint8Array(0), squadCommitment(squad, salt));
    await assert.rejects(backend.revealSquad(squad, newSquadSalt()), (e) => isAbort(e, "ghosts", 31));
    await assert.rejects(backend.revealSquad(encodeSquad(parseSquad("assault,assault,assault")), salt), (e) =>
        isAbort(e, "ghosts", 31),
    );
    assert.ok(await backend.revealSquad(squad, salt), "the right one lands");
});

test("a missed reveal is a no-show at the limit", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const { agent, backend } = rankedAgent({ seated: true, now });
    await ready(agent);
    const squad = encodeSquad(parseSquad("runner,runner,assault"));
    await backend.findRanked(3, new Uint8Array(0), squadCommitment(squad, newSquadSalt()));
    assert.equal((await agent.situation()).phase, "reveal");
    clock += 60_001;
    const account = await backend.account();
    assert.deepEqual([account?.search.kind, account?.score.losses], ["idle", 1]);
    assert.ok(account!.suspendedUntilMs > clock);
});

test("a search past the ticket lifetime gets a notice, which waiting dismisses, and play goes on", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const { agent, events } = rankedAgent({ empty: true, now });
    await ready(agent);
    const searching = await agent.findRanked();
    assert.deepEqual([searching.phase, searching.queue], ["searching", "ranked 3x3"]);
    clock += 300_001;
    assert.equal((await agent.situation()).phase, "notice");
    assert.equal((await agent.wait({ timeoutMs: 5 })).phase, "idle");
    assert.deepEqual(events.map((e) => e.kind), ["queued", "dismissed"]);
    assert.equal((await agent.findRanked()).phase, "searching", "and it searches again");
});

test("a squad shown to a waiter who was taken first is rebuilt, and the search waits", async () => {
    const backend = createSandbox({ seed: 2, empty: true });
    const sent: string[] = [];
    let call = 0;
    const racing: Backend = {
        ...backend,
        async findRanked(size, squad, commitment) {
            sent.push(hex(squad));
            call++;
            if (call === 1) throw new ActionError("rejected", "someone waits", false, { module: "rules", code: 0 });
            if (call === 2) throw new ActionError("rejected", "taken", false, { module: "ghosts", code: 32 });
            return backend.findRanked(size, squad, commitment);
        },
    };
    const agent = new GhostsAgent(racing, { ...fast, mode: { kind: "ranked", size: 3 } });
    await ready(agent);
    assert.equal((await agent.findRanked({ auto: { seed: 1 } })).phase, "searching");
    assert.equal(sent.length, 3);
    assert.deepEqual([sent[0], sent[2]], ["", ""], "waiting searches show nothing");
    assert.equal(sent[1].length, 18, "the match showed the squad");
    const account = await agent.backend.account();
    const kept = account?.search.kind === "searching" && agent.reveals.find(account.search.commitment!);
    assert.ok(kept, "the secret of the search that waits is kept");
});

test("ranked 4 has no level yet and is refused; a bad squad is refused before anything is sent", async () => {
    const { agent } = rankedAgent();
    await ready(agent);
    await assert.rejects(agent.findRanked({ size: 4 }), (e) => isAbort(e, "rules", 5));
    await assert.rejects(agent.findRanked({ squad: parseSquad("heavy,heavy,heavy") }), (e) =>
        e instanceof ActionError && e.code === "bad_squad" && /unlocks at Operative/.test(e.message),
    );
    assert.deepEqual((await agent.backend.account())?.search, { kind: "idle" });
});

test("ranked games move rating and score; a reset goes back, only from above, once per cooldown", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const { agent } = rankedAgent({ now, firstMover: "you", opponent: () => ["next_turn"] });
    await ready(agent);
    await assert.rejects(agent.resetRating(), (e) => isAbort(e, "account", 10));
    const { results } = await playGames(agent, referencePolicy, { games: 1, signal: AbortSignal.timeout(20_000) });
    assert.equal(results.length, 1);
    const after = (await agent.backend.account())!;
    assert.equal(after.score.wins + after.score.losses + after.score.draws, 1);
    assert.equal(after.recruits, 0, "no recruit was hired or risked");
    if (after.rating <= 1500) return; // the reference bot lost to a silent opponent: nothing to reset
    await agent.resetRating();
    const reset = (await agent.backend.account())!;
    assert.deepEqual([reset.rating, reset.deviation, reset.resets, reset.lastResetMs], [1500, 350, 1, clock]);
    assert.deepEqual(reset.score, after.score);
});

test("a reset needs a rating above the default, and the account idle", async () => {
    const backend = createSandbox({ rating: 1700, empty: true });
    await backend.createAccount();
    await backend.findRanked(3, new Uint8Array(0), `0x${"ab".repeat(32)}`);
    await assert.rejects(backend.resetRating(), (e) => isAbort(e, "account", 11), "searching");
    await backend.cancelSearch();
    await backend.resetRating();
    const reset = (await backend.account())!;
    assert.deepEqual([reset.rating, reset.resets], [1500, 1]);
    await assert.rejects(backend.resetRating(), (e) => isAbort(e, "account", 10), "at the default");
});

test("the fleet's loop plays ranked games back to back, the bot's own squads, no hiring", async () => {
    const { agent, events } = rankedAgent({ seed: 9 });
    const { results } = await playGames(agent, referencePolicy, {
        games: 3,
        name: "fleet-like",
        signal: AbortSignal.timeout(30_000),
    });
    assert.equal(results.length, 3);
    assert.equal(events.filter((e) => e.kind === "matched").length, 3);
    assert.equal((await agent.backend.account())?.recruits, 0);
});

test("the first mover follows the draw in every mode", async () => {
    for (const firstMover of ["you", "opponent"] as const) {
        const { agent } = rankedAgent({ firstMover });
        await ready(agent);
        await agent.findRanked();
        const { side } = await agent.current();
        assert.equal(side, firstMover === "you" ? 0 : 1);
    }
    const stakes = new GhostsAgent(createSandbox({ seed: 2, firstMover: "opponent", seated: true }), fast);
    await stakes.setName("stakes-one");
    await stakes.setup();
    await stakes.findGame();
    await stakes.wait({ timeoutMs: 5 });
    assert.equal((await stakes.current()).side, 1, "seated, and second all the same");
});

// === Skins: the CLI, the MCP server, the environment ===

test("the shell searches ranked with a squad, shows an auto one and the ranked rules", async () => {
    const { agent } = rankedAgent();
    await ready(agent);
    const shown = (await runCommand(agent, parseCommand(["squad", "--seed", "4"]))) as { squad: string; price: number };
    const again = (await runCommand(agent, parseCommand(["squad", "--seed", "4"]))) as { squad: string };
    assert.equal(shown.squad, again.squad);
    assert.ok(shown.price <= 150);
    const info = (await runCommand(agent, parseCommand(["ranked-info"]))) as { tier: { name: string }; sizes: unknown[] };
    assert.equal(info.tier.name, "Contractor");
    assert.deepEqual(info.sizes, [
        { units: 3, open: true, budget: 150 },
        { units: 4, open: false, budget: 200 },
    ]);
    const parsed = parseCommand(["ranked", "--size", "3", "--squad", "assault,2/1/-,1/1/smoke"]);
    assert.deepEqual(parsed.flags.squad, parseSquad("assault,2/1/-,1/1/smoke"));
    const found = (await runCommand(agent, parsed)) as { phase: string };
    assert.ok(["your_turn", "opponent_turn"].includes(found.phase));
    assert.throws(() => parseCommand(["ranked", "--squad", "tank"]), /Not a unit/);
});

test("the tools search ranked by mode and read the ranked rules", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 3 }), fast);
    const server = createMcpServer(agent);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        return JSON.parse((result.content as { text: string }[])[0].text);
    };
    await call("ghosts_set_name", { name: "tool-ranked" });
    await call("ghosts_setup");
    const info = await call("ghosts_ranked_info", { size: 3 });
    assert.equal(info.tier.name, "Contractor");
    assert.ok(info.auto.squad);
    const bad = await call("ghosts_find_game", { mode: "ranked", squad: "tank" });
    assert.equal(bad.error, "bad_squad");
    const found = await call("ghosts_find_game", { mode: "ranked", size: 3, squad: "auto" });
    assert.ok(["your_turn", "opponent_turn"].includes(found.phase));
    assert.equal((await agent.current()).state.mode.kind, "ranked");
});

test("the environment names the mode and the ranked objects; localnet takes every id", async () => {
    assert.deepEqual(playModeFrom(undefined), { kind: "stakes" });
    assert.deepEqual(playModeFrom("ranked"), { kind: "ranked", size: 3 });
    assert.deepEqual(playModeFrom("ranked:4"), { kind: "ranked", size: 4 });
    assert.throws(() => playModeFrom("casual"), /Unknown GHOSTS_MODE/);

    const dir = mkdtempSync(join(tmpdir(), "ghosts-env-"));
    try {
        const base = { GHOSTS_KEY_FILE: join(dir, "agent.key") };
        assert.throws(() => agentFromEnv({ ...base, GHOSTS_NETWORK: "localnet" }), /GHOSTS_PACKAGE is required/);
        const ids = {
            ...base,
            GHOSTS_NETWORK: "localnet",
            GHOSTS_PACKAGE: "0x1",
            GHOSTS_REGISTRY: "0x2",
            GHOSTS_MATCHMAKER: "0x3",
            GHOSTS_PRESET: "0x4",
            GHOSTS_LOBBIES: "0x5",
        };
        const agent = agentFromEnv({ ...ids, GHOSTS_MODE: "ranked", GHOSTS_RULES: "0x9", GHOSTS_RANKED_3: "0xa3" });
        assert.equal(agent.backend.network, "localnet");
        assert.equal(agent.backend.packageId, "0x1");
        assert.equal(agent.backend.nameService, false, "no name service on a local node");
        assert.deepEqual(agent.mode, { kind: "ranked", size: 3 });
        // a deployment without the ranked objects refuses ranked play with a clear error, unsent
        const bare = agentFromEnv(ids);
        await assert.rejects(bare.backend.rules(), (error) =>
            error instanceof ActionError && error.code === "no_rules" && /GHOSTS_RULES/.test(error.message),
        );
        // testnet defaults to the published package with ranked play
        const testnet = agentFromEnv({ ...base, GHOSTS_NETWORK: "testnet" });
        assert.equal(testnet.backend.packageId, "0x55020cb734b77cec16c17fa216df136b1d2955f17606549f7d43fcbd461b76db");
        assert.equal(testnet.backend.nameService, true);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("the ranked queues of the sandbox are the rules' own", () => {
    assert.equal(SANDBOX_RULES.sizes[0].queue, SANDBOX_RANKED_QUEUES[3]);
    assert.equal(SANDBOX_RULES.sizes[1].level, null);
});
