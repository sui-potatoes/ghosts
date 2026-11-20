// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, type ReactNode } from "react";

import { uiTick } from "../audio";
import { FocusCursor, headerClick, useFocusStore } from "./focus";
import { ContextMenu } from "./pointer";
import { Glyph, type GlyphSet } from "./glyphs";

type ScreenFrameProps = {
    /** Breadcrumb, outermost first: `["HQ", "Armory"]`. The last is where you are. */
    location: string[];
    /** Clicking the breadcrumb goes up one level (the mouse's Back). */
    onLocation?: () => void;
    /**
     * Sibling sections at the last breadcrumb step (HQ / SQUAD · ARMORY): the
     * triggers (LT / RT, PageUp / PageDown) step through them, a click picks one.
     */
    siblings?: SiblingProps;
    /** The section strip (`<Tabs>`), centred in the header. */
    tabs?: ReactNode;
    /** Status chips, right-aligned in fixed order: match, saving, balance. */
    status?: ReactNode;
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
    siblings,
    tabs,
    status,
    columns,
    commands,
    overlay,
    children,
}: ScreenFrameProps) {
    const root = useRef<HTMLElement | null>(null);
    const store = useFocusStore();
    const here = location[location.length - 1];
    const trail = location.slice(0, -1);
    return (
        <main ref={root} className="gui ui-zoom" data-overlay={overlay ? "" : undefined}>
            <i className="gui-corner" data-at="tl" aria-hidden />
            <i className="gui-corner" data-at="tr" aria-hidden />
            <i className="gui-corner" data-at="bl" aria-hidden />
            <i className="gui-corner" data-at="br" aria-hidden />
            <header className="gui-header">
                <div className="gui-where">
                    <div className="gui-crumbs">
                        <button
                            type="button"
                            tabIndex={-1}
                            className="gui-crumb-up"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onLocation && headerClick(store) && onLocation()}
                            disabled={!onLocation}
                        >
                            {trail.map((step) => (
                                <span key={step} className="gui-crumb">
                                    {step}
                                    <span className="gui-crumb-sep">/</span>
                                </span>
                            ))}
                            {!siblings && (
                                <span className="gui-crumb" data-here>
                                    {here}
                                </span>
                            )}
                        </button>
                        {siblings && <Siblings {...siblings} />}
                    </div>
                </div>
                <div className="gui-sections">{tabs}</div>
                <div className="gui-status">{status}</div>
            </header>
            <div
                className="gui-body"
                style={columns ? { gridTemplateColumns: columns } : undefined}
            >
                {children}
            </div>
            {overlay}
            {commands}
            <ContextMenu root={root} />
            <FocusCursor root={root} />
        </main>
    );
}

type SiblingProps = {
    sections: { id: string; label: string }[];
    active: string;
    onSelect: (id: string) => void;
    glyphs: GlyphSet;
};

/** The breadcrumb's last step as a switch between sibling sections. */
function Siblings({ sections, active, onSelect, glyphs }: SiblingProps) {
    const store = useFocusStore();
    return (
        <span className="gui-siblings">
            <Glyph action="prev-section" set={glyphs} />
            {sections.map((section, i) => (
                <span key={section.id} className="gui-sibling-wrap">
                    {i > 0 && <span className="gui-crumb-sep">·</span>}
                    <button
                        type="button"
                        tabIndex={-1}
                        className="gui-crumb gui-sibling"
                        data-here={section.id === active || undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                            section.id !== active && headerClick(store) && onSelect(section.id)
                        }
                    >
                        {section.label}
                    </button>
                </span>
            ))}
            <Glyph action="next-section" set={glyphs} />
        </span>
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
        <div className="gui-chip" data-state={state} data-tone={tone}>
            {state === "live" && <i className="gui-chip-dot" aria-hidden />}
            {state === "busy" && (
                <i className="gui-chip-ticks" aria-hidden>
                    <b />
                    <b />
                    <b />
                </i>
            )}
            <span className="gui-chip-label">{label}</span>
            <span className="gui-chip-value">{value}</span>
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
    const store = useFocusStore();
    const nav = useRef<HTMLElement>(null);
    // On a narrow screen the strip slides sideways: keep the active tab in view.
    useEffect(() => {
        const strip = nav.current?.parentElement;
        const tab = nav.current?.querySelector<HTMLElement>("[data-active]");
        if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
        const t = tab.getBoundingClientRect();
        const s = strip.getBoundingClientRect();
        strip.scrollLeft += t.left - s.left - (s.width - t.width) / 2;
    }, [active]);
    return (
        <nav ref={nav} className="gui-tabs" aria-label="Sections">
            <Glyph action="prev-tab" set={glyphs} />
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    tabIndex={-1}
                    className="gui-tab"
                    data-active={tab.id === active || undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        if (tab.id === active || !headerClick(store)) return;
                        uiTick(e.currentTarget);
                        onSelect(tab.id);
                    }}
                >
                    {tab.label}
                    {tab.count !== undefined && <span className="gui-tab-count">{tab.count}</span>}
                </button>
            ))}
            <Glyph action="next-tab" set={glyphs} />
        </nav>
    );
}
