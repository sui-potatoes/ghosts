// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { applyRules, DEFAULT_RULES } from "../src/features/play/economy/index.ts";
import {
    cardOf,
    CONTRACT_NAME,
    DEMO_SCENARIOS,
    modeCards,
    rankedFacts,
    routeOf,
} from "../src/features/play/model.ts";
import { NEW_PLAYER, standingOf } from "../src/features/play/rating.ts";
import { parentOf } from "../src/routes.ts";

test("the cards in order: ranked, friendly, contract, demo, faction wars, spectate", () => {
    assert.deepEqual(
        modeCards().map((c) => c.id),
        ["ranked", "friendly", "contract", "demo", "factions", "watch"],
    );
    assert.equal(cardOf("watch").name, "Spectate");
    assert.deepEqual(cardOf("watch").lines, ["Live matches and replays"]);
    assert.equal(cardOf("contract").name, CONTRACT_NAME);
    assert.deepEqual(cardOf("contract").lines, [
        "Your own recruits. They earn experience and can be lost",
        "Rating does not change",
    ]);
    for (const card of modeCards()) {
        assert.ok(card.name && card.verb && card.hint && card.tag);
        assert.ok(card.lines.length >= 1 && card.lines.length <= 3);
    }
});

test("ranked, friendly, contract and demo open their screens", () => {
    assert.equal(routeOf("ranked"), "/play/ranked");
    assert.equal(routeOf("friendly"), "/play/friendly");
    assert.equal(routeOf("contract"), "/play/contract");
    assert.equal(routeOf("demo"), "/play/training");
    assert.deepEqual(
        DEMO_SCENARIOS.map((d) => [d.name, d.route]),
        [
            ["Black Rain", "/demo"],
            ["Paper Trail", "/demo-2"],
        ],
    );
    assert.equal(cardOf("ranked").locked, undefined);
    assert.equal(cardOf("friendly").locked, undefined);
});

test("faction wars is inactive with a reason and opens nothing", () => {
    const factions = cardOf("factions");
    assert.ok(factions.locked);
    assert.equal(routeOf("factions"), null);
    assert.equal(factions.route, null);
    // The teaser follows the design: three corporations, missions, influence, standing.
    const copy = factions.lines.join(" ").toLowerCase();
    for (const word of ["three corporations", "missions", "influence", "standing"])
        assert.ok(copy.includes(word), word);
});

test("no card names the chain or a key", () => {
    for (const card of modeCards())
        assert.doesNotMatch(
            [card.name, card.hint, card.locked ?? "", ...card.lines].join(" "),
            /chain|wallet|enter|esc|pause|rewind|at any time|turn by turn/i,
        );
});

test("a search, a lobby or a game leads its own card back and holds the others", () => {
    const ranked = modeCards({ kind: "searching", mode: "ranked" });
    const by = (cards: ReturnType<typeof modeCards>, id: string) => cards.find((c) => c.id === id)!;
    assert.equal(by(ranked, "ranked").tag, "Searching");
    assert.equal(by(ranked, "ranked").locked, undefined);
    assert.equal(by(ranked, "friendly").locked, "Cancel your ranked search first");
    assert.equal(by(ranked, "contract").locked, "Cancel your ranked search first");
    const contract = modeCards({ kind: "searching", mode: "contract" });
    assert.equal(by(contract, "ranked").locked, "Cancel your contract search first");
    const lobby = modeCards({ kind: "lobby" });
    assert.equal(by(lobby, "friendly").tag, "In lobby");
    assert.equal(by(lobby, "ranked").locked, "Leave your friendly match first");
    const playing = modeCards({ kind: "playing", mode: "ranked" });
    assert.equal(by(playing, "ranked").route, "/match");
    assert.equal(by(playing, "ranked").verb, "Resume");
    assert.equal(by(playing, "contract").locked, "Finish your match first");
    // Demo, faction wars and spectate are never held.
    for (const cards of [ranked, contract, lobby, playing]) {
        assert.equal(by(cards, "demo").locked, undefined);
        assert.equal(by(cards, "watch").locked, undefined);
    }
});

test("the screen reads as a finished product: no preview or this-device disclaimers", () => {
    const copy = modeCards().flatMap((c) => [
        c.name,
        c.hint,
        c.verb,
        c.tag ?? "",
        c.locked ?? "",
        ...c.lines,
    ]);
    assert.doesNotMatch(copy.join(" "), /preview|mock|this device|for now/i);
    const screen = readFileSync(
        new URL("../src/features/play/PlayScreen.tsx", import.meta.url),
        "utf8",
    );
    const panels = readFileSync(
        new URL("../src/features/settings/panels.tsx", import.meta.url),
        "utf8",
    );
    const rating = panels.slice(
        panels.indexOf("function RankedBlock"),
        panels.indexOf("function NamePrompt"),
    );
    assert.ok(rating.length > 0);
    for (const text of [screen, rating]) assert.doesNotMatch(text, /Preview:|this device|for now/i);
});

test("the ranked facts are the player's standing, the sizes without a level left out", () => {
    applyRules(DEFAULT_RULES);
    const placed = standingOf({
        ...NEW_PLAYER,
        rating: { rating: 1720, deviation: 90 },
        score: { wins: 8, losses: 4, draws: 0 },
    });
    assert.deepEqual(rankedFacts(placed), {
        tier: "Operative",
        rating: 1720,
        budgets: [{ mode: "3x3", budget: 190 }],
        placementLeft: 0,
    });
    applyRules({ ...DEFAULT_RULES, open: { "3x3": true, "4x4": true } });
    assert.deepEqual(rankedFacts(standingOf(NEW_PLAYER)).budgets, [
        { mode: "3x3", budget: 150 },
        { mode: "4x4", budget: 200 },
    ]);
    assert.equal(rankedFacts(standingOf(NEW_PLAYER)).placementLeft, 5);
    applyRules(DEFAULT_RULES);
});

test("Back from a mode screen goes up to Play; Play's parent is the menu", () => {
    assert.equal(parentOf("/play"), "/");
    for (const p of ["/play/ranked", "/play/friendly", "/play/contract", "/play/training"])
        assert.equal(parentOf(p), "/play");
    // A demo operation goes back to the demo's list.
    assert.equal(parentOf("/demo"), "/play/training");
    assert.equal(parentOf("/demo-2"), "/play/training");
});

test("the numbers on the Play screen carry their unit or label", () => {
    assert.equal(cardOf("factions").locked, "Not open");
    const screen = readFileSync(
        new URL("../src/features/play/PlayScreen.tsx", import.meta.url),
        "utf8",
    );
    assert.match(screen, /\{b\.budget\} cr/);
    assert.match(screen, /\{b\.mode\} budget/);
    assert.doesNotMatch(screen, /credits</);
    const panels = readFileSync(
        new URL("../src/features/settings/panels.tsx", import.meta.url),
        "utf8",
    );
    assert.match(panels, /r\.budgets\["3x3"\]\} cr/);
    assert.match(panels, /r\.budgets\["4x4"\]\} cr/);
});

test("signed out, the modes that need an account lead to sign in; the rest stay open", () => {
    const cards = modeCards(null, false);
    const by = (id: string) => cards.find((c) => c.id === id)!;
    for (const id of ["ranked", "friendly", "contract"]) {
        assert.equal(by(id).tag, "Sign in", id);
        assert.equal(by(id).verb, "Sign in", id);
        assert.equal(by(id).hint, "Sign in to play", id);
        assert.equal(by(id).signIn, true, id);
        assert.equal(by(id).locked, undefined, id);
    }
    for (const id of ["demo", "watch"]) {
        assert.equal(by(id).tag, "Open", id);
        assert.equal(by(id).signIn, undefined, id);
    }
    assert.equal(by("factions").tag, "Soon");
    // Signed in, with or without an account on file, they are open.
    for (const card of modeCards(null, true)) assert.equal(card.signIn, undefined);
});
