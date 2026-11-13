// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";

import {
    pruneDrafts,
    sameDraft,
    settleSaved,
    unsavedIds,
    withoutDraft,
    type Draft,
} from "../src/features/headquarters/squad/drafts.ts";
import { dismissalNote, hireOffer, issuePlan } from "../src/features/headquarters/squad/rules.ts";
import { rankIcon, rankProgress } from "../src/features/headquarters/squad/ranks.ts";

const look = (i = 0, voice = 0): Draft => ({
    appearance: normalize(fromPreset(presets[i]), schema),
    armorColors: { ...DEFAULT_ARMOR_COLORS },
    voice,
});

test("a draft equal to its baseline is not unsaved", () => {
    const base = look();
    assert.deepEqual(
        unsavedIds({ a: look() }, () => base),
        [],
    );
});

test("a voice change alone makes a draft unsaved", () => {
    const base = look(0, 0);
    assert.deepEqual(
        unsavedIds({ a: look(0, 2) }, () => base),
        ["a"],
    );
});

test("a nudge below one quantization step is not a change", () => {
    const base = look();
    const nudged = look();
    nudged.appearance = { ...nudged.appearance, warmth: nudged.appearance.warmth + 1e-6 };
    assert.ok(sameDraft(base, nudged));
});

test("a real look change is unsaved; a recruit with no baseline is ignored", () => {
    const base = look(0);
    const changed = look(0);
    changed.appearance = {
        ...changed.appearance,
        hair: changed.appearance.hair === "bald" ? "buzz" : "bald",
    };
    assert.deepEqual(
        unsavedIds({ a: changed, gone: changed }, (id) => (id === "a" ? base : null)),
        ["a"],
    );
});

test("pruning drops drafts the chain matches and recruits no longer on file", () => {
    const base = look(0, 0);
    const kept = look(0, 3);
    const drafts = { same: look(0, 0), gone: kept, kept };
    const pruned = pruneDrafts(drafts, (id) => (id === "gone" ? null : base));
    assert.deepEqual(Object.keys(pruned), ["kept"]);
    // Nothing to drop: the same object comes back, so state does not churn.
    assert.equal(
        pruneDrafts(pruned, () => base),
        pruned,
    );
});

test("a landed save clears its draft unless the player edited on meanwhile", () => {
    const sent = look(0, 1);
    assert.deepEqual(settleSaved({ a: look(0, 1) }, "a", sent), {});
    const later = { a: look(0, 2) };
    assert.equal(settleSaved(later, "a", sent), later);
    assert.deepEqual(withoutDraft({ a: sent, b: sent }, "a"), { b: sent });
});

test("issuing into an empty slot issues; a filled one swaps", () => {
    assert.deepEqual(issuePlan("primary", [], 1), { verb: "Issue" });
    assert.deepEqual(issuePlan("armor", [{ id: "x" }], 1), { verb: "Swap" });
    assert.deepEqual(issuePlan("utility", [], 1), { verb: "Issue" });
    assert.deepEqual(issuePlan("utility", [{ id: "frag" }], 1), {
        verb: "Swap",
        replace: "frag",
    });
    assert.deepEqual(issuePlan("utility", [{ id: "frag" }], 2), { verb: "Issue" });
});

test("hiring: a free top-up below four, nothing to hire at four", () => {
    assert.deepEqual(hireOffer(0, 4), { kind: "free", open: 4 });
    assert.deepEqual(hireOffer(3, 4), { kind: "free", open: 1 });
    assert.deepEqual(hireOffer(4, 4), { kind: "full" });
});

test("the dismissal note follows the hiring rule", () => {
    assert.match(dismissalNote(4), /refills for free .* up to 4/);
});

test("rank insignia and progress", () => {
    assert.equal(rankIcon("Rookie"), "rank1");
    assert.equal(rankIcon("Corporal"), "rank2");
    assert.equal(rankIcon("Lieutenant"), "rank3");
    assert.deepEqual(rankProgress("Rookie", 2), { xp: 2, next: 3 });
    assert.equal(rankProgress("Colonel", 200).next, undefined);
});
