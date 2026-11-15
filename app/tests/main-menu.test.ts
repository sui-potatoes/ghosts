// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { pauseEntries, signInOptions } from "../src/features/dialogs/model.ts";
import {
    backTarget,
    matchChip,
    matchRow,
    menuRows,
    playerChip,
    startRow,
    type MenuState,
} from "../src/features/main-menu/model.ts";
import { FocusStore, type FocusElement } from "../src/ui/focus-store.ts";

const IDLE = { playing: false, searching: false, hiring: false, suspendedMin: 0 };

function state(patch: Partial<MenuState> = {}, match: Partial<MenuState["match"]> = {}): MenuState {
    return { signedIn: true, install: "none", ...patch, match: { ...IDLE, ...match } };
}

const ids = (s: MenuState) => menuRows(s).map((r) => r.id);

test("signed out: a Sign In row after the demos; Find Match asks to sign in first", () => {
    const s = state({ signedIn: false });
    assert.deepEqual(ids(s), [
        "demo-black-rain",
        "demo-paper-trail",
        "sign-in",
        "match",
        "headquarters",
        "editor",
        "leaderboard",
        "settings",
    ]);
    const match = matchRow(s);
    assert.equal(match.label, "Find Match");
    assert.equal(match.verb, "Sign in");
    assert.equal(match.instant, true);
    assert.equal(match.locked, undefined);
});

test("signed in: no Sign In row; Find Match opens its screen on the first click", () => {
    const rows = menuRows(state());
    assert.ok(!rows.some((r) => r.id === "sign-in"));
    const match = rows.find((r) => r.id === "match")!;
    assert.equal(match.verb, "Find match");
    assert.equal(match.primary, true);
    assert.equal(match.instant, true);
});

test("the one match row follows the search", () => {
    assert.equal(matchRow(state({}, { searching: true })).label, "Cancel Search");
    assert.equal(matchRow(state({}, { searching: true })).instant, false);
    assert.equal(matchRow(state({}, { playing: true, searching: true })).label, "Resume Match");
    const hiring = matchRow(state({}, { hiring: true }));
    assert.equal(hiring.tag, "Hiring");
    assert.ok(hiring.locked);
    const suspended = matchRow(state({}, { suspendedMin: 3 }));
    assert.equal(suspended.label, "Find Match");
    assert.equal(suspended.tag, "3m");
    assert.match(suspended.locked!, /3 min/);
    // The row keeps its id through every state, so the cursor stays on it.
    for (const m of [{ searching: true }, { playing: true }, { hiring: true }, { suspendedMin: 1 }])
        assert.equal(matchRow(state({}, m)).id, "match");
});

test("disabled rows stay in place with their reason", () => {
    const leaderboard = menuRows(state()).find((r) => r.id === "leaderboard")!;
    assert.equal(leaderboard.locked, "Not open yet");
    assert.equal(leaderboard.tag, "Soon");
    const ios = menuRows(state({ install: "ios" })).find((r) => r.id === "install")!;
    assert.match(ios.locked!, /Add to Home Screen/);
    const prompt = menuRows(state({ install: "prompt" })).find((r) => r.id === "install")!;
    assert.equal(prompt.locked, undefined);
    assert.equal(ids(state({ install: "prompt" })).at(-1), "settings");
});

test("the cursor starts at the top, or on the row the player left from", () => {
    const rows = menuRows(state());
    assert.equal(startRow(rows, null), "demo-black-rain");
    assert.equal(startRow(rows, { id: "headquarters", index: 3 }), "headquarters");
    // Signed in since: Sign In is gone, the row now in its place takes the cursor.
    assert.equal(startRow(rows, { id: "sign-in", index: 2 }), rows[2].id);
    assert.equal(startRow(rows, { id: "install", index: 99 }), "settings");
});

test("Back on the title goes to the top row, never off the screen", () => {
    assert.equal(backTarget(menuRows(state())), "demo-black-rain");
    assert.equal(backTarget([]), null);
});

test("the match chip: searching with its clock, none found, in progress, or nothing", () => {
    const t0 = 1_000_000;
    assert.equal(matchChip({ playing: false, searchingSinceMs: null }, t0, 120_000), null);
    assert.deepEqual(matchChip({ playing: false, searchingSinceMs: t0 }, t0 + 84_000, 120_000), {
        value: "Searching 1:24",
        state: "live",
    });
    assert.deepEqual(matchChip({ playing: false, searchingSinceMs: t0 }, t0 + 130_000, 120_000), {
        value: "None found",
        tone: "warn",
    });
    assert.equal(
        matchChip({ playing: true, searchingSinceMs: null }, t0, 120_000)?.value,
        "In progress",
    );
});

test("the player chip names the player once signed in", () => {
    assert.deepEqual(playerChip(false, ""), { value: "Signed out", idle: true });
    assert.deepEqual(playerChip(true, "nightjar"), { value: "nightjar", idle: false });
    assert.equal(playerChip(true, "").value, "On file");
});

test("sign-in options: Google refused without a key; one ceremony at a time", () => {
    const fresh = signInOptions({ hasPasskey: false, canGoogle: false, wallets: [], busy: null });
    assert.deepEqual(
        fresh.map((o) => o.id),
        ["passkey", "recover", "google"],
    );
    assert.equal(fresh[0].kind, "New");
    assert.equal(fresh[1].label, "I Have a Passkey");
    assert.ok(fresh[2].locked);
    const known = signInOptions({ hasPasskey: true, canGoogle: true, wallets: ["W"], busy: null });
    assert.equal(known[1].label, "Another Passkey");
    assert.equal(known[2].locked, undefined);
    assert.equal(known[3].id, "wallet:W");
    const busy = signInOptions({ hasPasskey: true, canGoogle: true, wallets: [], busy: "passkey" });
    assert.equal(busy[0].tag, "Waiting");
    assert.ok(busy.every((o) => o.locked));
});

test("pause entries: briefing and restart only where they make sense", () => {
    assert.deepEqual(
        pauseEntries({ briefing: true, restart: true, quitLabel: "Quit to menu" }).map((e) => e.id),
        ["resume", "briefing", "options", "restart", "quit"],
    );
    const match = pauseEntries({ briefing: false, restart: false, quitLabel: "Abandon match" });
    assert.deepEqual(
        match.map((e) => e.id),
        ["resume", "options", "quit"],
    );
    assert.equal(match.at(-1)!.label, "Abandon match");
});

// --- Focus restore around the title's prompt -------------------------------

let order = 0;
function box(top: number) {
    const at = order++;
    return {
        at,
        isConnected: true,
        getBoundingClientRect: () =>
            ({ left: 0, top, width: 300, height: 40, right: 300, bottom: top + 40 }) as DOMRect,
        compareDocumentPosition: (other: { at: number }) => (other.at > at ? 4 : 2),
    } as unknown as FocusElement;
}

test("the stop-search prompt traps the cursor and hands it back to the row it came from", () => {
    const store = new FocusStore({ action: "back", label: "Top" });
    const rows = menuRows(state({}, { searching: true }));
    rows.forEach((row, i) =>
        store.register({ id: row.id, group: "menu", scope: "root", el: box(i * 40), commands: [] }),
    );
    store.focus("headquarters", false);
    store.pushScope("prompt-stop-search", { action: "back", label: "Keep searching" }, true);
    store.register({
        id: "prompt-stop-search-block",
        group: "prompt",
        scope: "prompt-stop-search",
        el: box(200),
        commands: [],
    });
    assert.equal(store.focused, "prompt-stop-search-block");
    store.move("up");
    assert.equal(store.focused, "prompt-stop-search-block", "the menu is out of reach");
    assert.equal(store.command("back")?.label, "Keep searching");
    assert.equal(store.blocked, true);
    store.unregister("prompt-stop-search-block");
    store.popScope("prompt-stop-search");
    assert.equal(store.focused, "headquarters");
    assert.equal(store.command("back")?.label, "Top");
});

test("a shell dialog is a root of its own: the menu's cursor never moves under it", () => {
    const menu = new FocusStore({ action: "back", label: "Top" });
    menu.register({ id: "settings", group: "menu", scope: "root", el: box(0), commands: [] });
    const dialog = new FocusStore({ action: "back", label: "Close" });
    dialog.register({
        id: "sign-in-passkey",
        group: "sign-in",
        scope: "root",
        el: box(40),
        commands: [],
    });
    dialog.move("down");
    assert.equal(menu.focused, "settings");
    assert.equal(dialog.focused, "sign-in-passkey");
});
