// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

import { Tooltip } from "../components/Tooltip";
import { keyLabel, type Action } from "./keys";
import { currentAction, useSettings } from "./store";

/** A key cap in the controls table. */
function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="kbd">{children}</kbd>;
}

/** The keys bound to a menu `action`, or the given `keys`, as key caps. */
export function Keys(props: { action: Action } | { keys: string[] }) {
    const [settings] = useSettings();
    const keys = "keys" in props ? props.keys : settings.controls.bindings[props.action];
    return (
        <span className="inline-flex gap-1.5">
            {keys.map((key) => (
                <Kbd key={key}>{keyLabel(key)}</Kbd>
            ))}
        </span>
    );
}

/**
 * A labelled row in a settings panel. The value side is whatever you pass;
 * a `hint` shows as a tooltip on the label.
 */
export function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <div className="ctl-row">
            <div className="flex min-w-0 flex-col gap-0.5">
                {hint ? (
                    <Tooltip text={hint} align="start">
                        <span className="label text-foreground">{label}</span>
                    </Tooltip>
                ) : (
                    <span className="label text-foreground">{label}</span>
                )}
            </div>
            <div className="shrink-0 font-mono text-sm text-foreground">{children}</div>
        </div>
    );
}

/** On/off as a game switch. Left/Right arrows set it, Enter/Space flips it. */
export function Switch({
    label,
    hint,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <Field label={label} hint={hint}>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={disabled}
                className="switch-pill"
                onClick={() => onChange(!checked)}
                onKeyDown={(e) => {
                    const action = currentAction(e);
                    if (action === "left") onChange(false);
                    else if (action === "right") onChange(true);
                    else if (action === "confirm") onChange(!checked);
                    else return;
                    e.preventDefault();
                }}
            >
                {checked ? "On" : "Off"}
            </button>
        </Field>
    );
}

const STEPS = 10;
const STEP = 100 / STEPS;

/**
 * A level from 0 to 100 as ten blocks. Click a block, use the arrows at the
 * ends, or focus the bar and press Left/Right (Home/End for the extremes).
 */
export function Slider({
    label,
    hint,
    value,
    disabled,
    onChange,
}: {
    label: string;
    hint?: string;
    value: number;
    disabled?: boolean;
    onChange: (next: number) => void;
}) {
    const set = (v: number) => onChange(Math.max(0, Math.min(100, Math.round(v))));

    return (
        <Field label={label} hint={hint}>
            <div className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
                <button
                    type="button"
                    className="seg-btn"
                    aria-label={`${label} down`}
                    disabled={disabled || value <= 0}
                    onClick={() => set(value - STEP)}
                >
                    ‹
                </button>
                <div
                    role="slider"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={value}
                    aria-disabled={disabled}
                    className="seg"
                    onKeyDown={(e) => {
                        if (disabled) return;
                        const action = currentAction(e);
                        if (action === "left") set(value - STEP);
                        else if (action === "right") set(value + STEP);
                        else if (e.key === "Home") set(0);
                        else if (e.key === "End") set(100);
                        else return;
                        e.preventDefault();
                    }}
                >
                    {Array.from({ length: STEPS }, (_, i) => (
                        <span
                            key={i}
                            className={`seg-block ${value >= (i + 1) * STEP ? "on" : ""}`}
                            onClick={() => !disabled && set((i + 1) * STEP)}
                        />
                    ))}
                </div>
                <button
                    type="button"
                    className="seg-btn"
                    aria-label={`${label} up`}
                    disabled={disabled || value >= 100}
                    onClick={() => set(value + STEP)}
                >
                    ›
                </button>
                <span className="w-7 text-right tabular-nums">{value}</span>
            </div>
        </Field>
    );
}
