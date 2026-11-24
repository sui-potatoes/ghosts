// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The site plan's pure geometry (tested in `tests/missions-site.test.ts`):
 * tile regions traced into outlines, cover edges merged into runs, the
 * openings between them, deployment clusters and the sheet's layout in whole
 * pixels. Everything is in tile units (vertices on tile corners) until
 * `SitePlot` scales it by the cell size, which is a whole number of pixels,
 * so every vertex lands on a pixel.
 */

import type { MissionPlot, PlotCell, PlotEdge } from "./model";

/** A point in tile units: `[x, y]`, y growing south. */
export type Pt = readonly [x: number, y: number];

/** A closed outline: clockwise (on screen) round a region, counter-clockwise round a hole in one. */
export type Loop = { points: Pt[]; hole: boolean };

const key = (x: number, y: number) => `${x},${y}`;

/** The 4-connected regions of a set of cells, each in reading order. */
export function regions(cells: readonly PlotCell[]): PlotCell[][] {
    const left = new Map(cells.map((c) => [key(c[0], c[1]), c] as const));
    const out: PlotCell[][] = [];
    for (const start of cells) {
        if (!left.has(key(start[0], start[1]))) continue;
        left.delete(key(start[0], start[1]));
        const region: PlotCell[] = [];
        const queue: PlotCell[] = [start];
        while (queue.length) {
            const [x, y] = queue.pop()!;
            region.push([x, y]);
            for (const [dx, dy] of NEIGHBOURS) {
                const k = key(x + dx, y + dy);
                const next = left.get(k);
                if (next) {
                    left.delete(k);
                    queue.push(next);
                }
            }
        }
        region.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        out.push(region);
    }
    return out;
}

const NEIGHBOURS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
] as const;

/** Twice the signed area of a loop; positive for clockwise on screen (y down). */
export function signedArea(points: readonly Pt[]): number {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        sum += x1 * y2 - x2 * y1;
    }
    return sum;
}

/**
 * The outlines of a set of cells: every boundary traced once as a closed loop
 * with only its corners kept. A region gives one clockwise loop, each hole in
 * it one counter-clockwise loop, so a nonzero fill leaves the holes empty.
 * Cells touching only at a corner stay separate outlines.
 */
export function contours(cells: readonly PlotCell[]): Loop[] {
    const set = new Set(cells.map(([x, y]) => key(x, y)));
    // Every exposed side as a directed edge, the region on its right (clockwise round each cell).
    const from = new Map<string, Pt[]>();
    const add = (a: Pt, b: Pt) => {
        const k = key(a[0], a[1]);
        const list = from.get(k);
        if (list) list.push(b);
        else from.set(k, [b]);
    };
    for (const [x, y] of cells) {
        if (!set.has(key(x, y - 1))) add([x, y], [x + 1, y]);
        if (!set.has(key(x + 1, y))) add([x + 1, y], [x + 1, y + 1]);
        if (!set.has(key(x, y + 1))) add([x + 1, y + 1], [x, y + 1]);
        if (!set.has(key(x - 1, y))) add([x, y + 1], [x, y]);
    }
    const loops: Loop[] = [];
    const take = (at: Pt, dir: Pt | null): Pt | undefined => {
        const list = from.get(key(at[0], at[1]));
        if (!list?.length) return undefined;
        let pick = 0;
        if (dir && list.length > 1) {
            // At a pinch (two cells meeting at a corner) turn right: keep to the cell just traced.
            const rank = (b: Pt) => {
                const d: Pt = [b[0] - at[0], b[1] - at[1]];
                const cross = dir[0] * d[1] - dir[1] * d[0];
                return cross > 0 ? 0 : cross === 0 ? 1 : 2;
            };
            pick = list.reduce((best, b, i) => (rank(b) < rank(list[best]) ? i : best), 0);
        }
        const [next] = list.splice(pick, 1);
        if (!list.length) from.delete(key(at[0], at[1]));
        return next;
    };
    // Start each loop at its top-left-most free corner so the output is stable.
    const starts = () =>
        [...from.keys()]
            .map((k) => k.split(",").map(Number) as unknown as Pt)
            .sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
    while (from.size) {
        const start = starts();
        const raw: Pt[] = [start];
        let at = start;
        let dir: Pt | null = null;
        for (;;) {
            const next = take(at, dir);
            if (!next) break;
            dir = [next[0] - at[0], next[1] - at[1]];
            at = next;
            if (at[0] === start[0] && at[1] === start[1]) break;
            raw.push(at);
        }
        const points = corners(raw);
        if (points.length >= 4) loops.push({ points, hole: signedArea(points) < 0 });
    }
    return loops;
}

/** A closed loop without its collinear points. */
function corners(points: readonly Pt[]): Pt[] {
    const n = points.length;
    return points.filter((p, i) => {
        const a = points[(i - 1 + n) % n];
        const b = points[(i + 1) % n];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
    });
}

/**
 * A rectilinear loop moved `d` toward the region it bounds (a hole's loop
 * moves into the solid around it), each corner along both of its sides'
 * inward normals. With `d` under half the thinnest part it keeps its shape.
 */
export function insetLoop(points: readonly Pt[], d: number): Pt[] {
    const n = points.length;
    return points.map((p, i) => {
        const a = points[(i - 1 + n) % n];
        const b = points[(i + 1) % n];
        // The region lies right of travel: the inward normal of (dx, dy) is (-dy, dx).
        const [ax, ay] = [Math.sign(p[0] - a[0]), Math.sign(p[1] - a[1])];
        const [bx, by] = [Math.sign(b[0] - p[0]), Math.sign(b[1] - p[1])];
        return [p[0] - (ay + by) * d, p[1] + (ax + bx) * d] as Pt;
    });
}

/** A straight run of cover along one grid line: horizontal at `y = at`, or vertical at `x = at`. */
export type Run = { axis: "h" | "v"; at: number; from: number; to: number; level: 1 | 2 };

/** A cover edge as a unit segment on a grid line. */
function segmentOf(edge: PlotEdge): Omit<Run, "to"> {
    const { x, y, side, level } = edge;
    if (side === "n") return { axis: "h", at: y, from: x, level };
    if (side === "s") return { axis: "h", at: y + 1, from: x, level };
    if (side === "w") return { axis: "v", at: x, from: y, level };
    return { axis: "v", at: x + 1, from: y, level };
}

/** Cover edges merged into the longest straight runs of one level, in a stable order. */
export function coverRuns(edges: readonly PlotEdge[]): Run[] {
    const lines = new Map<string, number[]>();
    for (const edge of edges) {
        const s = segmentOf(edge);
        const k = `${s.level}:${s.axis}:${s.at}`;
        const list = lines.get(k);
        if (list) list.push(s.from);
        else lines.set(k, [s.from]);
    }
    const runs: Run[] = [];
    for (const [k, starts] of lines) {
        const [level, axis, at] = k.split(":");
        const sorted = [...new Set(starts)].sort((a, b) => a - b);
        let from = sorted[0];
        let to = from + 1;
        const flush = () =>
            runs.push({
                axis: axis as Run["axis"],
                at: Number(at),
                from,
                to,
                level: Number(level) as 1 | 2,
            });
        for (const s of sorted.slice(1)) {
            if (s === to) to = s + 1;
            else {
                flush();
                from = s;
                to = s + 1;
            }
        }
        flush();
    }
    return runs.sort(
        (a, b) =>
            a.level - b.level || a.axis.localeCompare(b.axis) || a.at - b.at || a.from - b.from,
    );
}

/** A gap in a line of high cover: a doorway, a way through a fence. */
export type Opening = { axis: "h" | "v"; at: number; from: number; to: number };

/**
 * The openings in high cover: a gap of at most `widest` tiles on one grid
 * line between two high runs, with no cover of its own (a low sill is not an
 * opening).
 */
export function openings(runs: readonly Run[], widest = 2): Opening[] {
    const covered = (axis: string, at: number, from: number, to: number) =>
        runs.some((r) => r.axis === axis && r.at === at && r.from < to && r.to > from);
    const high = runs.filter((r) => r.level === 2);
    const out: Opening[] = [];
    for (const a of high) {
        const next = high
            .filter((b) => b.axis === a.axis && b.at === a.at && b.from > a.to)
            .sort((x, y) => x.from - y.from)[0];
        if (!next || next.from - a.to > widest) continue;
        if (covered(a.axis, a.at, a.to, next.from)) continue;
        out.push({ axis: a.axis, at: a.at, from: a.to, to: next.from });
    }
    return out;
}

/** Cells grouped by nearness: within `reach` tiles of another (Chebyshev), with their bounds. */
export function clusters(
    cells: readonly PlotCell[],
    reach = 2,
): { cells: PlotCell[]; x0: number; y0: number; x1: number; y1: number }[] {
    const groups: PlotCell[][] = [];
    const seen = new Set<number>();
    cells.forEach((_, i) => {
        if (seen.has(i)) return;
        seen.add(i);
        const group: PlotCell[] = [];
        const queue = [i];
        while (queue.length) {
            const j = queue.pop()!;
            group.push(cells[j]);
            cells.forEach((c, k) => {
                if (seen.has(k)) return;
                const [x, y] = cells[j];
                if (Math.max(Math.abs(c[0] - x), Math.abs(c[1] - y)) <= reach) {
                    seen.add(k);
                    queue.push(k);
                }
            });
        }
        groups.push(group);
    });
    return groups.map((g) => ({
        cells: g,
        x0: Math.min(...g.map((c) => c[0])),
        y0: Math.min(...g.map((c) => c[1])),
        x1: Math.max(...g.map((c) => c[0])) + 1,
        y1: Math.max(...g.map((c) => c[1])) + 1,
    }));
}

/**
 * The tile corners the ground's marks sit on: inner corners whose four cells
 * are all open ground (no wall, no void), so the marks stay off structures.
 */
export function groundMarks(plot: MissionPlot): Pt[] {
    const solid = new Set([...plot.walls, ...plot.voids].map(([x, y]) => key(x, y)));
    const out: Pt[] = [];
    for (let y = 1; y < plot.rows; y++)
        for (let x = 1; x < plot.cols; x++) {
            if (
                solid.has(key(x - 1, y - 1)) ||
                solid.has(key(x, y - 1)) ||
                solid.has(key(x - 1, y)) ||
                solid.has(key(x, y))
            )
                continue;
            out.push([x, y]);
        }
    return out;
}

/** The void cells wholly closed in by walls (a building's inside), apart from the open ones. */
export function enclosedVoids(plot: MissionPlot): { inside: PlotCell[]; open: PlotCell[] } {
    const walls = new Set(plot.walls.map(([x, y]) => key(x, y)));
    const inside: PlotCell[] = [];
    const open: PlotCell[] = [];
    for (const region of regions(plot.voids)) {
        const own = new Set(region.map(([x, y]) => key(x, y)));
        const closed = region.every(([x, y]) =>
            NEIGHBOURS.every(([dx, dy]) => {
                const [nx, ny] = [x + dx, y + dy];
                if (nx < 0 || ny < 0 || nx >= plot.cols || ny >= plot.rows) return false;
                return own.has(key(nx, ny)) || walls.has(key(nx, ny));
            }),
        );
        (closed ? inside : open).push(...region);
    }
    return { inside, open };
}

/** A coordinate in whole pixels for a stroke `width` wide: odd widths sit on the pixel's centre. */
export const snap = (px: number, width = 1) => Math.round(px) + (Math.round(width) % 2 ? 0.5 : 0);

/** A loop as SVG path data, scaled by `cell` from `origin` and snapped for a stroke `width` wide. */
export function loopPath(points: readonly Pt[], cell: number, origin: Pt, width = 1): string {
    return (
        points
            .map(
                ([x, y], i) =>
                    `${i ? "L" : "M"}${snap(origin[0] + x * cell, width)} ${snap(origin[1] + y * cell, width)}`,
            )
            .join("") + "Z"
    );
}

/** What the sheet carries at a size: the plot alone, the rules with it, or every piece of furniture. */
export type SheetDetail = "bare" | "ruled" | "full";

export type SheetLayout = {
    /** One tile in whole pixels. */
    cell: number;
    /** The plot's north-west corner in whole pixels. */
    x: number;
    y: number;
    detail: SheetDetail;
};

/** Room round the plot for each level of detail: top, right, bottom, left. */
const MARGINS: Record<SheetDetail, readonly [number, number, number, number]> = {
    bare: [6, 6, 6, 6],
    ruled: [20, 10, 10, 26],
    full: [24, 34, 34, 30],
};

/**
 * The plot laid out in a box: the richest detail whose margins still leave
 * tiles big enough to read (16 px for the full sheet, 9 for the rules), the
 * plot centred in what the margins leave, all in whole pixels.
 */
export function sheetLayout(
    plot: Pick<MissionPlot, "cols" | "rows">,
    box: { width: number; height: number },
): SheetLayout {
    const fit = (detail: SheetDetail) => {
        const [t, r, b, l] = MARGINS[detail];
        const cell = Math.max(
            2,
            Math.floor(
                Math.min(
                    (box.width - l - r) / Math.max(1, plot.cols),
                    (box.height - t - b) / Math.max(1, plot.rows),
                ),
            ),
        );
        const w = cell * plot.cols;
        const h = cell * plot.rows;
        return {
            cell,
            x: Math.round(l + (box.width - l - r - w) / 2),
            y: Math.round(t + (box.height - t - b - h) / 2),
            detail,
        };
    };
    const full = fit("full");
    if (full.cell >= 16 && box.width >= 420 && box.height >= 300) return full;
    const ruled = fit("ruled");
    if (ruled.cell >= 9) return ruled;
    return fit("bare");
}

/** A box in pixels. */
export type Rect = { x: number; y: number; w: number; h: number };

const overlap = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The first of the candidate boxes that covers the least of what is already
 * drawn (`blocked`) and stays inside `within`; earlier candidates win ties,
 * so they are listed in order of preference.
 */
export function placeLabel(
    candidates: readonly Rect[],
    blocked: readonly Rect[],
    within: Rect,
): number {
    let best = 0;
    let bestScore = Infinity;
    candidates.forEach((c, i) => {
        const area = c.w * c.h;
        const outside = area - overlap(c, within);
        const score = blocked.reduce((s, b) => s + overlap(c, b), 0) + outside * 4;
        if (score < bestScore - 0.5) {
            best = i;
            bestScore = score;
        }
    });
    return best;
}

/** A mono label's box: `chars` wide at the plan's 10 px type and letter-spacing. */
export const labelSize = (text: string, size = 10): { w: number; h: number } => ({
    w: Math.ceil(text.length * size * 0.82),
    h: size,
});

/** The ruler marks on an axis of `count` tiles: a tick on every tile line, a label every `every` tiles. */
export function rulerLabels(count: number, every = 5): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i += every) out.push(i);
    return out;
}
