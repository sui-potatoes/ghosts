// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** What an idle agent sleeps on. It says "look again"; the agent then reads the truth itself. */
export interface Wake {
    next(signal?: AbortSignal): Promise<void>;
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
 * Poll with jitter, so a fleet started together doesn't read in lockstep. Fine
 * for one agent or a small fleet; at scale use `feedWake`, because tens of
 * thousands of pollers would mostly read games that have not changed.
 */
export function pollingWake(intervalMs = 2_000): Wake {
    return { next: (signal) => sleep(intervalMs * (0.75 + Math.random() / 2), signal) };
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
