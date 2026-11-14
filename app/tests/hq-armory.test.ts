// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    draftMod,
    fitCount,
    fitPlan,
    issueTo,
    LIMIT_REASON,
    planSummary,
    sameFit,
    type Holder,
} from "../src/features/headquarters/armory/rules.ts";
import { weaponName } from "../src/features/headquarters/squad/rules.ts";

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
    assert.deepEqual(issueTo("weapon", "w1", null, holder("a")), { verb: "Issue", from: null });
    assert.deepEqual(
        issueTo("armor", "x1", "b", holder("a", [{ id: "x0", name: "Light Armor" }])),
        { verb: "Swap", from: "b", returns: "Light Armor" },
    );
});

test("the carrier is already carrying it", () => {
    assert.deepEqual(issueTo("weapon", "w1", "a", holder("a", [{ id: "w1", name: "R" }])), {
        verb: "Carrying",
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
    assert.deepEqual(issueTo("utility", "u2", null, holder("a"), 1), { verb: "Issue", from: null });
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
