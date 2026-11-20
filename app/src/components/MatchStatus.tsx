// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
    acknowledgeExpired,
    TICKET_TTL_MS,
    useExpired,
    useMatchmakingDriver,
    useMatchSearch,
    type QueueSearch,
} from "../chain";
import { CLASSIC_TITLE } from "../classicTitle";
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
    const seconds = Math.floor(Math.min(useElapsed(sinceMs), TICKET_TTL_MS) / 1000);
    return (
        <span className="tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
    );
}

/** No match within the search's time: OK leaves the queue. */
function NoMatch(props: { busy: boolean; onDismiss: () => void }) {
    return (
        <>
            <span className="label">No match found</span>
            <button className="btn" disabled={props.busy} onClick={props.onDismiss}>
                OK
            </button>
        </>
    );
}

/** What a search is for: `Ranked 3x3`, `Contract`. */
const searchName = (search: QueueSearch) =>
    search.kind === "stakes"
        ? "Contract"
        : search.size
          ? `Ranked ${search.size}x${search.size}`
          : "Ranked";

function Searching(props: {
    search: QueueSearch;
    sinceMs: number;
    busy: boolean;
    onCancel: () => void;
}) {
    if (useElapsed(props.sinceMs) > TICKET_TTL_MS)
        return <NoMatch busy={props.busy} onDismiss={props.onCancel} />;
    return (
        <>
            <svg viewBox="0 0 32 32" aria-hidden="true">
                <circle className="save-indicator-track" cx="16" cy="16" r="12" />
                <circle className="save-indicator-arc" cx="16" cy="16" r="12" />
            </svg>
            <span className="label">{searchName(props.search)}</span>
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
    const { searching, playing, lobby, busy, error, cancel } = useMatchSearch();
    const expired = useExpired();
    useMatchmakingDriver();

    if (["/demo", "/editor", "/match"].some((path) => pathname.startsWith(path))) return null;
    // Headquarters and the title show the search in their own header.
    if (pathname === "/headquarters" || pathname === "/play/contract") return null;
    if (pathname === "/" && !CLASSIC_TITLE) return null;
    // The friendly screen is the lobby itself.
    if (lobby && pathname === "/play/friendly") return null;
    // The ranked and contract screens tell their own search.
    if (searching?.kind === "ranked" && pathname === "/play/ranked") return null;
    if (searching?.kind === "stakes" && pathname === "/play/contract") return null;
    const expiredHere =
        (expired?.kind === "ranked" && pathname === "/play/ranked") ||
        (expired?.kind === "stakes" && pathname === "/play/contract");
    const told = expired && !expiredHere && !searching && !playing && !lobby ? expired : null;
    if (!searching && !playing && !lobby && !told) return null;

    return (
        <div
            className={`match-status ${pad ? "above-pad" : ""} ${pathname === "/" || pathname === "/menu-classic" ? "on-menu" : ""}`}
            role="status"
            aria-live="polite"
        >
            {searching ? (
                <Searching
                    search={searching}
                    sinceMs={Number(searching.sinceMs)}
                    busy={busy}
                    onCancel={cancel}
                />
            ) : told ? (
                <>
                    <span className="label text-warn">No match found</span>
                    <button
                        className="btn"
                        onClick={() =>
                            navigate(told.kind === "ranked" ? "/play/ranked" : "/play/contract")
                        }
                    >
                        Search again
                    </button>
                    <button className="btn" onClick={acknowledgeExpired}>
                        OK
                    </button>
                </>
            ) : !playing && lobby ? (
                <>
                    <span className="label text-accent">Friendly lobby</span>
                    <button className="btn" onClick={() => navigate("/play/friendly")}>
                        Open
                    </button>
                </>
            ) : (
                <>
                    <span className="label text-accent">Match in progress</span>
                    <button className="btn" onClick={() => navigate("/match")}>
                        Resume
                    </button>
                </>
            )}
            {error && <span className="label text-warn normal-case">{error}</span>}
        </div>
    );
}
