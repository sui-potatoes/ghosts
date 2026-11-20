// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The three grenades are real items everywhere: the catalog, the contract's utility
 * kinds, the Armory's requisition list and loadout slot, the squad catalog and the
 * play modes' economy. The flashbang and the smoke grenade follow the frag grenade's
 * shape, with their own utility kind and their own action.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EQUIPMENT, INITIAL_STOCK, itemById } from "../../packages/squad/src/catalog.ts";
import actions from "../../packages/catalog/actions.json" with { type: "json" };
import catalog from "../../packages/catalog/items.json" with { type: "json" };
import effects from "../../packages/catalog/effects.json" with { type: "json" };
import {
    allItems,
    fieldUnit,
    itemOf,
    itemsFor,
    kitOf,
    PRESETS,
    PRICES,
    squadPrice,
    TIERS,
    unitStats,
    validateSquad,
    type Loadout,
} from "../src/features/play/economy/index.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Catalog id, utility kind, action, squad catalog id and stage model of each grenade. */
const GRENADES = [
    { id: "frag-grenade", kind: 0, action: "Grenade", client: "frag", model: "grenade" },
    { id: "flashbang", kind: 1, action: "Flashbang", client: "flash", model: "flash" },
    { id: "smoke-grenade", kind: 2, action: "SmokeGrenade", client: "smoke", model: "smoke" },
] as const;

const item = (id: string) => catalog.items.find((i) => i.id === id) as Record<string, unknown>;

test("the catalog lists the three as chain utilities, shaped alike, one action each", () => {
    const frag = item("frag-grenade");
    for (const g of GRENADES) {
        const entry = item(g.id);
        assert.ok(entry, g.id);
        assert.equal(entry.type, "utility");
        assert.equal(entry.status, "chain");
        assert.equal(entry.kind, g.kind);
        assert.deepEqual(entry.stats, {});
        assert.deepEqual(entry.actions, [{ kind: g.action, uses: 1 }]);
        assert.deepEqual(entry.chain, {
            requisition: "requisition_utility",
            args: { kind: g.kind },
            equip: "equip_utility",
        });
        assert.deepEqual(entry.clientIds, [g.client]);
        assert.deepEqual(
            Object.keys(entry).sort(),
            Object.keys(frag).sort(),
            `${g.id} has the frag's fields`,
        );
    }
    const names = GRENADES.map((g) => item(g.id).name);
    assert.deepEqual(names, ["Frag Grenade", "Flashbang", "Smoke Grenade"]);
});

test("each grenade has its own action: tag, throw function, records", () => {
    const byId = (id: string) => actions.actions.find((a) => a.id === id)!;
    assert.deepEqual(
        [byId("Grenade").tag, byId("Flashbang").tag, byId("SmokeGrenade").tag],
        [3, 4, 5],
    );
    assert.deepEqual(
        [byId("Grenade").chain, byId("Flashbang").chain, byId("SmokeGrenade").chain],
        ["perform_grenade", "perform_flashbang", "perform_smoke_grenade"],
    );
    for (const id of ["Grenade", "Flashbang", "SmokeGrenade"]) {
        const a = byId(id);
        assert.equal(a.status, "chain");
        assert.equal(a.source, "utility");
        assert.equal(a.ap, 1);
        assert.equal(a.uses, 1);
        assert.equal(a.endsActivation, false);
    }
    assert.deepEqual(byId("Flashbang").records, ["Flashbang", "EffectStart"]);
    assert.deepEqual(byId("SmokeGrenade").records, ["SmokeGrenade", "EffectStart"]);
});

test("the effects, with their numbers labelled, match the contract", () => {
    const [daze, smoke] = effects.effects;
    assert.deepEqual([daze.id, daze.kind, daze.turns], ["Daze", 0, 2]);
    assert.deepEqual([smoke.id, smoke.kind, smoke.turns], ["Smoke", 1, 2]);
    assert.deepEqual(smoke.stats, { aim: -30, defense: 30 });
    assert.deepEqual(daze.stats, { aim: "0", dodge: "0" });
    // the descriptions state the numbers and the duration, for the same range and radius
    assert.match(
        item("flashbang").description as string,
        /5 tiles.*2 tiles.*aim 0.*this turn and the enemy's turn/s,
    );
    assert.match(
        item("smoke-grenade").description as string,
        /5 tiles.*2 tiles.*\+30 defense and −30 aim.*this turn and the enemy's turn/s,
    );
    for (const text of [
        ...effects.effects.map((e) => e.description),
        ...GRENADES.map((g) => item(g.id).description as string),
        ...actions.actions
            .filter((a) => /Flashbang|SmokeGrenade/.test(a.id))
            .map((a) => a.description),
    ])
        assert.doesNotMatch(text, /preview|coming soon|not yet|mock|for now|sorry|later|planned/i);
});

test("the tx builder knows the three kinds, the Armory orders them, the loadout names them", () => {
    assert.match(
        read("../src/chain/ghosts.ts"),
        /UTILITY_KINDS = \{ fragGrenade: 0, flashbang: 1, smokeGrenade: 2 \} as const/,
    );
    // the requisition list is the catalog's chain utilities that have a builder kind
    assert.match(
        read("../src/features/headquarters/utilities.ts"),
        /i\.status === "chain" && i\.kind !== undefined/,
    );
    const mapping = read("../src/features/headquarters/mapping.ts");
    assert.match(mapping, /"Frag Grenade": "frag"/);
    assert.match(mapping, /"Smoke Grenade": "smoke"/);
    assert.match(mapping, /Flashbang: "flash"/);
    // one slot: equipping swaps through the existing steps
    assert.match(read("../src/features/headquarters/utilities.ts"), /MAX_UTILITIES = 1/);
});

test("nothing is left of the planned-only path", () => {
    assert.throws(() => read("../src/features/headquarters/armory/planned.ts"));
    for (const path of [
        "../src/features/headquarters/armory/model.ts",
        "../src/features/headquarters/armory/ArmoryView.tsx",
        "../src/features/headquarters/gear-thumbnails.ts",
    ])
        assert.doesNotMatch(read(path), /planned|Not in supply|NOT_IN_SUPPLY/i, path);
    assert.ok(catalog.items.every((i) => i.status !== "planned"));
});

test("the squad catalog has an item and a stage model for each", () => {
    for (const g of GRENADES) {
        const e = itemById(g.client);
        assert.ok(e, g.client);
        assert.equal(e.slot, "utility");
        assert.equal(e.model, g.model);
        assert.equal(INITIAL_STOCK[g.client], 4);
        assert.equal(
            e.description,
            item(g.id).description,
            `${g.client} reads as the catalog does`,
        );
    }
    assert.equal(EQUIPMENT.filter((e) => e.slot === "utility" && e.type === "THROWABLE").length, 3);
});

test("the economy sells all three at the same price in every tier", () => {
    assert.deepEqual(
        GRENADES.map((g) => PRICES[g.id]),
        [10, 10, 10],
    );
    for (const tier of TIERS)
        for (const g of GRENADES) assert.ok(tier.items.includes(g.id), `${tier.id} ${g.id}`);
    for (const rating of [0, 1500, 3000]) {
        const ids = itemsFor(rating, "utility").map((i) => i.id);
        for (const g of GRENADES) assert.ok(ids.includes(g.id), `${rating} ${g.id}`);
    }
    for (const g of GRENADES) {
        assert.equal(itemOf(g.id)?.name, item(g.id).name);
        assert.ok(allItems().some((i) => i.id === g.id));
    }
});

test("a squad with any of the three validates; a unit gets that grenade's action and count", () => {
    const base = PRESETS.find((p) => p.id === "assault")!.loadout;
    for (const g of GRENADES) {
        const loadout: Loadout = { ...base, utility: g.id };
        assert.deepEqual(validateSquad([loadout, loadout, loadout], 1500, "3x3", null), []);
        assert.equal(
            squadPrice([loadout]),
            squadPrice([{ ...base, utility: "frag-grenade" }]),
            g.id,
        );
        assert.equal(kitOf(loadout).utility, g.client);
        assert.deepEqual(
            fieldUnit(loadout).actions.map((a) => a.kind),
            ["Move", "Attack", "Reload", g.action],
        );
        assert.equal(unitStats(loadout).grenades, 1);
    }
    // a unit carries one: the loadout has a single utility slot
    assert.equal(Object.keys(base).filter((k) => k === "utility").length, 1);
});
