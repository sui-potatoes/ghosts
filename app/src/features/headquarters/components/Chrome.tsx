// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

/** The Headquarters header: back to the menu, and the Squad / Armory sections. */
export function HqHeader({ status }: { status?: ReactNode }) {
    return (
        <header className="squad-header">
            <Link to="/" className="squad-back label text-secondary hover:text-accent">
                ‹ Menu
            </Link>
            <h1 className="squad-title">Headquarters</h1>
            <nav className="hq-sections" aria-label="Headquarters sections">
                <NavLink to="/headquarters" end>
                    Squad
                </NavLink>
                <NavLink to="/headquarters/armory">Armory</NavLink>
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
