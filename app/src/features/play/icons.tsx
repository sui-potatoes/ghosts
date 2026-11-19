// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The three mode illustrations, drawn in the interface's line style: a 96-unit
 * grid, thin square-capped strokes in `currentColor` (the card sets it to the
 * accent), no fills but the faint `gui-play-ink` wash. They hold at 48px.
 */

import type { ModeId } from "./model";

const SVG = {
    viewBox: "0 0 96 96",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "square",
    strokeLinejoin: "miter",
    "aria-hidden": true,
    focusable: false,
} as const;

/** Ranked: rank chevrons in a hexagonal plate, a podium's steps beneath. */
function RankedArt() {
    return (
        <svg {...SVG}>
            <path d="M48 8l30 17v34L48 76 18 59V25z" />
            <path className="gui-play-ink" d="M48 14l24.5 14v28L48 70 23.5 56V28z" opacity=".35" />
            <path d="M34 36l14-8 14 8M34 46l14-8 14 8M34 56l14-8 14 8" />
            <path d="M14 88v-6h14v6M41 88v-12h14v12M68 88v-9h14v9" />
            <path d="M8 88h80" opacity=".5" />
            <path d="M48 2v3M6 22l2.5 1.5M90 22l-2.5 1.5" opacity=".5" />
        </svg>
    );
}

/** Friendly: two operators, a link between them, an invite tag beneath. */
function FriendlyArt() {
    return (
        <svg {...SVG}>
            <circle cx="26" cy="24" r="8" />
            <path d="M12 56v-8c0-6 6-10 14-10s14 4 14 10v8z" />
            <circle cx="70" cy="24" r="8" />
            <path d="M56 56v-8c0-6 6-10 14-10s14 4 14 10v8z" />
            <path d="M40 22h16" strokeDasharray="3 3" />
            <path d="M40 22l4-3M40 22l4 3M56 22l-4-3M56 22l-4 3" />
            <path d="M22 66h52v18H22z" />
            <path d="M22 66l-5 9 5 9" opacity=".5" />
            <path d="M30 75h8M43 75h4M52 75h14" opacity=".8" />
            <path d="M48 56v10" opacity=".5" />
        </svg>
    );
}

/** Faction wars: three corporate sigils, each a different shape, under one ring. */
function FactionsArt() {
    return (
        <svg {...SVG}>
            <circle cx="48" cy="48" r="42" strokeDasharray="2 4" opacity=".5" />
            {/* Bio engineering: a cell with a helix */}
            <g>
                <circle cx="48" cy="22" r="11" />
                <path d="M42 17c4 3 8 3 12 0M42 27c4-3 8-3 12 0M48 11v22" />
            </g>
            {/* AI and robotics: a diamond with a node */}
            <g>
                <path d="M24 58l12 12-12 12-12-12z" />
                <path d="M24 64v12M18 70h12" />
                <circle cx="24" cy="70" r="2" />
            </g>
            {/* Military tech: a triangle with a bar */}
            <g>
                <path d="M72 58l13 24H59z" />
                <path d="M66 74h12M72 66v8" />
            </g>
            <path d="M48 35v7M36 64l8-14M60 64l-8-14" opacity=".5" />
        </svg>
    );
}

export function ModeArt({ id }: { id: ModeId }) {
    return id === "ranked" ? <RankedArt /> : id === "friendly" ? <FriendlyArt /> : <FactionsArt />;
}
