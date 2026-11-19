// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { parentOf, upStep } from "../src/routes.ts";

test("every screen's parent is the menu; the menu has none", () => {
    for (const p of [
        "/headquarters",
        "/headquarters/armory",
        "/headquarters/armory-classic",
        "/settings",
        "/ui-sample",
    ])
        assert.equal(parentOf(p), "/");
    assert.equal(parentOf("/play"), "/");
    assert.equal(parentOf("/play/ranked"), "/play");
    assert.equal(parentOf("/"), null);
});

test("Back pops only when the previous entry is the parent, else replaces with it", () => {
    assert.deepEqual(upStep("/headquarters", { 0: "/", 1: "/headquarters" }, 1), { kind: "pop" });
    // Squad -> Armory by replace leaves [menu, armory]: still one pop to the menu.
    assert.deepEqual(upStep("/headquarters/armory", { 0: "/", 1: "/headquarters/armory" }, 1), {
        kind: "pop",
    });
    // Opened directly, or the previous entry is another screen: go to the parent.
    assert.deepEqual(upStep("/settings", { 0: "/settings" }, 0), { kind: "to", path: "/" });
    assert.deepEqual(
        upStep("/headquarters/armory", { 0: "/headquarters", 1: "/headquarters/armory" }, 1),
        { kind: "to", path: "/" },
    );
    assert.equal(upStep("/", {}, 0), null);
});
