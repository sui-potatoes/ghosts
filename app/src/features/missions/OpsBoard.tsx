// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useState, type ReactNode } from "react";

import { Panel, Tabs, useGlyphSet } from "../../ui";
import { reducedMotion } from "../../ui/motion";
import type { Mission, MissionStage } from "./model";
import { SiteLegend, SitePlot } from "./SitePlot";
import { WorldBoard, WorldLegend } from "./WorldBoard";
import { WORLD_ZOOM } from "./world";

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
    /** The World view's zoom step and its change. */
    zoom?: number;
    onZoom?: (zoom: number) => void;
};

/**
 * The situation display, the console's big board, in two views that
 * crossfade: World (`WorldBoard`: the planet, gliding to the shown mission's
 * city) and Site (the mission's ground as a site plan, `SitePlot`, or its
 * stages when it has no ground). A mission with no place on the planet (a
 * simulation) shows its own board in either view.
 */
export function OpsBoard({
    mission,
    label = "Situation",
    strip,
    world,
    view = "site",
    onView,
    zoom = WORLD_ZOOM,
    onZoom = () => undefined,
}: OpsBoardProps) {
    const [still] = useState(reducedMotion);
    const glyphs = useGlyphSet();
    // A mission with no place on the planet (a simulation) keeps its own board in either view.
    const placed = !mission || mission.position !== undefined;
    const onWorld = world !== undefined && view === "world" && placed;
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
                data-view={world ? (onWorld ? "world" : "site") : undefined}
            >
                {world && (
                    // The map stays mounted under the site layer: switching crossfades, and
                    // the map resumes from where it was.
                    <div className="gui-ops-view" data-on={onWorld || undefined}>
                        <WorldBoard
                            missions={world}
                            mission={mission}
                            active={onWorld}
                            zoom={zoom}
                            onZoom={onZoom}
                        />
                    </div>
                )}
                <div className="gui-ops-site" data-on={!onWorld || undefined}>
                    {/* The site drawing's one seam: the plot, else the stages, else the name. */}
                    {mission?.plot ? (
                        <div className="gui-ops-plot-box">
                            <Reticle key={mission.id}>
                                <SitePlot plot={mission.plot} code={mission.code} />
                            </Reticle>
                        </div>
                    ) : mission?.stages ? (
                        <StagePlot key={mission.id} mission={mission} stages={mission.stages} />
                    ) : (
                        <Reticle key={mission?.id ?? "none"}>
                            <span className="gui-ops-void">{mission ? mission.name : ""}</span>
                        </Reticle>
                    )}
                </div>
            </div>
            {onWorld ? (
                <WorldLegend zoom={zoom} onZoom={onZoom} />
            ) : (
                mission?.plot && <SiteLegend plot={mission.plot} className="gui-ops-legend" />
            )}
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
