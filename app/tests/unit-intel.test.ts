// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { Encounter } from "../../packages/engine/src/game.ts";
import { baseIntel } from "../../packages/engine/src/intel.ts";
import { pack, stats } from "../../packages/squad/src/stats.ts";
import { chainUnitIntel, opponentIntel } from "../src/chain/intel.ts";

// Shaped like the BCS-decoded `Recruit` in `Game.recruits` and a map `Unit`; names and ids are made up.
const kind = <K extends string>($kind: K) => ({ $kind, [$kind]: true }) as { $kind: K };
const recruit = {
    metadata: { name: "Test Subject Alpha", visuals: {}, voice: 0 },
    rank: kind("Sergeant"),
    weapon: {
        id: "0x1",
        name: "Standard Rifle",
        stats: { value: "0" },
        upgrades: [
            { id: "0x2", name: "Red Dot Scope", kind: 0, tier: 1, modifier: { value: "0" } },
            { id: "0x3", name: "Extended Clip", kind: 3, tier: 2, modifier: { value: "0" } },
        ],
    },
    armor: { id: "0x4", name: "Medium Armor", stats: { value: "0" } },
    utilities: [
        {
            id: "0x5",
            name: "Frag Grenade",
            stats: { value: "0" },
            actions: [{ uses: 2, kind: kind("Grenade") }],
        },
    ],
} as unknown as Parameters<typeof chainUnitIntel>[1];

const mapUnit = (grenadeUses: number, armed = true, effects: number[] = []) =>
    ({
        recruit: "0xr",
        owner: "0xa",
        ap: { value: 2, maxValue: 2 },
        hp: { value: 8, maxValue: 10 },
        ammo: { value: 3, maxValue: 4 },
        stats: {
            value: pack(
                stats({
                    mobility: 6,
                    aim: 70,
                    health: 10,
                    armor: 2,
                    dodge: 5,
                    defense: 10,
                    damage: 4,
                    spread: 2,
                    plusOne: 10,
                    critChance: 10,
                    range: 4,
                    ammo: 4,
                }),
            ).toString(),
        },
        actions: [
            { uses: null, kind: kind("Move") },
            ...(armed
                ? [
                      { uses: null, kind: kind("Attack") },
                      { uses: null, kind: kind("Reload") },
                  ]
                : []),
            { uses: grenadeUses, kind: kind("Grenade") },
        ],
        effects,
    }) as unknown as Parameters<typeof chainUnitIntel>[2];

const intelOf = (effects: number[]) =>
    chainUnitIntel(base(), recruit, mapUnit(1, true, effects)).stats;

const base = () => {
    const game = new Encounter();
    return baseIntel(game, game.enemies[0]);
};

test("chain intel: name, rank, weapon with its mods, armor, utility uses and the contract's stats", () => {
    const intel = chainUnitIntel(base(), recruit, mapUnit(1));
    assert.equal(intel.name, "Test Subject Alpha");
    assert.deepEqual(intel.rank, { name: "Sergeant", index: 3 });
    assert.deepEqual(intel.weapon, {
        name: "Standard Rifle",
        mods: [
            { kind: "scope", name: "Red Dot Scope", tier: 1 },
            { kind: "clip", name: "Extended Clip", tier: 2 },
        ],
    });
    assert.deepEqual(intel.armor, { name: "Medium Armor" });
    assert.deepEqual(intel.utility, { name: "Frag Grenade", uses: 1, max: 2 });
    assert.deepEqual(intel.stats, {
        aim: 70,
        damage: [2, 7],
        range: 4,
        mobility: 6,
        dodge: 5,
        defense: 10,
        critChance: 10,
    });
});

test("chain intel: a thrown grenade reads spent, an unarmed unit unarmed, a missing recruit keeps the engine's", () => {
    assert.equal(chainUnitIntel(base(), recruit, mapUnit(0)).utility?.uses, 0);
    assert.equal(chainUnitIntel(base(), recruit, mapUnit(1, false)).weapon, null);
    const unread = chainUnitIntel(base(), undefined, mapUnit(1));
    assert.equal(unread.name, base().name);
    assert.equal(unread.stats.dodge, 5);
    const noWeapon = { ...recruit, weapon: null, utilities: [] } as unknown as typeof recruit;
    const intel = chainUnitIntel(base(), noWeapon, mapUnit(0, false));
    assert.equal(intel.weapon, null);
    assert.equal(intel.utility, null);
});

test("chain intel: aim and defense are the unit's effective ones, base stats untouched on chain", () => {
    // base aim 70, defense 10
    assert.deepEqual([intelOf([]).aim, intelOf([]).defense], [70, 10]);
    assert.deepEqual([intelOf([0x02]).aim, intelOf([0x02]).defense], [0, 10], "dazed: aim 0");
    assert.deepEqual(
        [intelOf([0x12]).aim, intelOf([0x12]).defense],
        [40, 40],
        "smoke: -30 aim, +30 defense",
    );
    assert.deepEqual([intelOf([0x12, 0x02]).aim, intelOf([0x12, 0x02]).defense], [0, 40]);
    // the dodge too: a daze takes it to 0 (`DAZE_MODIFIER`), smoke leaves it
    assert.equal(intelOf([0x12]).dodge, 5);
    assert.equal(intelOf([0x02]).dodge, 0, "dazed: dodge 0");
    assert.deepEqual(
        [intelOf([0x12, 0x02]).aim, intelOf([0x12, 0x02]).dodge, intelOf([0x12, 0x02]).defense],
        [0, 0, 40],
        "dazed in smoke: aim 0, dodge 0, defense +30",
    );
});

test("chain intel: a smoke grenade or a flashbang carrier reads its own utility and uses", () => {
    for (const [name, action] of [
        ["Smoke Grenade", "SmokeGrenade"],
        ["Flashbang", "Flashbang"],
    ]) {
        const carrier = {
            ...recruit,
            utilities: [
                {
                    id: "0x6",
                    name,
                    stats: { value: "0" },
                    actions: [{ uses: 1, kind: kind(action) }],
                },
            ],
        } as unknown as typeof recruit;
        const unit = {
            ...(mapUnit(1) as object),
            actions: [
                { uses: null, kind: kind("Move") },
                { uses: 1, kind: kind(action) },
            ],
        } as unknown as Parameters<typeof chainUnitIntel>[2];
        assert.deepEqual(chainUnitIntel(base(), carrier, unit).utility, { name, uses: 1, max: 1 });
        const spent = {
            ...(unit as object),
            actions: [
                { uses: null, kind: kind("Move") },
                { uses: 0, kind: kind(action) },
            ],
        } as unknown as Parameters<typeof chainUnitIntel>[2];
        assert.equal(chainUnitIntel(base(), carrier, spent).utility?.uses, 0, name);
    }
});

test("the opponent's line: assigned name, rating and record from the Account", () => {
    const account = {
        rating: { rating: 1523n, deviation: 87n, games: 9n, lastPlayedMs: 0n },
        score: { wins: 5n, losses: 3n, draws: 1n },
    } as unknown as Parameters<typeof opponentIntel>[0];
    assert.deepEqual(opponentIntel(account, "commander-test"), {
        name: "commander-test",
        rating: 1523,
        deviation: 87,
        record: { wins: 5, losses: 3, draws: 1 },
    });
    assert.equal(opponentIntel(account, undefined).name, null);
});
