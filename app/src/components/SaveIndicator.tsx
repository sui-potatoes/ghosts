// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { useSaving } from "../chain";
import { usePadActive } from "./PadHints";

/** Long enough that a quick save still reads as a deliberate blink, not a flicker. */
const MIN_VISIBLE_MS = 900;

/**
 * The corner spinner a game shows while it saves progress: on while any send,
 * wait or refresh is in flight, held for a beat after so short saves register.
 * Mounted once in the shell; no words, the spinner is the message.
 */
export function SaveIndicator() {
    const saving = useSaving();
    const pad = usePadActive();
    const [shown, setShown] = useState(false);
    const since = useRef(0);

    useEffect(() => {
        if (saving) {
            setShown(true);
            since.current = performance.now();
            return;
        }
        const left = MIN_VISIBLE_MS - (performance.now() - since.current);
        if (left <= 0) return setShown(false);
        const timer = window.setTimeout(() => setShown(false), left);
        return () => window.clearTimeout(timer);
    }, [saving]);

    return (
        <div
            className={`save-indicator ${shown ? "is-on" : ""} ${pad ? "above-pad" : ""}`}
            role="status"
            aria-live="polite"
        >
            {shown && <span className="sr-only">Saving</span>}
            <svg viewBox="0 0 32 32" aria-hidden="true">
                <circle className="save-indicator-track" cx="16" cy="16" r="12" />
                <circle className="save-indicator-arc" cx="16" cy="16" r="12" />
            </svg>
        </div>
    );
}
