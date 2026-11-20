// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { GameEvent, PlaybackState } from "../../packages/engine/src/index.ts";
import { COMBAT_ACTIONS, DEFAULT_COMBAT_BINDINGS } from "../../packages/engine/src/keys.ts";
import { delayBefore, DEFAULT_PACE, initialRelease, paceOf } from "../src/features/watch/drip.ts";
import {
    journalKills,
    journalTurns,
    KEEP,
    readJournals,
    saveJournal,
    type JournalStorage,
    type LocalJournal,
} from "../src/features/watch/journal.ts";
import {
    banner,
    cycleSpeed,
    focusOrder,
    jumpTarget,
    keyCap,
    liveChip,
    pipHint,
    pipsOf,
    pipTitle,
    scrubWindow,
    SCRUB_WINDOW,
    speedLabel,
    turnReadout,
    WATCH_KEYS,
} from "../src/features/watch/model.ts";
import { DEFAULT_BINDINGS } from "../src/settings/keys.ts";
import { FocusStore, type Command, type FocusElement } from "../src/ui/focus-store.ts";
import { parentOf } from "../src/routes.ts";

const SIDES = [{ name: "Ghosts" }, { name: "Hostiles" }] as const;

const move = (unit: string): GameEvent => ({
    type: "move",
    unit,
    path: [
        [0, 0],
        [0, 1],
    ],
    vault: false,
    cover: false,
});
const EVENTS: GameEvent[] = [
    move("a"),
    { type: "hostile-phase" },
    {
        type: "shot",
        unit: "h",
        target: "a",
        hit: true,
        crit: false,
        damage: 12,
        killed: true,
        reaction: false,
    },
    { type: "turn", turn: 2 },
    {
        type: "grenade",
        unit: "b",
        at: [0, 0],
        casualties: [{ unit: "h", damage: 5, killed: true }],
    },
    { type: "hostile-phase" },
    move("i"),
];

function state(patch: Partial<PlaybackState> = {}): PlaybackState {
    return {
        cursor: 0,
        total: EVENTS.length,
        turns: [
            { start: 0, side: 0, round: 1, kills: 0 },
            { start: 2, side: 1, round: 1, kills: 1 },
            { start: 4, side: 0, round: 2, kills: 1 },
            { start: 6, side: 1, round: 2, kills: 0 },
        ],
        turn: 0,
        playing: true,
        speed: 1,
        growing: false,
        live: false,
        behind: 3,
        finished: false,
        outcome: null,
        ...patch,
    };
}

function memory(): JournalStorage & { data: Map<string, string>; limit: number } {
    const data = new Map<string, string>();
    return {
        data,
        limit: Infinity,
        getItem: (k) => data.get(k) ?? null,
        setItem(k, v) {
            if (v.length > this.limit) throw new Error("QuotaExceededError");
            data.set(k, v);
        },
    };
}

const journal = (id: string, updatedAt: number, events = EVENTS): LocalJournal => ({
    v: 1,
    id,
    scenario: "black-rain",
    squad: null,
    events,
    startedAt: updatedAt - 1000,
    updatedAt,
    result: null,
});

// === Recorded games ===

test("recorded games are kept newest first, replaced by id, at most KEEP", () => {
    const store = memory();
    for (let i = 0; i < KEEP + 2; i++) assert.ok(saveJournal(store, journal(`g${i}`, 1000 + i)));
    let list = readJournals(store);
    assert.equal(list.length, KEEP);
    assert.equal(list[0].id, `g${KEEP + 1}`, "the newest first");
    assert.ok(!list.some((j) => j.id === "g0" || j.id === "g1"), "the oldest went");
    saveJournal(store, { ...journal("g3", 5000), result: "victory" });
    list = readJournals(store);
    assert.equal(list.filter((j) => j.id === "g3").length, 1, "the same game is one entry");
    assert.equal(list[0].id, "g3");
    assert.equal(list[0].result, "victory");
});

test("a full store drops the oldest recordings until the new one fits; junk reads as nothing", () => {
    const store = memory();
    saveJournal(store, journal("old", 1));
    saveJournal(store, journal("older", 0));
    store.limit = store.data.get("ghosts:watch:journals")!.length;
    assert.ok(saveJournal(store, journal("new", 2)));
    const ids = readJournals(store).map((j) => j.id);
    assert.equal(ids[0], "new");
    assert.ok(ids.length < 3);
    store.data.set("ghosts:watch:journals", "{not json");
    assert.deepEqual(readJournals(store), []);
    store.data.set("ghosts:watch:journals", JSON.stringify([{ v: 2 }, journal("ok", 3)]));
    assert.deepEqual(
        readJournals(store).map((j) => j.id),
        ["ok"],
    );
    assert.deepEqual(readJournals(null), []);
});

test("a recording's turns and the units that fell in it", () => {
    assert.equal(journalTurns(EVENTS), 4);
    assert.equal(journalKills(EVENTS), 2);
    assert.equal(journalTurns([]), 1);
});

// === The growing test source's pace ===

test("the growing source opens with its first turns out, then turns open slower than moves", () => {
    assert.equal(initialRelease(EVENTS, 3), 5, "everything before the third turn opening");
    assert.equal(initialRelease(EVENTS, 1), 1);
    assert.equal(initialRelease(EVENTS, 9), EVENTS.length, "a short game is out at once");
    assert.equal(delayBefore({ type: "turn", turn: 3 }, DEFAULT_PACE), DEFAULT_PACE.turn);
    assert.equal(delayBefore(move("a"), DEFAULT_PACE), DEFAULT_PACE.step);
    assert.ok(DEFAULT_PACE.turn > DEFAULT_PACE.step);
    assert.ok(paceOf("fast").step < DEFAULT_PACE.step);
    assert.deepEqual(paceOf(null), DEFAULT_PACE);
});

// === The viewer model ===

test("speeds read as 0.5x to 4x and the control cycles through them", () => {
    assert.deepEqual(
        [0.5, 1, 2, 4].map((s) => speedLabel(s as 1)),
        ["0.5x", "1x", "2x", "4x"],
    );
    assert.equal(cycleSpeed(0.5), 1);
    assert.equal(cycleSpeed(2), 4);
    assert.equal(cycleSpeed(4), 0.5);
});

test("the readout names the turn as the players count it, of how many, and whose go it is", () => {
    assert.deepEqual(turnReadout(state({ turn: 1 }), SIDES), {
        turn: "Turn 01 of 02",
        side: "Hostiles",
    });
    assert.deepEqual(turnReadout(state({ turn: 2 }), SIDES), {
        turn: "Turn 02 of 02",
        side: "Ghosts",
    });
});

test("the scrubber: a pip per turn with its side, the viewer's place, the kills and the live edge", () => {
    const pips = pipsOf(state({ turn: 2, growing: true }));
    assert.deepEqual(
        pips.map((p) => [p.number, p.side, p.past, p.current, p.kills, p.edge]),
        [
            [1, 0, true, false, 0, false],
            [1, 1, true, false, 1, false],
            [2, 0, false, true, 1, false],
            [2, 1, false, false, 0, true],
        ],
    );
    assert.equal(pipTitle(pips[1], SIDES), "Turn 01 · Hostiles");
    assert.equal(pipHint(pips[1]), "1 unit fell");
    assert.equal(pipHint(pips[0]), "Nobody fell");
    assert.match(pipHint(pips[3]), /being played/);
    assert.equal(
        pipsOf(state()).some((p) => p.edge),
        false,
        "a finished game has no live edge",
    );
});

test("the Live chip: none on a replay, lit while following, the way back with how far behind", () => {
    assert.equal(liveChip(state()), null);
    assert.deepEqual(liveChip(state({ growing: true, live: true, behind: 0 })), {
        following: true,
        label: "Live",
    });
    const behind = liveChip(state({ growing: true, live: false, behind: 2, playing: false }));
    assert.equal(behind?.following, false);
    assert.equal(behind?.label, "Live · 2 turns behind");
    assert.equal(liveChip(state({ growing: true, behind: 1 }))?.label, "Live · 1 turn behind");
});

test("the banner names the winner, or why there is none, with the record in labelled numbers", () => {
    assert.equal(banner(state(), SIDES), null);
    assert.deepEqual(banner(state({ finished: true, outcome: { winner: 1 } }), SIDES), {
        title: "Hostiles won",
        line: "2 turns · 2 units fell",
    });
    assert.deepEqual(
        banner(
            state({ finished: true, outcome: { winner: 0, reason: "Hostiles left the game" } }),
            SIDES,
        ),
        { title: "Ghosts won", line: "Hostiles left the game · 2 turns · 2 units fell" },
        "a game won off the field says why",
    );
    assert.equal(
        banner(
            state({ finished: true, outcome: { winner: null, reason: "Left before the end" } }),
            SIDES,
        )?.title,
        "Left before the end",
    );
    assert.equal(banner(state({ finished: true }), SIDES)?.title, "No winner");
});

test("player-facing copy reads as finished: no preview, beta or soon", () => {
    const copy = [
        ...[0, 1, 2, 3].map((turn) => turnReadout(state({ turn }), SIDES).turn),
        ...pipsOf(state({ growing: true })).flatMap((p) => [pipTitle(p, SIDES), pipHint(p)]),
        JSON.stringify(liveChip(state({ growing: true, behind: 2 }))),
        JSON.stringify(banner(state({ finished: true, outcome: { winner: 0 } }), SIDES)),
        readFileSync(new URL("../src/features/watch/WatchScreen.tsx", import.meta.url), "utf8"),
        readFileSync(new URL("../src/features/watch/WatchList.tsx", import.meta.url), "utf8"),
    ].join(" ");
    assert.doesNotMatch(copy, /preview|beta|\bsoon\b|for now|mock/i);
});

test("a long game's strip is a window around the viewer's turn, with jumps of ten turns either side", () => {
    // 60 turns of both sides: 120 goes, rounds 0 to 59 as a chain game counts them
    const turns = Array.from({ length: 120 }, (_, i) => ({
        start: i * 3,
        side: (i % 2) as 0 | 1,
        round: Math.floor(i / 2),
        kills: 0,
    }));
    const long = (turn: number) => state({ turns, turn, total: 360 });
    const at = (turn: number) => scrubWindow(pipsOf(long(turn)), turn);

    const start = at(0);
    assert.equal(start.pips.length, SCRUB_WINDOW);
    assert.deepEqual([start.earlier, start.later], [0, 100]);
    assert.equal(start.pips[0].index, 0);

    const middle = at(61);
    assert.ok(
        middle.pips.some((p) => p.current),
        "the viewer's turn is always on the strip",
    );
    assert.deepEqual([middle.earlier, middle.later], [51, 49]);

    const end = at(119);
    assert.deepEqual([end.earlier, end.later], [100, 0]);
    assert.equal(end.pips.at(-1)?.index, 119);

    // a short game shows whole, no jumps
    assert.deepEqual(scrubWindow(pipsOf(state()), 0), {
        pips: pipsOf(state()),
        earlier: 0,
        later: 0,
    });

    // ten turns as the players count them: the first go of that round, clamped at the ends
    assert.equal(turns[jumpTarget(turns, 61, 1)].round, 40);
    assert.equal(turns[jumpTarget(turns, 61, 1)].side, 0);
    assert.equal(turns[jumpTarget(turns, 61, -1)].round, 20);
    assert.equal(jumpTarget(turns, 4, -1), 0);
    assert.equal(jumpTarget(turns, 115, 1), 119);

    // focus walks the window, with the jumps at its ends, then Live and Copy link
    const ids = focusOrder({ ...long(61), growing: true }, { link: true });
    assert.equal(ids.filter((id) => id.startsWith("watch-pip-")).length, SCRUB_WINDOW);
    assert.equal(ids[4], "watch-back");
    assert.deepEqual(ids.slice(-3), ["watch-ahead", "watch-live", "watch-link"]);
    assert.deepEqual(
        focusOrder({ ...long(119), finished: true }, { replay: true }).slice(0, 3),
        ["watch-replay", "watch-again", "watch-leave"],
        "a live game that ended offers its replay first",
    );
});

// === Keys ===

test("the viewer's keys clash with no camera or readout key and with no menu key but Space", () => {
    const combat = new Set(
        COMBAT_ACTIONS.flatMap((a) => DEFAULT_COMBAT_BINDINGS[a]).map((k) => k.toLowerCase()),
    );
    const menu = new Set(
        Object.values(DEFAULT_BINDINGS)
            .flat()
            .map((k) => k.toLowerCase()),
    );
    for (const [name, key] of Object.entries(WATCH_KEYS)) {
        assert.ok(!combat.has(key.toLowerCase()), `${name} (${key}) is a combat key`);
        if (name !== "toggle")
            assert.ok(!menu.has(key.toLowerCase()), `${name} (${key}) is a menu key`);
    }
    assert.ok(menu.has(" "), "Space confirms in menus: the viewer takes it for play and pause");
    assert.equal(keyCap(" "), "Space");
    assert.equal(keyCap("l"), "L");
});

// === Focus order ===

let order = 0;
function box(left: number, top: number, width = 40, height = 40) {
    const at = order++;
    return {
        at,
        isConnected: true,
        getBoundingClientRect: () =>
            ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect,
        compareDocumentPosition: (other: { at: number }) => (other.at > at ? 4 : 2),
    } as unknown as FocusElement;
}

const GROUP: Record<string, string> = {
    "watch-again": "banner",
    "watch-leave": "banner",
    "watch-live": "live",
};
const groupOf = (id: string) =>
    GROUP[id] ?? (id.startsWith("watch-pip") ? "scrubber" : "transport");

/** The transport laid out as the screen draws it: one row, left to right; the banner above. */
function laidOut(ids: string[]) {
    const s = new FocusStore({ action: "back", label: "Leave" } as Command);
    let x = 0;
    for (const id of ids) {
        const banner = groupOf(id) === "banner";
        s.register({
            id,
            group: groupOf(id),
            scope: "root",
            el: banner ? box(500 + (id === "watch-leave" ? 120 : 0), 200, 110) : box(x, 660),
            commands: [],
        });
        if (!banner) x += 48;
    }
    return s;
}

test("the cursor opens on the transport and walks it left to right: buttons, every turn, Live", () => {
    const ids = focusOrder(state({ growing: true }));
    assert.deepEqual(ids.slice(0, 4), ["watch-prev", "watch-play", "watch-next", "watch-speed"]);
    assert.equal(ids.at(-1), "watch-live");
    const s = laidOut(ids);
    assert.equal(s.focused, "watch-prev");
    const walked = [s.focused];
    for (let i = 1; i < ids.length; i++) {
        s.move("right");
        walked.push(s.focused);
    }
    assert.deepEqual(walked, ids);
    s.move("left");
    assert.equal(s.focused, ids.at(-2), "and back");
});

test("a finished game puts its banner first: Watch again, then Leave, above the transport", () => {
    const ids = focusOrder(state({ finished: true }));
    assert.deepEqual(ids.slice(0, 2), ["watch-again", "watch-leave"]);
    assert.ok(!ids.includes("watch-live"), "no Live on a finished game");
    const s = laidOut(ids);
    assert.equal(s.focused, "watch-again");
    s.move("right");
    assert.equal(s.focused, "watch-leave");
    s.move("down");
    assert.notEqual(
        groupOf(s.focused!),
        "banner",
        "down from the banner lands on the strip below it",
    );
});

test("Back from a game in the viewer goes to the watch screen, and from there to the menu", () => {
    assert.equal(parentOf("/watch/local/abc"), "/watch");
    assert.equal(parentOf("/watch/qa/abc"), "/watch");
    assert.equal(parentOf(`/watch/0x${"a".repeat(64)}`), "/watch");
    assert.equal(parentOf("/watch"), "/");
});
