// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useRef, type ReactNode } from "react";

import { uiTick } from "../../audio";
import { FocusCursor } from "./focus";
import { Glyph, type GlyphSet } from "./glyphs";

type ScreenFrameProps = {
    /** Breadcrumb, outermost first: `["HQ", "Armory"]`. The last is where you are. */
    location: string[];
    /** Clicking the breadcrumb goes up one level (the mouse's Back). */
    onLocation?: () => void;
    /** The section strip (`<Tabs>`), centred in the header. */
    tabs?: ReactNode;
    /** Status chips, right-aligned in fixed order: match, saving, balance. */
    status?: ReactNode;
    /** The stencil serial under the breadcrumb: the frame's one diegetic detail. */
    serial?: string;
    /** Body grid columns, e.g. `"340px 1fr 280px"`. */
    columns?: string;
    /** The command strip pinned to the bottom edge. */
    commands: ReactNode;
    /** A prompt over the body; the header dims, the command bar stays live. */
    overlay?: ReactNode;
    children: ReactNode;
};

/**
 * The one frame every screen uses: a header strip with fixed slots (where
 * you are, the sections, the status chips), the viewport-filling body grid,
 * the command bar on the bottom edge, and the focus cursor drawn over all
 * of it. Nothing scrolls; a screen's content is composed to fit.
 */
export function ScreenFrame({
    location,
    onLocation,
    tabs,
    status,
    serial,
    columns,
    commands,
    overlay,
    children,
}: ScreenFrameProps) {
    const root = useRef<HTMLElement | null>(null);
    const here = location[location.length - 1];
    const trail = location.slice(0, -1);
    return (
        <main ref={root} className="uis-root ui-zoom" data-overlay={overlay ? "" : undefined}>
            <i className="uis-corner" data-at="tl" aria-hidden />
            <i className="uis-corner" data-at="tr" aria-hidden />
            <i className="uis-corner" data-at="bl" aria-hidden />
            <i className="uis-corner" data-at="br" aria-hidden />
            <header className="uis-header">
                <div className="uis-where">
                    <button
                        type="button"
                        tabIndex={-1}
                        className="uis-crumbs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={onLocation}
                        disabled={!onLocation}
                    >
                        {trail.map((step) => (
                            <span key={step} className="uis-crumb">
                                {step}
                                <span className="uis-crumb-sep">/</span>
                            </span>
                        ))}
                        <span className="uis-crumb" data-here>
                            {here}
                        </span>
                    </button>
                    {serial && <span className="uis-serial">{serial}</span>}
                </div>
                <div className="uis-sections">{tabs}</div>
                <div className="uis-status">{status}</div>
            </header>
            <div
                className="uis-body"
                style={columns ? { gridTemplateColumns: columns } : undefined}
            >
                {children}
            </div>
            {overlay}
            {commands}
            <FocusCursor root={root} />
        </main>
    );
}

type StatusChipProps = {
    /** The stencil caption: `CREDIT`, `MATCH`. */
    label: string;
    value: ReactNode;
    /** `live` pulses (searching), `busy` runs the transfer ticks (saving), `idle` dims. */
    state?: "idle" | "live" | "busy";
    tone?: "default" | "warn";
};

/** One status readout in the header's right slot. */
export function StatusChip({ label, value, state, tone = "default" }: StatusChipProps) {
    return (
        <div className="uis-chip" data-state={state} data-tone={tone}>
            {state === "live" && <i className="uis-chip-dot" aria-hidden />}
            {state === "busy" && (
                <i className="uis-chip-ticks" aria-hidden>
                    <b />
                    <b />
                    <b />
                </i>
            )}
            <span className="uis-chip-label">{label}</span>
            <span className="uis-chip-value">{value}</span>
        </div>
    );
}

export type TabDef = { id: string; label: string; count?: number };

type TabsProps = {
    tabs: TabDef[];
    active: string;
    onSelect: (id: string) => void;
    glyphs: GlyphSet;
};

/**
 * The section strip: the one tab style. The bumpers (Q / E) flank it and
 * step through; the cursor never travels up into it, so Up at the top of a
 * list stays in the list. The mouse clicks a tab directly.
 */
export function Tabs({ tabs, active, onSelect, glyphs }: TabsProps) {
    return (
        <nav className="uis-tabs" aria-label="Sections">
            <Glyph action="prev-tab" set={glyphs} />
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    tabIndex={-1}
                    className="uis-tab"
                    data-active={tab.id === active || undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        if (tab.id === active) return;
                        uiTick(e.currentTarget);
                        onSelect(tab.id);
                    }}
                >
                    {tab.label}
                    {tab.count !== undefined && <span className="uis-tab-count">{tab.count}</span>}
                </button>
            ))}
            <Glyph action="next-tab" set={glyphs} />
        </nav>
    );
}
