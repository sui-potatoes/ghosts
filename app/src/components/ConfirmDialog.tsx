// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { uiConfirm, uiTick } from "../audio";
import { useBack } from "../hooks/useBack";
import { onAction } from "../input";
import { PadHints } from "./PadHints";

type Props = {
    open: boolean;
    title: string;
    /** The consequence, named plainly; shown under the title. */
    children: ReactNode;
    /** The confirming button's label; the other button is always Cancel. */
    confirmLabel: string;
    onConfirm: () => void;
    onClose: () => void;
};

/**
 * House-style modal confirmation for actions that deserve a second look.
 * Cancel is the resting choice; any direction moves the band between the two
 * buttons and confirm activates the chosen one, all off the input bus, so the
 * keyboard and the pad drive it alike. Back (Escape, pad B) cancels through
 * the back stack, and every other menu action is consumed while open, so the
 * list and the category nav behind the overlay hold still.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose }: Props) {
    const id = useId();
    const [choice, setChoice] = useState<0 | 1>(0);

    // Reopening always rests on Cancel: confirming must be deliberate.
    useEffect(() => {
        if (open) setChoice(0);
    }, [open]);

    useBack(open ? onClose : null);

    const act = (which: 0 | 1) => (which === 1 ? onConfirm() : onClose());
    const busRef = useRef({ choice, act });
    busRef.current = { choice, act };

    useEffect(() => {
        if (!open) return;
        return onAction((action) => {
            if (action === "back") return false; // falls to this dialog's back-stack entry
            if (action === "confirm") {
                uiConfirm();
                busRef.current.act(busRef.current.choice);
            } else if (["up", "down", "left", "right"].includes(action)) {
                uiTick();
                setChoice(busRef.current.choice === 0 ? 1 : 0);
            }
            return true; // modal: tabs and reset never reach the screen behind
        });
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-body`}
                className="confirm-dialog flex w-full max-w-md flex-col border border-line bg-surface"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex flex-col gap-2 px-6 pt-6 pb-5">
                    <h2 id={`${id}-title`} className="label text-foreground">
                        {title}
                    </h2>
                    <p id={`${id}-body`} className="text-[13px] leading-relaxed text-secondary">
                        {children}
                    </p>
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                    <PadHints
                        className="mr-auto"
                        entries={[
                            ["a", "Select"],
                            ["b", "Back"],
                        ]}
                    />
                    <button
                        type="button"
                        className="btn"
                        data-selected={choice === 0 || undefined}
                        onMouseEnter={() => setChoice(0)}
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn"
                        data-selected={choice === 1 || undefined}
                        onMouseEnter={() => setChoice(1)}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
