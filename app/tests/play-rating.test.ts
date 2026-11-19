// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyResult,
    canReset,
    currentDeviation,
    DEFAULT_DEVIATION,
    DEFAULT_RATING,
    glickoStep,
    HISTORY_MAX,
    parseRating,
    resetDeny,
    resetState,
    type RatingState,
} from "../src/features/play/rating.ts";

const DAY = 86_400_000;
const start = (): RatingState => parseRating(null);
const at = (rating: number): RatingState => ({ ...start(), rating, peak: rating });

// Reference table of move/packages glicko tests (glicko_tests.move, compute_matches_reference):
// (rating, rd, opponent rating, opponent rd, score 2 win / 1 draw / 0 loss, rating', rd').
const CASES = [
    [1500, 350, 1500, 350, 2, 1662, 290],
    [1500, 350, 1500, 350, 0, 1338, 290],
    [1500, 350, 1500, 350, 1, 1500, 290],
    [1500, 200, 1400, 30, 2, 1563, 175],
    [1500, 200, 1550, 100, 0, 1427, 176],
    [1500, 200, 1700, 300, 0, 1456, 187],
    [1500, 50, 1500, 50, 2, 1507, 50],
    [2000, 50, 1500, 350, 2, 2001, 50],
    [2000, 50, 1500, 350, 0, 1992, 50],
    [1500, 350, 2000, 50, 2, 2046, 319],
    [1500, 350, 2000, 50, 0, 1468, 319],
    [1200, 80, 1800, 60, 1, 1217, 80],
];

test("the step follows the contract's reference cases (within a point, as the contract's own test)", () => {
    for (const [r, rd, o, ord, s, wantR, wantRd] of CASES) {
        const [rating, deviation] = glickoStep(r, rd, o, ord, (s / 2) as 0 | 0.5 | 1);
        assert.ok(Math.abs(rating - wantR) <= 1, `${r}/${rd} v ${o}/${ord} s${s}: ${rating}`);
        assert.ok(Math.abs(deviation - wantRd) <= 1, `${r}/${rd} v ${o}/${ord}: rd ${deviation}`);
    }
});

test("a newcomer beating an established 1500 gains by hand-computed amounts", () => {
    const next = applyResult(start(), 1500, true, 350, DAY);
    assert.equal(next.rating, 1662);
    assert.equal(next.deviation, 290);
    assert.equal(applyResult(start(), 1500, false, 350, DAY).rating, 1338);
});

test("the deviation grows with idle days like the contract and is capped", () => {
    assert.equal(currentDeviation(50, 1000, 1000 + DAY - 1), 50);
    assert.equal(currentDeviation(50, 1000, 1000 + 50 * DAY), 250);
    assert.equal(currentDeviation(50, 1000, 1000 + 100 * DAY), 350);
    assert.equal(currentDeviation(50, null, 5 * DAY), 50);
    assert.equal(currentDeviation(50, 1000, 10), 50);
});

test("the rating saturates at zero", () => {
    assert.equal(glickoStep(0, 350, 1500, 350, 0)[0], 0);
});

test("results keep the record, peak, streak and history", () => {
    let s = start();
    s = applyResult(s, 1500, true, undefined, 1);
    s = applyResult(s, 1500, true, undefined, 2);
    assert.equal(s.streak, 2);
    assert.equal(s.peak, s.rating);
    const peak = s.peak;
    s = applyResult(s, 1500, false, undefined, 3);
    assert.equal(s.streak, -1);
    s = applyResult(s, 1500, false, undefined, 4);
    assert.equal(s.streak, -2);
    assert.equal(s.peak, peak);
    assert.deepEqual([s.games, s.wins, s.losses], [4, 2, 2]);
    assert.equal(s.history.length, 4);
    assert.equal(s.history[0].kind === "game" && s.history[0].won, false);
    assert.equal(s.lastPlayedAt, 4);
});

test("the history keeps the last 20, newest first", () => {
    let s = start();
    for (let i = 0; i < 30; i++) s = applyResult(s, 1500, i % 2 === 0, undefined, i + 1);
    assert.equal(s.history.length, HISTORY_MAX);
    assert.equal(s.history[0].at, 30);
    assert.equal(s.history[HISTORY_MAX - 1].at, 11);
    assert.equal(s.games, 30);
});

test("reset works only from above the default and lands exactly on it", () => {
    assert.equal(canReset(at(1501)), true);
    assert.equal(canReset(at(DEFAULT_RATING)), false);
    assert.equal(canReset(at(1499)), false);

    const high = { ...at(1720), games: 9, wins: 6, losses: 3, streak: 2, deviation: 80 };
    const next = resetState(high, 77);
    assert.equal(next.rating, DEFAULT_RATING);
    assert.equal(next.deviation, DEFAULT_DEVIATION);
    assert.equal(next.peak, 1720);
    assert.deepEqual([next.games, next.wins, next.losses, next.streak], [9, 6, 3, 2]);
    assert.equal(next.resets, 1);
    assert.equal(next.lastResetAt, 77);
    assert.deepEqual(next.history[0], { kind: "reset", at: 77, from: 1720, to: DEFAULT_RATING });
});

test("reset never lowers a rating at or below the default and changes nothing there", () => {
    for (const r of [0, 1000, 1499, 1500]) {
        const s = at(r);
        assert.equal(resetState(s, 5), s);
    }
    // after a reset it is at the default, so a second one does nothing
    const once = resetState(at(1600), 1);
    assert.equal(resetState(once, 2), once);
});

test("a reset entry counts against the history cap", () => {
    let s = at(1700);
    for (let i = 0; i < HISTORY_MAX; i++)
        s = {
            ...s,
            history: [
                ...s.history,
                ...applyResult(s, 1500, true, undefined, i).history.slice(0, 1),
            ],
        };
    s = { ...s, rating: 1700, history: s.history.slice(0, HISTORY_MAX) };
    assert.equal(resetState(s, 9).history.length, HISTORY_MAX);
});

test("corrupt storage falls back to the default", () => {
    const def = start();
    for (const raw of [
        null,
        "",
        "{",
        "null",
        "[]",
        "42",
        '"x"',
        '{"rating":"high"}',
        '{"rating":null}',
        '{"rating":-5}',
        '{"rating":1e999}',
    ]) {
        assert.deepEqual(parseRating(raw), def, String(raw));
    }
});

test("missing or broken fields fall back one by one", () => {
    const s = parseRating(
        JSON.stringify({
            rating: 1612.4,
            games: "many",
            wins: -3,
            deviation: 9999,
            peak: null,
            streak: "x",
            history: [
                { kind: "game", at: 1 },
                null,
                { kind: "reset", at: 2, from: 1700, to: 1500 },
                7,
            ],
        }),
    );
    assert.equal(s.rating, 1612);
    assert.equal(s.peak, 1612);
    assert.equal(s.deviation, DEFAULT_DEVIATION);
    assert.deepEqual([s.games, s.wins, s.losses, s.streak, s.resets], [0, 0, 0, 0, 0]);
    assert.equal(s.lastResetAt, null);
    assert.equal(s.history.length, 1);
    assert.equal(Number.isNaN(s.rating), false);
});

test("a stored history longer than the cap is cut", () => {
    const entry = { kind: "reset", at: 1, from: 1600, to: 1500 };
    const s = parseRating(JSON.stringify({ rating: 1500, history: Array(50).fill(entry) }));
    assert.equal(s.history.length, HISTORY_MAX);
});

test("an old record without the new fields still loads", () => {
    const s = parseRating(
        JSON.stringify({ rating: 1580, peak: 1600, games: 4, wins: 3, losses: 1 }),
    );
    assert.equal(s.rating, 1580);
    assert.equal(s.peak, 1600);
    assert.equal(s.deviation, DEFAULT_DEVIATION);
    assert.deepEqual(s.history, []);
});

test("the reset row is active only above the default and outside a match", () => {
    assert.equal(resetDeny(at(1720), false), undefined);
    assert.equal(resetDeny(at(1720), true), "Not during a match");
    assert.equal(
        resetDeny(at(DEFAULT_RATING), false),
        `Only a rating above ${DEFAULT_RATING} can be reset`,
    );
    assert.equal(resetDeny(at(1400), true), "Not during a match");
});
