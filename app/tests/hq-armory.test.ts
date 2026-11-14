// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    draftMod,
    fitCount,
    fitPlan,
    benchCommands,
    issueTo,
    LIMIT_REASON,
    planSummary,
    rowOf,
    sameFit,
    stackRows,
    type Holder,
    type StackInput,
} from "../src/features/headquarters/armory/rules.ts";
import { holdingRifle, weaponName } from "../src/features/headquarters/squad/rules.ts";

test("a draft takes one tier per kind: a new tier replaces the old one", () => {
    const next = draftMod({ scope: 1 }, "scope", 3);
    assert.ok("fit" in next);
    assert.deepEqual(next.fit, { scope: 3 });
    assert.equal(fitCount(next.fit), 1);
});

test("a fourth kind is refused with the reason", () => {
    const full = { scope: 1, laser: 2, clip: 1 };
    assert.deepEqual(draftMod(full, "stock", 1), { deny: LIMIT_REASON });
    // A kind already fitted can still change tier at the limit.
    const swap = draftMod(full, "laser", 3);
    assert.ok("fit" in swap && swap.fit.laser === 3);
});

test("clearing a kind frees a place under the limit", () => {
    const cleared = draftMod({ scope: 1, laser: 2, clip: 1 }, "laser", null);
    assert.ok("fit" in cleared);
    assert.deepEqual(cleared.fit, { scope: 1, clip: 1 });
    assert.ok("fit" in draftMod(cleared.fit, "stock", 2));
});

test("fits compare by tier per kind, absent equals zero", () => {
    assert.ok(sameFit({ scope: 1 }, { scope: 1, clip: undefined }));
    assert.ok(!sameFit({ scope: 1 }, { scope: 2 }));
});

test("a plan keeps wanted mods, strips the rest, takes from storage, then requisitions", () => {
    const plan = fitPlan(["Basic Scope", "Basic Expanded Clip"], { scope: 1, laser: 2, stock: 1 }, [
        "Advanced Laser Sight",
        "Basic Scope",
    ]);
    assert.deepEqual(plan.keep, ["Basic Scope"]);
    assert.deepEqual(plan.strip, ["Basic Expanded Clip"]);
    assert.deepEqual(plan.take, ["Advanced Laser Sight"]);
    assert.deepEqual(plan.requisition, ["Basic Stock"]);
    assert.equal(planSummary(plan), "3 changes · 1 requisitioned, free");
});

test("a stripped mod is not reused for the same apply", () => {
    // Clip I comes off and the draft wants it nowhere else; no stock: Scope II is requisitioned.
    const plan = fitPlan(["Basic Expanded Clip"], { scope: 2 }, []);
    assert.deepEqual(plan.strip, ["Basic Expanded Clip"]);
    assert.deepEqual(plan.requisition, ["Advanced Scope"]);
});

test("an unchanged draft plans nothing", () => {
    const plan = fitPlan(["Basic Scope"], { scope: 1 }, ["Basic Scope"]);
    assert.deepEqual(plan, { keep: ["Basic Scope"], strip: [], take: [], requisition: [] });
    assert.equal(planSummary(plan), "No changes");
});

const holder = (id: string, holding: { id: string; name: string }[] = []): Holder => ({
    id,
    name: id.toUpperCase(),
    holding,
});

test("issuing to an empty slot issues; to a held one swaps the piece back to storage", () => {
    assert.deepEqual(issueTo("weapon", "w1", null, holder("a")), { verb: "Equip", from: null });
    assert.deepEqual(
        issueTo("armor", "x1", "b", holder("a", [{ id: "x0", name: "Light Armor" }])),
        { verb: "Swap", from: "b", returns: "Light Armor" },
    );
});

test("the carrier is already carrying it", () => {
    assert.deepEqual(issueTo("weapon", "w1", "a", holder("a", [{ id: "w1", name: "R" }])), {
        verb: "Equipped",
    });
});

test("a full utility slot swaps its utility out in the same move", () => {
    const plan = issueTo(
        "utility",
        "u2",
        "b",
        holder("a", [{ id: "u1", name: "Frag Grenade" }]),
        1,
    );
    assert.deepEqual(plan, { verb: "Swap", from: "b", replace: "u1", returns: "Frag Grenade" });
    assert.deepEqual(issueTo("utility", "u2", null, holder("a"), 1), { verb: "Equip", from: null });
});

test("a weapon with a fitted upgrade is named with a plus; without, as is", () => {
    assert.equal(
        weaponName({ name: "Sharpshooter Rifle", upgrades: [{}] }),
        "Sharpshooter Rifle +",
    );
    assert.equal(weaponName({ name: "Standard Rifle", upgrades: [] }), "Standard Rifle");
    // A catalog entry has no upgrades at all.
    assert.equal(weaponName({ name: "Plasma Rifle" }), "Plasma Rifle");
});

const loose = (id: string, name = "Standard Rifle"): StackInput => ({ id, name, loose: true });
const held = (id: string, name = "Standard Rifle"): StackInput => ({ id, name, loose: false });

test("identical loose items stack into one row with every id, acting with the lowest", () => {
    const rows = stackRows("weapon", [loose("0x3"), loose("0x1"), loose("0x2")]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
        key: "stack-weapon-Standard Rifle",
        ids: ["0x1", "0x2", "0x3"],
        acting: "0x1",
    });
});

test("modded, finished and equipped items are rows of their own", () => {
    const rows = stackRows("weapon", [
        held("0xc"), // equipped
        loose("0x1"),
        held("0x5", "Standard Rifle +"), // modded
        held("0x6"), // a finish chosen
        loose("0x2"),
        loose("0x9", "Plasma Rifle"),
    ]);
    assert.deepEqual(
        rows.map((r) => [r.key, r.ids.length]),
        [
            ["item-0xc", 1],
            ["stack-weapon-Standard Rifle", 2],
            ["item-0x5", 1],
            ["item-0x6", 1],
            ["stack-weapon-Plasma Rifle", 1],
        ],
    );
});

test("a stack keeps its row id as its count changes", () => {
    const before = stackRows("utility", [
        loose("0x4", "Frag Grenade"),
        loose("0x7", "Frag Grenade"),
    ]);
    // Requisitioned one more, then equipped the acting one.
    const more = stackRows("utility", [
        loose("0x4", "Frag Grenade"),
        loose("0x7", "Frag Grenade"),
        loose("0x8", "Frag Grenade"),
    ]);
    const after = stackRows("utility", [
        held("0x4", "Frag Grenade"),
        loose("0x7", "Frag Grenade"),
        loose("0x8", "Frag Grenade"),
    ]);
    assert.equal(before[0].key, more[0].key);
    assert.equal(more[0].ids.length, 3);
    assert.equal(more[0].acting, "0x4");
    const stack = after.find((r) => r.key === before[0].key)!;
    assert.deepEqual(stack.ids, ["0x7", "0x8"]);
    assert.equal(stack.acting, "0x7");
    assert.equal(rowOf(after, "0x4")!.key, "item-0x4");
});

test("a linked object in a stack is the one acted on", () => {
    const rows = stackRows("armor", [loose("0x1", "Heavy Armor"), loose("0x2", "Heavy Armor")], {
        "stack-armor-Heavy Armor": "0x2",
    });
    assert.equal(rows[0].acting, "0x2");
    assert.equal(rowOf(rows, "0x2")!.key, "stack-armor-Heavy Armor");
    // A preference for an object no longer in the stack falls back to the lowest id.
    const gone = stackRows("armor", [loose("0x1", "Heavy Armor")], {
        "stack-armor-Heavy Armor": "0x2",
    });
    assert.equal(gone[0].acting, "0x1");
});

test("a recruit previewing another rifle wears that rifle's finish, not their own", () => {
    const skins = { A: "camo" };
    const vex = {
        equipment: { primary: "mx4" as string | null },
        attachments: {},
        weaponSkin: "camo", // their own rifle A
    };
    const plain = holdingRifle(vex, { id: "C", model: "mx4", attachments: {} }, skins);
    assert.equal(plain.weaponSkin, undefined);
    assert.equal(plain.equipment.primary, "mx4");
    const own = holdingRifle(vex, { id: "A", model: "mx4", attachments: {} }, skins);
    assert.equal(own.weaponSkin, "camo");
    const empty = holdingRifle(vex, null, skins);
    assert.equal(empty.equipment.primary, null);
    assert.equal(empty.weaponSkin, undefined);
});

test("bench commands: no draft keeps the row's own, a draft makes Apply the primary everywhere", () => {
    const apply = { action: "confirm" as const, label: "Apply mods" };
    const discard = { action: "reset" as const, label: "Discard" };
    const back = { action: "back" as const, label: "List" };
    const change = { action: "confirm" as const, label: "Change", tone: "primary" as const };
    const clear = { action: "reset" as const, label: "Clear" };
    const slotOwn = [clear, change, back];
    const asLabels = (cs: { action: string; label: string }[]) =>
        cs.map((c) => `${c.action}:${c.label}`);

    // No draft: untouched.
    assert.equal(benchCommands(false, slotOwn, apply, discard, back, false), slotOwn);

    // Draft, a slot or Finish row: Apply primary, the row's action secondary and the click.
    const slot = benchCommands(true, slotOwn, apply, discard, back, false);
    assert.deepEqual(asLabels(slot), ["confirm:Apply mods", "reset:Change", "back:List"]);
    assert.equal(slot[1].click, true);
    assert.equal(slot[1].tone, undefined);
    assert.equal(slot[0].click, undefined);

    // Draft, a row whose own action waits (stats, Equipped by): Apply and Discard.
    const waiting = benchCommands(true, [change, back], apply, discard, back, true);
    assert.deepEqual(asLabels(waiting), ["confirm:Apply mods", "reset:Discard", "back:List"]);
});
