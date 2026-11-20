// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { GameEvent, PlaybackState } from "../../packages/engine/src/index.ts";
import type { EndingOutcome } from "../src/features/watch/chain/phrases.ts";
import { COMBAT_ACTIONS, DEFAULT_COMBAT_BINDINGS } from "../../packages/engine/src/keys.ts";
import {
    banner,
    cycleSpeed,
    finalLine,
    focusOrder,
    jumpTarget,
    keyCap,
    liveChip,
    matchCard,
    matchRowCommands,
    pipHint,
    pipsOf,
    pipTitle,
    readoutNote,
    resultText,
    sceneEnding,
    scrubWindow,
    SCRUB_WINDOW,
    speedLabel,
    spectatorEntries,
    transportKeys,
    turnReadout,
    WATCH_KEYS,
} from "../src/features/watch/model.ts";
import { inlineConfirm } from "../src/ui/focus-store.ts";
import { EXPLORER, explorerUrl } from "../src/constants.ts";
import { Playback, type PlaybackStage } from "../../packages/engine/src/replay/playback.ts";
import { blackRain } from "../../packages/engine/src/scenario.ts";
import { pauseEntries } from "../src/features/dialogs/model.ts";
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
    assert.match(pipHint(pips[3]), /Turn in play/);
    assert.equal(
        pipsOf(state()).some((p) => p.edge),
        false,
        "a finished match has no live edge",
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

test("the banner has two lines: who won, and why under it, then the record in labelled numbers", () => {
    assert.equal(banner(state(), SIDES), null);
    assert.deepEqual(banner(state({ finished: true, outcome: { winner: 1 } }), SIDES), {
        title: "Hostiles won",
        reason: "by elimination",
        line: "2 turns · 2 units fell",
    });
    assert.equal(banner(state({ finished: true }), SIDES)?.title, "No result");
    assert.equal(banner(state({ finished: true }), SIDES)?.reason, "The ending was not recorded");
});

/** Every ending as the source tells it for sides Ghosts (0) and Hostiles (1). */
const ENDINGS: [string, EndingOutcome, string, string, string | null][] = [
    [
        "elimination",
        { kind: "won", winner: 0, reason: "by elimination" },
        "Ghosts won",
        "by elimination",
        null,
    ],
    [
        "abandoned",
        { kind: "abandoned", winner: 0, reason: "Hostiles left the match" },
        "Ghosts won",
        "Hostiles left the match",
        "Hostiles left the match \u00b7 Match abandoned",
    ],
    [
        "forfeited",
        { kind: "forfeited", winner: 1, reason: "Ghosts missed 3 turns in a row" },
        "Hostiles won",
        "Ghosts missed 3 turns in a row",
        "Ghosts missed 3 turns in a row \u00b7 Match forfeited",
    ],
    [
        "no-show",
        { kind: "no-show", winner: 0, reason: "Hostiles did not deploy in time" },
        "Ghosts won",
        "Hostiles did not deploy in time",
        null,
    ],
    [
        "nobody showed",
        { kind: "nobody-showed", winner: null, reason: "Neither side deployed" },
        "No winner",
        "Neither side deployed",
        null,
    ],
    [
        "stalemate",
        { kind: "stalemate", winner: null, reason: "Turn limit reached" },
        "Draw",
        "Turn limit reached",
        "Turn limit reached \u00b7 Match drawn",
    ],
    [
        "draw",
        { kind: "draw", winner: null, reason: "Both squads fell" },
        "Draw",
        "Both squads fell",
        null,
    ],
];

test("each ending: the banner's title and reason, the card's result, the scene's final line", () => {
    for (const [name, outcome, title, reason, last] of ENDINGS) {
        const end = banner(state({ finished: true, outcome }), SIDES);
        assert.equal(end?.title, title, name);
        assert.equal(end?.reason, reason, name);
        assert.equal(resultText(outcome, SIDES), `${title} \u00b7 ${reason}`, `${name}: card`);
        assert.equal(finalLine(outcome, SIDES), last, `${name}: final line`);
        assert.match(`${title} ${reason}`, /^[^.]*$/, `${name}: no full stop`);
    }
});

test("the scene's ending: the header's result and the status line, only at the end of the match", () => {
    const forfeit = ENDINGS[2][1];
    assert.equal(sceneEnding({ finished: false, outcome: null }, SIDES), null);
    assert.equal(sceneEnding({ finished: true, outcome: null }, SIDES), null);
    assert.deepEqual(sceneEnding({ finished: true, outcome: forfeit }, SIDES), {
        header: "Hostiles won",
        status: "Ghosts missed 3 turns in a row \u00b7 Match forfeited",
    });
    assert.deepEqual(sceneEnding({ finished: true, outcome: ENDINGS[0][1] }, SIDES), {
        header: "Ghosts won",
        status: undefined,
    });
    assert.deepEqual(sceneEnding({ finished: true, outcome: ENDINGS[5][1] }, SIDES), {
        header: "Draw",
        status: "Turn limit reached \u00b7 Match drawn",
    });
});

test("the readout note: missed turns build up in a forfeit, the final line closes the match", () => {
    const forfeit = ENDINGS[2][1];
    // seven goes, Ghosts (0) on the even ones; Ghosts missed the 3rd, 5th and 7th
    const turns = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        start: i,
        side: (i % 2) as 0 | 1,
        round: Math.floor(i / 2),
        kills: 0,
    }));
    const missed = [0, 0, 1, 0, 2, 0, 3];
    const note = (turn: number, finished = false) =>
        readoutNote(
            { turns, turn, finished, outcome: finished ? forfeit : null, growing: false },
            SIDES,
            forfeit,
            missed,
        );
    assert.deepEqual(
        [0, 1, 2, 3, 4, 5, 6].map((t) => note(t)),
        [
            null,
            null,
            "Ghosts missed turn 1 of 3",
            null,
            "Ghosts missed turn 2 of 3",
            null,
            "Ghosts missed turn 3 of 3",
        ],
    );
    assert.equal(note(6, true), "Ghosts missed 3 turns in a row \u00b7 Match forfeited");
    const live = readoutNote(
        { turns, turn: 6, finished: false, outcome: null, growing: true },
        SIDES,
        null,
    );
    assert.equal(live, null, "a match still going says nothing");
    assert.equal(
        readoutNote(
            { turns, turn: 4, finished: false, outcome: null, growing: false },
            SIDES,
            ENDINGS[2][1],
        ),
        null,
        "no per-turn counts known: nothing is guessed before the end",
    );
});

test("player-facing copy reads as finished: no preview, beta or soon", () => {
    const copy = [
        ...[0, 1, 2, 3].map((turn) => turnReadout(state({ turn }), SIDES).turn),
        ...pipsOf(state({ growing: true })).flatMap((p) => [pipTitle(p, SIDES), pipHint(p)]),
        JSON.stringify(liveChip(state({ growing: true, behind: 2 }))),
        JSON.stringify(banner(state({ finished: true, outcome: { winner: 0 } }), SIDES)),
        readFileSync(new URL("../src/features/watch/Viewer.tsx", import.meta.url), "utf8"),
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
    assert.deepEqual(ids.slice(-4), ["watch-ahead", "watch-live", "watch-link", "watch-menu"]);
    assert.deepEqual(
        focusOrder({ ...long(119), finished: true }).slice(0, 2),
        ["watch-replay", "watch-leave"],
        "the banner offers one Watch replay, then Leave",
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
    "watch-replay": "banner",
    "watch-leave": "banner",
    "watch-live": "live",
    "watch-menu": "share",
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
    assert.deepEqual(ids.slice(-2), ["watch-live", "watch-menu"]);
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

test("a finished game puts its banner first: Watch replay, then Leave, above the transport", () => {
    const ids = focusOrder(state({ finished: true }));
    assert.deepEqual(ids.slice(0, 2), ["watch-replay", "watch-leave"]);
    assert.ok(!ids.includes("watch-live"), "no Live on a finished match");
    const s = laidOut(ids);
    assert.equal(s.focused, "watch-replay");
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
    assert.equal(parentOf(`/watch/0x${"a".repeat(64)}`), "/watch");
    assert.equal(parentOf("/watch"), "/");
});

// === Spectator menu ===

test("the spectator menu: Resume, Options, Explorer, Copy link, Leave, in that order", () => {
    const ids = (opts: Parameters<typeof spectatorEntries>[0]) =>
        pauseEntries({
            briefing: false,
            restart: false,
            quitLabel: "Leave",
            extra: spectatorEntries(opts),
        }).map((e) => e.id);
    assert.deepEqual(ids({ link: true, explorer: true }), [
        "resume",
        "options",
        "explorer",
        "link",
        "quit",
    ]);
    // no briefing, restart or abandon; a missing link or explorer leaves its entry out
    assert.deepEqual(ids({ link: false, explorer: false }), ["resume", "options", "quit"]);
    const labels = pauseEntries({
        briefing: false,
        restart: false,
        quitLabel: "Leave",
        extra: spectatorEntries({ link: true, explorer: true, copied: "copied" }),
    }).map((e) => e.label);
    assert.deepEqual(labels, ["Resume", "Options", "Explorer", "Link copied", "Leave"]);
});

test("the transport keys stand still while the menu is open and act otherwise", () => {
    const calls: string[] = [];
    const playback = {
        toggle: () => calls.push("toggle"),
        prevTurn: () => calls.push("prev"),
        nextTurn: () => calls.push("next"),
        stepSpeed: (n: number) => calls.push(`speed${n}`),
        goLive: () => calls.push("live"),
        restart: () => calls.push("restart"),
        getState: () => ({ growing: true }),
    };
    assert.deepEqual(Object.keys(transportKeys(playback, true)), [], "no key while the menu is up");
    const keys = transportKeys(playback, false);
    for (const key of Object.values(WATCH_KEYS)) assert.ok(keys[key], `${key} acts`);
    keys[WATCH_KEYS.toggle]();
    keys[WATCH_KEYS.live]();
    assert.deepEqual(calls, ["toggle", "live"]);
});

test("back: a prompt closes first, then the viewer opens the menu, and the menu's back resumes", () => {
    // The input bus is LIFO (input.ts): the newest consumer takes Back first.
    const handlers: ((action: string) => boolean)[] = [];
    const dispatch = (action: string) => {
        for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i](action)) return true;
        return false;
    };
    const log: string[] = [];
    handlers.push((a) => a === "back" && (log.push("menu opens"), true)); // the viewer's root
    handlers.push((a) => a === "back" && (log.push("prompt closes"), handlers.pop(), true));
    dispatch("back");
    dispatch("back");
    handlers.push((a) => a === "back" && (log.push("resume"), handlers.pop(), true)); // the menu
    dispatch("back");
    assert.deepEqual(log, ["prompt closes", "menu opens", "resume"]);
});

test("the explorer link carries the id, encoded, and the network from the constants", () => {
    assert.equal(
        explorerUrl("0xabc"),
        `https://devxplorer.io/?search=0xabc&network=${EXPLORER.network}`,
    );
    assert.equal(EXPLORER.network, "testnet");
    assert.equal(
        explorerUrl("demo name&x=1", { base: "https://example.test/", network: "devnet" }),
        "https://example.test/?search=demo+name%26x%3D1&network=devnet",
    );
});

// === Match card ===

const TURNS = [
    { index: 0, round: 1, side: 0 as const, kills: 0 },
    { index: 2, round: 1, side: 1 as const, kills: 1 },
    { index: 5, round: 2, side: 0 as const, kills: 0 },
];
const FACTS = {
    mode: "Ranked 3x3 · Contractor",
    level: "Operation Black Rain",
    playedAt: Date.UTC(2026, 10, 20, 12, 0),
};
const NOW = FACTS.playedAt + 3 * 3_600_000;
const card = (over: Partial<Parameters<typeof matchCard>[0]> = {}) =>
    matchCard({
        live: false,
        sides: SIDES,
        turns: TURNS,
        outcome: { winner: 1 },
        over: true,
        facts: FACTS,
        now: NOW,
        ...over,
    });

test("the card of a replay: marked Replay, who played whom, labelled facts", () => {
    const c = card();
    assert.equal(c.eyebrow, "Replay");
    assert.equal(c.title, "Ghosts vs Hostiles");
    assert.deepEqual(
        c.facts.map(([label]) => label),
        ["Mode", "Level", "Result", "Turns", "Played"],
    );
    const fact = (label: string) => c.facts.find(([l]) => l === label)![1];
    assert.equal(fact("Mode"), "Ranked 3x3 · Contractor");
    assert.equal(fact("Result"), "Hostiles won · by elimination");
    assert.equal(fact("Turns"), "2 turns");
    assert.match(fact("Played"), /2026 · 3 h ago$/);
});

test("the card's result for each ending: the title, a dot, the reason", () => {
    assert.equal(
        resultText({ winner: 1, reason: "Ghosts missed 3 turns in a row" }, SIDES),
        "Hostiles won \u00b7 Ghosts missed 3 turns in a row",
    );
    assert.equal(
        resultText({ winner: null }, SIDES),
        "No winner \u00b7 The ending was not recorded",
    );
    assert.equal(resultText(null, SIDES), "No result \u00b7 The ending was not recorded");
});

test("the card of a live game: marked Live, no result yet, the turn so far, no date; modes read as given", () => {
    const c = card({ live: true, over: false, outcome: null });
    assert.equal(c.eyebrow, "Live");
    const facts = Object.fromEntries(c.facts);
    assert.equal(facts.Result, "In progress");
    assert.equal(facts.Turns, "2 turns so far");
    assert.equal(facts.Played, undefined);
    const friendly = card({ facts: { mode: "Friendly 3x3" } });
    assert.deepEqual(
        friendly.facts.map(([label]) => label),
        ["Mode", "Result", "Turns"],
        "what is not known is left out, not guessed",
    );
    assert.equal(Object.fromEntries(card({ turns: [TURNS[0]] }).facts).Turns, "1 turn");
});

test("the spectator menu offers Game details where the players' menu has Briefing", () => {
    const ids = pauseEntries({
        briefing: true,
        briefingLabel: "Match details",
        restart: false,
        quitLabel: "Leave",
        extra: spectatorEntries({ link: true, explorer: true }),
    });
    assert.deepEqual(
        ids.map((e) => e.id),
        ["resume", "briefing", "options", "explorer", "link", "quit"],
    );
    assert.equal(ids[1].label, "Match details");
    assert.equal(
        pauseEntries({ briefing: true, restart: false, quitLabel: "Q" })[1].label,
        "Briefing",
        "the players' menu keeps its word",
    );
});

test("a held replay applies no event before Play", async () => {
    const events: GameEvent[] = [move("a"), { type: "hostile-phase" }, move("h")];
    const source = {
        scenario: blackRain,
        sides: SIDES,
        events: () => events,
        ended: () => true,
        subscribe: () => () => {},
    };
    const presented: GameEvent[] = [];
    const rebuilt: number[] = [];
    const stage: PlaybackStage = {
        rebuild: (_events, index) => void rebuilt.push(index),
        present: async (event) => void presented.push(event),
        wait: async () => {},
        finish: async () => {},
        setTimeScale: () => {},
        setVoice: () => {},
    };
    const playback = new Playback(source, stage);
    playback.start({ at: "start", paused: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(presented, [], "nothing presented while held");
    assert.equal(playback.getState().playing, false);
    assert.equal(playback.getState().cursor, 0);
    assert.deepEqual(rebuilt.at(-1), 0, "the field shows the opening position");
    playback.play();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(presented.length > 0, "Play starts the events");
    playback.dispose();
});

test("a Spectate match row has one primary and nothing secondary or list-wide to show inline", () => {
    const commands = matchRowCommands("Watch", () => {});
    assert.deepEqual(
        commands.map((c) => c.action),
        ["nav", "confirm"],
    );
    assert.equal(inlineConfirm(commands, { armed: false, offered: false }), undefined);
    assert.equal(inlineConfirm(commands, { armed: true, offered: false })?.label, "Watch");
});
