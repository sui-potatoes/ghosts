// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { MouseEvent, ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useGoUp } from "../../../hooks/useGoUp";

/**
 * The Headquarters header: back to the menu, and the Squad / Armory sections.
 * `guard` gets a say before any of its links leaves the screen (unsaved
 * changes); it calls `go` to carry on.
 */
export function HqHeader({
    status,
    guard,
}: {
    status?: ReactNode;
    guard?: (go: () => void) => void;
}) {
    const navigate = useNavigate();
    const goUp = useGoUp();
    // Sections are siblings: switching replaces the entry (never grows the history).
    const via = (to: string) => (e: MouseEvent) => {
        if (!guard) return;
        e.preventDefault();
        if (e.currentTarget.getAttribute("aria-current")) return; // already here
        guard(() => navigate(to, { replace: true }));
    };
    const menu = (e: MouseEvent) => {
        e.preventDefault();
        (guard ?? ((go) => go()))(goUp);
    };
    return (
        <header className="squad-header">
            <Link
                to="/"
                className="squad-back label text-secondary hover:text-accent"
                onClick={menu}
            >
                ‹ Menu
            </Link>
            <h1 className="squad-title">Headquarters</h1>
            <nav className="hq-sections" aria-label="Headquarters sections">
                <NavLink to="/headquarters" end replace onClick={via("/headquarters")}>
                    Squad
                </NavLink>
                <NavLink to="/headquarters/armory" replace onClick={via("/headquarters/armory")}>
                    Armory
                </NavLink>
            </nav>
            <div className="squad-save">
                <small role="status">{status}</small>
            </div>
        </header>
    );
}

/** A full-screen notice in place of the workspace: deployment, sign-in, reading, errors. */
export function Gate(props: {
    heading: string;
    children: ReactNode;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <section className="hq-gate">
            <span className="sq-eyebrow">{props.heading}</span>
            <p>{props.children}</p>
            {props.action && props.onAction && (
                <button className="btn sq-primary" onClick={props.onAction}>
                    {props.action}
                </button>
            )}
        </section>
    );
}
