// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { MouseEvent, ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

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
    const via = (to: string) => (e: MouseEvent) => {
        if (!guard) return;
        e.preventDefault();
        guard(() => navigate(to));
    };
    return (
        <header className="squad-header">
            <Link
                to="/"
                className="squad-back label text-secondary hover:text-accent"
                onClick={via("/")}
            >
                ‹ Menu
            </Link>
            <h1 className="squad-title">Headquarters</h1>
            <nav className="hq-sections" aria-label="Headquarters sections">
                <NavLink to="/headquarters" end>
                    Squad
                </NavLink>
                <NavLink to="/headquarters/armory" onClick={via("/headquarters/armory")}>
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
