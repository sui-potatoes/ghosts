// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The effects layout of the contract (`move/packages/ghosts`: `Unit.effects`, `Effect`,
 * action kinds 4 and 5, records 12 to 15, `Map.units`) as the app reads it, and the rules
 * the app mirrors: effective stats, hit chance, throw validity and burst membership.
 * The expected bytes are written out by hand from the layout of the Move report, one
 * field at a time, not produced by the encoder under test.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bcs } from "@mysten/sui/bcs";

import { GameMap, GameRecord, MapUnit, Utility } from "../src/chain/bcs.ts";
import {
    EFFECT_KINDS,
    burstOf,
    canDo,
    effectBytes,
    effectByte,
    effectsOf,
    effectKind,
    effectName,
    effectTurns,
    effectiveStats,
    hasUsesLeft,
    hitChance,
    throwValid,
    tickEffects,
    unitActions,
    withEffect,
    type UnitAction,
} from "../src/chain/match-rules.ts";

const History = bcs.vector(GameRecord);
type History = typeof History.$inferType;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const addr = (byte: string) => `0x${byte.repeat(32)}`;
const u16 = (n: number) => n.toString(16).padStart(2, "0") + "00";

// === A unit with 0, 1 and 2 effects ===

const MOVE = "0000"; // Action { uses: None, kind: Move }
const ATTACK = "0001";
const RELOAD = "0002";
/** recruit, owner, ap 2/2, hp 10/10, ammo 3/3, stats 0x0102, three actions: Move, Attack, Reload. */
const UNIT_HEAD =
    "11".repeat(32) +
    "22".repeat(32) +
    "02000200" +
    "0a000a00" +
    "03000300" +
    "0201" +
    "00".repeat(14) +
    "03" +
    MOVE +
    ATTACK +
    RELOAD;

const unit = (effects: number[], actions: unknown[] = []) =>
    ({
        recruit: addr("11"),
        owner: addr("22"),
        ap: { value: 2, maxValue: 2 },
        hp: { value: 10, maxValue: 10 },
        ammo: { value: 3, maxValue: 3 },
        stats: { value: "258" },
        actions: actions.length
            ? actions
            : [
                  { uses: null, kind: { Move: true } },
                  { uses: null, kind: { Attack: true } },
                  { uses: null, kind: { Reload: true } },
              ],
        effects,
    }) as never;

test("a unit with no effects ends in a zero length byte, 100 bytes in all", () => {
    const bytes = MapUnit.serialize(unit([])).toBytes();
    assert.equal(hex(bytes), UNIT_HEAD + "00");
    assert.equal(bytes.length, 100);
    assert.deepEqual(MapUnit.parse(bytes).effects, []);
});

test("one effect is one byte, kind in the high nibble and turns in the low", () => {
    // a fresh daze: kind 0, 2 turns
    const daze = MapUnit.serialize(unit([0x02])).toBytes();
    assert.equal(hex(daze), UNIT_HEAD + "01" + "02");
    assert.equal(daze.length, 101);
    // a fresh smoke: kind 1, 2 turns
    const smoke = MapUnit.serialize(unit([0x12])).toBytes();
    assert.equal(hex(smoke), UNIT_HEAD + "01" + "12");
    assert.deepEqual(MapUnit.parse(smoke).effects, [0x12]);
});

test("two effects keep the order they landed in", () => {
    const bytes = MapUnit.serialize(unit([0x12, 0x01])).toBytes();
    assert.equal(hex(bytes), UNIT_HEAD + "02" + "12" + "01");
    assert.equal(bytes.length, 102);
    assert.deepEqual(MapUnit.parse(bytes).effects, [0x12, 0x01]);
});

test("an effect byte reads back as its kind and turns", () => {
    assert.equal(effectKind(0x12), EFFECT_KINDS.smoke);
    assert.equal(effectTurns(0x12), 2);
    assert.equal(effectKind(0x01), EFFECT_KINDS.daze);
    assert.equal(effectTurns(0x01), 1);
    assert.equal(effectByte(EFFECT_KINDS.smoke, 2), 0x12);
    assert.equal(effectName(0x02), "daze");
    assert.equal(effectName(0x12), "smoke");
    assert.equal(effectName(0x52), undefined, "a kind this client doesn't know");
});

// === Action kinds 4 and 5, utility kinds ===

test("action tags 4 and 5 are the flashbang and the smoke grenade, 6 on stays unknown", () => {
    // Action { uses: Some(1), kind } = 01 01 <tag>
    const tags: Record<number, string> = {
        3: "Grenade",
        4: "Flashbang",
        5: "SmokeGrenade",
        6: "Unknown6",
    };
    for (const [tag, kind] of Object.entries(tags)) {
        const bytes = Uint8Array.from(
            Buffer.from(`0101${Number(tag).toString(16).padStart(2, "0")}`, "hex"),
        );
        const utility = Utility.parse(
            Uint8Array.from([
                ...Buffer.from("33".repeat(32), "hex"),
                0, // name: ""
                ...Buffer.alloc(16),
                1, // one action
                ...bytes,
            ]),
        );
        assert.equal(utility.actions[0].kind.$kind, kind);
        assert.equal(utility.actions[0].uses, 1);
    }
});

test("a flashbang and a smoke grenade unit carry their action, once", () => {
    const flash = unit([], [{ uses: 1, kind: { Flashbang: true } }]);
    const smoke = unit([], [{ uses: 1, kind: { SmokeGrenade: true } }]);
    // length 1, then Some(1) and the tag
    assert.equal(hex(MapUnit.serialize(flash).toBytes()).slice(-10), "01" + "0101" + "04" + "00");
    assert.equal(hex(MapUnit.serialize(smoke).toBytes()).slice(-10), "01" + "0101" + "05" + "00");
});

// === Records 12 to 15 ===

const records = (...parts: string[]): History => {
    // history is a vector<Record>: ULEB length, then the records
    const bytes = Buffer.from(parts.length.toString(16).padStart(2, "0") + parts.join(""), "hex");
    return History.parse(Uint8Array.from(bytes));
};

test("records 12 to 15 decode, and 0 to 11 keep their tags", () => {
    const [flash, smoke, start, end, dodged, grenade, kia] = records(
        // Flashbang { origin [1, 2], target [3, 4] }
        "0c" + "02" + u16(1) + u16(2) + "02" + u16(3) + u16(4),
        // SmokeGrenade { origin [4, 3], target [2, 1] }
        "0d" + "02" + u16(4) + u16(3) + "02" + u16(2) + u16(1),
        // EffectStart (x 3, y 4, a fresh daze)
        "0e" + u16(3) + u16(4) + "02",
        // EffectEnd (x 3, y 4, kind smoke)
        "0f" + u16(3) + u16(4) + "01",
        "0b", // Dodged is still 11
        "09" + "02" + u16(0) + u16(0) + "02" + u16(1) + u16(1), // Grenade is still 9
        "0a" + "44".repeat(32) + u16(5) + u16(6), // UnitKIA is still 10
    );
    assert.equal(flash.$kind, "Flashbang");
    assert.deepEqual(flash.$kind === "Flashbang" && flash.Flashbang, {
        origin: [1, 2],
        target: [3, 4],
    });
    assert.equal(smoke.$kind, "SmokeGrenade");
    assert.deepEqual(smoke.$kind === "SmokeGrenade" && smoke.SmokeGrenade, {
        origin: [4, 3],
        target: [2, 1],
    });
    assert.equal(start.$kind, "EffectStart");
    assert.deepEqual(start.$kind === "EffectStart" && start.EffectStart, [3, 4, 0x02]);
    assert.equal(end.$kind, "EffectEnd");
    assert.deepEqual(end.$kind === "EffectEnd" && end.EffectEnd, [3, 4, EFFECT_KINDS.smoke]);
    assert.equal(dodged.$kind, "Dodged");
    assert.equal(grenade.$kind, "Grenade");
    assert.equal(kia.$kind, "UnitKIA");
});

test("the records encode to the bytes the contract writes", () => {
    const encode = (record: unknown) => hex(History.serialize([record as never]).toBytes());
    assert.equal(
        encode({ $kind: "Flashbang", Flashbang: { origin: [1, 2], target: [3, 4] } }),
        "01" + "0c" + "02" + u16(1) + u16(2) + "02" + u16(3) + u16(4),
    );
    assert.equal(
        encode({ $kind: "EffectStart", EffectStart: [3, 4, 0x12] }),
        "01" + "0e" + u16(3) + u16(4) + "12",
    );
    assert.equal(
        encode({ $kind: "EffectEnd", EffectEnd: [3, 4, 0] }),
        "01" + "0f" + u16(3) + u16(4) + "00",
    );
});

// === Map.units ===

test("Map ends in the fallen units, then the tiles holding a unit", () => {
    // a 1 x 2 grid: an empty tile, and a tile with a dazed unit on it
    const tiles = [
        [
            { tileType: { Empty: true, $kind: "Empty" }, unit: null },
            { tileType: { Empty: true, $kind: "Empty" }, unit: unit([0x02]) },
        ],
    ];
    const bytes = GameMap.serialize({
        id: addr("55"),
        grid: { grid: tiles, rows: 1, cols: 2 },
        fallen: [],
        units: [1],
    } as never).toBytes();
    const expected =
        "55".repeat(32) +
        "01" + // one row
        "02" + // two tiles
        "00" +
        "00" + // Empty, no unit
        "00" +
        "01" +
        UNIT_HEAD +
        "01" +
        "02" + // Empty, Some(unit with one effect)
        u16(1) +
        u16(2) + // rows, cols
        "00" + // fallen: none
        "01" +
        u16(1); // units: [1]
    assert.equal(hex(bytes), expected);
    const back = GameMap.parse(bytes);
    assert.deepEqual(back.units, [1]);
    assert.deepEqual(back.grid.grid[0][1].unit?.effects, [0x02]);
});

// === The rules the app mirrors ===

test("effective stats: daze zeroes the aim, smoke takes 30 off it and adds 30 defense", () => {
    const base = { aim: 65, defense: 10, range: 4 };
    assert.deepEqual(effectiveStats(base, []), base);
    assert.deepEqual(effectiveStats(base, [0x02]), { aim: 0, defense: 10, range: 4 });
    assert.deepEqual(effectiveStats(base, [0x12]), { aim: 35, defense: 40, range: 4 });
    // smoke floors the aim at 0, and either order of the two gives aim 0 and +30 defense
    assert.equal(effectiveStats({ aim: 20, defense: 0 }, [0x12]).aim, 0);
    assert.deepEqual(effectiveStats(base, [0x02, 0x12]), { aim: 0, defense: 40, range: 4 });
    assert.deepEqual(effectiveStats(base, [0x12, 0x02]), { aim: 0, defense: 40, range: 4 });
    // modified stats are capped at 127
    assert.equal(effectiveStats({ aim: 0, defense: 120 }, [0x12]).defense, 127);
});

test("hit chance with effects: 65, then 35 in smoke, 0 dazed, 10 close up, 65 after", () => {
    const shot = (aim: number, defense: number, distance: number) =>
        hitChance({ aim, range: 4, areaSize: 0 }, defense, distance, 0);
    const shooter = { aim: 65, defense: 0 };
    assert.equal(shot(65, 0, 4), 65);
    // the target stands in smoke: defense +30
    assert.equal(shot(65, effectiveStats({ aim: 0, defense: 0 }, [0x12]).defense, 4), 35);
    // the shooter stands in smoke: aim -30
    assert.equal(shot(effectiveStats(shooter, [0x12]).aim, 0, 4), 35);
    // the shooter is dazed: aim 0, and no floor on the chance
    const dazed = effectiveStats(shooter, [0x02]).aim;
    assert.equal(shot(dazed, 0, 4), 0);
    assert.equal(shot(dazed, 0, 5), 0, "past the range it is 0");
    assert.equal(shot(dazed, 0, 2), 10, "the distance bonus still applies: 5 for each tile closer");
    // after the daze ends the shooter is back to 65
    assert.equal(
        shot(effectiveStats(shooter, tickEffects(tickEffects([0x02]).effects).effects).aim, 0, 4),
        65,
    );
    // an area weapon ignores defense, so smoke does not shield from it
    assert.equal(hitChance({ aim: 65, range: 4, areaSize: 1 }, 30, 4, 0), 65);
    // defense and cover together cap at 100
    assert.equal(hitChance({ aim: 100, range: 4, areaSize: 0 }, 90, 4, 25), 0);
});

test("a refresh keeps the larger turns in place, a new kind goes last", () => {
    assert.deepEqual(withEffect([], 0x02), [0x02]);
    assert.deepEqual(withEffect([0x01, 0x12], 0x02), [0x02, 0x12]);
    assert.deepEqual(withEffect([0x02, 0x12], 0x01), [0x02, 0x12], "never shortens");
    assert.deepEqual(withEffect([0x02], 0x12), [0x02, 0x12]);
});

test("a turn change takes one turn off each effect and ends the ones at zero, in list order", () => {
    assert.deepEqual(tickEffects([0x02, 0x12]), { effects: [0x01, 0x11], ended: [] });
    assert.deepEqual(tickEffects([0x01, 0x11]), { effects: [], ended: [0, 1] });
    assert.deepEqual(tickEffects([0x12, 0x01]), { effects: [0x11], ended: [0] });
    assert.deepEqual(tickEffects([]), { effects: [], ended: [] });
});

// A 7 x 7 open ground with units where `at` puts them (row, col), walls where `walls` puts them.
function ground(at: [number, number][], walls: [number, number][] = []) {
    const grid = Array.from({ length: 7 }, (_, row) =>
        Array.from({ length: 7 }, (_, col) => ({
            tileType: walls.some(([r, c]) => r === row && c === col)
                ? { $kind: "Wall", Wall: true }
                : { $kind: "Empty", Empty: true },
            unit: at.some(([r, c]) => r === row && c === col) ? unit([]) : null,
        })),
    );
    return { map: { grid: { grid, rows: 7, cols: 7 } } } as never;
}

test("a throw reaches 5 tiles, from a tile with a unit, not onto or over a wall", () => {
    const game = ground([[3, 0]], [[3, 4]]);
    assert.ok(throwValid(game, [3, 0], [3, 3]));
    assert.ok(throwValid(game, [3, 0], [0, 2]), "Manhattan 5");
    assert.ok(!throwValid(game, [3, 0], [0, 3]), "Manhattan 6");
    assert.ok(!throwValid(game, [3, 0], [3, 4]), "onto a wall");
    assert.ok(!throwValid(game, [3, 0], [3, 5]), "over a wall");
    assert.ok(!throwValid(game, [2, 2], [2, 3]), "nobody on the tile it throws from");
});

test("the burst is every unit within 2 tiles of the target, either side, in tile order", () => {
    // thrower at (3,0); (2,3) and (3,3) are in the burst of (3,3), as are (1,3) and (3,5) at 2 tiles,
    // (4,4) and (4,2) at 2; (0,3) is 3 away, (5,4) is 3 away
    const game = ground([
        [3, 0],
        [0, 3],
        [1, 3],
        [2, 3],
        [3, 3],
        [3, 5],
        [4, 4],
        [5, 4],
    ]);
    assert.deepEqual(
        burstOf(game, [3, 3]).map(({ row, col }) => [row, col]),
        [
            [1, 3],
            [2, 3],
            [3, 3],
            [3, 5],
            [4, 4],
        ],
    );
    // the thrower counts too: a burst on its own tile names it
    assert.deepEqual(
        burstOf(game, [3, 1]).map(({ row, col }) => [row, col]),
        [
            [3, 0],
            [3, 3],
        ],
    );
    assert.deepEqual(burstOf(game, [6, 0]), []);
});

test("a unit has a grenade's action only when it carries it, and spends its one use", () => {
    const actions = (kind: string, uses: number | null) =>
        [
            { uses: null, kind: { $kind: "Move" } },
            { uses, kind: { $kind: kind } },
        ] as never;
    const game = (kind: string, uses: number) =>
        ({
            map: {
                grid: {
                    grid: [
                        [
                            {
                                tileType: { $kind: "Empty" },
                                unit: { recruit: "r", actions: actions(kind, uses) },
                            },
                        ],
                    ],
                },
            },
        }) as never;
    for (const kind of ["Flashbang", "SmokeGrenade", "Grenade"] as UnitAction[])
        for (const other of ["Flashbang", "SmokeGrenade", "Grenade"] as UnitAction[])
            assert.equal(canDo(game(kind, 1), "r", other), kind === other, `${kind} / ${other}`);
    const spent = actions("Flashbang", 0) as never as Parameters<
        typeof hasUsesLeft
    >[0]["actions"][number][];
    assert.ok(!hasUsesLeft({ actions: spent }, "Flashbang"));
    assert.ok(hasUsesLeft({ actions: actions("SmokeGrenade", 1) as never }, "SmokeGrenade"));
    assert.deepEqual(unitActions(actions("SmokeGrenade", 1) as never), [
        { kind: "Move", uses: null },
        { kind: "SmokeGrenade", uses: 1 },
    ]);
});

test("effects go to the engine by catalog id and come back as bytes", () => {
    assert.deepEqual(effectsOf([0x12, 0x01]), [
        { kind: "Smoke", turns: 2 },
        { kind: "Daze", turns: 1 },
    ]);
    assert.deepEqual(
        effectsOf([0x52]),
        [{ kind: "#5", turns: 2 }],
        "a kind this client doesn't know",
    );
    assert.deepEqual(
        effectBytes([
            { kind: "Smoke", turns: 2 },
            { kind: "Daze", turns: 0 },
            { kind: "#5", turns: 2 },
            { kind: "Daze", turns: 1 },
        ]),
        [0x12, 0x01],
        "spent and unknown ones are left out",
    );
});
