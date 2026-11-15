// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    useRef,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";

import { uiTick } from "../audio";
import { useFocusable, useFocusState, type Command } from "./focus";
import { Icon, type IconName } from "./icons";
import { InlineCommands } from "./pointer";

type PanelProps = {
    /** Stencil caption on the head; omit when the header already says it. */
    label?: string;
    /** Right side of the head: only a figure the player needs (a count against a limit). */
    meta?: ReactNode;
    /** Pinned to the panel's bottom edge. */
    foot?: ReactNode;
    /** `ghost` drops the fill and frame: a readout column rather than a working panel. */
    variant?: "solid" | "ghost";
    className?: string;
    children: ReactNode;
};

/** A panel anchored in the body grid: hairline frame, two corner ticks, an optional stencil head. */
export function Panel({ label, meta, foot, variant = "solid", className, children }: PanelProps) {
    return (
        <section className={`gui-panel ${className ?? ""}`} data-variant={variant}>
            {label && (
                <header className="gui-panel-head">
                    <span className="gui-panel-label">{label}</span>
                    {meta !== undefined && <span className="gui-panel-meta">{meta}</span>}
                </header>
            )}
            <div className="gui-panel-body">{children}</div>
            {foot && <footer className="gui-panel-foot">{foot}</footer>}
        </section>
    );
}

/** A heading inside a panel; the eyebrow of a block of rows. */
export function Eyebrow({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
    return (
        <div className="gui-eyebrow">
            <span>{children}</span>
            {meta !== undefined && <span className="gui-eyebrow-meta">{meta}</span>}
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
    /** The first click or tap runs the primary too (`useFocusable`'s `instant`). */
    instant?: boolean;
    /** The primary is on offer to the mouse as a labelled button on the row, armed or not. */
    offered?: boolean;
};

/** A small picture at a row's leading edge: a rendered thumbnail, or a pictogram. */
export function Thumb({ src, icon }: { src?: string; icon?: IconName }) {
    return (
        <span className="gui-thumb" data-kind={src ? "image" : "icon"}>
            {src ? <img src={src} alt="" draggable={false} /> : icon && <Icon name={icon} />}
        </span>
    );
}

type ListRowProps = Focus & {
    name: string;
    /** Leading picture: a gear thumbnail, a portrait, a pictogram. */
    thumb?: ReactNode;
    /** A second line, only when it tells the rows apart. */
    kind?: string;
    /** Right-hand state: a price, `In rack`, `Locked`. */
    tag?: string;
    tagTone?: "default" | "accent" | "warn" | "dim";
    /** The current one (issued, on stage): an accent notch, independent of the cursor. */
    selected?: boolean;
    /** A padlock before the tag. The dimming is the row's inactive state (`deny` on its Confirm). */
    locked?: boolean;
};

/**
 * One row of a list. Selection (what is current) and the cursor (what is
 * pointed at) are separate. With the mouse in use, the focused row carries
 * its commands at its trailing edge in place of its tag.
 */
export function ListRow({
    name,
    thumb,
    kind,
    tag,
    tagTone = "default",
    selected,
    locked,
    ...focus
}: ListRowProps) {
    const { props, inline, commands, armedCommand } = useFocusable<HTMLButtonElement>(focus);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-row"
            data-selected={selected || undefined}
            data-thumb={thumb ? "" : undefined}
            aria-selected={selected}
            {...props}
        >
            {thumb}
            <span className="gui-row-main">
                <span className="gui-row-name">{name}</span>
                {kind && <span className="gui-row-kind">{kind}</span>}
            </span>
            {inline ? (
                <InlineCommands commands={commands} armed={armedCommand} />
            ) : (
                tag && (
                    <span className="gui-row-tag" data-tone={tagTone}>
                        {locked && <i className="gui-lock" aria-hidden />}
                        {tag}
                    </span>
                )
            )}
        </button>
    );
}

type StatRowProps = Focus & {
    label: string;
    /** A pictogram before the label, where it says what the stat is at a glance. */
    icon?: IconName;
    value: number;
    /** What it is compared with; omitted, no delta. */
    base?: number;
    /** The bar's full scale. */
    max: number;
    /** Display override for the value: `2–6`, `30%`. */
    text?: string;
    /** For costs and penalties: a smaller number is the buff. */
    lowerIsBetter?: boolean;
};

/**
 * A stat: pictogram and label, value, the delta against the base (▲ buff in
 * the accent, ▼ nerf in amber) and a bar that carries the magnitude, so the
 * figures can stay small.
 */
export function StatRow({
    label,
    icon,
    value,
    base,
    max,
    text,
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
        <div className="gui-stat" data-trend={trend} {...props}>
            <span className="gui-stat-label">
                {icon && <Icon name={icon} size={14} />}
                {label}
            </span>
            <span className="gui-stat-value">{text ?? round(value)}</span>
            <span className="gui-stat-delta">
                {delta !== 0 && `${delta > 0 ? "▲ +" : "▼ −"}${round(Math.abs(delta))}`}
            </span>
            <span className="gui-stat-bar" aria-hidden>
                <i className="gui-stat-fill" style={{ width: pct(low) }} />
                {delta !== 0 && (
                    <i
                        className="gui-stat-change"
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
    /** Pending use, drawn hatched after the fill. */
    pending?: number;
    tone?: "default" | "warn";
};

/** A capacity readout: a thin bar or a row of pips. Not a cursor target. */
export function Meter({ label, value, max, segments, readout, pending = 0, tone }: MeterProps) {
    const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;
    return (
        <div className="gui-meter" data-tone={tone}>
            <span className="gui-meter-label">{label}</span>
            <span className="gui-meter-readout">{readout ?? `${value} / ${max}`}</span>
            {segments ? (
                <span className="gui-pips" aria-hidden>
                    {Array.from({ length: segments }, (_, i) => (
                        <i
                            key={i}
                            data-on={i < value || undefined}
                            data-pending={(i >= value && i < value + pending) || undefined}
                        />
                    ))}
                </span>
            ) : (
                <span className="gui-meter-bar" aria-hidden>
                    <i className="gui-meter-fill" style={{ width: pct(value) }} />
                    {pending > 0 && (
                        <i
                            className="gui-meter-pending"
                            style={{ left: pct(value), width: pct(pending) }}
                        />
                    )}
                </span>
            )}
        </div>
    );
}

type SlotRowProps = Focus & {
    /** The slot's name: `Scope`, `Primary`. */
    slot: string;
    /** Pictogram for the slot kind, shown when nothing (or no picture) fills it. */
    icon?: IconName;
    /** A thumbnail of what fills it. */
    image?: string;
    /** What is fitted; omitted, the slot reads empty. */
    item?: string;
};

/** A slot: filled or empty, a cursor target whose commands change or clear it. */
export function SlotRow({ slot, icon, image, item, ...focus }: SlotRowProps) {
    const { props, inline, commands, armedCommand } = useFocusable<HTMLButtonElement>(focus);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-slot"
            data-empty={!item || undefined}
            {...props}
        >
            {icon || image ? (
                <Thumb src={item ? image : undefined} icon={icon} />
            ) : (
                <i className="gui-slot-mark" aria-hidden />
            )}
            <span className="gui-slot-text">
                <span className="gui-slot-name">{slot}</span>
                <span className="gui-slot-item">{item ?? "Empty"}</span>
            </span>
            {inline && <InlineCommands commands={commands} armed={armedCommand} />}
        </button>
    );
}

/** A read-only line in a readout column. */
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
        <div className="gui-readout" data-empty={empty || undefined}>
            <span className="gui-readout-label">{label}</span>
            <span className="gui-readout-value">{children}</span>
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
    const { props, armedCommand } = useFocusable<HTMLButtonElement>(focus);
    return (
        <div className="gui-empty">
            <span className="gui-empty-headline">{headline}</span>
            <p className="gui-empty-body">{children}</p>
            <button type="button" tabIndex={-1} className="gui-empty-action" {...props}>
                {action}
            </button>
            {armedCommand && <InlineCommands commands={[]} armed={armedCommand} />}
        </div>
    );
}

type StepperProps = Focus & {
    label: string;
    /** `[id, label]` pairs, in stepping order. */
    options: [string, string][];
    value: string;
    onChange: (id: string) => void;
};

/**
 * A chooser in the game's language: left/right step through the options
 * while it has the cursor (wrapping), the arrows are click targets, and the
 * position shows as pips. No native select, no dropdown.
 */
export function Stepper({ label, options, value, onChange, ...focus }: StepperProps) {
    const at = Math.max(
        0,
        options.findIndex(([id]) => id === value),
    );
    const step = (by: 1 | -1) => {
        const next = options[(at + by + options.length) % options.length];
        uiTick(null);
        onChange(next[0]);
    };
    const store = useFocusState();
    const { props } = useFocusable<HTMLDivElement>({
        ...focus,
        clickConfirm: false,
        directions: (dir) => {
            if (dir !== "left" && dir !== "right") return false;
            step(dir === "left" ? -1 : 1);
            return true;
        },
    });
    // An arrow acts on the first click or tap and takes the cursor to its row,
    // selected or not (its click does not reach the row's own handler).
    const press = (by: 1 | -1) => (e: ReactMouseEvent) => {
        e.stopPropagation();
        store.pointerInput();
        store.focus(focus.id);
        step(by);
    };
    return (
        <div className="gui-chooser" {...props}>
            <span className="gui-chooser-label">{label}</span>
            <span className="gui-stepper">
                <button
                    type="button"
                    tabIndex={-1}
                    className="gui-step"
                    aria-label={`Previous ${label}`}
                    onClick={press(-1)}
                >
                    ‹
                </button>
                <span className="gui-stepper-value" key={value}>
                    {options[at]?.[1]}
                </span>
                <button
                    type="button"
                    tabIndex={-1}
                    className="gui-step"
                    aria-label={`Next ${label}`}
                    onClick={press(1)}
                >
                    ›
                </button>
            </span>
            <span className="gui-chooser-pips" aria-hidden>
                {options.map(([id], i) => (
                    <i key={id} data-on={i === at || undefined} />
                ))}
            </span>
        </div>
    );
}

type SwatchRowProps = Focus & {
    label: string;
    /** Each swatch: an id, its name, and one to three colours drawn side by side. */
    swatches: { id: string; name: string; colors: string[] }[];
    value: string;
    onChange: (id: string) => void;
};

/**
 * A row of colour chips: left/right move the pick while it has the cursor,
 * a click picks directly. The picked chip wears a frame. The chip colours
 * are the character's own data, not interface colour.
 */
export function SwatchRow({ label, swatches, value, onChange, ...focus }: SwatchRowProps) {
    const at = Math.max(
        0,
        swatches.findIndex((s) => s.id === value),
    );
    const pick = (i: number) => {
        uiTick(null);
        onChange(swatches[(i + swatches.length) % swatches.length].id);
    };
    const store = useFocusState();
    const { props } = useFocusable<HTMLDivElement>({
        ...focus,
        clickConfirm: false,
        directions: (dir) => {
            if (dir !== "left" && dir !== "right") return false;
            pick(at + (dir === "left" ? -1 : 1));
            return true;
        },
    });
    return (
        <div className="gui-chooser" data-kind="swatch" {...props}>
            <span className="gui-chooser-label">{label}</span>
            <span className="gui-swatches">
                {swatches.map((swatch, i) => (
                    <button
                        key={swatch.id}
                        type="button"
                        tabIndex={-1}
                        className="gui-swatch"
                        aria-label={swatch.name}
                        title={swatch.name}
                        data-picked={i === at || undefined}
                        onClick={(e) => {
                            e.stopPropagation();
                            store.pointerInput();
                            store.focus(focus.id);
                            if (i !== at) pick(i);
                        }}
                    >
                        {swatch.colors.map((color, k) => (
                            <i key={k} style={{ background: color }} />
                        ))}
                    </button>
                ))}
            </span>
        </div>
    );
}

type ActionRowProps = Focus & {
    label: string;
    /** `danger` draws it in amber: it removes something for good. */
    tone?: "default" | "danger";
};

/** A row that is one action (Dismiss): a cursor target, Confirm runs it. */
export function ActionRow({ label, tone = "default", ...focus }: ActionRowProps) {
    const { props, inline, commands, armedCommand } = useFocusable<HTMLButtonElement>(focus);
    return (
        <button type="button" tabIndex={-1} className="gui-action-row" data-tone={tone} {...props}>
            <span className="gui-action-label">{label}</span>
            {inline && <InlineCommands commands={commands} armed={armedCommand} />}
        </button>
    );
}

type SliderProps = Focus & {
    label: string;
    value: number;
    /** Range; a range around zero draws its centre mark. */
    min?: number;
    max?: number;
    /** Segments drawn; left/right step one segment. */
    segments?: number;
    onChange: (value: number) => void;
};

/**
 * A continuous value as a segmented bar: left/right step a segment while it
 * has the cursor, a press or a drag on the bar sets it directly. The readout
 * is the value in hundredths, the way the character editor counts.
 */
export function Slider({
    label,
    value,
    min = -1,
    max = 1,
    segments = 20,
    onChange,
    ...focus
}: SliderProps) {
    const bar = useRef<HTMLSpanElement>(null);
    const step = (max - min) / segments;
    const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
    const set = (v: number) => {
        const next = Math.round(clamp(v) * 1000) / 1000;
        if (next !== value) {
            uiTick(null);
            onChange(next);
        }
    };
    const { props } = useFocusable<HTMLDivElement>({
        ...focus,
        clickConfirm: false,
        directions: (dir) => {
            if (dir !== "left" && dir !== "right") return false;
            set(value + (dir === "left" ? -step : step));
            return true;
        },
    });
    const fromPointer = (e: ReactPointerEvent) => {
        const r = bar.current!.getBoundingClientRect();
        set(min + ((e.clientX - r.left) / r.width) * (max - min));
    };
    const at = Math.round((value - min) / step);
    const zero = min < 0 && max > 0 ? Math.round((0 - min) / step) : -1;
    return (
        <div className="gui-chooser" data-kind="slider" {...props}>
            <span className="gui-chooser-label">{label}</span>
            <span
                ref={bar}
                className="gui-slider"
                onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    fromPointer(e);
                }}
                onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
                }}
            >
                {Array.from({ length: segments }, (_, i) => {
                    // Filled from the centre (or the start) to the value.
                    const from = zero >= 0 ? Math.min(zero, at) : 0;
                    const to = zero >= 0 ? Math.max(zero, at) : at;
                    return (
                        <i
                            key={i}
                            data-on={(i >= from && i < to) || undefined}
                            data-zero={i === zero || undefined}
                        />
                    );
                })}
            </span>
            <span className="gui-slider-value">{Math.round(value * 100)}</span>
        </div>
    );
}

type TextFieldProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** Enter in the field: the prompt's confirm. */
    onSubmit: () => void;
    maxLength?: number;
};

/**
 * A text field for a prompt (a preset's name). It takes the keyboard while
 * focused — typing never moves the cursor; Enter submits, Escape is still
 * Back. A pad has no keyboard here: the field opens with a usable name, so
 * Confirm alone answers the prompt.
 */
export function TextField({ label, value, onChange, onSubmit, maxLength = 24 }: TextFieldProps) {
    return (
        <label className="gui-field">
            <span className="gui-field-label">{label}</span>
            <input
                className="gui-field-input"
                value={value}
                maxLength={maxLength}
                autoFocus
                spellCheck={false}
                onChange={(e) => onChange(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                // The prompt block keeps the mouse from moving focus; in the
                // field it has to place the caret and select text.
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    onSubmit();
                }}
            />
        </label>
    );
}
