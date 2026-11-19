// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The planned utilities (`status: "planned"` in `packages/catalog/items.json`):
 * the Armory's requisition catalog lists them with requisition inactive, and
 * nothing that builds transactions, decodes objects, prices a squad, runs a
 * match or plays as the CLI agent can see them.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { EQUIPMENT, INITIAL_STOCK, itemById } from "../../packages/squad/src/catalog.ts";
import catalog from "../../packages/catalog/items.json" with { type: "json" };
import {
    NOT_IN_SUPPLY,
    PLANNED_UTILITIES,
    requisitionDeny,
} from "../src/features/headquarters/armory/planned.ts";
import { allItems, itemOf, itemsFor, PRESETS } from "../src/features/play/economy/index.ts";

const IDS = ["smoke-grenade", "flashbang"];
const MODELS = ["smoke", "flash"];
/** Every way the two could be named in code that reads the catalog. */
const NAMES = [...IDS, ...MODELS.map((m) => `"${m}"`), "Smoke Grenade", "Flashbang"];

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sources = (dir: string, skip: string[] = []) =>
    readdirSync(new URL(dir, import.meta.url))
        .filter((f) => /\.(ts|tsx)$/.test(f) && !skip.includes(f))
        .map((f) => ({ path: `${dir}${f}`, text: read(`${dir}${f}`) }));

test("the catalog lists both as planned utilities with no kind and no chain call", () => {
    for (const id of IDS) {
        const entry = catalog.items.find((i) => i.id === id) as Record<string, unknown> | undefined;
        assert.ok(entry, id);
        assert.equal(entry.type, "utility");
        assert.equal(entry.status, "planned");
        assert.equal(entry.chain, null, `${id} has no chain call`);
        assert.equal("kind" in entry, false, `${id} has no utility kind`);
        assert.deepEqual(entry.actions, []);
    }
});

test("the requisition catalog's planned lines: names, models, copy with units", () => {
    assert.deepEqual(
        PLANNED_UTILITIES.map((u) => [u.id, u.name, u.model]),
        [
            ["smoke-grenade", "Smoke Grenade", "smoke"],
            ["flashbang", "Flashbang", "flash"],
        ],
    );
    for (const u of PLANNED_UTILITIES) {
        assert.deepEqual(
            u.lines.map((l) => l.label),
            ["Range", "Area", "Effect", "Uses"],
        );
        assert.equal(u.lines[0].value, "5 tiles");
        assert.equal(u.lines[3].value, "1 per match");
        // Every number carries its unit.
        for (const l of u.lines)
            assert.doesNotMatch(l.value, /\d(?![\d%]|-tile| tiles?| per| turn)/);
        // A finished product's copy.
        for (const text of [u.description, ...u.lines.map((l) => l.value)])
            assert.doesNotMatch(text, /preview|coming soon|not yet|mock|for now|sorry|later/i);
    }
});

test("requisition is inactive for a planned line, with the reason; a real one stays active", () => {
    assert.equal(NOT_IN_SUPPLY, "Not in supply");
    assert.equal(requisitionDeny({}), NOT_IN_SUPPLY);
    assert.equal(requisitionDeny({ order: { utility: 0 } }), undefined);
    // The Armory's supply list merges them after the contract's utilities,
    // with no order: the requisition command has nothing to send.
    const model = read("../src/features/headquarters/armory/model.ts");
    assert.match(model, /\.\.\.PLANNED_UTILITIES\.map\(/);
    const planned = model.slice(model.indexOf("...PLANNED_UTILITIES.map("));
    assert.doesNotMatch(planned.slice(0, planned.indexOf("}),")), /order:/);
    const view = read("../src/features/headquarters/armory/ArmoryView.tsx");
    assert.match(
        view,
        /e\.order\s*\?\s*write\("Requisition", \(\) => ops\.requisition\(e\.order!\)\)/,
    );
    assert.match(view, /deny: requisitionDeny\(e\)/);
});

test("the ranked economy, its presets and the mock matches never offer them", () => {
    const ids = allItems().map((i) => i.id);
    for (const id of IDS) {
        assert.ok(!ids.includes(id), id);
        assert.equal(itemOf(id), undefined);
    }
    for (const rating of [0, 1500, 3000])
        for (const item of itemsFor(rating, "utility")) assert.ok(!IDS.includes(item.id));
    for (const preset of PRESETS) assert.ok(!IDS.includes(preset.loadout.utility ?? ""));
});

test("the squad catalog (local roster, pickers, encounters) has no item for them", () => {
    for (const model of MODELS) {
        assert.equal(itemById(model), undefined);
        assert.equal(INITIAL_STOCK[model], undefined);
    }
    assert.ok(!EQUIPMENT.some((e) => (MODELS as string[]).includes(e.model)));
});

test("chain-facing code reads only chain entries and never names them", () => {
    // The utility list the tx builders take: `status === "chain"` and a kind.
    const utilities = read("../src/features/headquarters/utilities.ts");
    assert.match(utilities, /i\.status === "chain" && i\.kind !== undefined/);
    assert.match(read("../src/chain/ghosts.ts"), /UTILITY_KINDS = \{ fragGrenade: 0 \} as const/);
    // The engine's utility actions and the economy go by fixed chain ids.
    assert.match(
        read("../../packages/engine/src/squad-bridge.ts"),
        /UTILITY_ITEMS: Record<string, string> = \{ frag: "frag-grenade" \}/,
    );
    // Builders and decoders in the app, and the CLI agent's rules, contract and
    // decoders (its experiment sandbox is a simulation tool, not a chain path).
    for (const { path, text } of [
        ...sources("../src/chain/"),
        ...sources("../../packages/agent/src/", ["sandbox.ts"]),
        { path: "economy", text: read("../src/features/play/economy/index.ts") },
        { path: "match", text: read("../src/features/play/match/model.ts") },
    ])
        for (const name of NAMES) assert.ok(!text.includes(name), `${path} names ${name}`);
});
