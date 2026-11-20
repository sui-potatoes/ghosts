// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    debriefOf,
    deployedOf,
    fallTurns,
    promotionBonus,
    rankLabels,
    replacementFor,
    xpBand,
    type MatchResult,
    type ResultRecruit,
} from "../src/features/debrief/result.ts";
import { demoDebriefOf } from "../src/features/debrief/demo.ts";
import { fieldHint } from "../src/features/debrief/result.ts";
import { fixtureResult } from "../src/features/ui-sample/debrief.ts";

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
    // A contract game is unrated: its debrief shows no rating.
    assert.equal(d.rating, null);
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

test("outcomes read as the Game result names them", () => {
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

// === The real match: what Match.tsx hands over ============================

test("a survivor's experience comes from the Account once home", () => {
    // Corporal 13 earned 2 on the field and is Sergeant at home.
    const d = debriefOf(
        result({
            squad: [{ objectId: "0xc", name: "KITE", rank: "Corporal", xp: 13 }],
            home: { "0xc": { rank: "Sergeant", xp: 15 } },
        }),
    );
    const kite = d.plates[0];
    assert.ok(kite.kind === "home");
    assert.equal(kite.xpAfter, 15);
    assert.equal(kite.gained, 2);
    assert.equal(kite.rankAfter, "Sergeant");
    assert.equal(kite.promoted, true);
});

test("an Account a poll behind (old experience, pay due) falls back to the rules", () => {
    const d = debriefOf(
        result({
            squad: [{ objectId: "0xc", name: "KITE", rank: "Corporal", xp: 13 }],
            home: { "0xc": { rank: "Corporal", xp: 13 } },
        }),
    );
    const kite = d.plates[0];
    assert.ok(kite.kind === "home");
    assert.equal(kite.xpAfter, 15);
    assert.equal(kite.promoted, true);
});

test("a game gone before it was read: home says what was earned, else nothing", () => {
    const squad = [{ objectId: "0xa", name: "VEX", rank: "Sergeant", xp: 19 }];
    const home = debriefOf(
        result({
            outcome: "settled-win",
            earned: null,
            squad,
            home: { "0xa": { rank: "Sergeant", xp: 21 } },
        }),
    ).plates[0];
    assert.ok(home.kind === "home");
    assert.equal(home.gained, 2);
    const unknown = debriefOf(result({ outcome: "settled-win", earned: null, squad })).plates[0];
    assert.ok(unknown.kind === "home");
    assert.equal(unknown.gained, null);
    assert.equal(unknown.band, null);
});

test("a walkover or blame pays nothing: survivors come home with +0", () => {
    const d = debriefOf(result({ outcome: "abandoned", earned: 0 }));
    for (const p of d.plates) assert.ok(p.kind === "home" && p.gained === 0 && !p.promoted);
    assert.equal(d.tone, "blame");
    assert.match(d.note ?? "", /minute/);
});

test("each ending names itself", () => {
    const of = (outcome: MatchResult["outcome"]) => {
        const d = debriefOf(result({ outcome }));
        return [d.title, d.tone, d.note];
    };
    assert.deepEqual(of("victory"), ["Victory", "win", null]);
    assert.deepEqual(of("defeat"), ["Defeat", "loss", null]);
    assert.deepEqual(of("opponent-abandoned"), ["Victory", "win", "Opponent abandoned the match"]);
    assert.deepEqual(of("opponent-forfeited"), ["Victory", "win", "Opponent stopped playing"]);
    assert.deepEqual(of("stalemate"), ["Draw", "draw", "Turn limit reached"]);
    assert.equal(of("forfeited")[1], "blame");
    assert.equal(of("no-show")[0], "No squad deployed");
    assert.deepEqual(of("ended"), ["Match over", "draw", null]);
});

test("the opponent's name is carried when known", () => {
    assert.equal(debriefOf(result({ opponent: "NOVA" })).opponent, "NOVA");
    assert.equal(debriefOf(result({})).opponent, null);
});

test("nobody deployed: every podium is vacant", () => {
    const d = debriefOf(result({ outcome: "no-show", squad: [], earned: 0 }));
    assert.deepEqual(
        d.plates.map((p) => p.kind),
        ["vacant", "vacant", "vacant"],
    );
});

test("a squad of four gets four podiums", () => {
    const four = [...SQUAD, { objectId: "0xd", name: "ASH", rank: "Rookie", xp: 0 }];
    assert.equal(debriefOf(result({ squad: four })).plates.length, 4);
});

test("fallen detection: the deployed squad is what was seen, mine, standing or fallen", () => {
    const seen = [
        { objectId: "0xa", leader: "me" },
        { objectId: "0xb", leader: "me" },
        { objectId: "0xx", leader: "them" },
        { objectId: "0xe", leader: "me" }, // left home: never on the map
    ];
    const squad = deployedOf(seen, "me", ["0xa"], ["0xb"]);
    assert.deepEqual(
        squad.map((r) => r.objectId),
        ["0xa", "0xb"],
    );
    const d = debriefOf(
        result({
            squad: squad.map((r) => ({
                objectId: r.objectId,
                name: r.objectId,
                rank: "Rookie",
                xp: 0,
            })),
            fallen: ["0xb"],
            history: [
                { $kind: "NextTurn", NextTurn: 4 },
                { $kind: "UnitKIA", UnitKIA: ["0xb", 1, 1] },
            ],
        }),
    );
    assert.deepEqual(
        d.plates.map((p) => p.kind),
        ["home", "kia", "vacant"],
    );
});

test("hiring waits for the wrap-up and counts what the Account holds", () => {
    const fell = { fallen: ["0xb"] };
    assert.ok("deny" in debriefOf(result({ ...fell, recruitsHome: null })).replacement!);
    assert.deepEqual(debriefOf(result({ ...fell, recruitsHome: 2 })).replacement, {
        call: "hire_recruits",
        count: 2,
    });
});

test("a promoted survivor's plate settles on one rank label, the new one", () => {
    const d = debriefOf(
        result({ squad: [{ objectId: "0xc", name: "AVI", rank: "Sergeant", xp: 24 }] }),
    );
    const p = d.plates[0];
    assert.ok(p.kind === "home" && p.promoted);
    // played through: the swap ran and ended; skipped / reduced motion: no swap at all
    assert.deepEqual(rankLabels(p, true), ["Sergeant"]);
    assert.deepEqual(rankLabels(p, false), ["Lieutenant"]);
});

test("an unpromoted survivor shows their rank whether or not a swap runs", () => {
    const p = debriefOf(result({})).plates[0];
    assert.ok(p.kind === "home" && !p.promoted);
    assert.deepEqual(rankLabels(p, true), rankLabels(p, false));
});

const demoRecruit = (id: string, kills: number, kia = false) => {
    const xp = kia ? 0 : kills * 100 + 40;
    return {
        id,
        name: id.toUpperCase(),
        full: `Full ${id}`,
        role: "Vanguard",
        kia,
        kills,
        xp,
        level: 1 + Math.floor(xp / 100),
        progress: xp % 100,
    };
};

test("the demo's report becomes plates with the field record, a fallen unit KIA", () => {
    const d = demoDebriefOf({
        report: {
            victory: false,
            turns: 7,
            survivors: 2,
            recruits: [demoRecruit("v", 2), demoRecruit("g", 0), demoRecruit("k", 1, true)],
        },
        operation: "Black Rain",
        sector: "Kora",
    });
    assert.equal(d.title, "Contract failed");
    assert.equal(d.tone, "loss");
    assert.equal(d.plates.length, 3);
    const [v, g, k] = d.plates;
    assert.ok(v.kind === "home" && v.promoted && v.rankAfter === "Level 3" && v.gained === 240);
    assert.equal(v.field?.kills, 2);
    assert.ok(v.band && v.band.to === 0.4 && v.band.start === 200 && v.band.end === 300);
    assert.equal(fieldHint(v), "Promoted to level 3 · 40 / 100 XP to level 4");
    assert.ok(g.kind === "home" && !g.promoted && g.rankAfter === "Level 1");
    assert.equal(fieldHint(g), "40 / 100 XP to level 2");
    assert.ok(k.kind === "kia" && k.field?.kills === 1 && k.turn === null);
    assert.match(d.lines?.[1] ?? "", /07 turns · 2 \/ 3 returned · 1 lost/);
});

test("a won demo is a fulfilled contract with the fourth podium vacant", () => {
    const d = demoDebriefOf(
        {
            report: { victory: true, turns: 3, survivors: 1, recruits: [demoRecruit("v", 1)] },
            operation: "Op",
            sector: "S",
        },
        4,
    );
    assert.equal(d.title, "Contract fulfilled");
    assert.equal(d.tone, "win");
    assert.deepEqual(
        d.plates.map((p) => p.kind),
        ["home", "vacant", "vacant", "vacant"],
    );
});

// === Ranked =================================================================

const ranked = (over: Partial<MatchResult> = {}): MatchResult => ({
    outcome: "victory",
    earned: null,
    rating: null,
    squad: [
        { objectId: "0x1", name: "Assault", rank: "Assault", xp: 0 },
        { objectId: "0x2", name: "Sniper", rank: "Sniper", xp: 0 },
        { objectId: "0x3", name: "Runner", rank: "Runner", xp: 0 },
    ],
    fallen: ["0x2"],
    history: [
        { $kind: "NextTurn", NextTurn: 3 },
        { $kind: "UnitKIA", UnitKIA: ["0x2", 1, 1] },
    ],
    recruitsHome: null,
    ranked: { size: 3, tier: "Contractor", change: { before: 1512, after: 1529, tier: null } },
    ...over,
});

test("a ranked debrief: the rating from the account, no experience, nobody lost for good", () => {
    const d = debriefOf(ranked());
    assert.equal(d.title, "Victory");
    assert.deepEqual(d.rating, { before: 1512, after: 1529, delta: 17 });
    assert.deepEqual(d.lines, ["Ranked 3x3 · Contractor"]);
    assert.equal(d.replacement, null);
    for (const plate of d.plates) {
        assert.equal(plate.kind, "home");
        if (plate.kind !== "home") continue;
        assert.equal(plate.gained, null);
        assert.equal(plate.band, null);
        assert.equal(plate.promoted, false);
    }
    const [, sniper, runner] = d.plates;
    assert.ok(sniper.kind === "home" && runner.kind === "home");
    assert.equal(sniper.hint, "Fell on turn 4");
    assert.equal(runner.hint, "Standing at the end");
    assert.equal(runner.rankAfter, "Runner");
});

test("a ranked loss and a new tier are said; an unread rating is not guessed", () => {
    const down = debriefOf(
        ranked({
            outcome: "defeat",
            ranked: {
                size: 3,
                tier: "Contractor",
                change: { before: 1512, after: 1494, tier: null },
            },
        }),
    );
    assert.deepEqual(down.rating, { before: 1512, after: 1494, delta: -18 });
    const up = debriefOf(
        ranked({
            ranked: {
                size: 3,
                tier: "Contractor",
                change: {
                    before: 1638,
                    after: 1655,
                    tier: { before: "Contractor", after: "Operative" },
                },
            },
        }),
    );
    assert.deepEqual(up.lines, ["Ranked 3x3 · Contractor", "New rank: Operative"]);
    assert.equal(
        debriefOf(ranked({ ranked: { size: 3, tier: "Rookie", change: null } })).rating,
        null,
    );
    const noShow = debriefOf(ranked({ outcome: "no-show", squad: [], fallen: [] }));
    assert.match(noShow.note!, /Squad not shown in time/);
    const d = debriefOf(ranked());
    const copy = [
        d.title,
        d.note ?? "",
        ...(d.lines ?? []),
        ...d.plates.map((p) => ("hint" in p ? (p.hint ?? "") : "")),
    ];
    assert.doesNotMatch(copy.join(" "), /XP|experience|dog tag|Hire|recruit/i);
});
