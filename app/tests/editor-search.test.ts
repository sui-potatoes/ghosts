// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { canReset, clampHighlight, isNavKey, moveHighlight } from "../src/editorSearch.ts";

test("a list steps down and up one result", () => {
    assert.equal(moveHighlight(0, 5, "ArrowDown"), 1);
    assert.equal(moveHighlight(3, 5, "ArrowUp"), 2);
});

test("a list wraps at both ends", () => {
    assert.equal(moveHighlight(4, 5, "ArrowDown"), 0);
    assert.equal(moveHighlight(0, 5, "ArrowUp"), 4);
});

test("Home and End jump to the first and last result", () => {
    assert.equal(moveHighlight(2, 5, "Home"), 0);
    assert.equal(moveHighlight(2, 5, "End"), 4);
});

test("Left and Right leave the caret alone in a list", () => {
    assert.equal(moveHighlight(2, 5, "ArrowLeft"), null);
    assert.equal(moveHighlight(2, 5, "ArrowRight"), null);
});

test("no results: nothing to highlight, every nav key says so", () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"] as const)
        assert.equal(moveHighlight(0, 0, key), -1);
});

test("a single result stays put and wraps onto itself", () => {
    assert.equal(moveHighlight(0, 1, "ArrowDown"), 0);
    assert.equal(moveHighlight(0, 1, "ArrowUp"), 0);
});

test("a grid moves by row and column and clamps at the edges", () => {
    assert.equal(moveHighlight(1, 10, "ArrowDown", 3), 4);
    assert.equal(moveHighlight(4, 10, "ArrowUp", 3), 1);
    assert.equal(moveHighlight(1, 10, "ArrowUp", 3), 1);
    assert.equal(moveHighlight(1, 10, "ArrowRight", 3), 2);
    assert.equal(moveHighlight(0, 10, "ArrowLeft", 3), 0);
    assert.equal(moveHighlight(9, 10, "ArrowRight", 3), 9);
});

test("a grid step down into a short last row lands on the final result", () => {
    // 10 results, 3 wide: the last row holds only index 9.
    assert.equal(moveHighlight(7, 10, "ArrowDown", 3), 9);
    assert.equal(moveHighlight(8, 10, "ArrowDown", 3), 9);
    assert.equal(moveHighlight(9, 10, "ArrowDown", 3), 9);
});

test("a stale highlight is clamped before it moves", () => {
    assert.equal(moveHighlight(40, 5, "ArrowUp"), 3);
    assert.equal(moveHighlight(-1, 5, "ArrowDown"), 1);
});

test("clampHighlight keeps the index inside the results", () => {
    assert.equal(clampHighlight(7, 3), 2);
    assert.equal(clampHighlight(-2, 3), 0);
    assert.equal(clampHighlight(0, 0), -1);
});

test("nav keys are recognised, others are not", () => {
    assert.equal(isNavKey("Home"), true);
    assert.equal(isNavKey("Enter"), false);
    assert.equal(isNavKey("a"), false);
});

test("reset is available only while the board differs from its base", () => {
    assert.equal(canReset("{}", "{}"), false);
    assert.equal(canReset('{"a":1}', "{}"), true);
});
