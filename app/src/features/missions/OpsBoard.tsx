// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Panel, Tabs, useGlyphSet } from "../../ui";
import { reducedMotion } from "../../ui/motion";
import {
    cellSize,
    columnLabel,
    ruleMarks,
    type Mission,
    type MissionPlot,
    type MissionStage,
    type PlotEdge,
} from "./model";
import { WorldBoard, WorldLegend } from "./WorldBoard";

/** The board's two views: the planet (where) and the site (what ground). */
export type BoardView = "world" | "site";

const VIEWS = [
    { id: "world", label: "World" },
    { id: "site", label: "Site" },
];

type OpsBoardProps = {
    /** The mission the board is locked on; null draws the empty display. */
    mission: Mission | null;
    label?: string;
    /** Above the display: the status strip. */
    strip?: ReactNode;
    /**
     * Every mission on the board, for the World view (a pin per place). With
     * it the board has two views, World and Site, switched by the tabs in its
     * header (the screen's `onTab` steps them); without it, Site alone.
     */
    world?: Mission[];
    view?: BoardView;
    onView?: (view: BoardView) => void;
};

/**
 * The situation display, the console's big board: the locked mission's ground
 * as a tile plot (walls, cover by side, voids, both deployments, the
 * objective) on a ruled grid, or its stages in the same frame when it has no
 * ground to draw. Retargeting runs one lock-on (the reticle closes in, one
 * sweep, 180 ms) that never hides the plot and is held under reduced motion.
 */
export function OpsBoard({
    mission,
    label = "Situation",
    strip,
    world,
    view = "site",
    onView,
}: OpsBoardProps) {
    const [still] = useState(reducedMotion);
    const glyphs = useGlyphSet();
    const onWorld = world !== undefined && view === "world";
    return (
        <Panel
            label={label}
            meta={
                world && (
                    <Tabs
                        tabs={VIEWS}
                        active={view}
                        onSelect={(id) => onView?.(id as BoardView)}
                        glyphs={glyphs}
                    />
                )
            }
            className="gui-ops-board"
        >
            {strip}
            <div
                className="gui-ops-display"
                data-still={still || undefined}
                data-view={world ? view : undefined}
            >
                {world && (
                    <div className="gui-ops-view" hidden={!onWorld}>
                        <WorldBoard missions={world} mission={mission} active={onWorld} />
                    </div>
                )}
                {onWorld ? null : mission?.plot ? (
                    <LayoutPlot key={mission.id} plot={mission.plot} />
                ) : mission?.stages ? (
                    <StagePlot key={mission.id} mission={mission} stages={mission.stages} />
                ) : (
                    <Reticle key={mission?.id ?? "none"}>
                        <span className="gui-ops-void">{mission ? mission.name : ""}</span>
                    </Reticle>
                )}
            </div>
            {onWorld ? <WorldLegend /> : mission?.plot && <Legend plot={mission.plot} />}
        </Panel>
    );
}

/** The four corner brackets and the sweep: the lock-on, played once on mount. */
function Reticle({ children }: { children: ReactNode }) {
    return (
        <div className="gui-ops-reticle">
            <i data-at="tl" />
            <i data-at="tr" />
            <i data-at="bl" />
            <i data-at="br" />
            <b className="gui-ops-sweep" aria-hidden />
            {children}
        </div>
    );
}

/** The element's content box, followed as it resizes. */
function useBox<T extends HTMLElement>() {
    const ref = useRef<T>(null);
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
    return [ref, box] as const;
}

/** Room for the rules: the row numbers on the left, the column letters on top. */
const RULE = 22;
/** The least distance between two printed rule marks. */
const MARK_GAP = 22;

/** The ground as tiles, in whole pixels so every hairline is crisp. */
function LayoutPlot({ plot }: { plot: MissionPlot }) {
    const [ref, box] = useBox<HTMLDivElement>();
    const hatch = useId();
    const cell = cellSize(plot, { width: box.width - RULE, height: box.height - RULE });
    const w = plot.cols * cell;
    const h = plot.rows * cell;
    const step = Math.max(1, Math.ceil(MARK_GAP / cell));
    const at = (n: number) => n * cell;
    const grid: string[] = [];
    for (let x = 1; x < plot.cols; x++) grid.push(`M${at(x) + 0.5} 0V${h}`);
    for (let y = 1; y < plot.rows; y++) grid.push(`M0 ${at(y) + 0.5}H${w}`);
    const inset = Math.max(1, Math.round(cell * 0.22));
    const mark = Math.max(3, Math.round(cell * 0.24));
    return (
        <div ref={ref} className="gui-ops-plot-box">
            {box.width > 0 && (
                <div className="gui-ops-plot" style={{ width: w + RULE, height: h + RULE }}>
                    <Reticle>
                        <svg
                            className="gui-ops-svg"
                            width={w + RULE}
                            height={h + RULE}
                            viewBox={`${-RULE} ${-RULE} ${w + RULE} ${h + RULE}`}
                            role="img"
                            aria-label={`Ground ${plot.cols} by ${plot.rows} tiles`}
                        >
                            <defs>
                                <pattern
                                    id={hatch}
                                    width={6}
                                    height={6}
                                    patternUnits="userSpaceOnUse"
                                    patternTransform="rotate(45)"
                                >
                                    <path d="M0 0V6" className="gui-ops-hatch" />
                                </pattern>
                            </defs>
                            {ruleMarks(plot.cols, step).map((x) => (
                                <text
                                    key={`c${x}`}
                                    className="gui-ops-rule"
                                    x={at(x) + cell / 2}
                                    y={-8}
                                    textAnchor="middle"
                                >
                                    {columnLabel(x)}
                                </text>
                            ))}
                            {ruleMarks(plot.rows, step).map((y) => (
                                <text
                                    key={`r${y}`}
                                    className="gui-ops-rule"
                                    x={-6}
                                    y={at(y) + cell / 2}
                                    textAnchor="end"
                                    dominantBaseline="central"
                                >
                                    {String(y + 1).padStart(2, "0")}
                                </text>
                            ))}
                            <rect className="gui-ops-floor" width={w} height={h} />
                            <path className="gui-ops-grid" d={grid.join("")} />
                            {plot.voids.map(([x, y]) => (
                                <rect
                                    key={`v${x},${y}`}
                                    x={at(x)}
                                    y={at(y)}
                                    width={cell}
                                    height={cell}
                                    fill={`url(#${hatch})`}
                                />
                            ))}
                            {plot.obstacles.map(([x, y]) => (
                                <rect
                                    key={`o${x},${y}`}
                                    className="gui-ops-obstacle"
                                    x={at(x) + inset}
                                    y={at(y) + inset}
                                    width={cell - inset * 2}
                                    height={cell - inset * 2}
                                />
                            ))}
                            {plot.walls.map(([x, y]) => (
                                <rect
                                    key={`w${x},${y}`}
                                    className="gui-ops-wall"
                                    x={at(x)}
                                    y={at(y)}
                                    width={cell}
                                    height={cell}
                                />
                            ))}
                            {plot.edges.map((edge) => (
                                <Edge
                                    key={`${edge.x},${edge.y},${edge.side}`}
                                    edge={edge}
                                    cell={cell}
                                />
                            ))}
                            <rect
                                className="gui-ops-bounds"
                                x={0.5}
                                y={0.5}
                                width={w - 1}
                                height={h - 1}
                            />
                            {plot.squad.map(([x, y]) => (
                                <rect
                                    key={`s${x},${y}`}
                                    className="gui-ops-squad"
                                    x={at(x) + cell / 2 - mark}
                                    y={at(y) + cell / 2 - mark}
                                    width={mark * 2}
                                    height={mark * 2}
                                />
                            ))}
                            {plot.hostiles.map(([x, y]) => (
                                <path
                                    key={`h${x},${y}`}
                                    className="gui-ops-hostile"
                                    d={`M${at(x) + cell / 2} ${at(y) + cell / 2 - mark * 1.3}l${mark * 1.3} ${mark * 1.3}l${-mark * 1.3} ${mark * 1.3}l${-mark * 1.3} ${-mark * 1.3}z`}
                                />
                            ))}
                            {plot.objective && (
                                <Objective
                                    x={at(plot.objective[0]) + cell / 2}
                                    y={at(plot.objective[1]) + cell / 2}
                                    r={Math.max(5, cell * 0.42)}
                                />
                            )}
                        </svg>
                    </Reticle>
                </div>
            )}
        </div>
    );
}

/** A cover edge: a hairline along the tile's side, high cover brighter and heavier. */
function Edge({ edge, cell }: { edge: PlotEdge; cell: number }) {
    const x0 = edge.x * cell;
    const y0 = edge.y * cell;
    const [x1, y1, x2, y2] =
        edge.side === "n"
            ? [x0, y0, x0 + cell, y0]
            : edge.side === "s"
              ? [x0, y0 + cell, x0 + cell, y0 + cell]
              : edge.side === "w"
                ? [x0, y0, x0, y0 + cell]
                : [x0 + cell, y0, x0 + cell, y0 + cell];
    return (
        <line
            className="gui-ops-edge"
            data-level={edge.level === 2 ? "high" : "low"}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
        />
    );
}

/** The objective: a ring with four ticks pointing in. */
function Objective({ x, y, r }: { x: number; y: number; r: number }) {
    const t = r * 0.55;
    return (
        <g className="gui-ops-objective">
            <circle cx={x} cy={y} r={r} />
            <path
                d={`M${x} ${y - r - t}v${t * 1.4}M${x} ${y + r + t}v${-t * 1.4}M${x - r - t} ${y}h${t * 1.4}M${x + r + t} ${y}h${-t * 1.4}`}
            />
        </g>
    );
}

/** The key under the plot: only what this plot has. */
function Legend({ plot }: { plot: MissionPlot }) {
    const high = plot.edges.some((e) => e.level === 2);
    const low = plot.edges.some((e) => e.level === 1);
    const items: [key: string, label: string][] = [
        ...(plot.squad.length ? [["squad", "Squad"] as [string, string]] : []),
        ...(plot.hostiles.length ? [["hostile", "Hostiles"] as [string, string]] : []),
        ...(plot.objective ? [["objective", "Objective"] as [string, string]] : []),
        ...(plot.walls.length ? [["wall", "Wall"] as [string, string]] : []),
        ...(high ? [["high", "High cover"] as [string, string]] : []),
        ...(low ? [["low", "Low cover"] as [string, string]] : []),
        ...(plot.voids.length ? [["void", "Void"] as [string, string]] : []),
    ];
    return (
        <div className="gui-ops-legend">
            {items.map(([key, label]) => (
                <span key={key} className="gui-ops-key">
                    <i data-key={key} aria-hidden />
                    {label}
                </span>
            ))}
        </div>
    );
}

/** A mission without ground to draw: its stages in the display's frame, done or not. */
function StagePlot({ mission, stages }: { mission: Mission; stages: MissionStage[] }) {
    return (
        <div className="gui-ops-stage-box">
            <Reticle>
                <div className="gui-ops-stages">
                    <span className="gui-ops-stages-head">
                        <span>{mission.place ?? mission.name}</span>
                        <span>
                            {stages.filter((s) => s.done).length} / {stages.length}
                        </span>
                    </span>
                    <ol className="gui-ops-stage-list">
                        {stages.map((stage, i) => (
                            <li
                                key={stage.id}
                                className="gui-ops-stage"
                                data-done={stage.done || undefined}
                            >
                                <span className="gui-ops-stage-index">
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="gui-ops-stage-title">{stage.title}</span>
                                <span className="gui-ops-stage-state">
                                    {stage.done ? "Cleared" : "Open"}
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            </Reticle>
        </div>
    );
}
