// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { stats, unpack } from "@ghosts/squad/stats";

import {
    baseFromTotal,
    modifierParts,
    negate,
    signed,
    weaponProfile,
    withoutModifiers,
} from "../src/features/headquarters/fittings.ts";

const SLOTS = ["clip", "stock", "optic"] as const;
const rifle = stats({ damage: 4, critChance: 10, range: 4, ammo: 3 });
const clip = { slot: "clip", name: "Clip", modifier: stats({ ammo: 2 }) } as const;
const stock = { slot: "stock", name: "Stock", modifier: stats({ range: 2, aim: -5 }) } as const;
const optic = { slot: "optic", name: "Optic", modifier: stats({ aim: 10 }) } as const;
const optic2 = { slot: "optic", name: "Optic II", modifier: stats({ aim: 15 }) } as const;

test("no upgrades: now and next are the base", () => {
    const p = weaponProfile({ base: rifle, fitted: [], draft: [], slots: SLOTS });
    assert.deepEqual(p.now, rifle);
    assert.deepEqual(p.next, rifle);
    assert.equal(p.lines.length, 0);
});

test("fitted upgrades add to the base and keep their state", () => {
    const fitted = [clip, stock, optic];
    const p = weaponProfile({ base: rifle, fitted, draft: fitted, slots: SLOTS });
    assert.equal(p.now.ammo, 5);
    assert.equal(p.now.range, 6);
    // applied in slot order, as the chain does: −5 floors the weapon's 0 aim, then +10
    assert.equal(p.now.aim, 10);
    assert.deepEqual(p.next, p.now);
    assert.deepEqual(
        p.lines.map((l) => l.state),
        ["fitted", "fitted", "fitted"],
    );
});

test("a draft replacing an upgrade lists the removal beside the new fitting", () => {
    const p = weaponProfile({
        base: rifle,
        fitted: [clip, optic],
        draft: [clip, optic2],
        slots: SLOTS,
    });
    assert.equal(p.now.aim, 10);
    assert.equal(p.next.aim, 15);
    assert.deepEqual(
        p.lines.map((l) => [l.name, l.state]),
        [
            ["Clip", "fitted"],
            ["Optic", "removed"],
            ["Optic II", "drafted"],
        ],
    );
});

test("dropping an upgrade from the draft is a removal", () => {
    const p = weaponProfile({ base: rifle, fitted: [clip], draft: [], slots: SLOTS });
    assert.equal(p.next.ammo, 3);
    assert.equal(p.lines[0].state, "removed");
});

test("an upgrade the catalog does not know stays fitted in the draft", () => {
    const odd = { slot: null, name: "Odd", modifier: stats({ range: 1 }) };
    const p = weaponProfile({ base: rifle, fitted: [odd], draft: [], slots: SLOTS });
    assert.equal(p.next.range, 5);
    assert.equal(p.lines[0].state, "fitted");
});

test("negative modifiers are nerfs", () => {
    const p = weaponProfile({ base: rifle, fitted: [stock], draft: [stock], slots: SLOTS });
    assert.equal(p.now.aim, 0, "aim floors at zero");
    const heavy = unpack(0x80n + 1n);
    assert.equal(heavy.mobility, -1);
    assert.deepEqual(
        modifierParts(stock.modifier).map((m) => [m.label, m.text, m.sign]),
        [
            ["Aim", "−5%", -1],
            ["Range", "+2", 1],
        ],
    );
    assert.equal(signed(-1), "−1");
    assert.equal(signed(10, "%"), "+10%");
});

test("the base is the chain total with the fitted modifiers taken off", () => {
    const total = weaponProfile({
        base: rifle,
        fitted: [clip, optic],
        draft: [],
        slots: SLOTS,
    }).now;
    assert.deepEqual(withoutModifiers(total, [clip.modifier, optic.modifier]), rifle);
    assert.equal(negate(stats({ aim: 5, range: -2 })).aim, -5);
    assert.equal(negate(stats({ aim: 5, range: -2 })).range, 2);
});

test("a floored stat takes the preset base when it explains the total", () => {
    const mods = [stock.modifier, optic.modifier];
    const total = weaponProfile({
        base: rifle,
        fitted: [stock, optic],
        draft: [],
        slots: SLOTS,
    }).now;
    assert.equal(total.aim, 10);
    // taking the modifiers off cannot tell the floored −5 from a missing 5
    assert.equal(baseFromTotal(total, mods).aim, 5);
    assert.deepEqual(baseFromTotal(total, mods, rifle), rifle);
    // a preset that does not reproduce the total is ignored
    assert.deepEqual(
        baseFromTotal(total, mods, stats({ damage: 9 })),
        withoutModifiers(total, mods),
    );
});
