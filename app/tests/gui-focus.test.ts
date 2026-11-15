// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    clickCommand,
    FocusStore,
    nearest,
    secondaryCommands,
    type Command,
    type FocusElement,
} from "../src/ui/focus-store.ts";

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

const primary: Command = { action: "confirm", label: "Inspect", tone: "primary" };
const remove: Command = { action: "reset", label: "Remove" };
const toList: Command = { action: "back", label: "Roster" };
const turn: Command = { action: "nav", label: "Change", glyph: "lr" };

test("chips carry the secondary commands only, never the primary", () => {
    assert.deepEqual(secondaryCommands([primary, toList, turn]), []);
    assert.deepEqual(secondaryCommands([remove, primary, toList]), [remove]);
});

test("an instant target runs its primary on the first click", () => {
    const opts = { again: false, instant: true, clickConfirm: true };
    assert.equal(clickCommand([primary, toList], opts), primary);
});

test("other targets select first and run the primary on a second click", () => {
    const base = { instant: false, clickConfirm: true };
    assert.equal(clickCommand([primary], { ...base, again: false }), undefined);
    assert.equal(clickCommand([primary], { ...base, again: true }), primary);
});

test("choosers never confirm on a click, and nothing runs without a primary", () => {
    assert.equal(
        clickCommand([primary], { again: true, instant: true, clickConfirm: false }),
        undefined,
    );
    assert.equal(
        clickCommand([remove, toList], { again: true, instant: true, clickConfirm: true }),
        undefined,
    );
});

test("a header key from a picker closes it and goes on; from a prompt it is refused", () => {
    const s = store();
    add(s, "slot", "inspector", box(0, 0));
    s.focus("slot");
    let closed = 0;
    add(s, "pick", "picker", box(0, 0), "picker");
    s.pushScope("picker", {
        action: "back",
        label: "Loadout",
        run: () => {
            closed++;
            s.unregister("pick");
            s.popScope("picker");
        },
    });
    assert.equal(s.clearForHeader(), true);
    assert.equal(closed, 1);
    assert.equal(s.scope.id, "root");
    assert.equal(s.focused, "slot");

    let answered = 0;
    add(s, "p1", "prompt", box(100, 100), "prompt");
    s.pushScope("prompt", { action: "back", label: "Keep", run: () => answered++ }, true);
    assert.equal(s.clearForHeader(), false);
    assert.equal(answered, 0);
    assert.equal(s.scope.id, "prompt");
});

test("a command marked click answers a click on the first tap, never the primary", () => {
    const apply = { action: "confirm" as const, label: "Apply", tone: "primary" as const };
    const change = { action: "reset" as const, label: "Change", click: true };
    for (const again of [false, true])
        assert.equal(
            clickCommand([apply, change], { again, instant: true, clickConfirm: true }),
            change,
        );
});

// --- The cursor follows the pointer -----------------------------------------

function rows(sounds: { tick: number } = { tick: 0 }) {
    const s = new FocusStore(back, { tick: () => void sounds.tick++ });
    const ran: string[] = [];
    const confirm = (id: string): Command[] => [
        { action: "confirm", label: id, run: () => void ran.push(id) },
    ];
    for (const [i, id] of ["a", "b", "c"].entries())
        s.register({
            id,
            group: "list",
            scope: "root",
            el: box(0, i * 50),
            commands: confirm(id),
        });
    return { s, ran, confirm };
}

/** Two pointer events: the first only records where the pointer is. */
function arrive(s: FocusStore, id: string, now = 1000) {
    s.pointerMove(1, 1, null, now);
    return s.pointerMove(2, 2, id, now);
}

test("the pointer moving onto a target moves the cursor and marks the mouse in use", () => {
    const { s } = rows();
    assert.equal(s.focused, "a");
    assert.equal(arrive(s, "b"), true);
    assert.equal(s.focused, "b");
    assert.equal(s.pointer, true);
});

test("the first pointer event only records where the pointer is", () => {
    const { s } = rows();
    assert.equal(s.pointerMove(5, 5, "b"), false);
    assert.equal(s.focused, "a");
});

test("a stationary pointer does not move the cursor when the list changes under it", () => {
    const { s } = rows();
    arrive(s, "b");
    s.focus("a", false); // the layout moved; the browser re-tests hover at the same place
    assert.equal(s.pointerMove(2, 2, "c"), false);
    assert.equal(s.focused, "a");
    // ...and the pointer taking over needs a real move.
    assert.equal(s.pointerMove(2, 3, "c"), true);
    assert.equal(s.focused, "c");
});

test("keys after a hover keep the keyboard's place until the pointer moves again", () => {
    const { s } = rows();
    arrive(s, "b");
    s.keyInput();
    s.move("down");
    assert.equal(s.focused, "c");
    assert.equal(s.pointer, false);
    // The list auto-scrolled: hover is re-tested at the pointer's old place.
    assert.equal(s.pointerMove(2, 2, "b"), false);
    assert.equal(s.focused, "c");
    assert.equal(s.pointerMove(3, 2, "b"), true);
    assert.equal(s.focused, "b");
});

test("leaving every target leaves the cursor where it is", () => {
    const { s } = rows();
    arrive(s, "b");
    s.pointerMove(9, 9, null);
    assert.equal(s.focused, "b");
});

test("a scope owns the cursor: targets behind a prompt are not reached", () => {
    const { s } = rows();
    s.register({
        id: "ok",
        group: "prompt",
        scope: "prompt",
        el: box(300, 0),
        commands: [],
    });
    s.pushScope("prompt", back, true);
    assert.equal(s.focused, "ok");
    assert.equal(arrive(s, "c"), false);
    assert.equal(s.focused, "ok");
    s.popScope("prompt");
    assert.equal(arrive(s, "c", 2000), true);
});

test("a target that opts out of the pointer is never reached (the stage)", () => {
    const { s } = rows();
    s.register({
        id: "stage",
        group: "stage",
        scope: "root",
        el: box(300, 0),
        commands: [],
        pointer: false,
    });
    assert.equal(arrive(s, "stage"), false);
    assert.equal(s.focused, "a");
});

test("a locked target is reached like any other", () => {
    const { s } = rows();
    s.register({
        id: "locked",
        group: "list",
        scope: "root",
        el: box(0, 150),
        commands: [{ action: "confirm", label: "Open", deny: "Not yet" }],
        hint: "Not yet",
    });
    assert.equal(arrive(s, "locked"), true);
    assert.equal(s.focused, "locked");
});

test("the mouse events a touch leaves behind do not move the cursor", () => {
    const { s } = rows();
    s.pointerMove(1, 1, null, 0);
    s.touchDown("b", 100);
    s.touchEnd(200);
    assert.equal(s.pointerMove(5, 5, "c", 400), false);
    assert.equal(s.focused, "b");
    assert.equal(s.pointerMove(6, 6, "c", 2000), true);
});

test("a touch down focuses without activating; the lift (a click) activates an instant target", () => {
    const { s, ran, confirm } = rows();
    s.touchDown("b");
    assert.equal(s.focused, "b");
    assert.deepEqual(ran, []);
    s.click("b", confirm("b"), { instant: true, clickConfirm: true });
    assert.deepEqual(ran, ["b"]);
});

test("a finger that slides off before lifting leaves the cursor there and runs nothing", () => {
    const { s, ran } = rows();
    s.touchDown("c");
    // No click follows: the lift landed elsewhere.
    assert.equal(s.focused, "c");
    assert.deepEqual(ran, []);
});

test("a tap on a target behind a scope does not take the cursor", () => {
    const { s } = rows();
    s.register({ id: "ok", group: "prompt", scope: "prompt", el: box(300, 0), commands: [] });
    s.pushScope("prompt", back, true);
    s.touchDown("a");
    assert.equal(s.focused, "ok");
});

test("a target that is not instant is armed by a click and confirmed by the next, hover or not", () => {
    const { s, ran, confirm } = rows();
    arrive(s, "b"); // hover already put the cursor on it
    const opts = { instant: false, clickConfirm: true };
    s.click("b", confirm("b"), opts);
    assert.deepEqual(ran, []);
    assert.equal(s.armed, "b");
    s.click("b", confirm("b"), opts);
    assert.deepEqual(ran, ["b"]);
    assert.equal(s.armed, null);
});

test("moving the cursor disarms a target", () => {
    const { s, ran, confirm } = rows();
    const opts = { instant: false, clickConfirm: true };
    s.click("b", confirm("b"), opts);
    s.pointerMove(1, 1, null);
    s.pointerMove(2, 2, "c");
    s.pointerMove(3, 3, "b");
    s.click("b", confirm("b"), opts);
    assert.deepEqual(ran, []);
    assert.equal(s.armed, "b");
});

test("choosers are not armed by a click, and an instant target never waits", () => {
    const { s, ran, confirm } = rows();
    s.click("b", confirm("b"), { instant: false, clickConfirm: false });
    assert.equal(s.armed, null);
    s.click("c", confirm("c"), { instant: true, clickConfirm: true });
    assert.deepEqual(ran, ["c"]);
});

test("a sweep across rows ticks at most once per gap; keys tick every move", () => {
    const sounds = { tick: 0 };
    const { s } = rows(sounds);
    s.pointerMove(0, 0, null, 0);
    s.pointerMove(1, 0, "b", 1000);
    s.pointerMove(2, 0, "c", 1020);
    s.pointerMove(3, 0, "a", 1040);
    assert.equal(s.focused, "a");
    assert.equal(sounds.tick, 1);
    s.pointerMove(4, 0, "b", 1200);
    assert.equal(sounds.tick, 2);
    s.move("down");
    s.move("down");
    assert.equal(sounds.tick, 4);
});
