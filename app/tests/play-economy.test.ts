// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldStats } from "../../packages/squad/src/stats.ts";
import {
    allItems,
    budgetOf,
    defaultSquad,
    fieldUnit,
    itemOf,
    itemsFor,
    kitOf,
    matchRating,
    PRESETS,
    presetsFor,
    priceOf,
    PRICES,
    squadPrice,
    squadSize,
    tierOf,
    TIERS,
    unitStats,
    validateSquad,
    type Loadout,
    type Mode,
} from "../src/features/play/economy/index.ts";
import catalog from "../../packages/catalog/items.json" with { type: "json" };

const MODES: Mode[] = ["3x3", "4x4"];
const DEFAULT_RATING = 1500;
const preset = (id: string): Loadout => ({ ...PRESETS.find((p) => p.id === id)!.loadout });

test("tiers cover every rating without gaps, budgets grow with the rating", () => {
    assert.equal(TIERS[0].min, 0);
    assert.equal(TIERS.at(-1)!.max, null);
    for (let i = 1; i < TIERS.length; i++) {
        assert.equal(TIERS[i].min, TIERS[i - 1].max, `${TIERS[i].id} starts where the last ends`);
        for (const mode of MODES)
            assert.ok(TIERS[i].budget[mode] > TIERS[i - 1].budget[mode], `${TIERS[i].id} ${mode}`);
        for (const id of TIERS[i - 1].items) assert.ok(TIERS[i].items.includes(id), "unlocks stay");
    }
    for (const rating of [-50, 0, 1399, 1400, 1500, 1649, 1650, 1900, 3000])
        assert.ok(tierOf(rating), String(rating));
    assert.equal(tierOf(-50).id, TIERS[0].id, "below every band is the lowest tier");
    assert.equal(tierOf(5000).id, TIERS.at(-1)!.id);
});

test("the default rating lands in a simple tier, the one below is simpler still", () => {
    const tier = tierOf(DEFAULT_RATING);
    assert.equal(tier.id, "contractor");
    assert.ok(!tier.items.includes("rifle-3") && !tier.items.includes("armor-3"));
    const below = tierOf(DEFAULT_RATING - 200);
    assert.ok(below.items.length < tier.items.length);
    assert.deepEqual(
        presetsFor(DEFAULT_RATING - 200).map((p) => p.id),
        ["recruit", "runner", "assault"],
    );
    assert.equal(budgetOf(DEFAULT_RATING, "3x3"), tier.budget["3x3"]);
    assert.equal(matchRating(1450, 1720), 1450);
});

test("every ranked item is a chain item from the catalog, priced", () => {
    for (const item of allItems()) {
        const entry = catalog.items.find((i) => i.id === item.id);
        assert.ok(entry, item.id);
        assert.equal(entry.status, "chain", `${item.id} exists on chain`);
        assert.equal(item.name, entry.name);
        assert.ok(item.price > 0 && item.price === PRICES[item.id]);
        assert.ok(TIERS.some((t) => t.id === item.tier && t.unlocks.includes(item.id)));
    }
    assert.equal(itemOf("sidearm"), undefined, "no frontend-only items");
    assert.equal(itemOf("scope-1"), undefined, "no mods in version one");
    for (const slot of ["weapon", "armor", "utility"] as const)
        for (const item of itemsFor(1500, slot)) assert.equal(item.slot, slot);
});

test("presets: priced as the sum of their items, swaps declared", () => {
    for (const p of PRESETS) {
        const { weapon, armor, utility } = p.loadout;
        assert.equal(
            priceOf(p.loadout),
            PRICES[weapon] + PRICES[armor] + (utility ? PRICES[utility] : 0),
        );
        assert.equal(p.loadout.preset, p.id);
        assert.ok(p.swaps.length > 0 && p.role.length > 0);
    }
    for (const id of ["assault", "runner", "heavy", "sniper"])
        assert.ok(
            PRESETS.some((p) => p.id === id),
            id,
        );
});

test("the default squad is legal at every tier and mode", () => {
    for (const tier of TIERS)
        for (const rating of [tier.min, tier.max === null ? tier.min + 500 : tier.max - 1])
            for (const mode of MODES) {
                const squad = defaultSquad(rating, mode);
                assert.equal(squad.length, squadSize(mode));
                assert.deepEqual(validateSquad(squad, rating, mode), [], `${tier.id} ${mode}`);
            }
    assert.deepEqual(validateSquad(defaultSquad(-10, "3x3"), -10, "3x3"), []);
});

test("validateSquad names each problem", () => {
    const squad = [preset("heavy"), preset("recruit")];
    const issues = validateSquad(squad, DEFAULT_RATING, "3x3");
    assert.ok(issues.some((i) => i.kind === "size"));
    const locked = issues.filter((i) => i.kind === "locked");
    assert.deepEqual(
        locked.map((i) => [i.unit, i.slot, i.item]),
        [
            [0, "weapon", "rifle-3"],
            [0, "armor", "armor-3"],
        ],
    );

    const rich = Array.from({ length: 3 }, () => preset("heavy"));
    const over = validateSquad(rich, 2500, "3x3");
    assert.deepEqual(
        over.map((i) => i.kind),
        squadPrice(rich) > budgetOf(2500, "3x3") ? ["over-budget"] : [],
    );

    const wrong: Loadout[] = [
        { ...preset("recruit"), weapon: "armor-1" },
        { ...preset("recruit"), utility: "sidearm" },
        { ...preset("recruit"), preset: "nobody" },
    ];
    const illegal = validateSquad(wrong, DEFAULT_RATING, "3x3").filter((i) => i.kind === "illegal");
    assert.deepEqual(
        illegal.map((i) => [i.unit, i.slot]),
        [
            [0, "weapon"],
            [1, "utility"],
            [2, undefined],
        ],
    );
});

test("unit stats are the chain's: fieldStats of the matching squad items", () => {
    for (const p of PRESETS) {
        const kit = kitOf(p.loadout);
        const s = fieldStats({
            equipment: {
                primary: kit.primary,
                sidearm: null,
                armor: kit.armor,
                utility: kit.utility,
            },
            attachments: {},
        });
        const u = unitStats(p.loadout);
        assert.equal(u.hp, s.health);
        assert.equal(u.armor, s.armor);
        assert.equal(u.mobility, s.mobility);
        assert.equal(u.aim, s.aim);
        assert.equal(u.range, s.range);
        assert.equal(u.grenades, p.loadout.utility === "frag-grenade" ? 1 : 0);
    }
    // written from `items.move` and `stats::default()`: heavy armor and the plasma rifle
    const heavy = unitStats(preset("heavy"));
    assert.deepEqual(
        [
            heavy.hp,
            heavy.armor,
            heavy.mobility,
            heavy.aim,
            heavy.dodge,
            heavy.range,
            heavy.critChance,
        ],
        [11, 3, 6, 65, 0, 5, 30],
    );
    assert.deepEqual(unitStats(preset("recruit")).damage, [2, 7]);
    assert.deepEqual(
        fieldUnit(preset("runner")).actions.map((a) => a.kind),
        ["Move", "Attack", "Reload", "Grenade"],
    );
    assert.deepEqual(kitOf(preset("assault")), {
        primary: "mx4",
        armor: "nyx-mid",
        utility: "frag",
    });
});
