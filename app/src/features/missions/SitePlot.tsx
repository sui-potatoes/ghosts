// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { columnLabel, type MissionPlot, type PlotCell } from "./model";
import {
    clusters,
    contours,
    coverRuns,
    enclosedVoids,
    groundMarks,
    insetLoop,
    loopPath,
    openings,
    regions,
    rulerLabels,
    labelSize,
    placeLabel,
    sheetLayout,
    snap,
    type Rect,
    type Opening,
    type Pt,
    type Run,
} from "./site";
import "./site.css";

type SitePlotProps = {
    plot: MissionPlot;
    /** The operation's file code for the title block (`NS–11.024`). */
    code?: string;
    className?: string;
};

/**
 * The site plan: a level's ground drawn as an engineer's plate. Structures
 * are traced outlines over a 45° hatch, cover is a line on its edge (bold for
 * high, ticked for low, gaps in high cover marked as openings), voids are a
 * sparse cross-hatch, the ground is a dot at each open tile corner. The
 * squad's deployment is bracketed, hostiles are amber marks, the objective a
 * ringed crosshair with a leader. Rules (A… along the north edge, 01… down
 * the west, the board's reference), a north arrow, a scale bar and a title
 * block come and go with the room. Fills its container, transparent, every
 * line on whole pixels.
 */
export function SitePlot({ plot, code, className }: SitePlotProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const read = () => setBox({ width: el.clientWidth, height: el.clientHeight });
        read();
        const observer = new ResizeObserver(read);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const shape = useMemo(() => siteShape(plot), [plot]);
    const ids = useId().replace(/:/g, "");
    const layout = box.width > 0 && box.height > 0 ? sheetLayout(plot, box) : null;
    return (
        <div ref={ref} className={className ? `gui-site ${className}` : "gui-site"}>
            {layout && (
                <svg
                    className="gui-site-svg"
                    width={box.width}
                    height={box.height}
                    viewBox={`0 0 ${box.width} ${box.height}`}
                    role="img"
                    aria-label={`Site plan, ${plot.cols} by ${plot.rows} tiles`}
                    data-detail={layout.detail}
                >
                    <Sheet
                        plot={plot}
                        shape={shape}
                        layout={layout}
                        box={box}
                        code={code}
                        ids={ids}
                    />
                </svg>
            )}
        </div>
    );
}

/** Everything about a plot that does not depend on its size, traced once. */
function siteShape(plot: MissionPlot) {
    const { inside, open } = enclosedVoids(plot);
    const runs = coverRuns(plot.edges);
    return {
        // A closed building's inside is part of its mass: one hatched block, not a court.
        walls: contours([...plot.walls, ...inside]),
        voids: contours(open),
        obstacles: regions(plot.obstacles).map(contours),
        high: runs.filter((r) => r.level === 2),
        low: runs.filter((r) => r.level === 1),
        openings: openings(runs),
        marks: groundMarks(plot),
        squad: clusters(plot.squad),
        hostiles: clusters(plot.hostiles),
    };
}

type Shape = ReturnType<typeof siteShape>;
type Layout = ReturnType<typeof sheetLayout>;

/** A cell's reference on the board's rules: `J·07`. */
const reference = ([x, y]: PlotCell) => `${columnLabel(x)}·${String(y + 1).padStart(2, "0")}`;

function Sheet({
    plot,
    shape,
    layout,
    box,
    code,
    ids,
}: {
    plot: MissionPlot;
    shape: Shape;
    layout: Layout;
    box: { width: number; height: number };
    code?: string;
    ids: string;
}) {
    const { cell: c, detail } = layout;
    const o: Pt = [layout.x, layout.y];
    const X = (x: number) => o[0] + x * c;
    const Y = (y: number) => o[1] + y * c;
    const w = plot.cols * c;
    const h = plot.rows * c;
    const pitch = c >= 24 ? 5 : c >= 14 ? 4 : 3;
    const hatch = `${ids}-hatch`;
    const cross = `${ids}-cross`;
    // The accent goes to what the player looks at first: the objective, else their deployment.
    const lead = plot.objective ? "objective" : "squad";

    const loops = (list: { points: Pt[] }[], width: number) =>
        list.map((l) => loopPath(l.points, c, o, width)).join("");

    // Ground: a one-pixel dot at each open tile corner.
    const ground = shape.marks.map(([x, y]) => `M${X(x)} ${Y(y) + 0.5}h1`).join("");

    // Obstacles: each prop outlined inside its tiles, a lone box crossed corner to corner.
    const inset = Math.max(2, Math.round(c * 0.2)) / c;
    const obstacleLines: string[] = [];
    const obstacleCross: string[] = [];
    for (const region of shape.obstacles) {
        for (const loop of region) {
            const pts = insetLoop(loop.points, loop.hole ? -inset : inset);
            obstacleLines.push(loopPath(pts, c, o, 1));
            if (region.length === 1 && pts.length === 4 && !loop.hole) {
                const [a, , b] = pts;
                obstacleCross.push(
                    `M${snap(X(a[0]))} ${snap(Y(a[1]))}L${snap(X(b[0]))} ${snap(Y(b[1]))}`,
                );
            }
        }
    }

    const runPath = (r: Run | Opening, width: number) =>
        r.axis === "h"
            ? `M${snap(X(r.from), width)} ${snap(Y(r.at), width)}H${snap(X(r.to), width)}`
            : `M${snap(X(r.at), width)} ${snap(Y(r.from), width)}V${snap(Y(r.to), width)}`;

    // Low cover: a thin line ticked across at each tile's middle, like a fence on a map.
    const tick = Math.max(2, Math.round(c * 0.1));
    const lowTicks = shape.low
        .flatMap((r) => {
            const out: string[] = [];
            for (let i = r.from; i < r.to; i++) {
                const mid = Math.round((i + 0.5) * c);
                out.push(
                    r.axis === "h"
                        ? `M${o[0] + mid + 0.5} ${Y(r.at) - tick}v${tick * 2 + 1}`
                        : `M${X(r.at) - tick} ${o[1] + mid + 0.5}h${tick * 2 + 1}`,
                );
            }
            return out;
        })
        .join("");

    // Openings: the jambs at either side, a dashed threshold across.
    const jamb = Math.max(3, Math.round(c * 0.22));
    const jambs = shape.openings
        .flatMap((g) =>
            [g.from, g.to].map((at) =>
                g.axis === "h"
                    ? `M${X(at) + 0.5} ${Y(g.at) - jamb}v${jamb * 2 + 1}`
                    : `M${X(g.at) - jamb} ${Y(at) + 0.5}h${jamb * 2 + 1}`,
            ),
        )
        .join("");

    const ruled = detail !== "bare";
    const full = detail === "full";
    // Marker labels need tiles big enough to keep them clear of what they name.
    const tags =
        ruled && c >= 14 ? planTags(plot, shape, X, Y, c, { x: o[0], y: o[1], w, h }) : null;
    return (
        <>
            <defs>
                <pattern
                    id={hatch}
                    width={pitch}
                    height={pitch}
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                >
                    <path d={`M0.5 0V${pitch}`} className="gui-site-hatch" />
                </pattern>
                <pattern
                    id={cross}
                    width={pitch * 2}
                    height={pitch * 2}
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                >
                    <path d={`M0.5 0V${pitch * 2}M0 0.5H${pitch * 2}`} className="gui-site-cross" />
                </pattern>
            </defs>

            {ruled && <Rules plot={plot} X={X} Y={Y} o={o} w={w} h={h} c={c} full={full} />}
            {full && <Furniture plot={plot} o={o} w={w} h={h} c={c} box={box} code={code} />}

            <rect
                className="gui-site-frame"
                x={snap(o[0])}
                y={snap(o[1])}
                width={w - 1}
                height={h - 1}
            />
            <path className="gui-site-ground" d={ground} />

            <path className="gui-site-void" d={loops(shape.voids, 1)} fill={`url(#${cross})`} />

            <path className="gui-site-obstacle" d={obstacleLines.join("")} />
            <path className="gui-site-obstacle-cross" d={obstacleCross.join("")} />

            <path className="gui-site-mass" d={loops(shape.walls, 2)} fill={`url(#${hatch})`} />

            <path className="gui-site-low" d={shape.low.map((r) => runPath(r, 1)).join("")} />
            <path className="gui-site-low" d={lowTicks} />
            <path
                className="gui-site-threshold"
                d={shape.openings.map((g) => runPath(g, 1)).join("")}
            />
            <path className="gui-site-jamb" d={jambs} />
            <path className="gui-site-high" d={shape.high.map((r) => runPath(r, 2)).join("")} />

            <Deployment
                plot={plot}
                shape={shape}
                X={X}
                Y={Y}
                c={c}
                lead={lead === "squad"}
                tags={tags}
            />
            {plot.objective && (
                <Objective at={plot.objective} X={X} Y={Y} c={c} tag={tags?.objective} />
            )}
        </>
    );
}

/** The rules: a tick on every tile line along the north and west edges, a reference every five tiles. */
function Rules({
    plot,
    X,
    Y,
    o,
    w,
    h,
    c,
    full,
}: {
    plot: MissionPlot;
    X: (x: number) => number;
    Y: (y: number) => number;
    o: Pt;
    w: number;
    h: number;
    c: number;
    full: boolean;
}) {
    const gap = 3;
    const ticks: string[] = [];
    // A short tick on every tile line; a longer one on the middle of each labelled tile.
    for (let x = 0; x <= plot.cols; x++) {
        ticks.push(`M${snap(X(x))} ${o[1] - gap - 2}V${o[1] - gap}`);
        if (full) ticks.push(`M${snap(X(x))} ${o[1] + h + gap}v2`);
    }
    for (let y = 0; y <= plot.rows; y++) {
        ticks.push(`M${o[0] - gap - 2} ${snap(Y(y))}H${o[0] - gap}`);
        if (full) ticks.push(`M${o[0] + w + gap} ${snap(Y(y))}h2`);
    }
    for (const x of rulerLabels(plot.cols))
        ticks.push(`M${snap(X(x) + c / 2)} ${o[1] - gap - 5}V${o[1] - gap}`);
    for (const y of rulerLabels(plot.rows))
        ticks.push(`M${o[0] - gap - 5} ${snap(Y(y) + c / 2)}H${o[0] - gap}`);
    return (
        <g className="gui-site-rules">
            <path className="gui-site-tick" d={ticks.join("")} />
            {rulerLabels(plot.cols).map((x) => (
                <text
                    key={`c${x}`}
                    className="gui-site-label"
                    x={Math.round(X(x) + c / 2)}
                    y={o[1] - gap - 9}
                    textAnchor="middle"
                >
                    {columnLabel(x)}
                </text>
            ))}
            {rulerLabels(plot.rows).map((y) => (
                <text
                    key={`r${y}`}
                    className="gui-site-label"
                    x={o[0] - gap - 9}
                    y={Math.round(Y(y) + c / 2)}
                    textAnchor="end"
                    dominantBaseline="central"
                >
                    {String(y + 1).padStart(2, "0")}
                </text>
            ))}
        </g>
    );
}

/** A round length for the scale bar: the largest of 1, 2, 5, 10… metres that fits in `room`. */
function scaleLength(tile: number, c: number, room: number): number {
    const steps = [1, 2, 5, 10, 20, 50];
    let best = 1;
    for (const m of steps) if ((m / tile) * c <= room) best = m;
    return best;
}

/** North arrow, scale bar, title block and the sheet's registration marks. */
function Furniture({
    plot,
    o,
    w,
    h,
    c,
    box,
    code,
}: {
    plot: MissionPlot;
    o: Pt;
    w: number;
    h: number;
    c: number;
    box: { width: number; height: number };
    code?: string;
}) {
    const right = o[0] + w;
    const bottom = o[1] + h;
    // North: a needle on the east margin, level with the top rule.
    const nx = right + 20;
    const ny = o[1] + 6;
    // The scale: in metres when the level says how big a tile is, else in tiles.
    const room = Math.min(w * 0.4, 160);
    const metres = plot.tile && plot.tile > 0 ? scaleLength(plot.tile, c, room) : null;
    const length = metres ? Math.round((metres / plot.tile!) * c) : Math.min(5, plot.cols) * c;
    const parts = metres ? (metres % 5 === 0 ? 5 : metres) : Math.min(5, plot.cols);
    const sy = bottom + 18;
    const bar: string[] = [`M${o[0]} ${sy + 0.5}h${length}`];
    for (let i = 0; i <= parts; i++)
        bar.push(
            `M${o[0] + Math.round((length * i) / parts) + 0.5} ${sy - (i % parts ? 1 : 3)}v${i % parts ? 3 : 7}`,
        );
    const filled: string[] = [];
    for (let i = 0; i < parts; i += 2) {
        const a = o[0] + Math.round((length * i) / parts);
        const b = o[0] + Math.round((length * (i + 1)) / parts);
        filled.push(`M${a} ${sy - 1}H${b}v3H${a}Z`);
    }
    const reg = 4;
    const corners: Pt[] = [
        [6 + reg, 6 + reg],
        [box.width - 7 - reg, 6 + reg],
        [6 + reg, box.height - 7 - reg],
        [box.width - 7 - reg, box.height - 7 - reg],
    ];
    return (
        <g className="gui-site-furniture">
            <path
                className="gui-site-reg"
                d={corners
                    .map(
                        ([x, y]) =>
                            `M${x - reg} ${y + 0.5}h${reg * 2 + 1}M${x + 0.5} ${y - reg}v${reg * 2 + 1}`,
                    )
                    .join("")}
            />
            <g className="gui-site-north">
                <path className="gui-site-north-line" d={`M${nx + 0.5} ${ny + 4}v18`} />
                <path className="gui-site-north-head" d={`M${nx + 0.5} ${ny}l-3.5 8h7z`} />
                <text className="gui-site-label" x={nx + 1} y={ny + 32} textAnchor="middle">
                    N
                </text>
            </g>
            <path className="gui-site-scale-fill" d={filled.join("")} />
            <path className="gui-site-tick" d={bar.join("")} />
            <text className="gui-site-label" x={o[0]} y={sy + 13}>
                0
            </text>
            <text className="gui-site-label" x={o[0] + length} y={sy + 13} textAnchor="middle">
                {metres ? `${metres} M` : `${Math.min(5, plot.cols)} TILES`}
            </text>
            <text className="gui-site-label gui-site-title" x={right} y={sy + 3} textAnchor="end">
                {[code ?? "SITE PLAN", `${plot.cols} × ${plot.rows}`].join("  ·  ")}
            </text>
        </g>
    );
}

/** A label placed on the sheet: its box (text runs from the left edge) and where it hangs from. */
type Tag = {
    text: string;
    box: Rect;
    anchor?: { x: number; y: number };
    elbow?: { x: number; y: number };
};

/**
 * Where the markers' labels go: the objective's first, then the squad's, then
 * the hostiles', each in the spot that covers least of the drawing and of
 * the labels already placed.
 */
function planTags(
    plot: MissionPlot,
    shape: Shape,
    X: (x: number) => number,
    Y: (y: number) => number,
    c: number,
    frame: Rect,
) {
    const cellBox = ([x, y]: PlotCell): Rect => ({ x: X(x), y: Y(y), w: c, h: c });
    const blocked: Rect[] = [
        ...plot.walls.map(cellBox),
        ...plot.voids.map(cellBox),
        ...plot.obstacles.map(cellBox),
        ...plot.squad.map(cellBox),
        ...plot.hostiles.map(cellBox),
        ...[...shape.high, ...shape.low].map((r) =>
            r.axis === "h"
                ? { x: X(r.from), y: Y(r.at) - 3, w: (r.to - r.from) * c, h: 6 }
                : { x: X(r.at) - 3, y: Y(r.from), w: 6, h: (r.to - r.from) * c },
        ),
    ];
    if (plot.objective) blocked.push(cellBox(plot.objective));
    const tags: { objective?: Tag; squad?: Tag; hostile?: Tag } = {};
    const take = (text: string, options: Omit<Tag, "text">[]): Tag => {
        const pick =
            options[
                placeLabel(
                    options.map((o) => o.box),
                    blocked,
                    frame,
                )
            ];
        blocked.push(pick.box);
        return { text, ...pick };
    };
    const gap = 6;
    if (plot.objective) {
        const text = `OBJ  ${reference(plot.objective)}`;
        const { w, h } = labelSize(text);
        const cx = X(plot.objective[0]) + c / 2;
        const cy = Y(plot.objective[1]) + c / 2;
        const r = Math.max(4, Math.round(c * 0.38));
        const leg = Math.max(10, Math.round(c * 0.9));
        const d = Math.round(r * 0.7071);
        const run = 12;
        const options = (
            [
                [1, -1],
                [-1, -1],
                [1, 1],
                [-1, 1],
            ] as const
        ).map(([sx, sy]) => {
            const elbow = {
                x: Math.round(cx + sx * (d + leg)),
                y: Math.round(cy + sy * (d + leg)),
            };
            const end = elbow.x + sx * run;
            return {
                anchor: { x: Math.round(cx + sx * d), y: Math.round(cy + sy * d) },
                elbow,
                box: { x: sx > 0 ? end + 4 : end - 4 - w, y: elbow.y - h / 2, w, h },
            };
        });
        tags.objective = take(text, options);
        // The leader itself is drawn too.
        const t = tags.objective;
        blocked.push({
            x: Math.min(t.anchor!.x, t.elbow!.x) - 1,
            y: Math.min(t.anchor!.y, t.elbow!.y) - 1,
            w: Math.abs(t.elbow!.x - t.anchor!.x) + 14,
            h: Math.abs(t.elbow!.y - t.anchor!.y) + 2,
        });
    }
    const around = (
        z: { x0: number; y0: number; x1: number; y1: number },
        text: string,
        pad: number,
    ) => {
        const { w, h } = labelSize(text);
        const [x0, y0, x1, y1] = [X(z.x0) - pad, Y(z.y0) - pad, X(z.x1) + pad, Y(z.y1) + pad];
        const my = Math.round((y0 + y1) / 2 - h / 2);
        return [
            { box: { x: x0, y: y0 - gap - h, w, h } },
            { box: { x: x1 + gap + 2, y: my, w, h } },
            { box: { x: x0 - gap - 2 - w, y: my, w, h } },
            { box: { x: x0, y: y1 + gap, w, h } },
            { box: { x: x1 - w, y: y0 - gap - h, w, h } },
            { box: { x: x1 - w, y: y1 + gap, w, h } },
        ];
    };
    const count = (n: number) => String(n).padStart(2, "0");
    const zone = shape.squad[0];
    if (zone) {
        const all = shape.squad.reduce<{ x0: number; y0: number; x1: number; y1: number }>(
            (a, z) => ({
                x0: Math.min(a.x0, z.x0),
                y0: Math.min(a.y0, z.y0),
                x1: Math.max(a.x1, z.x1),
                y1: Math.max(a.y1, z.y1),
            }),
            zone,
        );
        const text = `SQUAD ${count(plot.squad.length)}`;
        tags.squad = take(text, around(all, text, zonePad(c)));
    }
    const biggest = [...shape.hostiles].sort((a, b) => b.cells.length - a.cells.length)[0];
    if (biggest) {
        const text = `HOSTILE ${count(plot.hostiles.length)}`;
        tags.hostile = take(text, around(biggest, text, 2));
    }
    return tags;
}

const zonePad = (c: number) => Math.max(2, Math.round(c * 0.22));

/** A label's text at its box. */
function TagText({ tag }: { tag: Tag }) {
    return (
        <text
            className="gui-site-label gui-site-tag"
            x={Math.round(tag.box.x)}
            y={Math.round(tag.box.y + tag.box.h / 2)}
            dominantBaseline="central"
        >
            {tag.text}
        </text>
    );
}

/** Both sides' deployment: the squad's cells bracketed as one zone, hostiles as amber marks. */
function Deployment({
    plot,
    shape,
    X,
    Y,
    c,
    lead,
    tags,
}: {
    plot: MissionPlot;
    shape: Shape;
    X: (x: number) => number;
    Y: (y: number) => number;
    c: number;
    lead: boolean;
    tags: { squad?: Tag; hostile?: Tag } | null;
}) {
    const pad = zonePad(c);
    const arm = Math.max(4, Math.round(c * 0.45));
    const r = Math.max(2, Math.round(c * 0.17));
    const brackets: string[] = [];
    for (const z of shape.squad) {
        const [x0, y0] = [X(z.x0) - pad, Y(z.y0) - pad];
        const [x1, y1] = [X(z.x1) + pad - 1, Y(z.y1) + pad - 1];
        brackets.push(
            `M${x0 + 0.5} ${y0 + arm}V${y0 + 0.5}H${x0 + arm}`,
            `M${x1 - arm + 1} ${y0 + 0.5}H${x1 + 0.5}V${y0 + arm}`,
            `M${x0 + 0.5} ${y1 - arm + 1}V${y1 + 0.5}H${x0 + arm}`,
            `M${x1 - arm + 1} ${y1 + 0.5}H${x1 + 0.5}V${y1 - arm + 1}`,
        );
    }
    const centre = ([x, y]: PlotCell) => [Math.round(X(x) + c / 2), Math.round(Y(y) + c / 2)];
    const units = plot.squad
        .map((cell) => {
            const [cx, cy] = centre(cell);
            return `M${cx - r} ${cy + 0.5}a${r + 0.5} ${r + 0.5} 0 1 0 ${2 * r + 1} 0a${r + 0.5} ${r + 0.5} 0 1 0 ${-2 * r - 1} 0`;
        })
        .join("");
    const dots = plot.squad
        .map((cell) => {
            const [cx, cy] = centre(cell);
            return `M${cx - 1} ${cy - 1}h3v3h-3z`;
        })
        .join("");
    const k = Math.max(2, Math.round(c * 0.16));
    const hostile = plot.hostiles
        .map((cell) => {
            const [cx, cy] = centre(cell).map((v) => v + 0.5);
            return `M${cx - k} ${cy - k}L${cx + k} ${cy + k}M${cx - k} ${cy + k}L${cx + k} ${cy - k}`;
        })
        .join("");
    return (
        <g>
            <g className="gui-site-squad" data-lead={lead || undefined}>
                <path className="gui-site-zone" d={brackets.join("")} />
                <path className="gui-site-unit" d={units} />
                <path className="gui-site-unit-dot" d={dots} />
                {tags?.squad && <TagText tag={tags.squad} />}
            </g>
            <g className="gui-site-hostile">
                <path d={hostile} />
                {tags?.hostile && <TagText tag={tags.hostile} />}
            </g>
        </g>
    );
}

/** The objective: a ring with crosshair ticks, a leader out to its reference. */
function Objective({
    at,
    X,
    Y,
    c,
    tag,
}: {
    at: PlotCell;
    X: (x: number) => number;
    Y: (y: number) => number;
    c: number;
    tag?: Tag;
}) {
    const cx = Math.round(X(at[0]) + c / 2) + 0.5;
    const cy = Math.round(Y(at[1]) + c / 2) + 0.5;
    const r = Math.max(4, Math.round(c * 0.38));
    const t = Math.max(3, Math.round(c * 0.22));
    return (
        <g className="gui-site-objective">
            <circle cx={cx} cy={cy} r={r} />
            <path
                d={`M${cx} ${cy - r - t}v${t * 2}M${cx} ${cy + r + t}v${-t * 2}M${cx - r - t} ${cy}h${t * 2}M${cx + r + t} ${cy}h${-t * 2}`}
            />
            {tag?.anchor && tag.elbow && (
                <>
                    <path
                        className="gui-site-leader"
                        d={`M${tag.anchor.x + 0.5} ${tag.anchor.y + 0.5}L${tag.elbow.x + 0.5} ${tag.elbow.y + 0.5}H${tag.box.x > tag.elbow.x ? tag.box.x - 4 : tag.box.x + tag.box.w + 4}`}
                    />
                    <TagText tag={tag} />
                </>
            )}
        </g>
    );
}

/** The key to the site plan: only what this plot has, drawn with the plan's own marks. */
export function SiteLegend({ plot, className }: { plot: MissionPlot; className?: string }) {
    const ids = useId().replace(/:/g, "");
    const high = plot.edges.some((e) => e.level === 2);
    const low = plot.edges.some((e) => e.level === 1);
    const lead = plot.objective ? "objective" : "squad";
    const items: [key: string, label: string, mark: ReactNode][] = [];
    if (plot.squad.length)
        items.push([
            "squad",
            "Squad",
            <g className="gui-site-squad" data-lead={lead === "squad" || undefined}>
                <path
                    className="gui-site-zone"
                    d="M0.5 4V0.5H4M12 0.5H15.5V4M0.5 7V10.5H4M12 10.5H15.5V7"
                />
                <circle className="gui-site-unit" cx={8} cy={5.5} r={2.5} />
            </g>,
        ]);
    if (plot.hostiles.length)
        items.push([
            "hostile",
            "Hostiles",
            <g className="gui-site-hostile">
                <path d="M5.5 2.5l5 5M5.5 7.5l5 -5" />
            </g>,
        ]);
    if (plot.objective)
        items.push([
            "objective",
            "Objective",
            <g className="gui-site-objective">
                <circle cx={8} cy={5.5} r={3.5} />
                <path d="M8 0v3M8 8v3M2.5 5.5h3M10.5 5.5h3" />
            </g>,
        ]);
    if (plot.walls.length)
        items.push([
            "wall",
            "Structure",
            <path className="gui-site-mass" d="M2 1H14V10H2Z" fill={`url(#${ids}-h)`} />,
        ]);
    if (high) items.push(["high", "High cover", <path className="gui-site-high" d="M1 5H15" />]);
    if (low)
        items.push([
            "low",
            "Low cover",
            <path className="gui-site-low" d="M1 5.5H15M4.5 3v5M8.5 3v5M12.5 3v5" />,
        ]);
    if (plot.obstacles.length)
        items.push([
            "obstacle",
            "Obstacle",
            <path
                className="gui-site-obstacle gui-site-obstacle-legend"
                d="M4.5 1.5H11.5V8.5H4.5ZM4.5 1.5L11.5 8.5"
            />,
        ]);
    if (plot.voids.length)
        items.push([
            "void",
            "Impassable",
            <path className="gui-site-void" d="M2.5 1.5H13.5V9.5H2.5Z" fill={`url(#${ids}-x)`} />,
        ]);
    return (
        <div className={className ? `gui-site-legend ${className}` : "gui-site-legend"}>
            <svg width={0} height={0} className="gui-site-defs" aria-hidden>
                <defs>
                    <pattern
                        id={`${ids}-h`}
                        width={3}
                        height={3}
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(45)"
                    >
                        <path d="M0.5 0V3" className="gui-site-hatch" />
                    </pattern>
                    <pattern
                        id={`${ids}-x`}
                        width={5}
                        height={5}
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(45)"
                    >
                        <path d="M0.5 0V5M0 0.5H5" className="gui-site-cross" />
                    </pattern>
                </defs>
            </svg>
            {items.map(([key, label, mark]) => (
                <span key={key} className="gui-site-key">
                    <svg width={16} height={11} viewBox="0 0 16 11" aria-hidden>
                        {mark}
                    </svg>
                    {label}
                </span>
            ))}
        </div>
    );
}
