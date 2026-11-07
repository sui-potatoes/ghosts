// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { SEARCH_TIMEOUT_MS, useMatchmakingDriver, useMatchSearch } from "../chain";
import { usePadActive } from "./PadHints";

/** Time since `sinceMs`, ticking once a second. */
function useElapsed(sinceMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return Math.max(0, now - sinceMs);
}

/** How long a search has been running, as `m:ss`; stops at the timeout. */
export function SearchClock({ sinceMs }: { sinceMs: number }) {
    const seconds = Math.floor(Math.min(useElapsed(sinceMs), SEARCH_TIMEOUT_MS) / 1000);
    return (
        <span className="tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
    );
}

function Searching(props: { sinceMs: number; busy: boolean; onCancel: () => void }) {
    if (useElapsed(props.sinceMs) > SEARCH_TIMEOUT_MS)
        return (
            <>
                <span className="label">No match found</span>
                <button className="btn" disabled={props.busy} onClick={props.onCancel}>
                    OK
                </button>
            </>
        );
    return (
        <>
            <svg viewBox="0 0 32 32" aria-hidden="true">
                <circle className="save-indicator-track" cx="16" cy="16" r="12" />
                <circle className="save-indicator-arc" cx="16" cy="16" r="12" />
            </svg>
            <span className="label">Finding match</span>
            <span className="label text-secondary">
                <SearchClock sinceMs={props.sinceMs} />
            </span>
            <button className="btn" disabled={props.busy} onClick={props.onCancel}>
                Cancel
            </button>
        </>
    );
}

/**
 * The search for a match, following the player across the menu screens so the
 * squad and the settings stay editable meanwhile, and the way back to a game in
 * progress. Mounted once in the shell, where it also drives the search; out of
 * the way in the encounter and the editor, where the search carries on, and in
 * the match itself.
 */
export function MatchStatus() {
    const { pathname } = useLocation();
    const pad = usePadActive();
    const navigate = useNavigate();
    const { searching, matched, playing, busy, error, cancel } = useMatchSearch();
    const driver = useMatchmakingDriver();

    if (["/demo", "/editor", "/match"].some((path) => pathname.startsWith(path))) return null;
    if (!searching && !matched && !playing) return null;

    const message = error || driver.error;

    return (
        <div
            className={`match-status ${pad ? "above-pad" : ""} ${pathname === "/" ? "on-menu" : ""}`}
            role="status"
            aria-live="polite"
        >
            {searching ? (
                <Searching sinceMs={Number(searching.sinceMs)} busy={busy} onCancel={cancel} />
            ) : matched ? (
                <>
                    <span className="label text-accent">Match found</span>
                    {driver.error && (
                        <button className="btn" disabled={driver.busy} onClick={driver.retry}>
                            Retry
                        </button>
                    )}
                </>
            ) : (
                <>
                    <span className="label text-accent">Match in progress</span>
                    <button className="btn" onClick={() => navigate("/match")}>
                        Resume
                    </button>
                </>
            )}
            {message && <span className="label text-warn normal-case">{message}</span>}
        </div>
    );
}
