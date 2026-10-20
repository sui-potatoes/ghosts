// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

/**
 * Instant hover/focus tooltip, styled by `.tip` in index.css. Never the
 * browser's own `title`: it is slow, unstyled and invisible to keyboard users.
 * Line breaks in `text` are kept.
 */
export function Tooltip({
    text,
    align = "end",
    children,
}: {
    text: string;
    /** Which edge of the wrapper the bubble lines up with. */
    align?: "start" | "end";
    children: ReactNode;
}) {
    return (
        <span className={align === "start" ? "tip tip-start" : "tip"} tabIndex={0}>
            {children}
            <span role="tooltip" className="tip-bubble">
                {text}
            </span>
        </span>
    );
}
