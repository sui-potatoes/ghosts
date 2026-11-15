// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, type ReactNode } from "react";

import { FocusScope, useFocusable, useFocusState, type Command } from "./focus";
import { Eyebrow } from "./parts";

export type GridOption = {
    id: string;
    label: string;
    /** One to three colours drawn as the tile's chip. */
    colors?: string[];
    /** A picture for the tile. */
    image?: string;
};

type GridPickerProps = {
    /** Unique per picker; the focus scope's id. */
    id: string;
    title: string;
    options: GridOption[];
    value: string;
    /** The option under the cursor, for a live preview (the stage wearing it). */
    onPreview: (id: string) => void;
    onPick: (id: string) => void;
    /** Back: the preview ends, nothing changes. */
    onClose: () => void;
    columns?: number;
    /** Below the grid: one line about what is under the cursor. */
    foot?: ReactNode;
};

/**
 * A large set as a grid of tiles standing in for a panel's rows: its own
 * focus scope (the cursor moves in two dimensions inside it), the option
 * under the cursor previewed live, Confirm picks it, Back leaves it as it
 * was. Opens on the current value.
 */
export function GridPicker({
    id,
    title,
    options,
    value,
    onPreview,
    onPick,
    onClose,
    columns = 3,
    foot,
}: GridPickerProps) {
    const close: Command = { action: "back", label: "Cancel", run: onClose };
    return (
        <FocusScope id={id} back={close}>
            <div className="gui-grid-picker">
                <Eyebrow meta={`${options.length}`}>{title}</Eyebrow>
                <div
                    className="gui-grid"
                    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                    {options.map((option) => (
                        <Tile
                            key={option.id}
                            scope={id}
                            option={option}
                            current={option.id === value}
                            onPick={onPick}
                            close={close}
                        />
                    ))}
                </div>
                {foot}
                <Preview scope={id} value={value} onPreview={onPreview} />
            </div>
        </FocusScope>
    );
}

/** Follows the cursor and reports the option under it; starts on the current value. */
function Preview({
    scope,
    value,
    onPreview,
}: {
    scope: string;
    value: string;
    onPreview: (id: string) => void;
}) {
    const store = useFocusState();
    const prefix = `${scope}:`;
    useEffect(() => {
        store.focus(prefix + value, false);
        // Once, on open.
    }, []);
    const at = store.preview;
    const focused = at?.startsWith(prefix) ? at.slice(prefix.length) : null;
    useEffect(() => {
        if (focused !== null) onPreview(focused);
        // The preview follows the cursor only.
    }, [focused]);
    return null;
}

function Tile({
    scope,
    option,
    current,
    onPick,
    close,
}: {
    scope: string;
    option: GridOption;
    current: boolean;
    onPick: (id: string) => void;
    close: Command;
}) {
    const { props } = useFocusable<HTMLButtonElement>({
        id: `${scope}:${option.id}`,
        group: "grid",
        previews: true,
        title: option.label,
        hint: current ? "Current" : undefined,
        commands: [
            {
                action: "confirm",
                label: current ? "Keep" : "Choose",
                tone: "primary",
                run: () => onPick(option.id),
            },
            close,
        ],
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-tile"
            data-current-value={current || undefined}
            {...props}
        >
            {option.image ? (
                <img src={option.image} alt="" draggable={false} />
            ) : option.colors ? (
                <span className="gui-tile-chip" aria-hidden>
                    {option.colors.map((c, i) => (
                        <i key={i} style={{ background: c }} />
                    ))}
                </span>
            ) : null}
            <span className="gui-tile-label">{option.label}</span>
        </button>
    );
}
