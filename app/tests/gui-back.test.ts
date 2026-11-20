// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { claimScreenBack, screenOwnsBack, subscribeScreenBack } from "../src/ui/back.ts";

test("a screen owns Back while its claim is held", () => {
    assert.equal(screenOwnsBack(), false);
    const release = claimScreenBack();
    assert.equal(screenOwnsBack(), true);
    release();
    assert.equal(screenOwnsBack(), false);
});

test("overlapping claims (a screen mounting before the last unmounts) are counted", () => {
    const a = claimScreenBack();
    const b = claimScreenBack();
    a();
    assert.equal(screenOwnsBack(), true);
    b();
    assert.equal(screenOwnsBack(), false);
});

test("a release is idempotent (StrictMode double cleanup)", () => {
    const a = claimScreenBack();
    const b = claimScreenBack();
    a();
    a();
    assert.equal(screenOwnsBack(), true);
    b();
    assert.equal(screenOwnsBack(), false);
});

test("subscribers hear every change, so EscapeBack re-renders in the claiming commit", () => {
    let heard = 0;
    const stop = subscribeScreenBack(() => heard++);
    const release = claimScreenBack();
    release();
    stop();
    claimScreenBack()();
    assert.equal(heard, 2);
});

test("the shell's go-back stands aside on the bus while a screen owns Back", () => {
    // The input bus is LIFO and the first consumer wins; EscapeBack subscribes
    // only while no screen owns Back, so the order of subscription no longer
    // matters. Modelled on input.ts's dispatch.
    const handlers: ((a: string) => boolean)[] = [];
    const log: string[] = [];
    const dispatch = (a: string) =>
        handlers
            .slice()
            .reverse()
            .some((h) => h(a));
    const screen = () => (log.push("screen"), true);
    const escapeBack = () => (log.push("shell"), true);
    const release = claimScreenBack();
    handlers.push(screen);
    // EscapeBack's effect runs after the route's; it would have subscribed on top.
    if (!screenOwnsBack()) handlers.push(escapeBack);
    dispatch("back");
    assert.deepEqual(log, ["screen"]);
    release();
});

test("the encounter routes answer Back themselves, so the shell's go-up lists them", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/EscapeBack.tsx", import.meta.url), "utf8");
    for (const path of ["/demo", "/match"]) assert.ok(source.includes(`"${path}"`), path);
    assert.ok(!source.includes('"/play/match"'), "the mock match is gone");
});
