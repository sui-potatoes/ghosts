// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    TIERS,
    allItems,
    budgetOf,
    changesFrom,
    changesText,
    defaultSquad,
    itemsFor,
    presetLabel,
    presetsFor,
    PRESETS,
    priceOf,
    squadSize,
    type Loadout,
} from "../src/features/play/economy/index.ts";
import {
    applyOption,
    budgetView,
    canSwap,
    choosePreset,
    emptySaved,
    fitSquad,
    opponentFor,
    parseSaved,
    pickSections,
    serializeSaved,
    squadCost,
    squadFor,
    startGate,
    swapItem,
    switchMode,
    tierNotice,
    SLOTS,
} from "../src/features/play/ranked/model.ts";

const RATING = 1500;

test("the default squad has the right size and is a legal start", () => {
    for (const mode of ["3x3", "4x4"] as const) {
        const squad = defaultSquad(RATING, mode);
        assert.equal(squad.length, squadSize(mode));
        assert.deepEqual(startGate(squad, RATING, mode), { ok: true });
    }
});

test("budget arithmetic: spent, left and over", () => {
    const squad = defaultSquad(RATING, "3x3");
    const view = budgetView(squad, RATING, "3x3");
    assert.equal(view.budget, budgetOf(RATING, "3x3"));
    assert.equal(view.spent, squadCost(squad));
    assert.equal(view.left, view.budget - view.spent);
    assert.equal(view.over, view.spent > view.budget);
    // A squad of the dearest units possible goes over a tiny rating's budget or not, but the sums agree.
    const dear = squad.map((u) => ({ ...u }));
    assert.equal(
        squadCost(dear),
        dear.reduce((n, u) => n + priceOf(u), 0),
    );
});

test("choosing a preset replaces the unit with its loadout", () => {
    const squad = defaultSquad(RATING, "3x3");
    const presets = presetsFor(RATING);
    const last = presets[presets.length - 1];
    const next = choosePreset(squad, 1, last);
    assert.deepEqual(next[1], last.loadout);
    assert.notEqual(next[1], last.loadout, "the unit is a copy");
    assert.deepEqual(next[0], squad[0]);
    assert.equal(choosePreset(squad, 9, last), squad);
});

test("a swap changes one slot and respects the preset's swaps", () => {
    const squad = defaultSquad(RATING, "3x3");
    let done = false;
    for (const slot of SLOTS) {
        const items = itemsFor(RATING, slot);
        if (!items.length) continue;
        const target = items[items.length - 1];
        const next = swapItem(squad, 0, slot, target.id, RATING);
        if (canSwap(squad[0], slot, RATING)) {
            assert.equal(next[0][slot], target.id);
            assert.equal(next[0].preset, squad[0].preset);
            done = true;
        } else {
            assert.equal(next, squad, "a fixed slot is refused");
        }
    }
    assert.ok(done, "some slot could be swapped");
    assert.equal(swapItem(squad, 0, "weapon", "no-such-item", RATING), squad);
    if (canSwap(squad[0], "utility", RATING))
        assert.equal(swapItem(squad, 0, "utility", null, RATING)[0].utility, null);
});

test("picker options carry price deltas that add up", () => {
    const squad = defaultSquad(RATING, "3x3");
    const base = budgetView(squad, RATING, "3x3");
    const sections = pickSections(squad, 0, RATING, "3x3");
    assert.equal(sections[0].group, "preset");
    for (const option of sections.flatMap((s) => s.options)) {
        assert.equal(option.leftAfter, base.left - option.delta);
        const next = applyOption(squad, 0, option, RATING);
        if (next !== squad) assert.equal(squadCost(next) - base.spent, option.delta);
    }
    const current = sections.flatMap((s) => s.options).filter((o) => o.current);
    assert.ok(current.length >= 1);
    for (const o of current) assert.equal(o.delta, 0);
});

test("an over-budget choice stays choosable and blocks Start with a reason", () => {
    const mode = "3x3";
    const squad = defaultSquad(RATING, mode);
    const dear = pickSections(squad, 0, RATING, mode)
        .flatMap((s) => s.options)
        .sort((a, b) => b.delta - a.delta)[0];
    const stuffed = (): Loadout[] => {
        // Fill the squad with the dearest option until it breaks the budget, if the economy allows it.
        let s = squad;
        for (let i = 0; i < s.length; i++)
            for (let pass = 0; pass < 3; pass++)
                for (const o of pickSections(s, i, RATING, mode).flatMap((x) => x.options))
                    if (o.delta > 0) s = applyOption(s, i, o, RATING);
        return s;
    };
    const next = stuffed();
    const gate = startGate(next, RATING, mode);
    if (budgetView(next, RATING, mode).over) {
        assert.equal(gate.ok, false);
        if (!gate.ok) assert.ok(gate.reason.length > 0);
    }
    assert.ok(dear);
});

test("a wrong-sized squad cannot start", () => {
    const squad = defaultSquad(RATING, "3x3");
    assert.equal(startGate(squad, RATING, "4x4").ok, false);
    assert.equal(startGate([], RATING, "3x3").ok, false);
});

test("switching size keeps what it can and remembers each size", () => {
    const three = defaultSquad(RATING, "3x3").map((u, i) => ({ ...u, preset: `p${i}` }));
    const saved = emptySaved();
    const toFour = switchMode(saved, RATING, "3x3", three, "4x4");
    assert.equal(toFour.mode, "4x4");
    const four = toFour.squads["4x4"]!;
    assert.equal(four.length, 4);
    assert.deepEqual(four.slice(0, 3), three, "the three units carry over");
    assert.deepEqual(toFour.squads["3x3"], three);
    const edited = four.map((u, i) => (i === 3 ? { ...u, preset: "edited" } : u));
    const back = switchMode(toFour, RATING, "4x4", edited, "3x3");
    assert.deepEqual(back.squads["3x3"], three);
    const again = switchMode(back, RATING, "3x3", three, "4x4");
    assert.equal(again.squads["4x4"]![3].preset, "edited", "the 4x4 squad is remembered");
    assert.deepEqual(fitSquad(four, RATING, "3x3"), four.slice(0, 3));
});

test("persistence round-trips and ignores what it cannot read", () => {
    const squad = defaultSquad(RATING, "3x3");
    const saved = {
        ...emptySaved(),
        mode: "4x4" as const,
        squads: { "3x3": squad },
        seen: { tier: "t", name: "T", budget: 100 },
    };
    const back = parseSaved(serializeSaved(saved));
    assert.deepEqual(back, saved);
    assert.deepEqual(squadFor(back, RATING, "3x3"), squad);
    assert.equal(squadFor(back, RATING, "4x4").length, 4);
    for (const junk of [
        null,
        "",
        "{",
        "[]",
        '{"v":2}',
        '{"v":1,"mode":"9x9","squads":{"3x3":[{"x":1}]}}',
    ]) {
        const read = parseSaved(junk);
        assert.deepEqual(read.squads, {});
        assert.equal(read.mode, "3x3");
    }
    const unknown = { ...saved, squads: { "3x3": [{ ...squad[0], weapon: "gone" }] } };
    assert.deepEqual(
        parseSaved(serializeSaved(unknown)).squads,
        {},
        "unknown items drop the squad",
    );
});

test("tier notice appears only when the tier changed", () => {
    const squad = defaultSquad(RATING, "3x3");
    assert.equal(tierNotice(emptySaved(), RATING, "3x3", squad), null);
    const other = { ...emptySaved(), seen: { tier: "other-tier", name: "Other", budget: 1 } };
    const text = tierNotice(other, RATING, "3x3", squad);
    assert.ok(text && text.includes(String(budgetOf(RATING, "3x3"))));
});

test("an opponent is near the player's rating", () => {
    for (const roll of [0, 0.5, 0.999]) {
        const o = opponentFor(RATING, () => roll);
        assert.ok(o.name.length > 0);
        assert.ok(Math.abs(o.rating - RATING) <= 60);
    }
    assert.ok(opponentFor(10, () => 0).rating >= 0);
});

test("what the tier has not unlocked is listed after the rest, with its reason, and cannot be chosen", () => {
    const rookie = TIERS[0];
    const rating = rookie.min;
    const squad = defaultSquad(rating, "3x3");
    const sections = pickSections(squad, 0, rating, "3x3");
    const presets = sections[0].options;
    const open = presetsFor(rating).map((p) => p.id);
    // available first, locked after, every locked preset accounted for
    const firstLocked = presets.findIndex((o) => o.locked);
    assert.ok(firstLocked >= 0, "the lowest tier has presets it has not unlocked");
    assert.ok(presets.slice(0, firstLocked).every((o) => !o.locked));
    assert.ok(presets.slice(firstLocked).every((o) => o.locked));
    assert.equal(presets.length, PRESETS.length);
    for (const o of presets.filter((o) => !o.locked))
        assert.ok(open.includes(o.key.slice("preset:".length)));
    for (const slot of SLOTS) {
        const options = sections.find((s) => s.group === slot)!.options;
        const swappable = options.filter((o) => !o.locked).length > 0;
        if (!swappable) continue;
        const wanted = allItems().filter((i) => i.slot === slot);
        // every catalog item of the slot appears once: unlocked ones plain, the rest locked
        assert.equal(
            options.filter((o) => o.key.startsWith(`${slot}:`) && o.key !== "utility:none").length,
            wanted.length,
        );
        for (const o of options.filter((o) => o.locked)) {
            const item = allItems().find((i) => `${slot}:${i.id}` === o.key)!;
            assert.equal(o.locked, `Unlocks at ${TIERS.find((t) => t.id === item.tier)!.name}`);
            assert.ok(!itemsFor(rating, slot).some((i) => i.id === item.id));
        }
    }
    // a locked preset names the lowest tier that opens all its items
    for (const o of presets.filter((o) => o.locked)) assert.match(o.locked!, /^Unlocks at \w+/);
    // choosing one changes nothing
    const lockedOne = presets.find((o) => o.locked)!;
    assert.equal(applyOption(squad, 0, lockedOne, rating), squad);
    // the top tier has nothing locked
    const top = TIERS[TIERS.length - 1].min;
    const all = pickSections(defaultSquad(top, "3x3"), 0, top, "3x3").flatMap((s) => s.options);
    assert.ok(all.every((o) => !o.locked));
});

test("a unit that differs from its preset says so, and what changed", () => {
    const assault = PRESETS.find((p) => p.id === "assault")!;
    const plain = { ...assault.loadout };
    assert.equal(presetLabel(plain), assault.name);
    assert.deepEqual(changesFrom(plain), []);
    assert.equal(changesText(plain), "");
    const lighter = swapItem([plain], 0, "armor", "armor-1", RATING)[0];
    assert.equal(lighter.preset, "assault");
    assert.equal(presetLabel(lighter), `${assault.name} · modified`);
    const changes = changesFrom(lighter);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].slot, "armor");
    assert.match(changesText(lighter), /^Armor: .+ instead of .+$/);
    // swapping back is no longer modified
    assert.equal(
        presetLabel(swapItem([lighter], 0, "armor", assault.loadout.armor, RATING)[0]),
        assault.name,
    );
});
