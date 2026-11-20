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
    clearUnit,
    cr,
    crDelta,
    gearSections,
    leavesText,
    savedSquadRefusal,
    squadIssues,
    tierLimits,
    typeName,
    typeSection,
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

test("credit labels always carry their unit", () => {
    assert.equal(cr(55), "55 cr");
    assert.equal(crDelta(15), "+15 cr");
    assert.equal(crDelta(-10), "−10 cr");
    assert.equal(crDelta(0), "+0 cr");
    assert.equal(leavesText(25), "leaves 25 cr");
    assert.equal(leavesText(-20), "20 cr over");
    assert.equal(leavesText(null), "No limit");
});

test("a unit is built in two steps: type first, then its equipment", () => {
    const limits = tierLimits(RATING, "3x3");
    const squad = defaultSquad(RATING, "3x3");
    const types = typeSection(squad, 0, limits);
    assert.ok(types.options.every((o) => o.group === "preset"));
    const gear = gearSections(squad, 0, limits);
    assert.deepEqual(
        gear.map((s) => s.group),
        ["weapon", "armor", "utility"],
    );
    // a place with no unit offers no equipment, only types
    const empty = clearUnit(squad, 1);
    assert.equal(empty[1], null);
    assert.deepEqual(gearSections(empty, 1, limits), []);
    assert.ok(typeSection(empty, 1, limits).options.length > 0);
    // choosing a type resets the equipment to the type's kit
    const swapped = swapItem(squad, 0, "armor", "armor-1", RATING);
    const assault = typeSection(swapped, 0, limits).options.find(
        (o) => o.key === "preset:assault",
    )!;
    const back = applyOption(swapped, 0, assault, RATING);
    assert.deepEqual(back[0], PRESETS.find((p) => p.id === "assault")!.loadout);
});

test("saved types are listed under the built-in ones and choose their own loadout", () => {
    const limits = tierLimits(RATING, "3x3");
    const squad = defaultSquad(RATING, "3x3");
    const loadout: Loadout = {
        preset: "assault",
        weapon: "rifle-1",
        armor: "armor-1",
        utility: null,
    };
    const mine = [{ id: "t1", name: "Breacher", loadout }];
    const options = typeSection(squad, 0, limits, mine).options;
    const own = options.filter((o) => o.mine);
    assert.equal(own.length, 1);
    assert.equal(options[options.length - 1].key, "mine:t1");
    assert.deepEqual(applyOption(squad, 0, own[0], RATING)[0], loadout);
    assert.equal(typeName(loadout, RATING, mine), "Breacher");
    assert.equal(typeName(loadout, RATING), "Assault · modified");
    // a saved type with gear above the tier is locked with its reason
    const heavy = [{ id: "t2", name: "Tank", loadout: { ...loadout, armor: "armor-3" } }];
    const locked = typeSection(squad, 0, tierLimits(0, "3x3"), heavy).options.find((o) => o.mine)!;
    assert.match(locked.locked!, /^Unlocks at /);
    assert.equal(applyOption(squad, 0, locked, 0), squad);
});

test("issues name the place, an empty place is one, and the budget is the one given", () => {
    const squad = clearUnit(defaultSquad(RATING, "3x3"), 1);
    const issues = squadIssues(squad, RATING, "3x3");
    const empty = issues.find((i) => i.unit === 1);
    assert.ok(empty && /unit 2/i.test(empty.message));
    assert.equal(startGate(squad, RATING, "3x3").ok, false);
    // no limit: the dearest squad is never over budget
    const top = TIERS[TIERS.length - 1].min;
    const dear = defaultSquad(top, "4x4", Number.POSITIVE_INFINITY);
    assert.deepEqual(squadIssues(dear, top, "4x4", null), []);
    assert.equal(budgetView(dear, top, "4x4", null).left, null);
    // a small budget the host set is enforced
    const tight = squadIssues(dear, top, "4x4", 10);
    assert.ok(tight.some((i) => i.kind === "over-budget" && i.message.includes("cr")));
    // a locked item names the unit's place, not its place among the filled ones
    const locked = [null, { ...squad[0]!, weapon: "rifle-3" }, squad[2]];
    const found = squadIssues(locked, TIERS[0].min, "3x3").find((i) => i.kind === "locked");
    assert.equal(found?.unit, 1);
});

test("a saved squad that does not fit says why", () => {
    const squad = defaultSquad(RATING, "3x3") as Loadout[];
    assert.equal(savedSquadRefusal(squad, RATING, "3x3", budgetOf(RATING, "3x3")), null);
    assert.match(savedSquadRefusal(squad, RATING, "3x3", 10)!, /cr over the budget$/);
    const plasma = squad.map((u) => ({ ...u, weapon: "rifle-3" }));
    assert.match(savedSquadRefusal(plasma, TIERS[0].min, "3x3", null)!, /unlocks at/);
});

test("stored squads keep empty places and drop junk", () => {
    const squad = clearUnit(defaultSquad(RATING, "3x3"), 2);
    const back = parseSaved(serializeSaved({ ...emptySaved(), squads: { "3x3": squad } }));
    assert.deepEqual(back.squads["3x3"], squad);
    assert.deepEqual(parseSaved('{"v":1,"squads":{"3x3":[null,null,null]}}').squads, {});
});

test("the builder brings its own styles, so any screen that mounts it is laid out", async () => {
    const { readFileSync } = await import("node:fs");
    const builder = readFileSync(
        new URL("../src/features/play/ranked/SquadBuilder.tsx", import.meta.url),
        "utf8",
    );
    assert.match(builder, /import "\.\/ranked\.css"/);
    const bar = readFileSync(new URL("../src/ui/gui.css", import.meta.url), "utf8");
    // The bar's confirm keeps one width whatever the pointer rests on.
    assert.match(
        bar,
        /\.gui-bar-commands \.gui-cmd\[data-action="confirm"\] \{\s+flex: none;\s+width:/,
    );
});

// === The search and the wait (search.ts, waiting.ts, field.ts) ==============

import { FIXTURES as F } from "./ranked-fixtures.ts";
import { Game } from "../src/chain/bcs.ts";
import { encodeSquad, hexOf } from "../src/chain/ranked-core.ts";
import { applyRules, DEFAULT_RULES, sizeOpen } from "../src/features/play/economy/index.ts";
import { mapUnits, rankedField } from "../src/features/play/ranked/field.ts";
import {
    findAction,
    searchCard,
    type RankedSearchState,
} from "../src/features/play/ranked/search.ts";
import { waitingView } from "../src/features/play/ranked/waiting.ts";

const SEARCH: RankedSearchState = {
    signedIn: true,
    loading: false,
    playing: false,
    lobby: false,
    contract: false,
    suspendedMin: 0,
    open: true,
    mode: "3x3",
    phase: "idle",
    sinceMs: null,
    now: 1_000_000,
    ttlMs: 300_000,
    busy: false,
    tier: "Contractor",
    units: 3,
    spent: 145,
};
const search = (patch: Partial<RankedSearchState> = {}) => ({ ...SEARCH, ...patch });

test("Find ranked game: sign in, resume, or why it waits, in the order that matters", () => {
    assert.equal(findAction(search({ signedIn: false }), null).id, "sign-in");
    assert.equal(findAction(search({ playing: true }), null).id, "resume");
    assert.equal(findAction(search(), null).deny, undefined);
    assert.equal(findAction(search(), "Unit 2: needs a weapon.").deny, "Unit 2: needs a weapon.");
    assert.equal(findAction(search({ lobby: true }), null).deny, "Leave your friendly match first");
    assert.equal(
        findAction(search({ contract: true }), null).deny,
        "Cancel your contract search first",
    );
    assert.equal(findAction(search({ suspendedMin: 2 }), null).deny, "Suspended for 2 min");
    assert.equal(findAction(search({ open: false, mode: "4x4" }), null).deny, "No 4x4 level yet");
    assert.equal(
        findAction(search({ phase: "searching" }), null).deny,
        "Searching for an opponent",
    );
    // A refusal or a search that ran out leaves the way open to try again.
    assert.equal(findAction(search({ phase: "refused" }), null).deny, undefined);
    assert.equal(findAction(search({ phase: "expired" }), null).deny, undefined);
});

test("the search card: joining, waiting with its clock, past the ticket, ran out, refused", () => {
    assert.equal(searchCard(search()), null);
    const checking = searchCard(search({ phase: "checking" }))!;
    assert.equal(checking.back.deny, "Checking the queue");
    const joining = searchCard(search({ phase: "sending-wait" }))!;
    assert.equal(joining.title, "Joining the queue");
    assert.equal(joining.pending, true);
    assert.equal(searchCard(search({ phase: "sending-match" }))!.title, "Opponent found");
    const waiting = searchCard(search({ phase: "searching", sinceMs: 1_000_000 - 84_000 }))!;
    assert.equal(waiting.title, "Looking for an opponent");
    assert.deepEqual(waiting.lines[0], ["Searching", "1:24"]);
    assert.deepEqual(waiting.lines[2], ["Squad", "3 units · 145 cr"]);
    // Cancel works as soon as the account shows the search; only another write holds it.
    assert.equal(waiting.back.label, "Cancel search");
    assert.equal(waiting.back.deny, undefined);
    assert.equal(
        searchCard(search({ phase: "searching", sinceMs: 0, busy: true }))!.back.deny,
        "Saving a change",
    );
    const out = searchCard(search({ phase: "searching", sinceMs: 1_000_000 - 301_000 }))!;
    assert.equal(out.phase, "timeout");
    assert.equal(out.back.label, "Leave the queue");
    const expired = searchCard(search({ phase: "expired" }))!;
    assert.equal(expired.title, "No match found");
    assert.equal(expired.primary?.label, "Search again");
    assert.equal(expired.back.label, "Close");
    const refused = searchCard(
        search({ phase: "refused", line: "The squad costs more than your budget" }),
    )!;
    assert.deepEqual(refused.lines, [["Reason", "The squad costs more than your budget"]]);
    for (const phase of ["checking", "sending-wait", "searching", "expired", "refused"] as const) {
        const card = searchCard(search({ phase, sinceMs: 0 }))!;
        assert.doesNotMatch(
            [card.title, card.hint, ...card.lines.flat()].join(" "),
            /chain|testnet|mock|preview|!/i,
        );
    }
});

test("4x4 is offered only once the rules give it a level", () => {
    applyRules(DEFAULT_RULES);
    assert.equal(sizeOpen("3x3"), true);
    assert.equal(sizeOpen("4x4"), false);
    applyRules({ ...DEFAULT_RULES, open: { "3x3": true, "4x4": true } });
    assert.equal(sizeOpen("4x4"), true);
    applyRules(DEFAULT_RULES);
});

test("the wait before a ranked game: showing the squad, lost, late, the finder's wait", () => {
    const at = { deadline: 60_000, now: 15_000, title: "Ranked 3x3", busy: false };
    const revealing = waitingView({ ...at, phase: "revealing" });
    assert.equal(revealing.headline, "Opponent found");
    assert.equal(revealing.left, "0:45");
    assert.equal(revealing.pending, true);
    assert.equal(
        waitingView({ ...at, phase: "lost" }).note,
        "This squad can no longer be shown; the match is forfeit",
    );
    assert.equal(waitingView({ ...at, phase: "late" }).left, null);
    assert.match(
        waitingView({ ...at, phase: "failed", line: "The time to show the squad is over" }).note,
        /time to show/,
    );
    const waiting = waitingView({ ...at, phase: "waiting" });
    assert.match(waiting.note, /Waiting for your opponent/);
    const called = waitingView({ ...at, now: 61_000, phase: "called" });
    assert.equal(called.action?.label, "Continue");
    assert.equal(
        waitingView({ ...at, phase: "called", busy: true }).action?.deny,
        "Saving a change",
    );
});

test("a ranked field: the player's names from the builder, the opponent's by role, both dressed", () => {
    const game = Game.parse(Buffer.from(F.gameRankedPlaying, "hex"));
    const side = game.players.indexOf(`0x${F.aliceId}`);
    const alice = encodeSquad([
        { weapon: "rifle-1", armor: "armor-2", utility: "frag-grenade" },
        { weapon: "rifle-2", armor: "armor-1", utility: null },
        { weapon: "rifle-1", armor: "armor-1", utility: "flashbang" },
    ]);
    const field = rankedField(game, game.id, side, mapUnits(game), {
        squad: hexOf(alice),
        labels: ["Breacher", "Sniper · modified", "Scout"],
    });
    assert.deepEqual([...field.mine.names].sort(), ["Breacher", "Scout", "Sniper"]);
    assert.deepEqual([...field.theirs.names].sort(), ["Assault", "Assault-2", "Runner"]);
    assert.equal(field.squad.length, 3);
    assert.deepEqual(
        field.squad.map((r) => r.id),
        field.mine.ids,
    );
    assert.equal(field.looks.size, 3);
    for (const id of field.theirs.ids) assert.ok(field.names.get(id));
    // Without the builder's names (another device), its own units go by role too.
    const bare = rankedField(game, game.id, side, mapUnits(game), null);
    assert.deepEqual([...bare.mine.names].sort(), ["Assault", "Recruit", "Sniper"]);
});
