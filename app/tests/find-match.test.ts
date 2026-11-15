// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    clockOf,
    findView,
    requestFind,
    takeFindRequest,
    type FindState,
} from "../src/features/find-match/model.ts";

const BASE: FindState = {
    signedIn: true,
    playing: false,
    searching: false,
    hiring: false,
    suspendedMin: 0,
    error: null,
    elapsedMs: 0,
    timeoutMs: 120_000,
    starting: false,
};
const view = (patch: Partial<FindState> = {}) => findView({ ...BASE, ...patch });

test("just arrived and sent: a pending screen, not a blank one", () => {
    const v = view({ starting: true });
    assert.equal(v.phase, "starting");
    assert.equal(v.pending, true);
    assert.equal(v.headline, "Finding match");
});

test("hiring, then searching with a cancel", () => {
    assert.equal(view({ hiring: true, starting: true }).phase, "hiring");
    const v = view({ searching: true, elapsedMs: 5_000 });
    assert.equal(v.phase, "searching");
    assert.equal(v.action.id, "cancel");
});

test("a search past its time says so and leaves the queue", () => {
    const v = view({ searching: true, elapsedMs: 130_000 });
    assert.equal(v.phase, "timeout");
    assert.equal(v.action.id, "cancel");
    assert.equal(v.pending, false);
});

test("a failure offers a retry, unless a new try is in flight", () => {
    assert.equal(view({ error: "boom" }).action.id, "retry");
    assert.equal(view({ error: "boom", starting: true }).phase, "starting");
});

test("signed out, in a game and suspended respond on the first press too", () => {
    assert.equal(view({ signedIn: false }).action.id, "sign-in");
    assert.equal(view({ playing: true }).action.id, "resume");
    const suspended = view({ suspendedMin: 3 });
    assert.equal(suspended.phase, "suspended");
    assert.match(suspended.note, /3 min/);
});

test("the request to search is taken once", () => {
    assert.equal(takeFindRequest(), false);
    requestFind();
    assert.equal(takeFindRequest(), true);
    assert.equal(takeFindRequest(), false);
});

test("clock", () => {
    assert.equal(clockOf(75_000), "1:15");
    assert.equal(clockOf(-5), "0:00");
});
