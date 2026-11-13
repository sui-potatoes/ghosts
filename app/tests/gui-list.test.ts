// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { followScroll, overflowEdges, railThumb } from "../src/ui/list-math.ts";

const view = (top: number) => ({ top, height: 400, content: 1680 });
const row = (i: number) => ({ top: i * 42, height: 40 });

test("a row comfortably in view leaves the list where it is", () => {
    assert.equal(followScroll(view(0), row(3), 40), 0);
});

test("moving down past the window scrolls so the next row peeks in", () => {
    // Row 9 ends at 418; with one row of margin the window ends at 458.
    assert.equal(followScroll(view(0), row(9), 40), 58);
});

test("moving up past the window keeps a row of margin above", () => {
    assert.equal(followScroll(view(400), row(9), 40), 338);
});

test("the scroll is clamped to the content", () => {
    assert.equal(followScroll(view(0), row(39), 40), 1280);
    assert.equal(followScroll(view(300), row(0), 40), 0);
});

test("a margin too large for the window shrinks to fit", () => {
    const small = { top: 0, height: 60, content: 1680 };
    assert.equal(followScroll(small, row(5), 400), 200);
});

test("wrapping from the last row to the first jumps to the top", () => {
    assert.equal(followScroll(view(1280), row(0), 40), 0);
});

test("no rail when everything fits", () => {
    assert.equal(railThumb({ top: 0, height: 400, content: 400 }), null);
});

test("the rail's thumb is the window's share and position", () => {
    const top = railThumb(view(0))!;
    assert.ok(Math.abs(top.size - 400 / 1680) < 1e-9);
    assert.equal(top.start, 0);
    const end = railThumb(view(1280))!;
    assert.ok(Math.abs(end.start + end.size - 1) < 1e-9);
});

test("a very long list keeps a visible thumb", () => {
    assert.equal(railThumb({ top: 0, height: 100, content: 100_000 })!.size, 0.08);
});

test("overflow edges say where more of the list lies", () => {
    assert.deepEqual(overflowEdges(view(0)), { above: false, below: true });
    assert.deepEqual(overflowEdges(view(600)), { above: true, below: true });
    assert.deepEqual(overflowEdges(view(1280)), { above: true, below: false });
});
