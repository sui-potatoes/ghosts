// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked standing as the app reads it from the `Account` (`features/play/rating.ts`)
 * and the rating reset's gate (`chain/ranked-core.ts`, `account::reset_rating`'s checks in
 * its order). No rating is stored on the device any more.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { availableIn, resetDeny } from "../src/chain/ranked-core.ts";
import {
    applyRules,
    DEFAULT_RULES,
    economyRules,
    standingRating,
} from "../src/features/play/economy/index.ts";
import {
    DEFAULT_RATING,
    NEW_PLAYER,
    ratingChange,
    standingOf,
} from "../src/features/play/rating.ts";

const DAY = 86_400_000;

const account = (rating: number, wins = 0, losses = 0, draws = 0, resets = 0, lastResetMs = 0) => ({
    ...NEW_PLAYER,
    rating: { rating: String(rating), deviation: "120" },
    score: { wins: String(wins), losses: String(losses), draws: String(draws) },
    resets,
    lastResetMs: String(lastResetMs),
});

test("the standing reads the account: rating, ranked games, tier, budgets, resets", () => {
    applyRules(DEFAULT_RULES);
    const s = standingOf(account(1720, 7, 4, 1, 2, 5 * DAY));
    assert.equal(s.rating, 1720);
    assert.equal(s.deviation, 120);
    assert.equal(s.games, 12);
    assert.deepEqual([s.wins, s.losses, s.draws], [7, 4, 1]);
    assert.equal(s.tier.name, "Operative");
    assert.deepEqual(s.budgets, { "3x3": 190, "4x4": 255 });
    assert.equal(s.placementLeft, 0);
    assert.equal(s.resets, 2);
    assert.equal(s.lastResetMs, 5 * DAY);
});

test("the placement floor: fewer than 5 ranked games stand at Contractor at least", () => {
    applyRules(DEFAULT_RULES);
    const fresh = standingOf(NEW_PLAYER);
    assert.equal(fresh.rating, DEFAULT_RATING);
    assert.equal(fresh.tier.name, "Contractor");
    assert.equal(fresh.placementLeft, 5);
    // A placing player below Contractor's floor still builds to Contractor's budget.
    const low = standingOf(account(1340, 1, 2));
    assert.equal(low.tier.name, "Contractor");
    assert.equal(low.budgets["3x3"], 150);
    assert.equal(low.placementLeft, 2);
    // Placed, the rating alone decides.
    assert.equal(standingOf(account(1340, 3, 2)).tier.name, "Rookie");
    assert.equal(standingRating(1340, 5), 1340);
    assert.equal(standingRating(1340, 4), 1400);
    assert.equal(standingRating(1800, 0), 1800);
});

test("the live rules move the standing without a new app", () => {
    applyRules({
        ...DEFAULT_RULES,
        version: 3,
        placement: { games: 2, tier: 0 },
        tiers: DEFAULT_RULES.tiers.map((t, i) => (i === 2 ? { ...t, min: 1700 } : t)),
    });
    assert.equal(standingOf(account(1680, 5, 5)).tier.name, "Contractor");
    assert.equal(standingOf(NEW_PLAYER).tier.name, "Contractor");
    assert.equal(standingOf(account(1300, 1, 0)).tier.name, "Rookie");
    applyRules(DEFAULT_RULES);
    assert.equal(economyRules().version, 0);
});

test("a ranked game's change: the rating and the tier, the placement floor at each end", () => {
    applyRules(DEFAULT_RULES);
    assert.deepEqual(ratingChange({ rating: 1640, games: 10 }, { rating: 1656, games: 11 }), {
        before: 1640,
        after: 1656,
        delta: 16,
        tier: { before: "Contractor", after: "Operative" },
    });
    assert.equal(ratingChange({ rating: 1500, games: 3 }, { rating: 1484, games: 4 }).tier, null);
    // The fifth game lifts the floor: the tier falls with it.
    assert.deepEqual(ratingChange({ rating: 1380, games: 4 }, { rating: 1370, games: 5 }).tier, {
        before: "Contractor",
        after: "Rookie",
    });
});

const gate = (patch: Partial<Parameters<typeof resetDeny>[0]>) =>
    resetDeny({
        rating: 1720,
        busy: null,
        resets: 0,
        lastResetMs: 0,
        cooldownMs: 7 * DAY,
        now: 100 * DAY,
        ...patch,
    });

test("the reset: from above 1500 only, never in a game or a search, once a week", () => {
    assert.equal(gate({}), undefined);
    assert.equal(gate({ rating: 1500 }), "Only a rating above 1500 can be reset");
    assert.equal(gate({ rating: 1320 }), "Only a rating above 1500 can be reset");
    assert.equal(gate({ busy: "match" }), "Not during a match");
    assert.equal(gate({ busy: "search" }), "Not during a search");
    // The first reset has no cooldown; the next waits for it.
    assert.equal(gate({ resets: 0, lastResetMs: 99 * DAY }), undefined);
    assert.equal(gate({ resets: 1, lastResetMs: 96 * DAY }), "Available in 3 days");
    assert.equal(gate({ resets: 1, lastResetMs: 93 * DAY }), undefined);
    assert.equal(gate({ resets: 1, lastResetMs: 100 * DAY - 7 * DAY + 1 }), "Available in 1 min");
    // At or below the default wins over every other reason, as the contract checks it first.
    assert.equal(
        gate({ rating: 1500, busy: "match", resets: 1, lastResetMs: 99 * DAY }),
        "Only a rating above 1500 can be reset",
    );
});

test("available-in lines carry their unit", () => {
    assert.equal(availableIn(3 * DAY), "Available in 3 days");
    assert.equal(availableIn(DAY), "Available in 1 day");
    assert.equal(availableIn(DAY - 1), "Available in 24 hours");
    assert.equal(availableIn(5 * 3_600_000 + 1), "Available in 6 hours");
    assert.equal(availableIn(90_000), "Available in 2 min");
});

test("no rating is kept on the device any more", () => {
    const source = readFileSync(new URL("../src/features/play/rating.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
