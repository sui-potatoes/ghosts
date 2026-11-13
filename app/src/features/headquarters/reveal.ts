// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { uiTick } from "../../audio";

/** The beat between two cards turning over. */
const REVEAL_GAP_MS = 650;
/** How long a hired card waits for its portrait before it turns over anyway. */
const PORTRAIT_WAIT_MS = 3500;

/**
 * The recruitment deck's reveal: hired cards turn over one at a time, left
 * to right, each once its portrait is drawn (or after a short wait), so every
 * card lands with its face already on it. Cards hired before the deck mounted
 * start face up, unless a hire is still settling. Returns how many of `slots`
 * are face up.
 */
export function useReveal(
    slots: ({ objectId: string } | null)[],
    portraits: Record<string, string>,
    pending: boolean,
): number {
    const [revealed, setRevealed] = useState(() => (pending ? 0 : slots.filter(Boolean).length));
    const nextId = slots[revealed]?.objectId;
    const nextReady = !!nextId && !!portraits[nextId];
    useEffect(() => {
        if (!nextId) return;
        const timer = window.setTimeout(
            () => {
                setRevealed((r) => r + 1);
                uiTick();
            },
            nextReady ? REVEAL_GAP_MS : PORTRAIT_WAIT_MS,
        );
        return () => window.clearTimeout(timer);
    }, [nextId, nextReady]);
    return revealed;
}
