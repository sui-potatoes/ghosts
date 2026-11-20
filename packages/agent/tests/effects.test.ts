// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Status effects, the flashbang and the smoke grenade, against `ghosts::effect`, `ghosts::map`
 * and `ghosts::unit`: the decoders, the stat folding and hit chances, throw legality, bursts,
 * refresh and expiry, the history replay and the bots. `parity.test.ts` holds the sandbox to the
 * bytes Move wrote.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeEffect,
    decodeGame,
    decodeRecord,
    encodeEffect,
    GameBcs,
    RecordBcs,
} from "../src/bcs.ts";
import { bcs } from "@mysten/sui/bcs";
import { referencePolicy } from "../src/bot.ts";
import { armSquadTx } from "../src/contract.ts";
import {
    actionId,
    applyDeterministic,
    blastUnits,
    effectiveStats,
    hitChance,
    legalActions,
    parseAction,
    passTurn,
    refusal,
    replayEffects,
    shotChance,
    spreadEffect,
    throwEffect,
    validateBatch,
    type EffectThrowAction,
} from "../src/rules.ts";
import { createSandbox, type SquadUnit } from "../src/sandbox.ts";
import type { GameRecord, GameState, Stats, Tile, Unit, UnitActionEntry } from "../src/types.ts";
import { FIXTURES } from "./fixtures.ts";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

/** `stats::default()` with a standard rifle: aim 65, range 4, 10 health. */
const BASE: Stats = {
    mobility: 7,
    aim: 65,
    health: 10,
    armor: 0,
    dodge: 0,
    defense: 0,
    damage: 4,
    spread: 2,
    plusOne: 10,
    critChance: 10,
    canBeDodged: 1,
    areaSize: 0,
    envDamage: 0,
    range: 4,
    ammo: 3,
};

const acts = (...kinds: string[]): UnitActionEntry[] =>
    kinds.map((text) => {
        const [kind, uses] = text.split(":");
        return { kind: kind as UnitActionEntry["kind"], uses: uses === undefined ? null : +uses };
    });

/** An empty `rows` x `cols` map, Alice (side 0) to act, `Map.units` kept as the units go. */
function arena(rows = 10, cols = 10): GameState {
    const tiles: Tile[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, (): Tile => ({ kind: "empty" })),
    );
    return {
        id: "0x1",
        version: "1",
        rows,
        cols,
        turn: 0,
        active: 0,
        players: ["0xa", "0xb"],
        squads: [[], []],
        fallen: [],
        positions: [[], []],
        history: [],
        missed: [0, 0],
        abandonedBy: null,
        deadlineMs: 1_000_000,
        status: { kind: "active" },
        tiles,
        units: [],
    };
}

function place(
    state: GameState,
    side: number,
    x: number,
    y: number,
    actions: string[] = ["move", "attack", "reload"],
    effects: Unit["effects"] = [],
): Unit {
    const unit: Unit = {
        recruit: `0x${side}${x}${y}`,
        owner: state.players[side],
        side,
        x,
        y,
        ap: 2,
        apMax: 2,
        hp: 10,
        hpMax: 10,
        ammo: 3,
        ammoMax: 3,
        stats: BASE,
        actions: acts(...actions),
        effects,
    };
    state.units.push(unit);
    return unit;
}

const flash = (x: number, y: number, tx: number, ty: number): EffectThrowAction => ({
    kind: "flashbang",
    x,
    y,
    tx,
    ty,
});
const smoke = (x: number, y: number, tx: number, ty: number): EffectThrowAction => ({
    kind: "smoke_grenade",
    x,
    y,
    tx,
    ty,
});

// === Bytes from Move ===

test("the effect byte is `kind << 4 | turns`, and the kinds and tags are Move's", () => {
    assert.deepEqual(decodeEffect(0x02), { kind: "daze", turns: 2 });
    assert.deepEqual(decodeEffect(0x12), { kind: "smoke", turns: 2 });
    assert.deepEqual(decodeEffect(0x1f), { kind: "smoke", turns: 15 });
    assert.equal(encodeEffect({ kind: "daze", turns: 2 }), 0x02);
    assert.equal(encodeEffect({ kind: "smoke", turns: 1 }), 0x11);

    // action kinds 4 and 5, then records 12 to 15, as the Move fixtures write them
    const records = bcs.vector(RecordBcs).parse(bytes(FIXTURES.records));
    assert.deepEqual(
        records.slice(12).map((record) => [record.$kind, decodeRecord(record).kind]),
        [
            ["Flashbang", "flashbang"],
            ["SmokeGrenade", "smoke_grenade"],
            ["EffectStart", "effect_start"],
            ["EffectStart", "effect_start"],
            ["EffectEnd", "effect_end"],
            ["EffectEnd", "effect_end"],
        ],
    );
});

test("every step of the scripted match round-trips, and decodes with its effects", () => {
    for (let step = 0; step <= 10; step++) {
        const hex = FIXTURES[`gameScript${step}` as keyof typeof FIXTURES];
        const game = GameBcs.parse(bytes(hex));
        assert.equal(Buffer.from(GameBcs.serialize(game).toBytes()).toString("hex"), hex);

        // `Map.units` is the tile of every unit on the map, ascending: the order effects land in
        const { cols } = decodeGame(bytes(hex), "1");
        const tiles = game.map.grid.grid.flatMap((row, x) =>
            row.flatMap((tile, y) => (tile.unit ? [x * cols + y] : [])),
        );
        assert.deepEqual(game.map.units, tiles, `the unit index after step ${step}`);
    }

    const effects = (step: number) =>
        decodeGame(bytes(FIXTURES[`gameScript${step}` as keyof typeof FIXTURES]), "1")
            .units.filter((unit) => unit.effects.length > 0)
            .map(({ x, y, effects }) => [x, y, effects.map((e) => `${e.kind}${e.turns}`)]);
    assert.deepEqual(effects(0), []);
    assert.deepEqual(effects(1), [[2, 1, ["smoke2"]]]);
    assert.deepEqual(effects(4), [
        [2, 1, ["smoke2"]],
        [5, 5, ["daze2"]],
        [6, 1, ["smoke2"]],
        [6, 3, ["daze2"]],
    ]);
    assert.deepEqual(effects(10), []);

    // a recruit killed under a daze lies in `Map.fallen` with it
    const killed = GameBcs.parse(bytes(FIXTURES.gameScript8));
    assert.deepEqual(killed.map.fallen.map((unit) => unit.effects), [[0x01]]);
    const unit = decodeGame(bytes(FIXTURES.gameScript4), "1").units.find((u) => u.x === 5)!;
    assert.deepEqual(
        unit.actions.map((a) => a.kind),
        ["move", "attack", "reload"],
    );
    const flashbanger = decodeGame(bytes(FIXTURES.gameScript4), "1").units.find(
        (u) => u.x === 6 && u.y === 3,
    )!;
    assert.deepEqual(flashbanger.actions.at(-1), { kind: "flashbang", uses: 0 }, "spent");
});

// === Stats and hit chance ===

test("effective stats fold the effects in order, as `stats::add` does", () => {
    const unit = (...effects: Unit["effects"]) => ({ stats: BASE, effects });
    const daze = { kind: "daze", turns: 2 } as const;
    const smokeEffect = { kind: "smoke", turns: 2 } as const;

    assert.equal(effectiveStats(unit()), BASE, "no effects, the base itself");
    assert.deepEqual(
        [effectiveStats(unit(smokeEffect)).aim, effectiveStats(unit(smokeEffect)).defense],
        [35, 30],
    );
    assert.deepEqual(
        [effectiveStats(unit(daze)).aim, effectiveStats(unit(daze)).defense],
        [0, 0],
    );
    // a daze takes all the aim, which smoke can't give back, whichever came first
    for (const both of [unit(daze, smokeEffect), unit(smokeEffect, daze)]) {
        assert.deepEqual([effectiveStats(both).aim, effectiveStats(both).defense], [0, 30]);
    }
    // the base is never touched, and what the effects don't touch stays
    const smoked = effectiveStats(unit(smokeEffect));
    assert.deepEqual({ ...smoked, aim: 65, defense: 0 }, BASE);
    assert.equal(BASE.aim, 65);
    // a stat an effect modifies is capped at 127; aim never goes below 0
    const sturdy = { stats: { ...BASE, defense: 120, aim: 10 }, effects: [smokeEffect] };
    assert.deepEqual([effectiveStats(sturdy).defense, effectiveStats(sturdy).aim], [127, 0]);
});

test("hit chances count both sides' effects, with no floor at aim 0", () => {
    const state = arena();
    const shooter = place(state, 0, 5, 1);
    const target = place(state, 1, 5, 5); // distance 4: the weapon's range
    const chance = (from: Unit, to: Unit) =>
        shotChance(
            state,
            effectiveStats(from),
            from.x,
            from.y,
            to.x,
            to.y,
            effectiveStats(to).defense,
        );

    assert.equal(chance(shooter, target), 65);
    target.effects = [{ kind: "smoke", turns: 2 }];
    assert.equal(chance(shooter, target), 35, "smoke on the target: +30 defense");
    target.effects = [];
    shooter.effects = [{ kind: "smoke", turns: 2 }];
    assert.equal(chance(shooter, target), 35, "smoke on the shooter: -30 aim");
    shooter.effects = [{ kind: "daze", turns: 2 }];
    assert.equal(chance(shooter, target), 0, "a dazed shooter never hits at the range");

    // inside the range the distance bonus is still there: 5 for each tile
    target.x = 5;
    target.y = 3; // distance 2
    assert.equal(chance(shooter, target), 10);
    // past it the penalty has nothing left to take
    target.y = 7; // distance 6
    assert.equal(chance(shooter, target), 0);
    shooter.effects = [];
    assert.equal(chance(shooter, target), 45, "and 65 - 20 once the daze is gone");

    // the formula itself: defense comes off after the distance, floored at 0
    assert.equal(hitChance({ ...BASE, aim: 0 }, 2, 0), 10);
    assert.equal(hitChance({ ...BASE, aim: 0 }, 2, 30), 0);
});

test("a dazed or smoked unit's legal shots carry the chances the chain would roll", () => {
    const state = arena();
    place(state, 0, 5, 1);
    place(state, 1, 5, 5, ["move", "attack", "reload"], [{ kind: "smoke", turns: 1 }]);
    const [shot] = legalActions(state, 0, 0).filter((a) => a.kind === "attack");
    assert.equal(shot.hitChance, 35);
    state.units[0].effects = [{ kind: "daze", turns: 1 }];
    const [dazed] = legalActions(state, 0, 0).filter((a) => a.kind === "attack");
    assert.equal(dazed.hitChance, 0);
});

// === Throws ===

test("a throw is legal for a unit with its action, in range, at a tile no wall covers", () => {
    const state = arena();
    state.tiles[5][4] = { kind: "wall" };
    place(state, 0, 5, 2, ["move", "flashbang:1"]);
    place(state, 0, 8, 2, ["move", "smoke_grenade:1"]);
    place(state, 0, 9, 9, ["move", "attack", "reload"]);
    place(state, 1, 5, 7);
    const ok = (action: EffectThrowAction) => refusal(state, 0, action, 0);

    // range 5 by Manhattan distance, the same as the frag grenade's
    assert.equal(ok(flash(5, 2, 5, 7)), "A wall blocks the throw.");
    assert.equal(ok(flash(5, 2, 3, 3)), null, "walls block a throw only on its line");
    assert.equal(ok(flash(5, 2, 5, 8)), "The target is out of throwing range.");
    assert.equal(ok(flash(5, 2, 5, 4)), "Cannot target a wall.");
    assert.equal(ok(flash(5, 2, 12, 2)), "The target is off the map.");
    assert.equal(ok(smoke(8, 2, 8, 7)), null);
    assert.equal(ok(smoke(8, 2, 8, 8)), "The target is out of throwing range.");

    // a grenade is its own action: a flashbanger can't smoke, nor throw a frag
    assert.equal(ok(smoke(5, 2, 4, 6)), "That unit cannot smoke_grenade.");
    assert.equal(
        refusal(state, 0, { kind: "grenade", x: 5, y: 2, tx: 4, ty: 6 }, 0),
        "That unit cannot grenade.",
    );
    assert.equal(ok(flash(9, 9, 8, 8)), "That unit cannot flashbang.");
    assert.equal(ok(flash(8, 2, 8, 3)), "That unit cannot flashbang.");

    // the throw costs 1 AP and the one use
    const thrower = state.units[0];
    thrower.ap = 0;
    assert.equal(ok(flash(5, 2, 3, 3)), "That unit has no AP left this turn.");
    thrower.ap = 1;
    assert.equal(ok(flash(5, 2, 3, 3)), null);
    thrower.actions = acts("move", "flashbang:0");
    assert.equal(ok(flash(5, 2, 3, 3)), "This unit has no flashbang left.");
});

test("a throw is listed for a unit that has it, and only the right kind", () => {
    const state = arena();
    place(state, 0, 5, 2, ["move", "flashbang:1"]);
    place(state, 0, 6, 2, ["move", "smoke_grenade:1"]);
    place(state, 0, 7, 2, ["move", "grenade:1"]);
    place(state, 1, 5, 6);
    const listed = (kind: string) =>
        legalActions(state, 0, 0).filter((a) => a.kind === kind && a.to);

    // the flashbang and the frag grenade want an enemy in the blast; the frag one is unchanged
    for (const throwing of listed("flashbang")) {
        assert.deepEqual(throwing.unit, [5, 2]);
        assert.ok(throwing.enemiesHit! >= 1);
        assert.ok(Math.abs(throwing.to![0] - 5) + Math.abs(throwing.to![1] - 2) <= 5);
    }
    assert.ok(listed("flashbang").length > 0);
    assert.deepEqual([...new Set(listed("grenade").map((a) => a.unit!.join()))], ["7,2"]);
    // smoke is for anyone: it is offered over my own units too
    const smoked = listed("smoke_grenade");
    assert.deepEqual([...new Set(smoked.map((a) => a.unit!.join()))], ["6,2"]);
    assert.ok(smoked.some((a) => a.enemiesHit === 0 && a.alliesHit! > 0));
    // every listed throw passes the check, and has an id that parses back
    for (const throwing of [...listed("flashbang"), ...smoked, ...listed("grenade")]) {
        assert.equal(refusal(state, 0, parseAction(throwing.id), 0), null);
        assert.equal(actionId(parseAction(throwing.id)), throwing.id);
    }
    assert.deepEqual(parseAction("smoke_grenade:6,2:5,4"), smoke(6, 2, 5, 4));
    assert.equal(actionId(flash(1, 2, 3, 4)), "flashbang:1,2:3,4");
});

test("a burst reaches every unit within 2 of the target, either side, the thrower too", () => {
    const state = arena();
    const thrower = place(state, 0, 5, 3, ["move", "flashbang:1"]);
    place(state, 0, 4, 6); // distance 1 from (4, 7): in
    place(state, 1, 6, 7); // 2 + 0 from (4, 7)? |6-4| + |7-7| = 2: in
    place(state, 1, 4, 9); // 2 from (4, 7): in
    place(state, 1, 7, 7); // 3: out
    place(state, 0, 2, 8); // 2 + 1 = 3: out
    // the thrower at (5, 3) is 5 from the target (4, 7): inside the range, outside the burst
    const target = [4, 7] as const;
    assert.deepEqual(
        blastUnits(state, ...target, 2)
            .map((unit) => [unit.x, unit.y])
            .sort(),
        [
            [4, 6],
            [4, 9],
            [6, 7],
        ],
    );

    // the thrower in the burst: a throw at its own feet
    const records = throwEffect(state, flash(5, 3, 5, 3));
    assert.deepEqual(records, [
        { kind: "flashbang", from: [5, 3], to: [5, 3] },
        { kind: "effect_start", x: 5, y: 3, effect: "daze", turns: 2 },
    ]);
    assert.equal(thrower.ap, 1, "1 AP spent");
    assert.deepEqual(thrower.actions.at(-1), { kind: "flashbang", uses: 0 });
    assert.deepEqual(
        state.units.filter((unit) => unit.effects.length).map((unit) => [unit.x, unit.y]),
        [[5, 3]],
    );
});

test("a throw writes its records in `Map.units` order, whatever order the units were added", () => {
    const state = arena();
    place(state, 1, 7, 5, ["move", "smoke_grenade:1"]);
    place(state, 0, 6, 4);
    place(state, 1, 3, 5);
    place(state, 0, 6, 6);
    const records = throwEffect(state, smoke(7, 5, 6, 5));
    assert.deepEqual(
        records.map((record) => record.kind === "effect_start" && [record.x, record.y]),
        [false, [6, 4], [6, 6], [7, 5]],
        "row-major by tile; (3, 5) is 3 away and stays out",
    );
    assert.deepEqual(records[0], { kind: "smoke_grenade", from: [7, 5], to: [6, 5] });
    // none of it damages anything
    assert.deepEqual(
        state.units.map((unit) => unit.hp),
        [10, 10, 10, 10],
    );
});

test("a throw into an empty area writes the header alone", () => {
    const state = arena();
    place(state, 0, 5, 2, ["move", "flashbang:1"]);
    assert.deepEqual(throwEffect(state, flash(5, 2, 5, 7)), [
        { kind: "flashbang", from: [5, 2], to: [5, 7] },
    ]);
});

// === Timing ===

test("an effect lasts the rest of its turn and the next, and ends with an `EffectEnd`", () => {
    const state = arena();
    const alice = place(state, 0, 5, 2, ["move", "smoke_grenade:1"]);
    const bob = place(state, 1, 5, 6, ["move", "flashbang:1"]);

    // thrown on Alice's turn: Alice's end leaves 1, Bob's end ends it
    spreadEffect(state, 5, 2, "smoke");
    assert.deepEqual(alice.effects, [{ kind: "smoke", turns: 2 }]);
    assert.deepEqual(passTurn(state), []);
    assert.deepEqual(alice.effects, [{ kind: "smoke", turns: 1 }]);
    assert.deepEqual(passTurn(state), [{ kind: "effect_end", x: 5, y: 2, effect: "smoke" }]);
    assert.deepEqual(alice.effects, []);

    // the same thrown on Bob's turn: it ends when Alice ends hers
    assert.equal(state.active, 0);
    passTurn(state);
    assert.equal(state.active, 1);
    spreadEffect(state, 5, 6, "daze");
    assert.deepEqual(bob.effects, [{ kind: "daze", turns: 2 }]);
    passTurn(state);
    assert.deepEqual(bob.effects, [{ kind: "daze", turns: 1 }]);
    assert.deepEqual(passTurn(state), [{ kind: "effect_end", x: 5, y: 6, effect: "daze" }]);
});

test("the same effect refreshes to the longer and does not stack; kinds keep their order", () => {
    const state = arena();
    const unit = place(state, 0, 5, 2);
    spreadEffect(state, 5, 2, "smoke");
    passTurn(state); // smoke 1
    const records = spreadEffect(state, 5, 2, "smoke");
    assert.deepEqual(records, [{ kind: "effect_start", x: 5, y: 2, effect: "smoke", turns: 2 }]);
    assert.deepEqual(unit.effects, [{ kind: "smoke", turns: 2 }], "refreshed, with no end first");

    // a daze goes after the smoke; a refresh of the smoke keeps its place in the list
    spreadEffect(state, 5, 2, "daze");
    passTurn(state);
    spreadEffect(state, 5, 2, "smoke");
    assert.deepEqual(unit.effects, [
        { kind: "smoke", turns: 2 },
        { kind: "daze", turns: 1 },
    ]);
    // both run out on one turn change: an end per effect, in the order the unit had them
    state.units[0].effects = [
        { kind: "smoke", turns: 1 },
        { kind: "daze", turns: 1 },
    ];
    assert.deepEqual(passTurn(state), [
        { kind: "effect_end", x: 5, y: 2, effect: "smoke" },
        { kind: "effect_end", x: 5, y: 2, effect: "daze" },
    ]);
    assert.deepEqual(unit.effects, []);
});

test("every turn change ticks every unit, either side's, and only gives AP to the new side", () => {
    const state = arena();
    const mine = place(state, 0, 1, 1);
    const theirs = place(state, 1, 8, 8);
    mine.ap = 0;
    theirs.ap = 0;
    mine.effects = [{ kind: "daze", turns: 2 }];
    theirs.effects = [{ kind: "smoke", turns: 1 }];
    const ends = passTurn(state);
    assert.deepEqual(ends, [{ kind: "effect_end", x: 8, y: 8, effect: "smoke" }]);
    assert.deepEqual([mine.ap, theirs.ap], [0, 2], "the side whose turn begins");
    assert.deepEqual(mine.effects, [{ kind: "daze", turns: 1 }]);
    // the cursor a batch is checked against ticks the same
    const next = applyDeterministic(state, { kind: "next_turn" });
    assert.deepEqual(next.units[0].effects, []);
    assert.deepEqual(state.units[0].effects, [{ kind: "daze", turns: 1 }], "a copy");
});

test("an orders batch may carry a throw before a shot, but not after a frag", () => {
    const state = arena();
    place(state, 0, 5, 2, ["move", "flashbang:1"]);
    place(state, 0, 5, 3, ["move", "attack", "reload", "grenade:1"]);
    place(state, 0, 5, 4, ["move", "attack", "reload"]);
    place(state, 1, 5, 7);
    const ids = (...list: string[]) => validateBatch(state, 0, list, 0).map((a) => a.kind);

    assert.deepEqual(ids("flashbang:5,2:5,6", "attack:5,4:5,7"), ["flashbang", "attack"]);
    assert.throws(() => ids("grenade:5,3:5,7", "attack:5,4:5,7"), /dice roll must be the last/);
    assert.throws(() => ids("attack:5,4:5,7", "flashbang:5,2:5,6"), /dice roll must be the last/);
    // the throw spent the unit's AP and use: a second one fails the check
    assert.throws(() => ids("flashbang:5,2:5,6", "flashbang:5,2:5,6"), /no flashbang left|no AP/);
    // and the daze it put on the target is what the next order is checked against
    const dazed = applyDeterministic(state, flash(5, 2, 5, 6));
    assert.deepEqual(dazed.units[3].effects, [{ kind: "daze", turns: 2 }]);
});

// === History replay ===

const THROWN: GameRecord[] = [
    { kind: "smoke_grenade", from: [1, 1], to: [1, 2] },
    { kind: "effect_start", x: 1, y: 2, effect: "smoke", turns: 2 },
    { kind: "effect_start", x: 1, y: 3, effect: "smoke", turns: 2 },
    { kind: "next_turn", turn: 1 },
    { kind: "flashbang", from: [1, 3], to: [1, 2] },
    { kind: "effect_start", x: 1, y: 2, effect: "daze", turns: 2 },
    { kind: "effect_start", x: 1, y: 3, effect: "smoke", turns: 2 },
    { kind: "move", path: [1, 2, 4, 4, 2] },
    { kind: "kia", recruit: "0x1", x: 1, y: 3 },
    { kind: "next_turn", turn: 2 },
];

test("a replay from the records alone gives the effects a game holds, order included", () => {
    // the smoke at (1, 3) died with its unit and wrote no end; the walker's runs out
    const records: GameRecord[] = [
        ...THROWN,
        { kind: "effect_end", x: 3, y: 3, effect: "smoke" },
    ];
    assert.deepEqual(replayEffects(records), [
        { x: 3, y: 3, effects: [{ kind: "daze", turns: 1 }] },
    ]);
    // a walk, a kill and a refresh in between, the list keeps the order the unit got them in
    assert.deepEqual(
        replayEffects(THROWN.slice(0, 3)).map(({ x, y, effects }) => [x, y, effects.length]),
        [
            [1, 2, 1],
            [1, 3, 1],
        ],
    );
});

test("a replay refuses a history that lets an effect run out without its end", () => {
    assert.throws(() => replayEffects(THROWN), /ran out without an end/);
    assert.throws(
        () => replayEffects([{ kind: "effect_end", x: 1, y: 1, effect: "daze" }]),
        /did not end/,
    );
    assert.throws(
        () =>
            replayEffects([
                { kind: "effect_start", x: 1, y: 1, effect: "daze", turns: 2 },
                { kind: "effect_end", x: 1, y: 1, effect: "daze" },
            ]),
        /did not end/,
        "an end with turns left",
    );
});

// === Whole games ===

/** Squads of carriers: a flashbanger, a smoker and a frag thrower, with rifles, a side each. */
function carriers(): [SquadUnit[], SquadUnit[]] {
    const squad = (): SquadUnit[] =>
        ["flashbang:1", "smoke_grenade:1", "grenade:1"].map((grenade) => ({
            stats: BASE,
            actions: acts("move", "attack", "reload", grenade),
        }));
    return [squad(), squad()];
}

test("bot games with every grenade keep the replay equal to the units, all along", async () => {
    const thrown = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
        const legalOnly = (state: GameState, side: number, ids: string[]) => {
            for (const id of ids) {
                const action = parseAction(id);
                assert.equal(refusal(state, side, action, 0), null, `${id} is legal`);
                thrown.add(action.kind);
                // every order is applied to the state it was chosen on: the cursor keeps up
                state = applyDeterministic(state, action);
            }
        };
        const backend = createSandbox({
            seed,
            seated: true,
            squads: carriers(),
            positions: [
                [11, 6],
                [12, 8],
                [11, 10],
                [4, 11],
                [5, 14],
                [3, 6],
            ],
            now: () => 0,
            opponent: (input) => {
                const ids = referencePolicy(input) as string[];
                legalOnly(structuredClone(input.state), input.side, ids);
                return ids;
            },
        });
        await backend.createAccount();
        await backend.hireSquad();
        await backend.findGame();
        await backend.acceptSeat();
        const account = (await backend.account())!;
        const id = account.search.kind === "playing" ? account.search.game : "";

        let game = (await backend.game(id))!;
        await backend.submit(game, [{ kind: "deploy" }]);
        for (let turn = 0; turn < 40; turn++) {
            game = (await backend.game(id))!;
            if (game.status.kind !== "active") break;
            // my side plays the reference bot too, one order at a time
            for (let i = 0; i < 12 && game.status.kind === "active" && game.active === 0; i++) {
                const legal = legalActions(game, 0, 0);
                const ids = referencePolicy({ state: game, side: 0, legal, nowMs: 0 }) as string[];
                legalOnly(structuredClone(game), 0, ids);
                await backend.submit(game, ids.map(parseAction));
                game = (await backend.game(id))!;
            }

            const rebuilt = replayEffects(game.history)
                .map(({ x, y, effects }) => ({ x, y, effects }))
                .sort((a, b) => a.x - b.x || a.y - b.y);
            const carried = game.units
                .filter((unit) => unit.effects.length > 0)
                .map(({ x, y, effects }) => ({ x, y, effects }))
                .sort((a, b) => a.x - b.x || a.y - b.y);
            assert.deepEqual(rebuilt, carried, `seed ${seed}, turn ${game.turn}`);
        }
        assert.ok(game.history.length > 20, "a game was played");
    }
    assert.ok(thrown.has("flashbang") && thrown.has("smoke_grenade"), [...thrown].join());
});

// === The bots ===

test("the reference bot flashbangs enemies about to shoot, and not its own units", () => {
    const state = arena();
    const flasher = place(state, 0, 6, 3, ["move", "flashbang:1"]);
    place(state, 0, 9, 9, ["move"]);
    const first = place(state, 1, 3, 4);
    const second = place(state, 1, 3, 6);
    // both can shoot a unit of mine that has no weapon to answer with
    place(state, 0, 6, 5, ["move"]);
    const choose = () =>
        referencePolicy({
            state,
            side: 0,
            legal: legalActions(state, 0, 0),
            nowMs: 0,
        }) as string[];

    const [id] = choose();
    const picked = parseAction(id);
    assert.equal(picked.kind, "flashbang");
    const throwing = picked as EffectThrowAction;
    assert.deepEqual([flasher.x, flasher.y], [throwing.x, throwing.y]);
    const burst = blastUnits(state, throwing.tx, throwing.ty, 2);
    assert.ok(burst.includes(first) || burst.includes(second));
    assert.ok(burst.every((unit) => unit.side === 1), "none of mine in it");

    // dazed already: nothing left to stop, so the bot does not waste the flashbang
    first.effects = [{ kind: "daze", turns: 2 }];
    second.effects = [{ kind: "daze", turns: 2 }];
    assert.notEqual(parseAction(choose()[0]).kind, "flashbang");
});

test("the reference bot smokes its units an enemy is likely to hit, with no cover", () => {
    const state = arena();
    place(state, 0, 5, 1, ["move", "smoke_grenade:1"]);
    place(state, 1, 5, 9); // too far to shoot
    place(state, 0, 5, 3, ["move"]); // no weapon: no good shot to take instead
    const enemy = place(state, 1, 5, 7);
    const choose = () =>
        referencePolicy({
            state,
            side: 0,
            legal: legalActions(state, 0, 0),
            nowMs: 0,
        }) as string[];

    // the unit at (5, 3) is 4 from the enemy at (5, 7): exposed on open ground
    const picked = parseAction(choose()[0]);
    assert.equal(picked.kind, "smoke_grenade");
    const throwing = picked as EffectThrowAction;
    const covered = blastUnits(state, throwing.tx, throwing.ty, 2);
    assert.ok(covered.every((unit) => unit.side === 0), "no enemy in it");
    assert.ok(covered.some((unit) => unit.x === 5 && unit.y === 3));

    // in cover already, or smoked already, or not within the enemy's reach: no throw
    state.tiles[5][3] = { kind: "cover", left: 0, top: 0, right: 2, bottom: 0 };
    assert.notEqual(parseAction(choose()[0]).kind, "smoke_grenade");
    state.tiles[5][3] = { kind: "empty" };
    // (the thrower stands 6 from the enemy: exposed too, so both have to be in smoke)
    state.units[0].effects = [{ kind: "smoke", turns: 2 }];
    state.units[2].effects = [{ kind: "smoke", turns: 2 }];
    assert.notEqual(parseAction(choose()[0]).kind, "smoke_grenade");
    state.units[0].effects = [];
    state.units[2].effects = [];
    [enemy.x, enemy.y] = [0, 9];
    [state.units[1].x, state.units[1].y] = [1, 9];
    assert.notEqual(parseAction(choose()[0]).kind, "smoke_grenade");
});

test("a bot is not given a throw it has no action for, or one already spent", () => {
    const state = arena();
    place(state, 0, 5, 2, ["move", "attack", "reload"]);
    place(state, 0, 6, 2, ["move", "flashbang:0", "smoke_grenade:0"]);
    place(state, 1, 5, 5);
    place(state, 1, 5, 6);
    const kinds = new Set(legalActions(state, 0, 0).map((a) => a.kind));
    assert.ok(!kinds.has("flashbang") && !kinds.has("smoke_grenade") && !kinds.has("grenade"));
});

// === Contract bindings ===

test("the armory fits a flashbang or a smoke grenade as it fits a frag grenade", () => {
    const ref = { objectId: `0x${"cc".repeat(32)}`, version: "5", digest: "1".repeat(32) };
    const tx = armSquadTx(
        {
            package: "0x1",
            registry: "0x2",
            matchmaker: "0x3",
            preset: "0x4",
            names: { package: "0x6", suins: "0x7", instance: "0x8", domain: "demo.ghosts.sui" },
        },
        "0x5",
        [
            { recruit: ref, rifle: false, grenade: true },
            { recruit: ref, rifle: false, grenade: true, utility: "flashbang" },
            { recruit: ref, rifle: false, grenade: true, utility: "smoke_grenade" },
        ],
    );
    const data = tx.getData();
    const kinds = data.commands
        .filter((command) => command.MoveCall?.function === "requisition_utility")
        .map((command) => {
            const input = command.MoveCall!.arguments[1];
            assert.ok("Input" in input);
            const pure = data.inputs[input.Input].Pure;
            return Buffer.from(pure!.bytes, "base64")[0];
        });
    assert.deepEqual(kinds, [0, 1, 2], "frag grenade 0, flashbang 1, smoke grenade 2");
});
