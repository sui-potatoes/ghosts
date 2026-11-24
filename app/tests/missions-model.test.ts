// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";

import {
    briefParts,
    cellSize,
    clockOf,
    columnLabel,
    openingMission,
    plotOf,
    ruleMarks,
    tally,
    withNext,
    type Mission,
    type PlotTile,
} from "../src/features/missions/model.ts";

const E: PlotTile = { t: "empty" };
const W: PlotTile = { t: "wall" };
const O: PlotTile = { t: "obstacle" };
const V: PlotTile = { t: "unwalkable" };
const cover = (l: number, t: number, r: number, b: number): PlotTile => ({
    t: "cover",
    sides: [l, t, r, b],
});

test("a plot sorts the tiles and keeps each cover edge once, at its higher level", () => {
    // (0,0) has high cover on its east side; (1,0) carries the same edge as low cover on its west.
    const tiles: PlotTile[][] = [
        [cover(0, 0, 2, 0), cover(1, 0, 0, 1), W],
        [O, V, E],
    ];
    const plot = plotOf(tiles, { squad: [[0, 1]], hostiles: [[2, 1]] }, [2, 0]);
    assert.equal(plot.cols, 3);
    assert.equal(plot.rows, 2);
    assert.deepEqual(plot.walls, [[2, 0]]);
    assert.deepEqual(plot.obstacles, [[0, 1]]);
    assert.deepEqual(plot.voids, [[1, 1]]);
    assert.equal(plot.edges.length, 2);
    assert.deepEqual(
        plot.edges.find((e) => e.side === "e" || e.side === "w"),
        { x: 0, y: 0, side: "e", level: 2 },
    );
    assert.deepEqual(
        plot.edges.find((e) => e.side === "s"),
        { x: 1, y: 0, side: "s", level: 1 },
    );
    assert.deepEqual(plot.objective, [2, 0]);
});

test("deployment and objective off the grid are dropped", () => {
    const plot = plotOf(
        [[E, E]],
        {
            squad: [
                [0, 0],
                [5, 0],
            ],
            hostiles: [[-1, 0]],
        },
        [0, 3],
    );
    assert.deepEqual(plot.squad, [[0, 0]]);
    assert.deepEqual(plot.hostiles, []);
    assert.equal(plot.objective, undefined);
});

test("columns read as letters past Z", () => {
    assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(columnLabel), [
        "A",
        "B",
        "Z",
        "AA",
        "AB",
        "AZ",
        "BA",
    ]);
});

test("rule marks step evenly and always end on the last cell, never crowding it", () => {
    assert.deepEqual(ruleMarks(10, 4), [0, 4, 9]);
    assert.deepEqual(ruleMarks(9, 4), [0, 4, 8]);
    assert.deepEqual(ruleMarks(10, 3), [0, 3, 6, 9]);
    assert.deepEqual(ruleMarks(1, 4), [0]);
    assert.deepEqual(ruleMarks(0, 4), []);
});

test("cells are whole pixels that fit the box", () => {
    assert.equal(cellSize({ cols: 18, rows: 14 }, { width: 700, height: 500 }), 35);
    assert.equal(cellSize({ cols: 21, rows: 22 }, { width: 100, height: 100 }), 6);
    assert.equal(cellSize({ cols: 0, rows: 0 }, { width: 100, height: 100 }), 6);
});

test("a briefing line splits its order names out", () => {
    assert.deepEqual(briefParts("Use *Extract* now"), [
        { text: "Use ", order: false },
        { text: "Extract", order: true },
        { text: " now", order: false },
    ]);
    assert.deepEqual(briefParts("Plain"), [{ text: "Plain", order: false }]);
});

const mission = (id: string, state: Mission["state"]): Mission => ({
    id,
    name: id,
    location: "",
    brief: [],
    objectives: [],
    facts: [],
    state,
    verb: "Deploy",
});

test("the next mission is the first open one; the board opens on it", () => {
    const board = withNext([
        mission("a", "done"),
        mission("b", "locked"),
        mission("c", "open"),
        mission("d", "open"),
    ]);
    assert.deepEqual(
        board.filter((m) => m.next).map((m) => m.id),
        ["c"],
    );
    assert.equal(openingMission(board), "c");
    assert.equal(openingMission(board, "d"), "d");
    assert.equal(openingMission(board, "zz"), "c");
    const cleared = withNext([mission("a", "done")]);
    assert.equal(cleared[0].next, undefined);
    assert.equal(openingMission(cleared), "a");
    assert.equal(openingMission([]), null);
    assert.equal(tally(board), "1 / 4");
});

test("the clock is UTC, two digits each", () => {
    assert.equal(clockOf(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), "03:04:05");
});
