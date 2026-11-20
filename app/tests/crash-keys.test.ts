// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { crashKeyAction, padStep, stepFocus } from "../src/components/crashKeys.ts";

test("arrows move, escape goes back, plain r reloads", () => {
    assert.equal(crashKeyAction({ key: "ArrowLeft" }), "prev");
    assert.equal(crashKeyAction({ key: "ArrowUp" }), "prev");
    assert.equal(crashKeyAction({ key: "ArrowRight" }), "next");
    assert.equal(crashKeyAction({ key: "ArrowDown" }), "next");
    assert.equal(crashKeyAction({ key: "Escape" }), "back");
    assert.equal(crashKeyAction({ key: "r" }), "reload");
    assert.equal(crashKeyAction({ key: "R" }), "reload");
});

test("modified keys and native keys are left alone", () => {
    assert.equal(crashKeyAction({ key: "r", metaKey: true }), "none");
    assert.equal(crashKeyAction({ key: "r", ctrlKey: true }), "none");
    assert.equal(crashKeyAction({ key: "ArrowLeft", altKey: true }), "none");
    assert.equal(crashKeyAction({ key: "Enter" }), "none");
    assert.equal(crashKeyAction({ key: " " }), "none");
    assert.equal(crashKeyAction({ key: "Tab" }), "none");
});

test("focus wraps around the ring", () => {
    assert.equal(stepFocus(0, 5, 1), 1);
    assert.equal(stepFocus(4, 5, 1), 0);
    assert.equal(stepFocus(0, 5, -1), 4);
    assert.equal(stepFocus(-1, 5, 1), 0);
    assert.equal(stepFocus(-1, 5, -1), 4);
    assert.equal(stepFocus(0, 0, 1), -1);
});

test("pad d-pad and stick map to steps", () => {
    const none = Array(16).fill(false);
    const press = (i: number) => none.map((_, k) => k === i);
    assert.equal(padStep(none, [0, 0]), 0);
    assert.equal(padStep(press(14), [0, 0]), -1);
    assert.equal(padStep(press(15), [0, 0]), 1);
    assert.equal(padStep(press(12), [0, 0]), -1);
    assert.equal(padStep(press(13), [0, 0]), 1);
    assert.equal(padStep(none, [0.9, 0]), 1);
    assert.equal(padStep(none, [0, -0.9]), -1);
    assert.equal(padStep(none, [0.3, 0.3]), 0);
    assert.equal(padStep(press(14), [0.9, 0]), 0);
});
