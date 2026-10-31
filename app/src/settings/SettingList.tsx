// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { padGlyph } from "@ghosts/engine/gamepad";

import { uiConfirm, uiTick } from "../audio";
import { usePad } from "../components/PadHints";
import { onAction, onKeys } from "../input";
import { keyLabel, type Action } from "./keys";
import { useSettings } from "./store";

/*
 * The Sifu-style setting list: wide rows with the label on the left and the
 * value on the right flanked by ‹ › arrows, a full-width inverted band on the
 * focused row, a description panel under the list and a key-hints bar at the
 * bottom. One keyboard handler drives the whole list; rows only describe
 * themselves.
 */

type RowBase = {
    id: string;
    label: string;
    /** One or two sentences for the description panel while the row is focused. */
    description: string;
    disabled?: boolean;
    /** Reset this one setting to its default (the reset key / hint). */
    onReset?: () => void;
};

export type SettingRow =
    /** Un-focusable group heading between rows. */
    | { kind: "section"; id: string; label: string }
    /** A value cycled with Left/Right; Confirm advances it too. */
    | (RowBase & {
          kind: "choice";
          value: ReactNode;
          onPrev: () => void;
          onNext: () => void;
          onConfirm?: () => void;
      })
    /** A 0–100 level stepped in increments of ten. */
    | (RowBase & { kind: "slider"; value: number; onChange: (next: number) => void })
    /** Confirm (or click) runs it; no arrows. */
    | (RowBase & { kind: "action"; value: ReactNode; onConfirm: () => void })
    /** Read-only display; still focusable so its description shows. */
    | (RowBase & { kind: "static"; value: ReactNode });

const SLIDER_STEPS = 10;
const SLIDER_STEP = 100 / SLIDER_STEPS;

function clamp(v: number): number {
    return Math.max(0, Math.min(100, Math.round(v)));
}

function focusable(row: SettingRow | undefined): boolean {
    return !!row && row.kind !== "section";
}

/**
 * True while a dialog is open ABOVE `self`: one that does not contain it.
 * The pause overlay is itself a dialog wrapping the settings, so containment
 * is what separates "the dialog we live in" from "a dialog stacked on top"
 * (the name dialog, the sign-in dialog).
 */
export function dialogAbove(self: HTMLElement | null): boolean {
    return Array.from(document.querySelectorAll('[role="dialog"], dialog[open]')).some(
        (dialog) => !self || !dialog.contains(self),
    );
}

function Arrow({
    dir,
    label,
    disabled,
    onClick,
}: {
    dir: -1 | 1;
    label: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            tabIndex={-1}
            className="set-arrow"
            aria-label={label}
            disabled={disabled}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
                uiTick();
            }}
        >
            {dir < 0 ? "‹" : "›"}
        </button>
    );
}

function RowValue({
    row,
    focused,
}: {
    row: Exclude<SettingRow, { kind: "section" }>;
    focused: boolean;
}) {
    const [settings] = useSettings();

    switch (row.kind) {
        case "choice":
            return (
                <>
                    <Arrow
                        dir={-1}
                        label={`${row.label}: previous`}
                        disabled={row.disabled}
                        onClick={row.onPrev}
                    />
                    <span className="set-choice">{row.value}</span>
                    <Arrow
                        dir={1}
                        label={`${row.label}: next`}
                        disabled={row.disabled}
                        onClick={row.onNext}
                    />
                </>
            );
        case "slider": {
            const set = (v: number) => row.onChange(clamp(v));
            return (
                <>
                    <Arrow
                        dir={-1}
                        label={`${row.label} down`}
                        disabled={row.disabled || row.value <= 0}
                        onClick={() => set(row.value - SLIDER_STEP)}
                    />
                    <span
                        className="set-seg"
                        role="slider"
                        aria-label={row.label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={row.value}
                        aria-disabled={row.disabled}
                    >
                        {Array.from({ length: SLIDER_STEPS }, (_, i) => (
                            <span
                                key={i}
                                className={`set-seg-block ${row.value >= (i + 1) * SLIDER_STEP ? "on" : ""}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (row.disabled) return;
                                    set((i + 1) * SLIDER_STEP);
                                    uiTick();
                                }}
                            />
                        ))}
                    </span>
                    <span className="set-slider-num">{row.value}</span>
                    <Arrow
                        dir={1}
                        label={`${row.label} up`}
                        disabled={row.disabled || row.value >= 100}
                        onClick={() => set(row.value + SLIDER_STEP)}
                    />
                </>
            );
        }
        case "action":
            return (
                <>
                    {row.value}
                    <kbd className={`kbd set-cue ${focused ? "" : "set-cue-hidden"}`} aria-hidden>
                        {keyLabel(settings.controls.bindings.confirm[0])}
                    </kbd>
                </>
            );
        case "static":
            return <>{row.value}</>;
    }
}

function Hint({ caps, label, dim }: { caps: string[]; label: string; dim?: boolean }) {
    return (
        <span className="set-hint" data-dim={dim || undefined}>
            {caps.map((cap) => (
                <kbd key={cap} className="kbd">
                    {cap}
                </kbd>
            ))}
            <span>{label}</span>
        </span>
    );
}

/** The list tells the view whether the focused row can reset, for the footer. */
export const ResetHintContext = createContext<(canReset: boolean) => void>(() => {});

/**
 * The control hints: a quiet global footer, rendered by the view. Pad glyphs
 * while a controller is connected, the bound keys otherwise.
 */
export function SettingsHints({ canReset }: { canReset: boolean }) {
    const [settings] = useSettings();
    const pad = usePad();
    const b = settings.controls.bindings;
    const caps = (keys: string[], glyphs: string[]) => (pad ? glyphs : keys.map(keyLabel));
    return (
        <div className="set-hints" aria-hidden>
            <Hint caps={caps([b.up[0], b.down[0]], [padGlyph("dpad")])} label="Navigate" />
            <Hint caps={caps([b.left[0], b.right[0]], ["◀ ▶"])} label="Change" />
            <Hint caps={caps([b.confirm[0]], [padGlyph("a")])} label="Select" />
            <Hint
                caps={caps([b["prev-tab"][0], b["next-tab"][0]], [padGlyph("lb"), padGlyph("rb")])}
                label="Category"
            />
            <Hint caps={caps([b.reset[0]], [padGlyph("x")])} label="Default" dim={!canReset} />
            <Hint caps={caps([b.back[0]], [padGlyph("b")])} label="Back" />
        </div>
    );
}

export function SettingList({ rows }: { rows: SettingRow[] }) {
    const listRef = useRef<HTMLDivElement | null>(null);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
    const first = rows.findIndex(focusable);
    const [focusIndex, setFocusIndex] = useState(first);
    const reportReset = useContext(ResetHintContext);

    // Rows can appear or vanish between renders (signing in or out).
    const focus = focusable(rows[focusIndex]) ? focusIndex : first;
    const row = rows[focus];

    function moveTo(i: number) {
        if (i !== focus) uiTick();
        setFocusIndex(i);
        rowRefs.current[i]?.scrollIntoView({ block: "nearest" });
    }

    function step(dir: 1 | -1) {
        let i = focus;
        for (let n = 0; n < rows.length; n++) {
            i = (i + dir + rows.length) % rows.length;
            if (focusable(rows[i])) break;
        }
        moveTo(i);
    }

    function change(r: SettingRow | undefined, dir: 1 | -1): boolean {
        if (!r || r.kind === "section" || r.disabled) return false;
        // The tick sounds after the store settles, so it lands at the level
        // just set when the row being changed is the Interface slider itself.
        if (r.kind === "choice") {
            (dir < 0 ? r.onPrev : r.onNext)();
            uiTick();
            return true;
        }
        if (r.kind === "slider") {
            r.onChange(clamp(r.value + dir * SLIDER_STEP));
            uiTick();
            return true;
        }
        return false;
    }

    function confirm(r: SettingRow | undefined): boolean {
        if (!r || r.kind === "section" || r.disabled) return false;
        if (r.kind === "action") {
            uiConfirm();
            r.onConfirm();
            return true;
        }
        if (r.kind === "choice") {
            uiConfirm();
            (r.onConfirm ?? r.onNext)();
            return true;
        }
        return false;
    }

    // The list consumes bus actions no matter what has DOM focus, reading
    // fresh state through a ref; a dialog stacked above still wins.
    function onBusAction(action: Action): boolean {
        if (dialogAbove(listRef.current)) return false;
        if (action === "up") {
            step(-1);
            return true;
        }
        if (action === "down") {
            step(1);
            return true;
        }
        if (action === "left") return change(row, -1);
        if (action === "right") return change(row, 1);
        if (action === "confirm") return confirm(row);
        if (action === "reset" && row && row.kind !== "section" && row.onReset && !row.disabled) {
            row.onReset();
            uiConfirm();
            return true;
        }
        return false;
    }
    const actionRef = useRef(onBusAction);
    actionRef.current = onBusAction;
    useEffect(() => onAction((action) => actionRef.current(action)), []);

    // Home/End jump a slider to its ends: a keyboard nicety outside the action
    // set, riding the input bus's shortcut lane like every other screen key.
    const edgeRef = useRef((end: boolean): boolean => {
        void end;
        return false;
    });
    edgeRef.current = (end: boolean) => {
        if (dialogAbove(listRef.current) || row?.kind !== "slider" || row.disabled) return false;
        row.onChange(end ? 100 : 0);
        return true;
    };
    useEffect(
        () =>
            onKeys({
                Home: () => edgeRef.current(false),
                End: () => edgeRef.current(true),
            }),
        [],
    );

    function hover(i: number) {
        if (i === focus || !focusable(rows[i])) return;
        uiTick();
        setFocusIndex(i);
    }

    const canReset = !!row && row.kind !== "section" && !!row.onReset && !row.disabled;
    useEffect(() => {
        reportReset(canReset);
    }, [reportReset, canReset]);

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div ref={listRef} role="listbox" aria-label="Settings" className="set-list">
                {rows.map((r, i) =>
                    r.kind === "section" ? (
                        <div key={r.id} className="set-section label" role="presentation">
                            {r.label}
                        </div>
                    ) : (
                        <div
                            key={r.id}
                            ref={(el) => {
                                rowRefs.current[i] = el;
                            }}
                            role="option"
                            aria-selected={i === focus}
                            aria-disabled={r.disabled || undefined}
                            className="set-row"
                            data-focused={i === focus || undefined}
                            data-disabled={r.disabled || undefined}
                            onMouseEnter={() => hover(i)}
                            onClick={() => confirm(r)}
                        >
                            <span className="set-label label">{r.label}</span>
                            <span className="set-value">
                                <RowValue row={r} focused={i === focus} />
                            </span>
                        </div>
                    ),
                )}
            </div>
            <div className="set-desc" aria-live="polite">
                {row && row.kind !== "section" ? row.description : ""}
            </div>
        </div>
    );
}
