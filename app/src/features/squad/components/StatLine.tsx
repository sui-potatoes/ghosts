// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { CSSProperties } from "react";

import { Tooltip } from "../../../components/Tooltip";
import type { StatRow } from "@ghosts/squad/stats";

/**
 * One stat row, the look of the Stats tab: label, bar (base in white, what
 * gear added in accent, what it took away in amber), value, and the gear delta
 * with a tooltip saying where it comes from. `draft` adds a change that is not
 * applied yet: a striped bar segment and a "draft → value" line under the row, dashed so it never
 * reads as an applied bonus.
 */
export function StatLine({
    row,
    base,
    value,
    text,
    delta,
    tip,
    draft,
}: {
    row: StatRow;
    /** What the bar's white part stands for: the value before gear. */
    base: number;
    value: number;
    /** The formatted value. */
    text: string;
    /** Gear's share of the value; shown when there is a tip to explain it. */
    delta: number;
    tip?: string;
    /** The value if the draft were applied. */
    draft?: { value: number; text: string };
}) {
    const pct = (n: number) => `${Math.max(0, Math.min(100, (n / row.max) * 100))}%`;
    const next = draft?.value ?? value;
    const lo = Math.min(value, next);
    const bar = {
        "--base": pct(Math.min(base, lo)),
        "--gain": pct(Math.max(0, lo - base)),
        "--draft": pct(Math.abs(next - value)),
        "--loss": pct(Math.max(0, base - Math.max(value, next))),
    } as CSSProperties;
    const direction = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");
    return (
        <div className="stat-row">
            <span className="stat-label">{row.label}</span>
            <span className="stat-bar" aria-hidden="true" style={bar}>
                <i className="stat-bar-base" />
                <i className="stat-bar-gain" />
                <i className={`stat-bar-draft ${direction(next - value)}`} />
                <i className="stat-bar-loss" />
            </span>
            <span className="stat-value">{text}</span>
            <span className="stat-delta">
                {tip && (
                    <Tooltip text={tip}>
                        <span className={`stat-delta-value ${direction(delta)}`}>
                            {delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "±0"}
                        </span>
                    </Tooltip>
                )}
            </span>
            {draft && (
                <span className="stat-draft">
                    <span className={`stat-draft-value ${direction(next - value)}`}>
                        draft → {draft.text}
                    </span>
                </span>
            )}
        </div>
    );
}
