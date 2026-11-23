// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { INTROS, INTRO_ORDER } from "../src/features/intro/intros.ts";
import {
    accept,
    dueIntro,
    INTRO_KEY,
    introRoute,
    readAccepted,
    type IntroStore,
} from "../src/features/intro/model.ts";

function memory(): IntroStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
    };
}

const throwing: IntroStore = {
    getItem() {
        throw new Error("blocked");
    },
    setItem() {
        throw new Error("blocked");
    },
};

const welcomed = { welcome: INTROS.welcome.version };

test("the welcome is due on every menu screen until accepted", () => {
    for (const path of [
        "/",
        "/play",
        "/play/ranked",
        "/play/training",
        "/settings",
        "/headquarters",
        "/headquarters/armory",
        "/leaderboard",
        "/watch",
        "/watch/",
    ])
        assert.equal(dueIntro(path, {}), "welcome", path);
});

test("nothing over a match, the viewer, training scenes, the editor or QA routes", () => {
    for (const path of [
        "/match",
        "/watch/0xabc",
        "/demo",
        "/demo-2",
        "/editor",
        "/sounds",
        "/ui-sample",
        "/qa/name",
    ])
        assert.equal(dueIntro(path, {}), null, path);
    // A screen intro never shows there either.
    assert.equal(dueIntro("/match", welcomed), null);
    assert.equal(dueIntro("/watch/0xabc", welcomed), null);
});

test("a screen intro waits for the welcome, then follows it", () => {
    assert.equal(dueIntro("/play", {}), "welcome");
    assert.equal(dueIntro("/play", welcomed), "play");
    assert.equal(dueIntro("/headquarters", {}), "welcome");
    assert.equal(dueIntro("/headquarters", welcomed), "headquarters");
    assert.equal(dueIntro("/headquarters/armory", welcomed), "headquarters");
});

test("the headquarters intro skips the classic screens", () => {
    assert.equal(dueIntro("/headquarters-classic", welcomed), null);
    assert.equal(dueIntro("/headquarters/armory-classic", welcomed), null);
});

test("intros belong to their own screens only", () => {
    assert.equal(dueIntro("/", welcomed), null);
    assert.equal(dueIntro("/settings", welcomed), null);
    assert.equal(dueIntro("/play/ranked", welcomed), null);
    assert.equal(introRoute("play", "/play/"), true);
    assert.equal(introRoute("headquarters", "/play"), false);
});

test("each intro is accepted on its own", () => {
    const store = memory();
    let a = accept(store, {}, "welcome").accepted;
    assert.equal(dueIntro("/play", a), "play");
    a = accept(store, a, "play").accepted;
    assert.equal(dueIntro("/play", a), null);
    assert.equal(dueIntro("/headquarters", a), "headquarters");
    a = accept(store, a, "headquarters").accepted;
    assert.equal(dueIntro("/headquarters", a), null);
    assert.deepEqual(readAccepted(store), a);
});

test("bumping a version shows that intro again, and only that one", () => {
    const all = Object.fromEntries(INTRO_ORDER.map((id) => [id, INTROS[id].version]));
    assert.equal(dueIntro("/play", all), null);
    assert.equal(dueIntro("/play", { ...all, play: INTROS.play.version - 1 }), "play");
    assert.equal(dueIntro("/play", { ...all, welcome: INTROS.welcome.version - 1 }), "welcome");
    assert.equal(dueIntro("/headquarters", { ...all, play: -1 }), null);
});

test("acceptance is one stored map", () => {
    const store = memory();
    assert.equal(accept(store, {}, "play").saved, true);
    assert.deepEqual(JSON.parse(store.data.get(INTRO_KEY)!), { play: INTROS.play.version });
});

test("the old welcome key still counts", () => {
    const store = memory();
    store.data.set("ghosts:welcome", "1");
    assert.equal(readAccepted(store).welcome, 1);
    assert.equal(dueIntro("/", readAccepted(store)), null);
});

test("junk in storage counts as not accepted", () => {
    const store = memory();
    for (const junk of ["", "yes", "[1]", "null", '{"play":"1"}', '{"play":-1}', '{"play":1.5}']) {
        store.data.set(INTRO_KEY, junk);
        assert.deepEqual(readAccepted(store), {}, junk);
    }
});

test("unavailable storage never throws and still accepts for the session", () => {
    assert.deepEqual(readAccepted(null), {});
    assert.deepEqual(readAccepted(throwing), {});
    for (const store of [null, throwing]) {
        const r = accept(store, {}, "welcome");
        assert.equal(r.saved, false);
        assert.equal(dueIntro("/", r.accepted), null);
    }
});

test("the texts have no trailing full stop and the welcome is Enter, screens Continue", () => {
    for (const intro of Object.values(INTROS)) {
        assert.ok(!intro.lead.endsWith("."), intro.id);
        for (const [label, line] of intro.list) {
            assert.ok(!label.endsWith(".") && !line.endsWith("."), `${intro.id} ${label}`);
        }
    }
    assert.equal(INTROS.welcome.command, "Enter");
    assert.equal(INTROS.play.command, "Continue");
    assert.equal(INTROS.headquarters.command, "Continue");
});
