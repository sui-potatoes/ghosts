// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { FocusStore, nearest, type Command, type FocusElement } from "../src/ui/focus-store.ts";

/** A laid-out box standing in for an element; `order` is its document position. */
let order = 0;
function box(left: number, top: number, width = 100, height = 40) {
    const at = order++;
    const el = {
        at,
        isConnected: true,
        getBoundingClientRect: () =>
            ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect,
        compareDocumentPosition: (other: { at: number }) => (other.at > at ? 4 : 2),
    };
    return el as unknown as FocusElement & { isConnected: boolean };
}

const back: Command = { action: "back", label: "Leave" };

function store() {
    return new FocusStore(back);
}

function add(s: FocusStore, id: string, group: string, el: FocusElement, scope = "root") {
    s.register({ id, group, scope, el, commands: [] });
}

const settle = () => new Promise<void>((r) => queueMicrotask(r));

test("nearest prefers the row straight below over a closer one to the side", () => {
    const from = box(0, 0).getBoundingClientRect();
    const below = { el: box(0, 50) };
    const aside = { el: box(130, 20) };
    assert.equal(nearest(from, [aside, below], "down"), below);
});

test("nearest ignores what lies behind the direction", () => {
    const from = box(0, 100).getBoundingClientRect();
    assert.equal(nearest(from, [{ el: box(0, 0) }], "down"), undefined);
});

test("sideways into a column lands on the row level with the cursor", () => {
    const from = box(0, 100).getBoundingClientRect();
    const top = { el: box(200, 0) };
    const level = { el: box(200, 100) };
    assert.equal(nearest(from, [top, level], "right"), level);
});

test("the first registered node takes the cursor; moves stay in the group", () => {
    const s = store();
    add(s, "a1", "list", box(0, 0));
    add(s, "a2", "list", box(0, 50));
    add(s, "b1", "detail", box(300, 0));
    assert.equal(s.focused, "a1");
    s.move("down");
    assert.equal(s.focused, "a2");
});

test("lists wrap vertically inside their group", () => {
    const s = store();
    add(s, "a1", "list", box(0, 0));
    add(s, "a2", "list", box(0, 50));
    s.focus("a2");
    s.move("down");
    assert.equal(s.focused, "a1");
});

test("entering a panel resumes on the row it had last", () => {
    const s = store();
    add(s, "a1", "list", box(0, 0));
    add(s, "b1", "detail", box(300, 0));
    add(s, "b2", "detail", box(300, 50));
    add(s, "b3", "detail", box(300, 100));
    s.focus("b3");
    s.focus("a1");
    s.move("right");
    assert.equal(s.focused, "b3");
});

test("a direction with nowhere to go bumps", () => {
    const s = store();
    add(s, "a1", "list", box(0, 0));
    s.move("left");
    assert.equal(s.focused, "a1");
    assert.equal(s.motion?.kind, "bump");
    assert.equal(s.motion?.dir, "left");
});

test("a scope traps the cursor and returns it where it was", () => {
    const s = store();
    add(s, "a1", "list", box(0, 0));
    add(s, "a2", "list", box(0, 50));
    s.focus("a2");
    add(s, "p1", "prompt", box(100, 100), "prompt");
    s.pushScope("prompt", { action: "back", label: "Cancel" }, true);
    assert.equal(s.focused, "p1");
    assert.equal(s.blocked, true);
    s.move("up");
    assert.equal(s.focused, "p1");
    assert.equal(s.command("back")?.label, "Cancel");
    s.popScope("prompt");
    assert.equal(s.focused, "a2");
    assert.equal(s.blocked, false);
});

test("a scope that replaced its opener restores to it when it remounts", () => {
    const s = store();
    add(s, "slot", "inspector", box(0, 0));
    add(s, "roster", "list", box(-300, 0));
    s.focus("slot");
    // The picker stands in for the slot rows: the slot unmounts, the scope opens.
    s.unregister("slot");
    add(s, "pick", "picker", box(0, 0), "picker");
    s.pushScope("picker", { action: "back", label: "Loadout" });
    assert.equal(s.focused, "pick");
    s.unregister("pick");
    s.popScope("picker");
    add(s, "slot", "inspector", box(0, 0));
    assert.equal(s.focused, "slot");
});

test("a tab swap: the new rows of the same panel take the cursor, other panels keep their place", async () => {
    const s = store();
    add(s, "r1", "list", box(-300, 0));
    add(s, "r2", "list", box(-300, 50));
    add(s, "slot", "inspector", box(0, 0));
    s.focus("r2");
    s.focus("slot");
    // Loadout → Stats in one commit: the slot row goes, the stat rows come.
    s.unregister("slot");
    add(s, "stat1", "inspector", box(0, 0));
    add(s, "stat2", "inspector", box(0, 50));
    await settle();
    assert.equal(s.focused, "stat1");
    // The roster still remembers its row: Back to the roster returns to r2.
    assert.equal(s.remembered("list"), "r2");
});

test("a focused node gone with nothing replacing it falls back in its panel, then anywhere", async () => {
    const s = store();
    add(s, "r1", "list", box(-300, 0));
    add(s, "a", "detail", box(0, 0));
    add(s, "b", "detail", box(0, 50));
    s.focus("b");
    s.unregister("b");
    await settle();
    assert.equal(s.focused, "a");
    s.unregister("a");
    await settle();
    assert.equal(s.focused, "r1");
});

test("a refused command flashes and counts instead of running", () => {
    const s = store();
    let ran = 0;
    s.register({
        id: "x",
        group: "g",
        scope: "root",
        el: box(0, 0),
        commands: [{ action: "confirm", label: "Buy", deny: "Locked", run: () => ran++ }],
    });
    s.invoke("confirm");
    assert.equal(ran, 0);
    assert.equal(s.denies, 1);
    assert.equal(s.pulse?.kind, "deny");
});

test("back falls through to the scope when the node has none", () => {
    let left = 0;
    const s = new FocusStore({ action: "back", label: "Leave", run: () => left++ });
    add(s, "x", "g", box(0, 0));
    assert.equal(s.invoke("back"), true);
    assert.equal(left, 1);
});
