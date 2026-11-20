// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** What the agent saw before it sleeps: how long a poll may wait depends on it. */
export interface WakeHint {
    phase: string;
    /** Time left on the turn (or the deployment) being waited on. */
    turnMsLeft?: number;
    /** How long the search has run. */
    searchingMs?: number;
    suspendedUntilMs?: number;
}

/** What an idle agent sleeps on. It says "look again"; the agent then reads the truth itself. */
export interface Wake {
    next(signal?: AbortSignal, hint?: WakeHint): Promise<void>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

/**
 * How many polling intervals a wait in each phase sleeps. The opponent's turn is watched at half
 * speed (a turn lasts 90 s; seeing its end a few seconds late costs nothing), a search backs off
 * as it ages (one waits minutes; a reveal it leads to has a minute), a lobby is slower still, and
 * a suspension sleeps long, all of it bounded by `MAX_FACTOR`.
 */
export function pollFactor(hint?: WakeHint): number {
    switch (hint?.phase) {
        case "opponent_turn":
            return 2;
        case "searching": {
            // 1x for the first 20 s, doubling every 40 s after, up to 6x
            const ms = hint.searchingMs ?? 0;
            return Math.min(6, Math.max(1, 2 ** ((ms - 20_000) / 40_000)));
        }
        case "lobby_hosting":
        case "lobby_guest":
            return 3;
        case "suspended":
            return MAX_FACTOR;
        default:
            return 1;
    }
}

const MAX_FACTOR = 15;

/**
 * Poll with jitter, so a fleet started together doesn't read in lockstep, and slower where
 * nothing is due (`pollFactor`). A turn's deadline cuts a wait short, so a timed-out opponent is
 * seen at once. Fine for one agent or a small fleet; at scale use `feedWake`, because tens of
 * thousands of pollers would mostly read games that have not changed.
 */
export function pollingWake(intervalMs = 2_000): Wake {
    return {
        next(signal, hint) {
            let ms = intervalMs * pollFactor(hint) * (0.75 + Math.random() / 2);
            if (hint?.turnMsLeft !== undefined) ms = Math.min(ms, hint.turnMsLeft + 250);
            if (hint?.suspendedUntilMs !== undefined) {
                ms = Math.min(ms, Math.max(intervalMs, hint.suspendedUntilMs - Date.now() + 1_000));
            }
            return sleep(Math.max(0, ms), signal);
        },
    };
}

/**
 * Long-poll the turn feed: an indexer on `SubscribeCheckpoints` answers when
 * something happened for this `Account`. The service is assumed:
 *
 *     GET {url}/v1/wake/{account}?cursor={cursor}&timeout=25 -> { "cursor": "..." }
 *
 * The feed is an optimization and never the source of truth, so while it is
 * down the agent falls back to polling and keeps playing.
 */
export function feedWake(url: string, account: () => string | null, fallbackMs = 5_000): Wake {
    let cursor = "";
    return {
        async next(signal) {
            const id = account();
            if (!id) return sleep(fallbackMs, signal);
            try {
                const query = new URLSearchParams({ cursor, timeout: "25" });
                const response = await fetch(`${url}/v1/wake/${id}?${query}`, { signal });
                if (!response.ok) throw new Error(`feed answered ${response.status}`);
                cursor = ((await response.json()) as { cursor: string }).cursor;
            } catch {
                await sleep(fallbackMs, signal);
            }
        },
    };
}
