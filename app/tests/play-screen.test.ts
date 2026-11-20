// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { budgetOf, tierOf } from "../src/features/play/economy/index.ts";
import { cardOf, modeCards, rankedFacts, routeOf } from "../src/features/play/model.ts";
import { parentOf } from "../src/routes.ts";

test("three cards in order: ranked, friendly, faction wars", () => {
    assert.deepEqual(
        modeCards().map((c) => c.id),
        ["ranked", "friendly", "factions", "watch"],
    );
    for (const card of modeCards()) {
        assert.ok(card.name && card.verb && card.hint && card.tag);
        assert.ok(card.lines.length >= 1 && card.lines.length <= 3);
    }
});

test("ranked and friendly open their screens", () => {
    assert.equal(routeOf("ranked"), "/play/ranked");
    assert.equal(routeOf("friendly"), "/play/friendly");
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
            /chain|wallet|enter|esc/i,
        );
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

test("the ranked facts are whatever the economy returns", () => {
    for (const rating of [0, 1500, 99_999]) {
        const facts = rankedFacts(rating);
        assert.equal(facts.tier, tierOf(rating).name);
        assert.equal(facts.rating, rating);
        assert.deepEqual(facts.budgets, [
            { mode: "3x3", budget: budgetOf(rating, "3x3") },
            { mode: "4x4", budget: budgetOf(rating, "4x4") },
        ]);
    }
});

test("Back from a mode screen goes up to Play; Play's parent is the menu", () => {
    assert.equal(parentOf("/play"), "/");
    for (const p of ["/play/ranked", "/play/friendly", "/play/match"])
        assert.equal(parentOf(p), "/play");
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
    assert.match(panels, /budgetOf\(r\.rating, "3x3"\)\} cr/);
    assert.match(panels, /budgetOf\(r\.rating, "4x4"\)\} cr/);
});
