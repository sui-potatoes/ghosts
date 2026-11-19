// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { demoLevels } from "../../packages/engine/src/editor/from-plan.ts";
import { toMoveMap } from "../../packages/engine/src/editor/level.ts";
import { scenarioFromLevel } from "../../packages/engine/src/editor/playtest.ts";
import { deploymentIssues } from "../../packages/engine/src/editor/preset.ts";
import { initialUnits } from "../../packages/engine/src/game.ts";
import { deploymentLoadouts } from "../../packages/engine/src/squad-bridge.ts";
import type { EncounterDebrief } from "../../packages/engine/src/aftermath/report.ts";
import {
    defaultSquad,
    presetOf,
    squadSize,
    tierOf,
    unitStats,
    validateSquad,
    type Loadout,
    type Mode,
} from "../src/features/play/economy/index.ts";
import {
    BASIC_KIT,
    fieldKit,
    fieldRole,
    gearLine,
    matchPlan,
    mockDebriefOf,
    opponentFaces,
    opponentLooks,
    opponentSquad,
    parseMatch,
    playerFaces,
    presetName,
    ratingLines,
    settleMatch,
    spawnsFor,
    virtualRecruits,
    type MockMatch,
    type TextSlot,
} from "../src/features/play/match/model.ts";
import {
    applyResult,
    DEFAULT_RATING,
    parseRating,
    type RatingState,
} from "../src/features/play/rating.ts";

const preset = (id: string): Loadout => ({ ...presetOf(id)!.loadout });

const match = (over: Partial<MockMatch> = {}): MockMatch => ({
    kind: "ranked",
    mode: "3x3",
    squad: defaultSquad(DEFAULT_RATING, "3x3"),
    opponent: { name: "Nightjar", rating: 1520 },
    returnTo: "/play/ranked",
    id: "m-test",
    ...over,
});

// === Loadout → engine unit ===

test("a loadout maps to squad catalog ids slot by slot", () => {
    assert.deepEqual(fieldKit(preset("assault")), {
        primary: "mx4",
        armor: "nyx-mid",
        utility: "frag",
    });
    assert.deepEqual(fieldKit(preset("sniper")), {
        primary: "srs9",
        armor: "spectre",
        utility: null,
    });
    assert.deepEqual(fieldKit(preset("heavy")), {
        primary: "plasma",
        armor: "nyx-heavy",
        utility: null,
    });
    assert.equal(fieldRole(fieldKit(preset("sniper"))), "RECON");
    assert.equal(fieldRole(fieldKit(preset("heavy"))), "HEAVY");
    assert.equal(fieldRole(fieldKit(preset("assault"))), "ASSAULT");
});

test("unknown ids fall back to the basic kit with a warning", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const kit = fieldKit({
        preset: "ghost",
        weapon: "railgun-9",
        armor: "exo-suit",
        utility: "drone",
    });
    assert.deepEqual(kit, BASIC_KIT);
    assert.equal(warn.mock.callCount(), 3);
    // A slot the squad catalog has, but not for that slot: armor in the weapon slot.
    const wrong = fieldKit({ preset: "x", weapon: "armor-2", armor: "armor-1", utility: null });
    assert.equal(wrong.primary, "mx4");
    assert.equal(wrong.armor, "spectre");
    // Each unknown id warns once.
    fieldKit({ preset: "ghost", weapon: "railgun-9", armor: "exo-suit", utility: "drone" });
    assert.equal(warn.mock.callCount(), 4);
});

test("virtual recruits fight with the economy's numbers in the engine", () => {
    const squad: Loadout[] = [preset("assault"), preset("sniper"), preset("heavy")];
    const plan = matchPlan(match({ squad, opponent: { name: "Nightjar", rating: 2000 } }));
    const recruits = virtualRecruits(plan.player, plan.seed);
    assert.deepEqual(
        recruits.map((r) => r.id),
        ["a1", "a2", "a3"],
    );
    assert.equal(new Set(recruits.map((r) => r.callsign)).size, 3);
    assert.deepEqual(recruits[2].equipment, {
        primary: "plasma",
        sidearm: "k12",
        armor: "nyx-heavy",
        utility: null,
    });

    const { level } = demoLevels[0].build();
    const scenario = scenarioFromLevel({ ...level, spawns: spawnsFor(level.spawns, "3x3") });
    const units = initialUnits(scenario);
    units.filter((u) => !u.enemy).forEach((u, i) => (u.id = recruits[i].id));
    const loadouts = deploymentLoadouts(recruits, units, scenario);
    squad.forEach((loadout, i) => {
        const fit = loadouts.get(`a${i + 1}`)!.fit;
        const stats = unitStats(loadout);
        assert.equal(fit.hp, stats.hp, `${loadout.preset} hp`);
        assert.equal(fit.armor, stats.armor, `${loadout.preset} armor`);
        assert.equal(fit.aim, stats.aim, `${loadout.preset} aim`);
        assert.equal(fit.mobility, stats.mobility, `${loadout.preset} mobility`);
    });
    // The assault's grenade is a Grenade order; the sniper carries none.
    assert.ok(loadouts.get("a1")!.actions.some((a) => a.kind === "Grenade"));
    assert.ok(!loadouts.get("a2")!.actions.some((a) => a.kind === "Grenade"));
});

// === The opponent ===

test("the opponent squad is legal, sized to the mode and fixed by the seed", () => {
    for (const rating of [900, 1500, 1700, 2100])
        for (const mode of ["3x3", "4x4"] as Mode[])
            for (let seed = 1; seed < 40; seed++) {
                const squad = opponentSquad(rating, mode, seed);
                assert.equal(squad.length, squadSize(mode));
                assert.deepEqual(
                    validateSquad(squad, rating, mode),
                    [],
                    `${rating} ${mode} seed ${seed}`,
                );
                assert.deepEqual(opponentSquad(rating, mode, seed), squad);
            }
});

test("different seeds give different opponents", () => {
    const squads = new Set(
        Array.from({ length: 12 }, (_, seed) =>
            JSON.stringify(opponentSquad(1700, "4x4", seed * 7919)),
        ),
    );
    assert.ok(squads.size >= 4, `only ${squads.size} distinct squads`);
});

test("a match plan is the same for the same match, new for a new one", () => {
    const a = matchPlan(match());
    assert.deepEqual(matchPlan(match()), a);
    const b = matchPlan(match({ id: "m-other" }));
    assert.notDeepEqual(
        [b.opponent.callsigns, b.opponent.loadouts, b.player.callsigns],
        [a.opponent.callsigns, a.opponent.loadouts, a.player.callsigns],
    );
    assert.deepEqual(a.opponent.ids, ["b1", "b2", "b3"]);
});

// === Spawns ===

test("Black Rain deploys three a side for 3x3 and four a side for 4x4", () => {
    const { level } = demoLevels[0].build();
    const tiles = toMoveMap(level).tiles;
    for (const mode of ["3x3", "4x4"] as Mode[]) {
        const spawns = spawnsFor(level.spawns, mode);
        assert.equal(spawns.a.length, squadSize(mode));
        assert.equal(spawns.b.length, squadSize(mode));
        const played = { ...level, spawns };
        delete played.objective;
        assert.deepEqual(deploymentIssues(played), []);
        for (const [x, z] of spawns.b)
            assert.equal(tiles[z][x].t, "empty", `side B ${x},${z} is open ground`);
        const scenario = scenarioFromLevel(played);
        assert.equal(scenario.units.filter((u) => u.enemy).length, squadSize(mode));
        assert.equal(scenario.noObjective, true);
    }
});

// === The result ===

const report = (victory: boolean, fallen: string[] = []): EncounterDebrief => ({
    operation: "Ranked 3x3",
    sector: "Black Rain",
    report: {
        victory,
        turns: 7,
        survivors: 3 - fallen.length,
        recruits: ["a1", "a2", "a3"].map((id, i) => ({
            id,
            name: `UNIT${i}`,
            full: `Unit ${i}`,
            role: "ASSAULT",
            kia: fallen.includes(id),
            kills: i,
            xp: 0,
            level: 1,
            progress: 0,
        })),
    },
});

function harness(start: Partial<RatingState> = {}) {
    let state: RatingState = { ...parseRating(null), ...start };
    let stored: string | null = null;
    let writes = 0;
    const ledger: TextSlot = { get: () => stored, set: (v) => (stored = v) };
    return {
        deps: {
            ledger,
            read: () => state,
            write: (next: RatingState) => {
                writes++;
                state = next;
            },
        },
        state: () => state,
        writes: () => writes,
    };
}

test("a ranked result moves the rating exactly once", () => {
    const h = harness();
    const m = match();
    const first = settleMatch(m, "victory", report(true), h.deps);
    const expected = applyResult(parseRating(null), 1520, true);
    assert.equal(first.rating!.before, DEFAULT_RATING);
    assert.equal(first.rating!.after, expected.rating);
    assert.equal(first.rating!.delta, expected.rating - DEFAULT_RATING);
    assert.ok(first.rating!.delta > 0);
    // A double effect, a reload of the debrief: the same record, no second step.
    const again = settleMatch(m, "defeat", report(false), h.deps);
    assert.deepEqual(again, first);
    assert.equal(h.writes(), 1);
    assert.equal(h.state().rating, expected.rating);
    // A new match settles on its own.
    settleMatch(match({ id: "m-next" }), "defeat", report(false), h.deps);
    assert.equal(h.writes(), 2);
});

test("a forfeit counts as a loss in ranked", () => {
    const h = harness();
    const settled = settleMatch(match(), "forfeit", report(false), h.deps);
    assert.ok(settled.rating!.delta < 0);
    assert.equal(h.state().losses, 1);
});

test("a friendly leaves the rating alone", () => {
    const h = harness();
    const settled = settleMatch(match({ kind: "friendly" }), "victory", report(true), h.deps);
    assert.equal(settled.rating, null);
    assert.equal(h.writes(), 0);
    assert.deepEqual(ratingLines("friendly", null), ["Friendly match: rating unchanged"]);
});

test("the debrief names the outcome, the units and the rating step", () => {
    const h = harness({ rating: 1395, peak: 1395 });
    const m = match({ opponent: { name: "Nightjar", rating: 1700 } });
    const settled = settleMatch(m, "victory", report(true, ["a2"]), h.deps);
    const debrief = mockDebriefOf(m, matchPlan(m), settled);
    assert.equal(debrief.title, "Victory");
    assert.equal(debrief.tone, "win");
    assert.equal(debrief.plates.length, 3);
    assert.deepEqual(
        debrief.plates.map((p) => p.kind),
        ["home", "kia", "home"],
    );
    const { before, after, delta } = settled.rating!;
    assert.ok(debrief.lines!.includes(`Rating ${before} → ${after} · +${delta}`));
    // 1395 is Rookie; a win over 1700 lifts it past 1400.
    assert.ok(after >= 1400);
    assert.ok(
        debrief.lines!.includes(`Rank Rookie → ${tierOf(after).name}`),
        debrief.lines!.join(" | "),
    );
    const forfeit = mockDebriefOf(m, matchPlan(m), { ...settled, outcome: "forfeit" });
    assert.equal(forfeit.title, "Match forfeited");
    assert.equal(forfeit.note, "Counts as a loss");
});

test("a staged match reads back only when it is whole", () => {
    assert.equal(parseMatch(null), null);
    assert.equal(parseMatch("{"), null);
    assert.equal(parseMatch(JSON.stringify({ kind: "ranked", mode: "5x5", squad: [] })), null);
    const m = match();
    assert.deepEqual(parseMatch(JSON.stringify(m)), m);
});

test("a modified unit is named so on the versus card and the debrief plate", () => {
    const assault = preset("assault");
    const modified: Loadout = { ...assault, armor: "armor-1" };
    assert.equal(presetName(assault), "Assault");
    assert.equal(presetName(modified), "Assault · modified");
    assert.match(gearLine(modified), /Standard Rifle · Light Armor/);
});

test("the opponent's units wear their kit's armor and faces the player's units do not", () => {
    for (const mode of ["3x3", "4x4"] as const) {
        for (const id of ["m-a", "m-b", "m-c", "m-d", "m-e"]) {
            const plan = matchPlan(match({ mode, squad: defaultSquad(DEFAULT_RATING, mode), id }));
            const size = squadSize(mode);
            const mine = playerFaces(plan.seed, size).map((f) => f.name);
            const theirs = opponentFaces(plan.seed, size).map((f) => f.name);
            assert.equal(theirs.length, size);
            assert.equal(new Set(theirs).size, size, "no face twice in a squad");
            // the six presets cover two squads of three; a 4x4 can repeat only what it must
            const shared = theirs.filter((name) => mine.includes(name)).length;
            assert.ok(shared <= Math.max(0, 2 * size - 6), `${shared} shared`);
            const looks = opponentLooks(plan);
            assert.deepEqual(
                looks.map((l) => l.armor),
                plan.opponent.kits.map((k) => k.armor),
            );
            // same seed, same result
            assert.deepEqual(
                opponentFaces(plan.seed, size).map((f) => f.name),
                theirs,
            );
        }
    }
});
