// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The friendly screen's pure rules (`src/features/play/friendly/model.ts`): the
 * code's text as the screen takes it, the share link, the sizes the level
 * allows, what keeps a player out, and when Start and Join can run; and how the
 * rest of the app treats a player in a lobby (title, Play cards, Find Match)
 * and a friendly game's result. The chain side is `tests/lobby-chain.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { debriefOf, type MatchResult } from "../src/features/debrief/result.ts";
import { findView, type FindState } from "../src/features/find-match/model.ts";
import { matchChip, matchRow, menuRows, type MenuState } from "../src/features/main-menu/model.ts";
import {
    CODE_ALPHABET,
    CODE_LENGTH,
    formatCode,
    gateOf,
    joinBlock,
    linkCode,
    LOBBY_LIFETIME_MS,
    parseCode,
    personLine,
    shareLink,
    sizeBlock,
    sizeLabel,
    startBlock,
    timeLeft,
    typingProblem,
    type GateInput,
    type LobbyState,
    type OpenGame,
} from "../src/features/play/friendly/model.ts";
import { modeCards } from "../src/features/play/model.ts";

const FREE: GateInput = {
    signedIn: true,
    loading: false,
    hasAccount: true,
    recruits: 4,
    playing: false,
    queued: false,
    suspendedMin: 0,
};

test("the code is 13 characters of the unambiguous alphabet, grouped 4-4-5", () => {
    assert.equal(CODE_LENGTH, 13);
    assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
    assert.equal(formatCode("24vmt8ut43yr9"), "24VM-T8UT-43YR9");
    assert.equal(formatCode("24V"), "24V");
    assert.equal(formatCode("24VMT8"), "24VM-T8");
});

test("parsing is tolerant of case, spaces, dashes and a pasted link", () => {
    for (const text of [
        "24VMT8UT43YR9",
        "24vmt8ut43yr9",
        "24VM-T8UT-43YR9",
        " 24vm t8ut 43yr9 ",
        shareLink("24VMT8UT43YR9", "https://ghosts.test"),
        // An invite as the agent tools write it: the host's Account ID, then the code.
        `0x${"b2".repeat(32)}:24VM-T8UT-43YR9`,
    ]) {
        const parsed = parseCode(text);
        assert.ok(parsed.ok, text);
        assert.deepEqual([...parsed.bytes], [1, 2, 3, 4, 5, 6, 7, 8]);
    }
});

test("parsing refuses what is malformed, with a reason; typing waits for a short code", () => {
    const reason = (t: string) => {
        const p = parseCode(t);
        return p.ok ? "ok" : p.problem;
    };
    assert.equal(reason(""), "empty");
    assert.equal(reason("24VM"), "short");
    assert.equal(reason("24VMT8UT43YR92"), "long");
    assert.equal(reason("24VM-T8UT-43YR0"), "chars");
    assert.equal(typingProblem("24VM"), null);
    assert.equal(typingProblem("24VMO"), "Codes use letters and digits, never 0, O, 1, I or L");
});

test("the share link carries the grouped code and reads back", () => {
    const link = shareLink("24VMT8UT43YR9", "https://ghosts.test");
    assert.equal(link, "https://ghosts.test/play/friendly?code=24VM-T8UT-43YR9");
    assert.equal(linkCode(new URL(link).search), "24VM-T8UT-43YR9");
    assert.equal(linkCode("?code="), null);
    assert.equal(linkCode(""), null);
});

test("4x4 opens only on a level with 4 spawn positions a side", () => {
    assert.equal(sizeBlock(3, 3), null);
    assert.equal(sizeBlock(4, 3), "No 4x4 level yet");
    assert.equal(sizeBlock(4, 4), null);
    // Before the level is read, the one level there is holds 3.
    assert.equal(sizeBlock(4, null), "No 4x4 level yet");
    assert.equal(sizeBlock(3, null), null);
    assert.equal(sizeLabel(4), "4 x 4");
});

test("the gate: signed out, no squad, in a match, queued, suspended, free", () => {
    assert.equal(gateOf({ ...FREE, signedIn: false })?.reason, "Sign in to play");
    assert.equal(gateOf({ ...FREE, signedIn: false })?.action?.id, "sign-in");
    assert.equal(gateOf({ ...FREE, hasAccount: false, recruits: 0 })?.reason, "Hire a squad first");
    assert.equal(gateOf({ ...FREE, recruits: 0 })?.action?.id, "headquarters");
    assert.equal(gateOf({ ...FREE, playing: true })?.action?.id, "resume");
    assert.equal(gateOf({ ...FREE, queued: true })?.reason, "You are in the match queue");
    assert.equal(gateOf({ ...FREE, suspendedMin: 2 })?.reason, "Suspended for 2 min");
    assert.equal(gateOf(FREE), null);
});

const host = (over: Partial<Extract<LobbyState, { kind: "host" }>> = {}): LobbyState => ({
    kind: "host",
    listed: true,
    size: 3,
    sinceMs: 0,
    code: null,
    guest: null,
    ...over,
});

test("Start waits for a guest, refuses an invite-only game and an expired one", () => {
    const guest = { id: "0x9", name: "vesper", rating: 1544 };
    assert.equal(startBlock(host(), 1000, LOBBY_LIFETIME_MS), "Nobody has joined yet");
    assert.equal(startBlock(host({ guest }), 1000, LOBBY_LIFETIME_MS), null);
    assert.equal(
        startBlock(host({ listed: false }), 1000, LOBBY_LIFETIME_MS),
        "The match starts when your friend joins",
    );
    // Startable up to the lifetime inclusive, as the contract has it.
    assert.equal(startBlock(host({ guest }), LOBBY_LIFETIME_MS, LOBBY_LIFETIME_MS), null);
    assert.equal(
        startBlock(host({ guest }), LOBBY_LIFETIME_MS + 1, LOBBY_LIFETIME_MS),
        "This game has expired",
    );
});

test("Join on the list: the gate first, then full, then the level", () => {
    const game: OpenGame = {
        hostId: "0x1",
        owner: "0xa",
        rating: 1500,
        size: 3,
        sinceMs: 0,
        full: false,
    };
    assert.equal(joinBlock(game, null, 3), null);
    assert.equal(joinBlock({ ...game, full: true }, null, 3), "This game is full");
    assert.equal(joinBlock({ ...game, size: 4 }, null, 3), "No 4x4 level yet");
    assert.equal(
        joinBlock({ ...game, full: true }, { reason: "Sign in to play" }, 3),
        "Sign in to play",
    );
});

test("time left counts down to 0:00, and players read with their rating", () => {
    assert.equal(timeLeft(0, 0), "10:00");
    assert.equal(timeLeft(0, 61_000), "8:59");
    assert.equal(timeLeft(0, 700_000), "0:00");
    assert.equal(personLine({ name: "kestrel", rating: 1520 }), "kestrel · Rating 1520");
    assert.equal(personLine({ name: null, rating: null }), "Unnamed");
});

// === The rest of the app ====================================================

const menu = (match: Partial<MenuState["match"]>): MenuState => ({
    signedIn: true,
    match: { playing: false, searching: false, hiring: false, suspendedMin: 0, ...match },
    install: "none",
});

test("the title: Find Match is inactive in a lobby, Play leads back to it", () => {
    const row = matchRow(menu({ lobby: true }));
    assert.equal(row.label, "Find Match");
    assert.equal(row.locked, "Leave your friendly game first");
    const play = menuRows(menu({ lobby: true })).find((r) => r.id === "play")!;
    assert.equal(play.hint, "Back to your friendly game");
    assert.equal(
        menuRows(menu({})).find((r) => r.id === "play")!.hint,
        "Ranked, friendly, faction wars",
    );
    assert.deepEqual(matchChip({ playing: false, searchingSinceMs: null, lobby: true }, 0, 1), {
        value: "Friendly lobby",
        state: "live",
    });
    // A game in progress still wins.
    assert.equal(matchRow(menu({ lobby: true, playing: true })).label, "Resume Match");
});

test("Find Match sends a player in a lobby back to it, never into the queue", () => {
    const state: FindState = {
        signedIn: true,
        playing: false,
        searching: false,
        lobby: true,
        hiring: false,
        suspendedMin: 0,
        error: null,
        elapsedMs: 0,
        timeoutMs: 120_000,
        starting: false,
    };
    const view = findView(state);
    assert.equal(view.phase, "lobby");
    assert.equal(view.action.id, "lobby");
    assert.notEqual(view.action.id, "cancel");
});

test("the Play cards: the friendly card leads back to the lobby", () => {
    const friendly = modeCards(true).find((c) => c.id === "friendly")!;
    assert.equal(friendly.tag, "In lobby");
    assert.equal(friendly.route, "/play/friendly");
    assert.equal(modeCards().find((c) => c.id === "friendly")!.tag, "Open");
});

test("a friendly result claims no rating, experience or loss: the fallen are home", () => {
    const result: MatchResult = {
        outcome: "defeat",
        friendly: true,
        earned: 0,
        rating: [1500, 1500],
        squad: [
            { objectId: "0x1", name: "Kira", rank: "Rookie", xp: 2 },
            { objectId: "0x2", name: "Vex", rank: "Squaddie", xp: 5 },
        ],
        fallen: ["0x2"],
        history: [
            { $kind: "NextTurn", NextTurn: 2 },
            { $kind: "UnitKIA", UnitKIA: ["0x2", 0, 0] },
        ],
        recruitsHome: 4,
        opponent: "kestrel",
    };
    const d = debriefOf(result, 3);
    assert.equal(d.title, "Defeat");
    assert.equal(d.rating, null);
    assert.equal(d.replacement, null);
    assert.deepEqual(d.lines, ["Friendly match · Everyone comes home"]);
    assert.equal(d.plates.filter((p) => p.kind === "kia").length, 0);
    const [kira, vex, empty] = d.plates;
    assert.ok(kira.kind === "home" && kira.gained === null && kira.hint === "Home");
    assert.ok(
        vex.kind === "home" && vex.rankAfter === "Squaddie" && vex.hint === "Fell on turn 3 · Home",
    );
    assert.equal(empty.kind, "vacant");

    // Walking out of a friendly game suspends nobody.
    assert.equal(debriefOf({ ...result, outcome: "abandoned" }).note, null);
    assert.equal(debriefOf({ ...result, outcome: "forfeited" }).note, "Missed 3 turns in a row");
    // A rated one still says it.
    assert.equal(
        debriefOf({ ...result, friendly: false, outcome: "abandoned" }).note,
        "No new match for a minute",
    );
});
