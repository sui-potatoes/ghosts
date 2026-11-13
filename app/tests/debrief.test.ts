// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    debriefOf,
    fallTurns,
    fixtureResult,
    promotionBonus,
    replacementFor,
    xpBand,
    type MatchResult,
    type ResultRecruit,
} from "../src/features/ui-sample/debrief.ts";

const SQUAD: ResultRecruit[] = [
    { objectId: "0xa", name: "VEX", rank: "Sergeant", xp: 19 },
    { objectId: "0xb", name: "HALE", rank: "Lieutenant", xp: 31 },
    { objectId: "0xc", name: "KITE", rank: "Corporal", xp: 14 },
];

const result = (over: Partial<MatchResult>): MatchResult => ({
    outcome: "victory",
    earned: 2,
    rating: [1500, 1516],
    squad: SQUAD,
    fallen: [],
    history: [],
    recruitsHome: 4,
    ...over,
});

test("a survivor's bar fills inside their rank's band", () => {
    // Sergeant: 15 to 25.
    assert.deepEqual(xpBand("Sergeant", 19, 21), { start: 15, end: 25, from: 0.4, to: 0.6 });
});

test("a promotion fills the old band to its end", () => {
    // Corporal 13 + 2 = 15: Sergeant; the Corporal band is 8 to 15.
    assert.deepEqual(xpBand("Corporal", 13, 15), { start: 8, end: 15, from: 5 / 7, to: 1 });
});

test("a promotion adds aim, and health on even ranks", () => {
    assert.deepEqual(promotionBonus("Corporal", "Sergeant"), { aim: 2, health: 0 });
    assert.deepEqual(promotionBonus("Squaddie", "Corporal"), { aim: 2, health: 1 });
    assert.deepEqual(promotionBonus("Rookie", "Corporal"), { aim: 4, health: 1 });
    assert.deepEqual(promotionBonus("Major", "Major"), { aim: 0, health: 0 });
});

test("the top rank has no bar", () => {
    assert.equal(xpBand("Colonel", 95, 97), null);
    assert.deepEqual(xpBand("Major", 89, 91), { start: 60, end: 90, from: 29 / 30, to: 1 });
});

test("a rookie starts at zero", () => {
    assert.deepEqual(xpBand("Rookie", 0, 1), { start: 0, end: 3, from: 0, to: 1 / 3 });
});

test("the turn a recruit fell on comes from the history", () => {
    const turns = fallTurns([
        { $kind: "Move" },
        { $kind: "UnitKIA", UnitKIA: ["0xa", 1, 1] },
        { $kind: "NextTurn", NextTurn: 1 },
        { $kind: "NextTurn", NextTurn: 2 },
        { $kind: "UnitKIA", UnitKIA: ["0xb", 1, 1] },
    ]);
    assert.equal(turns.get("0xa"), 1);
    assert.equal(turns.get("0xb"), 3);
});

test("survivors gain the earned experience; a promotion is named", () => {
    const d = debriefOf(result({}));
    assert.equal(d.title, "Victory");
    assert.equal(d.tone, "win");
    assert.deepEqual(d.rating, { before: 1500, after: 1516, delta: 16 });
    assert.equal(d.replacement, null);
    const [vex, , kite] = d.plates;
    assert.ok(vex.kind === "home" && kite.kind === "home");
    assert.equal(vex.xpAfter, 21);
    assert.equal(vex.promoted, false);
    assert.equal(kite.rankAfter, "Sergeant");
    assert.equal(kite.promoted, true);
});

test("the fallen get a KIA plate with their turn; survivors still earn", () => {
    const d = debriefOf(
        result({
            fallen: ["0xb"],
            history: [
                { $kind: "NextTurn", NextTurn: 1 },
                { $kind: "UnitKIA", UnitKIA: ["0xb", 0, 0] },
            ],
            recruitsHome: 3,
        }),
    );
    const hale = d.plates[1];
    assert.ok(hale.kind === "kia");
    assert.equal(hale.rank, "Lieutenant");
    assert.equal(hale.turn, 2);
    assert.deepEqual(d.replacement, { call: "hire_recruits", count: 1 });
});

test("a smaller squad leaves the last podiums vacant", () => {
    const d = debriefOf(result({ squad: SQUAD.slice(0, 1) }));
    assert.deepEqual(
        d.plates.map((p) => p.kind),
        ["home", "vacant", "vacant"],
    );
});

test("outcomes read as the Match result names them", () => {
    assert.equal(debriefOf(result({ outcome: "defeat" })).tone, "loss");
    assert.equal(debriefOf(result({ outcome: "stalemate" })).title, "Draw");
    assert.equal(debriefOf(result({ outcome: "opponent-forfeited" })).title, "Victory");
    assert.equal(debriefOf(result({ outcome: "forfeited" })).tone, "blame");
});

test("an unchanged rating is not shown", () => {
    assert.equal(debriefOf(result({ rating: [1500, 1500] })).rating, null);
    assert.equal(debriefOf(result({ rating: null })).rating, null);
});

test("hiring: free up to four, no more, never mid-game", () => {
    assert.deepEqual(replacementFor(1), { call: "hire_recruits", count: 3 });
    assert.ok("deny" in replacementFor(4));
    assert.ok("deny" in replacementFor(null));
});

test("fixtures: win keeps everyone, costly loses one, wipe loses all", () => {
    const win = debriefOf(fixtureResult("win", SQUAD, 4));
    const costly = debriefOf(fixtureResult("costly", SQUAD, 4));
    const wipe = debriefOf(fixtureResult("wipe", SQUAD, 4));
    assert.deepEqual(
        win.plates.map((p) => p.kind),
        ["home", "home", "home"],
    );
    assert.deepEqual(
        costly.plates.map((p) => p.kind),
        ["home", "kia", "home"],
    );
    assert.equal(costly.title, "Victory");
    assert.deepEqual(
        wipe.plates.map((p) => p.kind),
        ["kia", "kia", "kia"],
    );
    assert.equal(wipe.tone, "loss");
    assert.deepEqual(wipe.replacement, { call: "hire_recruits", count: 3 });
    for (const p of wipe.plates) assert.ok(p.kind === "kia" && p.turn !== null);
});
