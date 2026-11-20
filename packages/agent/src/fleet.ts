// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What a fleet seat does on its own, the testable part of `bin/fleet.ts`: make sure it has an
 * `Account` and a name on the deployment it plays (a republished package means a new registry,
 * so a seat simply starts over there), play ranked games back to back with pauses and an hourly
 * cap, log one line per finished game, and leave nothing behind when it stops: no search, no
 * lobby, no reveal pending, and a game it is in played to the end.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { playGames, type GhostsAgent } from "./agent.ts";
import { referencePolicy, type Policy } from "./bot.ts";
import { ensureFleetName, type NameOutcome } from "./callsign.ts";
import { describeSquad, loadoutOfUnit, type Loadout } from "./ranked.ts";
import { ActionError } from "./types.ts";

/** What a seat last played on, kept next to its key: how `status` tells a stale seat. */
export interface SeatRecord {
    package: string;
    account: string;
    name: string | null;
}

export function readSeatRecord(path: string): SeatRecord | null {
    try {
        return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SeatRecord) : null;
    } catch {
        return null;
    }
}

/**
 * Get a seat ready on the agent's deployment: an `Account` on its registry (created, and funded,
 * when the package was republished or the seat is new), and an `ai-<word>` player name
 * (`ensureFleetName`). The record says what it is ready on. A name that cannot be had is
 * reported, never thrown.
 */
export async function ensureSeat(
    agent: GhostsAgent,
    seed: number,
    recordPath?: string,
): Promise<{ account: string; fresh: boolean; name: NameOutcome | { kind: "failed"; message: string } }> {
    const before = await agent.backend.account();
    await agent.setup();
    const account = await agent.backend.account();
    if (!account) throw new ActionError("no_account", "Setup made no account.");
    let name: NameOutcome | { kind: "failed"; message: string };
    try {
        name = await ensureFleetName(agent, seed);
    } catch (error) {
        name = { kind: "failed", message: (error as Error).message };
    }
    if (recordPath && agent.backend.packageId) {
        const record: SeatRecord = {
            package: agent.backend.packageId,
            account: account.id,
            name: "name" in name ? name.name : await agent.backend.name().catch(() => null),
        };
        writeFileSync(recordPath, JSON.stringify(record));
    }
    return { account: account.id, fresh: !before, name };
}

/**
 * Leave nothing pending: reveal a ranked squad a match is waiting on (the agent's `wait` does),
 * dismiss a notice, cancel a search, close or leave a lobby, then play out a game the account is
 * in. Never starts a new search.
 */
export async function settleSeat(agent: GhostsAgent, policy: Policy = referencePolicy, signal?: AbortSignal) {
    for (let step = 0; step < 6; step++) {
        const account = await agent.backend.account();
        if (!account) return;
        if (account.search.kind === "playing") {
            await playGames(agent, policy, { queue: false, signal });
            continue;
        }
        if (account.search.kind === "idle") return;
        const role = await agent.backend.searchRole();
        switch (role?.kind) {
            case "reveal":
            case "seat_waiting":
                await agent.wait({ timeoutMs: 5_000 });
                break;
            case "notice":
                await agent.backend.dismissNotice();
                break;
            case "hosting_open":
            case "hosting_invite":
                await agent.closeLobby();
                break;
            case "guest":
                await agent.leaveLobby();
                break;
            default:
                await agent.cancelSearch().catch(() => agent.wait({ timeoutMs: 2_000 }));
        }
    }
}

export interface RunOptions {
    /** Units a side. */
    size?: number;
    /** Most games a seat starts in any hour. */
    perHour?: number;
    /** A random pause between games, in this range. */
    pauseMs?: [number, number];
    /** How long a search may wait before it is left and tried again later. */
    patienceMs?: number;
    signal: AbortSignal;
    log: (line: string) => void;
    policy?: Policy;
    random?: () => number;
    /** Real time, for the hourly cap; tests move it. */
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** A finished game, as one log line: who, with what, how it went, and where to find it. */
export interface GameLine {
    game: string;
    seat: string | null;
    opponent: string | null;
    squad: string;
    opponentSquad: string;
    result: string;
    rating: { before: number; after: number; change: number };
}

const HOUR_MS = 3_600_000;
/** Errors in a row before a seat gives up. */
const MAX_FAILURES = 20;

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });
}

/**
 * Play ranked games until `signal`: a random pause, a search (an auto squad), the game, a line
 * for it, again; no more than `perHour` games started in any hour. A search left alone past
 * `patienceMs` is let go and tried again after the pause. On `signal` the seat is settled.
 */
export async function runSeat(agent: GhostsAgent, options: RunOptions): Promise<GameLine[]> {
    const { signal, log } = options;
    const random = options.random ?? Math.random;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? wait;
    const [pauseMin, pauseMax] = options.pauseMs ?? [5_000, 30_000];
    const perHour = options.perHour ?? 12;
    agent.mode = { kind: "ranked", size: options.size ?? 3 };
    const started: number[] = [];
    const lines: GameLine[] = [];
    let seat = await agent.backend.name();
    let failures = 0;

    while (!signal.aborted) {
        const hourAgo = now() - HOUR_MS;
        while (started.length && started[0] < hourAgo) started.shift();
        if (started.length >= perHour) {
            await sleep(started[0] + HOUR_MS - now(), signal);
            continue;
        }
        await sleep(pauseMin + random() * (pauseMax - pauseMin), signal);
        if (signal.aborted) break;

        const before = await agent.backend.account();
        if (!before || now() < before.suspendedUntilMs) {
            await sleep(Math.max(1_000, (before?.suspendedUntilMs ?? 0) - now()), signal);
            continue;
        }
        let game: string | null = null;
        let squads: [string, string] = ["", ""];
        let opponent: string | null = null;
        const seen = async (id: string) => {
            game = id;
            const { state, side } = await agent.current();
            const describe = (s: number) =>
                describeSquad(
                    state.units
                        .filter((u) => u.side === s)
                        .map(loadoutOfUnit)
                        .filter((l): l is Loadout => l !== null),
                );
            squads = [describe(side), describe(1 - side)];
            opponent = await agent.backend.playerName(state.players[1 - side]).catch(() => null);
        };
        let results: unknown[];
        try {
            ({ results } = await playGames(agent, options.policy ?? referencePolicy, {
                games: 1,
                signal,
                patienceMs: options.patienceMs,
                onEvent: ({ situation }) => {
                    const phases = ["your_turn", "opponent_turn", "opponent_timed_out"];
                    if (situation.game && situation.game !== game && phases.includes(situation.phase)) {
                        void seen(situation.game).catch(() => {});
                        started.push(now());
                    }
                },
            }));
            failures = 0;
        } catch (error) {
            // a busy network, a stale read, someone acting first: the chain holds the truth, and
            // the next round picks the game back up where it is
            if (++failures >= MAX_FAILURES) throw error;
            log(JSON.stringify({ retry: (error as Error).message.slice(0, 160), failures }));
            await sleep(2_000 * failures, signal);
            continue;
        }
        if (results.length === 0 || !game) continue;
        const after = await agent.backend.account();
        seat = await agent.backend.name().catch(() => seat);
        const line: GameLine = {
            game,
            seat,
            opponent,
            squad: squads[0],
            opponentSquad: squads[1],
            result: (results[0] as string | undefined) ?? "unknown",
            rating: {
                before: before.rating,
                after: after?.rating ?? before.rating,
                change: (after?.rating ?? before.rating) - before.rating,
            },
        };
        lines.push(line);
        log(JSON.stringify(line));
    }
    await settleSeat(agent, options.policy ?? referencePolicy);
    return lines;
}
