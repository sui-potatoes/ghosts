// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

import { useFocusable, type Command } from "./focus";

type PanelProps = {
    /** Stencil caption on the panel's head: `REQUISITION`. */
    label: string;
    /** Two-digit index before the caption: `01`. */
    index?: string;
    /** Right side of the head: a count, a serial, a short readout. */
    meta?: ReactNode;
    /** Pinned to the panel's bottom edge: a summary line, a capacity meter. */
    foot?: ReactNode;
    /** `ghost` drops the fill: a readout column rather than a working panel. */
    variant?: "solid" | "ghost";
    className?: string;
    children: ReactNode;
};

/** A framed panel anchored in the body grid: hairline frame, corner ticks, stencil head. */
export function Panel({
    label,
    index,
    meta,
    foot,
    variant = "solid",
    className,
    children,
}: PanelProps) {
    return (
        <section className={`uis-panel ${className ?? ""}`} data-variant={variant}>
            <header className="uis-panel-head">
                {index && <span className="uis-panel-index">{index}</span>}
                <span className="uis-panel-label">{label}</span>
                {meta !== undefined && <span className="uis-panel-meta">{meta}</span>}
            </header>
            <div className="uis-panel-body">{children}</div>
            {foot && <footer className="uis-panel-foot">{foot}</footer>}
        </section>
    );
}

/** A heading inside a panel; the eyebrow of a block of rows. */
export function Eyebrow({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
    return (
        <div className="uis-eyebrow">
            <span>{children}</span>
            {meta !== undefined && <span className="uis-eyebrow-meta">{meta}</span>}
        </div>
    );
}

type Focus = {
    /** Unique on the screen; stable across re-renders. */
    id: string;
    /** The panel it belongs to; the cursor prefers to stay in it. */
    group: string;
    /** What the command bar shows while it is focused. */
    title?: string;
    hint?: string;
    commands?: Command[];
};

type ListRowProps = Focus & {
    index: string;
    name: string;
    /** Secondary line: the class, the maker. */
    kind?: string;
    /** Right-hand state: a price, `IN STOCK`, `LOCKED`. */
    tag?: string;
    tagTone?: "default" | "accent" | "warn" | "dim";
    /** The current one (issued, equipped): an accent notch and a mark. */
    selected?: boolean;
    /** Shown, focusable, refused: the command bar says why. */
    locked?: boolean;
};

/** One row of a list. Selection (what is current) and the cursor (what is pointed at) are separate. */
export function ListRow({
    index,
    name,
    kind,
    tag,
    tagTone = "default",
    selected,
    locked,
    ...focus
}: ListRowProps) {
    const { props } = useFocusable<HTMLButtonElement>(focus);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="uis-row"
            data-selected={selected || undefined}
            data-locked={locked || undefined}
            aria-selected={selected}
            {...props}
        >
            <span className="uis-row-index">{index}</span>
            <span className="uis-row-main">
                <span className="uis-row-name">{name}</span>
                {kind && <span className="uis-row-kind">{kind}</span>}
            </span>
            {tag && (
                <span className="uis-row-tag" data-tone={tagTone}>
                    {locked && <i className="uis-lock" aria-hidden />}
                    {tag}
                </span>
            )}
        </button>
    );
}

type StatRowProps = Focus & {
    label: string;
    value: number;
    /** What it is compared with (the issued item); omitted, no delta. */
    base?: number;
    /** The bar's full scale. */
    max: number;
    /** Display override for the value: `2–6`. */
    text?: string;
    unit?: string;
    /** For costs and penalties: a smaller number is the buff. */
    lowerIsBetter?: boolean;
};

/**
 * A stat: label, value, the delta against the base (▲ buff in the accent,
 * ▼ nerf in amber) and a bar that shows the base, the gain or the loss.
 */
export function StatRow({
    label,
    value,
    base,
    max,
    text,
    unit,
    lowerIsBetter,
    ...focus
}: StatRowProps) {
    const { props } = useFocusable<HTMLDivElement>(focus);
    const delta = base === undefined ? 0 : value - base;
    const better = lowerIsBetter ? delta < 0 : delta > 0;
    const trend = delta === 0 ? "even" : better ? "buff" : "nerf";
    const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;
    const low = Math.min(value, base ?? value);
    const high = Math.max(value, base ?? value);
    const round = (n: number) => Math.round(n * 10) / 10;
    return (
        <div className="uis-stat" data-trend={trend} {...props}>
            <span className="uis-stat-label">{label}</span>
            <span className="uis-stat-value">
                {text ?? round(value)}
                {unit && <span className="uis-stat-unit">{unit}</span>}
            </span>
            <span className="uis-stat-delta">
                {delta === 0 ? "—" : `${delta > 0 ? "▲ +" : "▼ −"}${round(Math.abs(delta))}`}
            </span>
            <span className="uis-stat-bar" aria-hidden>
                <i className="uis-stat-fill" style={{ width: pct(low) }} />
                {delta !== 0 && (
                    <i
                        className="uis-stat-change"
                        style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }}
                    />
                )}
            </span>
        </div>
    );
}

type MeterProps = {
    label: string;
    value: number;
    max: number;
    /** Segment count; set, the meter draws pips instead of a bar. */
    segments?: number;
    /** Readout on the right; defaults to `value / max`. */
    readout?: ReactNode;
    /** Pending use, drawn hatched after the fill (a requisition's cost). */
    pending?: number;
    tone?: "default" | "warn";
};

/** A capacity readout: a thin bar or a row of pips. Not a cursor target. */
export function Meter({ label, value, max, segments, readout, pending = 0, tone }: MeterProps) {
    const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;
    return (
        <div className="uis-meter" data-tone={tone}>
            <span className="uis-meter-label">{label}</span>
            <span className="uis-meter-readout">{readout ?? `${value} / ${max}`}</span>
            {segments ? (
                <span className="uis-pips" aria-hidden>
                    {Array.from({ length: segments }, (_, i) => (
                        <i
                            key={i}
                            data-on={i < value || undefined}
                            data-pending={(i >= value && i < value + pending) || undefined}
                        />
                    ))}
                </span>
            ) : (
                <span className="uis-meter-bar" aria-hidden>
                    <i className="uis-meter-fill" style={{ width: pct(value) }} />
                    {pending > 0 && (
                        <i
                            className="uis-meter-pending"
                            style={{ left: pct(value), width: pct(pending) }}
                        />
                    )}
                </span>
            )}
        </div>
    );
}

type SlotRowProps = Focus & {
    /** The slot's name: `OPTIC`. */
    slot: string;
    /** What is fitted; omitted, the slot reads empty. */
    item?: string;
};

/** A fitting slot: filled or empty, a cursor target whose commands fit or clear it. */
export function SlotRow({ slot, item, ...focus }: SlotRowProps) {
    const { props } = useFocusable<HTMLButtonElement>(focus);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="uis-slot"
            data-empty={!item || undefined}
            {...props}
        >
            <i className="uis-slot-mark" aria-hidden />
            <span className="uis-slot-name">{slot}</span>
            <span className="uis-slot-item">{item ?? "Empty"}</span>
        </button>
    );
}

/** A read-only line in a readout column: `PRIMARY  Standard Rifle`. */
export function ReadoutLine({
    label,
    children,
    empty,
}: {
    label: string;
    children: ReactNode;
    empty?: boolean;
}) {
    return (
        <div className="uis-readout" data-empty={empty || undefined}>
            <span className="uis-readout-label">{label}</span>
            <span className="uis-readout-value">{children}</span>
        </div>
    );
}

type EmptyStateProps = Focus & {
    /** Stencil headline: `NO STOCK`. */
    headline: string;
    children: ReactNode;
    /** The way out; the block is the cursor target and Confirm runs it. */
    action: string;
};

/** An empty panel that still gives the cursor somewhere to be, and a way forward. */
export function EmptyState({ headline, children, action, ...focus }: EmptyStateProps) {
    const { props } = useFocusable<HTMLButtonElement>(focus);
    return (
        <div className="uis-empty">
            <span className="uis-empty-mark" aria-hidden />
            <span className="uis-empty-headline">{headline}</span>
            <p className="uis-empty-body">{children}</p>
            <button type="button" tabIndex={-1} className="uis-empty-action" {...props}>
                {action}
            </button>
        </div>
    );
}
