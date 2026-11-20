// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game being played, as a record source: polled the way the players' clients
 * poll it, the history past the last look turned into events as it grows, the
 * turn's clock while there is one, and the ending once the game is over or
 * gone (a game can be deleted in the transaction that ends it, so the last poll
 * may find nothing: its last version and that transaction say how it ended).
 * Needs no wallet. The reads are passed in; tested with fakes in
 * `tests/watch-chain.test.ts`.
 */

import type { RecordSource, WatchOutcome, WatchSide } from "@ghosts/engine";

import type { GameTx } from "../../../chain/archive.ts";
import type { ChainGame } from "../../../chain/bcs.ts";
import { isOver, turnLimitMs, turnStartedAt } from "../../../chain/match-rules.ts";
import type { EventFeed, WatchStart } from "./record.ts";

/** How often the game is read: about the players' own pace. */
export const WATCH_POLL_MS = 500;

export interface LiveReads {
    /** The game now; null once it is deleted. Throws when the read fails (it is tried again). */
    read(): Promise<ChainGame | null>;
    /** For a deleted game: its last version and the transaction that deleted it. */
    vanished(): Promise<{ last: ChainGame; tx: GameTx | null } | null>;
    /** How a game ended, from its last version and the deleting transaction, if any. */
    outcome(last: ChainGame, tx: GameTx | null): WatchOutcome | null;
    /** Waits `ms` between reads. */
    wait(ms: number): Promise<void>;
}

/** A live record source: it reads while subscribed to; `stop` ends it for good. */
export type LiveSource = RecordSource & {
    /** The game as last read. */
    latest(): ChainGame;
    stop(): void;
};

/** When nothing says how a deleted game ended. */
const UNTOLD: WatchOutcome = { winner: null, reason: "The match ended" };

export function liveSource(
    init: {
        start: WatchStart;
        sides: readonly [WatchSide, WatchSide];
        feed: EventFeed;
        current: ChainGame;
    },
    reads: LiveReads,
): LiveSource {
    const { start, sides, feed } = init;
    const listeners = new Set<() => void>();
    let latest = init.current;
    let ended = isOver(latest);
    let outcome: WatchOutcome | null = ended ? reads.outcome(latest, null) : null;
    let running = false;
    let stopped = false;
    feed.take(latest);

    const tell = () => {
        for (const listener of listeners) listener();
    };
    const clockOf = (game: ChainGame) => `${game.turn}:${turnStartedAt(game)}`;

    /** Reads while anyone follows the game: the viewer's playback subscribes, and lets go on leave. */
    async function poll() {
        running = true;
        try {
            await follow();
        } finally {
            running = false;
        }
    }

    async function follow() {
        while (!stopped && !ended && listeners.size) {
            await reads.wait(WATCH_POLL_MS);
            if (stopped || !listeners.size) return;
            let game: ChainGame | null;
            try {
                game = await reads.read();
            } catch {
                continue;
            }
            if (stopped) return;
            if (!game) {
                const gone = await reads.vanished().catch(() => null);
                if (gone) {
                    feed.take(gone.last);
                    latest = gone.last;
                }
                outcome = (gone && reads.outcome(gone.last, gone.tx)) ?? UNTOLD;
                ended = true;
                tell();
                return;
            }
            const clock = clockOf(game) !== clockOf(latest);
            const added = feed.take(game);
            latest = game;
            if (isOver(game)) {
                ended = true;
                outcome = reads.outcome(game, null);
            }
            if (added || clock || ended) tell();
        }
    }

    return {
        scenario: start.scenario,
        sides,
        prepare: start.prepare,
        events: () => feed.events,
        ended: () => ended,
        outcome: () => outcome,
        deadline: () => {
            if (ended || latest.state.$kind !== "Playing") return undefined;
            return turnStartedAt(latest) + turnLimitMs(latest.turn);
        },
        // The game is read from the moment the viewer follows it, and until it lets go.
        subscribe(listener) {
            listeners.add(listener);
            if (!running && !stopped && !ended) void poll();
            return () => void listeners.delete(listener);
        },
        latest: () => latest,
        stop() {
            stopped = true;
        },
    };
}
