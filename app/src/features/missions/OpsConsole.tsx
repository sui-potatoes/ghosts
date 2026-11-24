// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useSyncExternalStore, type ReactNode } from "react";

/** Below this width the console is one column that scrolls (missions.css agrees). */
export const NARROW_CONSOLE = "(max-width: 760px)";

const subscribe = (change: () => void) => {
    const query = window.matchMedia(NARROW_CONSOLE);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
};

/** Whether the console is in its one-column phone layout. */
export function useNarrowConsole(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(NARROW_CONSOLE).matches,
        () => false,
    );
}

/**
 * The console's layout: queue, board, briefing side by side, the board taking
 * what the side panels leave; on a phone one column that scrolls inside the
 * frame's body. It is the cursor's scroll container there, so the cursor
 * follows its targets as the column scrolls.
 */
export function OpsConsole({ children }: { children: ReactNode }) {
    return (
        <div className="gui-ops-console" data-gui-scroll>
            {children}
        </div>
    );
}
