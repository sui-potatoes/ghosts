// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";

import type { MissionPlot, PlotCell, PlotEdge } from "../src/features/missions/model.ts";
import {
    clusters,
    contours,
    coverRuns,
    enclosedVoids,
    groundMarks,
    insetLoop,
    loopPath,
    openings,
    placeLabel,
    regions,
    sheetLayout,
    signedArea,
    snap,
} from "../src/features/missions/site.ts";

const plot = (over: Partial<MissionPlot>): MissionPlot => ({
    cols: 6,
    rows: 6,
    walls: [],
    obstacles: [],
    voids: [],
    edges: [],
    squad: [],
    hostiles: [],
    ...over,
});

test("an L of wall tiles traces to one clockwise outline of six corners", () => {
    const cells: PlotCell[] = [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 2],
        [2, 2],
    ];
    const loops = contours(cells);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].hole, false);
    assert.deepEqual(loops[0].points, [
        [0, 0],
        [1, 0],
        [1, 2],
        [3, 2],
        [3, 3],
        [0, 3],
    ]);
    assert.ok(signedArea(loops[0].points) > 0);
    // Twice the area: five tiles.
    assert.equal(signedArea(loops[0].points), 10);
});

test("a ring traces to an outer outline and a hole the other way round", () => {
    const cells: PlotCell[] = [];
    for (let y = 0; y < 3; y++)
        for (let x = 0; x < 4; x++) if (y !== 1 || x === 0 || x === 3) cells.push([x, y]);
    const loops = contours(cells);
    assert.equal(loops.length, 2);
    const [outer, hole] = loops;
    assert.equal(outer.hole, false);
    assert.deepEqual(outer.points, [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
    ]);
    assert.equal(hole.hole, true);
    assert.equal(hole.points.length, 4);
    assert.equal(signedArea(hole.points), -4);
});

test("cells meeting only at a corner stay two outlines", () => {
    const loops = contours([
        [0, 0],
        [1, 1],
    ]);
    assert.equal(loops.length, 2);
    for (const loop of loops) {
        assert.equal(loop.points.length, 4);
        assert.equal(loop.hole, false);
    }
});

test("regions are 4-connected", () => {
    const found = regions([
        [0, 0],
        [1, 0],
        [2, 1],
        [2, 2],
    ]);
    assert.equal(found.length, 2);
    assert.deepEqual(found[0], [
        [0, 0],
        [1, 0],
    ]);
});

test("an inset moves every corner into the region, concave ones too", () => {
    const [l] = contours([
        [0, 0],
        [0, 1],
        [1, 1],
    ]);
    assert.deepEqual(insetLoop(l.points, 0.25), [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.75, 1.25],
        [1.75, 1.25],
        [1.75, 1.75],
        [0.25, 1.75],
    ]);
});

const edge = (x: number, y: number, side: PlotEdge["side"], level: 1 | 2 = 2): PlotEdge => ({
    x,
    y,
    side,
    level,
});

test("collinear cover edges merge into runs by level, a tile's south side on the next one's north line", () => {
    const runs = coverRuns([
        edge(0, 0, "s"),
        edge(1, 1, "n"),
        edge(2, 0, "s"),
        edge(4, 0, "s"),
        edge(5, 0, "s", 1),
        edge(3, 3, "e", 1),
        edge(4, 4, "w", 1),
    ]);
    assert.deepEqual(runs, [
        { axis: "h", at: 1, from: 5, to: 6, level: 1 },
        { axis: "v", at: 4, from: 3, to: 5, level: 1 },
        { axis: "h", at: 1, from: 0, to: 3, level: 2 },
        { axis: "h", at: 1, from: 4, to: 5, level: 2 },
    ]);
});

test("a gap in high cover is an opening; one with a low sill is not", () => {
    const runs = coverRuns([
        edge(0, 0, "n"),
        edge(2, 0, "n"),
        edge(4, 2, "w"),
        edge(4, 4, "w"),
        edge(4, 3, "w", 1),
        edge(0, 5, "n"),
        edge(5, 5, "n"),
    ]);
    assert.deepEqual(openings(runs), [{ axis: "h", at: 0, from: 1, to: 2 }]);
});

test("whole-pixel snapping puts odd strokes on pixel centres", () => {
    assert.equal(snap(10, 1), 10.5);
    assert.equal(snap(10, 2), 10);
    assert.equal(snap(9.6, 2), 10);
    assert.equal(
        loopPath(
            [
                [0, 0],
                [1, 0],
                [1, 1],
            ],
            12,
            [3, 4],
            1,
        ),
        "M3.5 4.5L15.5 4.5L15.5 16.5Z",
    );
});

test("a sheet lays out in whole pixels and drops furniture as it shrinks", () => {
    const p = { cols: 21, rows: 22 };
    const wide = sheetLayout(p, { width: 760, height: 640 });
    assert.equal(wide.detail, "full");
    assert.ok(Number.isInteger(wide.cell) && Number.isInteger(wide.x) && Number.isInteger(wide.y));
    assert.ok(wide.y + wide.cell * p.rows <= 640);
    assert.equal(sheetLayout(p, { width: 390, height: 260 }).detail, "ruled");
    assert.equal(sheetLayout(p, { width: 200, height: 120 }).detail, "bare");
});

test("deployment cells cluster by nearness", () => {
    const groups = clusters([
        [10, 20],
        [12, 20],
        [14, 20],
        [2, 2],
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(
        { x0: groups[0].x0, y0: groups[0].y0, x1: groups[0].x1, y1: groups[0].y1 },
        { x0: 10, y0: 20, x1: 15, y1: 21 },
    );
});

test("a void closed in by walls is a building's inside; one open to the ground is not", () => {
    const p = plot({
        walls: [
            [0, 0],
            [1, 0],
            [2, 0],
            [0, 1],
            [2, 1],
            [0, 2],
            [1, 2],
            [2, 2],
        ],
        voids: [
            [1, 1],
            [4, 4],
        ],
    });
    assert.deepEqual(enclosedVoids(p), { inside: [[1, 1]], open: [[4, 4]] });
    // No ground mark touches a wall or a void.
    const marks = groundMarks(p);
    assert.ok(!marks.some(([x, y]) => x <= 3 && y <= 3));
    assert.ok(!marks.some(([x, y]) => (x === 4 || x === 5) && (y === 4 || y === 5)));
    assert.ok(marks.some(([x, y]) => x === 4 && y === 1));
});

test("a label goes to the first spot clear of the drawing and inside the frame", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100 };
    const wall = { x: 0, y: 0, w: 50, h: 50 };
    const spots = [
        { x: 10, y: 10, w: 20, h: 10 },
        { x: 90, y: 60, w: 20, h: 10 },
        { x: 60, y: 60, w: 20, h: 10 },
        { x: 60, y: 80, w: 20, h: 10 },
    ];
    assert.equal(placeLabel(spots, [wall], frame), 2);
});
