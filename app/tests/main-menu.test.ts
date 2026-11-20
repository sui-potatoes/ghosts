// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { pauseEntries, signInOptions } from "../src/features/dialogs/model.ts";
import {
    backTarget,
    matchChip,
    menuRows,
    playRow,
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

test("signed out: Play, then Sign In, Spectate and the rest; no Find Match, no demo rows", () => {
    assert.deepEqual(ids(state({ signedIn: false })), [
        "play",
        "sign-in",
        "watch",
        "headquarters",
        "editor",
        "leaderboard",
        "settings",
    ]);
    assert.deepEqual(ids(state()), [
        "play",
        "watch",
        "headquarters",
        "editor",
        "leaderboard",
        "settings",
    ]);
    const labels = menuRows(state({ signedIn: false })).map((r) => r.label);
    for (const gone of ["Find Match", "Black Rain", "Paper Trail", "Cancel Search"])
        assert.ok(!labels.includes(gone), gone);
    assert.equal(menuRows(state()).find((r) => r.id === "watch")!.label, "Spectate");
});

test("Play is the first, primary row, never refused, and the one way into every mode", () => {
    for (const signedIn of [true, false]) {
        const rows = menuRows(state({ signedIn }));
        assert.equal(rows[0].id, "play");
        assert.equal(rows[0].label, "Play");
        assert.equal(rows[0].primary, true);
        assert.equal(rows[0].instant, true);
        assert.equal(rows[0].locked, undefined);
    }
    for (const m of [{ searching: true }, { hiring: true }, { suspendedMin: 2 }, { playing: true }])
        assert.equal(menuRows(state({}, m))[0].locked, undefined);
});

test("the Play row leads back to a search, a lobby or a match in progress", () => {
    const searching = playRow(state({}, { searching: true }));
    assert.equal(searching.tag, "Searching");
    assert.equal(searching.hint, "Back to your search");
    const lobby = playRow(state({}, { lobby: true }));
    assert.equal(lobby.tag, "Lobby");
    assert.equal(lobby.hint, "Back to your friendly game");
    const playing = playRow(state({}, { playing: true, searching: true }));
    assert.equal(playing.label, "Resume Match");
    assert.equal(playing.verb, "Resume");
    const expired = playRow(state({}, { expired: true }));
    assert.equal(expired.tag, "No match");
    assert.equal(expired.tagTone, "warn");
    // The row keeps its id through every state, so the cursor stays on it.
    for (const m of [{ searching: true }, { playing: true }, { lobby: true }, { expired: true }])
        assert.equal(playRow(state({}, m)).id, "play");
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
    assert.equal(startRow(rows, null), "play");
    assert.equal(startRow(rows, { id: "headquarters", index: 2 }), "headquarters");
    // Signed in since: Sign In is gone, the row now in its place takes the cursor.
    assert.equal(startRow(rows, { id: "sign-in", index: 1 }), rows[1].id);
    assert.equal(startRow(rows, { id: "install", index: 99 }), "settings");
});

test("Back on the title goes to the top row, never off the screen", () => {
    assert.equal(backTarget(menuRows(state())), "play");
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
