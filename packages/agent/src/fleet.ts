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
import { backoffMs, isTransient } from "./rpc.ts";
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
    for (let step = 0, busy = 0; step < 6; step++) {
        try {
            if (await settleStep(agent, policy, signal)) return;
        } catch (error) {
            // a busy node is waited out; a refusal is the next step's to read again
            if (isTransient(error) && busy++ < 20) {
                step--;
                await new Promise((resolve) => setTimeout(resolve, 1_000 + backoffMs(busy, Math.random, 1_000, 20_000)));
            } else throw error;
        }
    }
}

/** One step toward settled; true once there is nothing left to do. */
async function settleStep(agent: GhostsAgent, policy: Policy, signal?: AbortSignal): Promise<boolean> {
    {
        const account = await agent.backend.account();
        if (!account) return true;
        if (account.search.kind === "playing") {
            await playGames(agent, policy, { queue: false, signal });
            return false;
        }
        if (account.search.kind === "idle") return true;
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
        return false;
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

        let before: Awaited<ReturnType<typeof agent.backend.account>>;
        try {
            before = await agent.backend.account();
        } catch (error) {
            if (!isTransient(error)) throw error;
            await sleep(5_000, signal);
            continue;
        }
        if (!before || now() < before.suspendedUntilMs) {
            if (before) log(JSON.stringify({ suspendedUntil: new Date(before.suspendedUntilMs).toISOString() }));
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
            // the next round picks the game back up where it is. Only lasting failures count.
            if (!isTransient(error) && ++failures >= MAX_FAILURES) throw error;
            log(JSON.stringify({ retry: (error as Error).message.slice(0, 160), failures }));
            await sleep(2_000 * failures, signal);
            continue;
        }
        if (results.length === 0 || !game) continue;
        const after = await agent.backend.account().catch(() => null);
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

// === Supervising seat processes ===

/** What `superviseSeats` needs of a child process: its output, its end, a way to stop it. */
export interface SeatChild {
    stdout?: NodeJS.ReadableStream | null;
    stderr?: NodeJS.ReadableStream | null;
    kill(signal?: NodeJS.Signals): boolean;
    on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface SuperviseOptions {
    seats: number[];
    /** Games each seat plays in all, across its restarts. */
    games: number;
    /** Start a seat's process for `remaining` games. */
    start: (seat: number, remaining: number, attempt: number) => SeatChild;
    /** Seats start this far apart, jittered: a random pause in the range between two starts. */
    staggerMs?: [number, number];
    /** Restarts a seat gets after an unexpected exit, each after `restartDelayMs(n)`. */
    maxRestarts?: number;
    restartDelayMs?: (restart: number) => number;
    /** Stops new starts and restarts, and asks every child to stop (SIGTERM). */
    signal?: AbortSignal;
    /** Told every line a child prints, with its seat. */
    onLine?: (seat: number, line: string, stream: "stdout" | "stderr") => void;
    log?: (line: string) => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    random?: () => number;
}

export interface SeatSummary {
    seat: number;
    played: number;
    results: string[];
    restarts: number;
    /** `done`: played its games or ran out of patience; `failed`: out of restarts; `stopped`. */
    end: "done" | "failed" | "stopped";
    /** The child's last words on stderr, or its exit, when it failed. */
    reason: string | null;
    /** The last `rpc` counts the seat printed. */
    rpc: Record<string, number> | null;
}

const pauseFor = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
        if (signal?.aborted || ms <= 0) return resolve();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });

/** Lines of a stream, as they come. */
function eachLine(stream: NodeJS.ReadableStream | null | undefined, onLine: (line: string) => void) {
    if (!stream) return;
    let rest = "";
    stream.on("data", (chunk: Buffer | string) => {
        const lines = (rest + chunk.toString()).split("\n");
        rest = lines.pop() ?? "";
        lines.forEach(onLine);
    });
    stream.on("end", () => rest && onLine(rest));
}

/**
 * Run one process per seat until each has played `games`: starts staggered, a seat that exits
 * with an error started again (its remaining games) after a growing delay, up to `maxRestarts`.
 * A child counts its games by printing `result {...}` lines; it exits 0 once it played them or
 * ran out of patience. On `signal` nothing new starts and every child is asked to stop.
 */
export async function superviseSeats(options: SuperviseOptions): Promise<SeatSummary[]> {
    const sleep = options.sleep ?? pauseFor;
    const random = options.random ?? Math.random;
    const [gapMin, gapMax] = options.staggerMs ?? [3_000, 7_000];
    const maxRestarts = options.maxRestarts ?? 5;
    const restartDelay = options.restartDelayMs ?? ((n: number) => Math.min(120_000, 10_000 * 2 ** (n - 1)));
    const log = options.log ?? (() => {});
    const live = new Set<SeatChild>();
    const stopAll = () => live.forEach((child) => child.kill("SIGTERM"));
    options.signal?.addEventListener("abort", stopAll, { once: true });

    const runSeat = async (seat: number): Promise<SeatSummary> => {
        const summary: SeatSummary = {
            seat,
            played: 0,
            results: [],
            restarts: 0,
            end: "done",
            reason: null,
            rpc: null,
        };
        for (let attempt = 0; ; attempt++) {
            if (options.signal?.aborted) return { ...summary, end: "stopped" };
            const remaining = options.games - summary.played;
            if (remaining <= 0) return summary;
            const child = options.start(seat, remaining, attempt);
            live.add(child);
            let lastError: string | null = null;
            eachLine(child.stdout, (line) => {
                const result = /^result (\{.*\})$/.exec(line)?.[1];
                if (result) {
                    summary.played++;
                    try {
                        summary.results.push(String((JSON.parse(result) as { result?: string }).result ?? "unknown"));
                    } catch {
                        summary.results.push("unknown");
                    }
                }
                const rpc = /^rpc (\{.*\})$/.exec(line)?.[1];
                if (rpc) {
                    try {
                        summary.rpc = JSON.parse(rpc) as Record<string, number>;
                    } catch {
                        // a torn line; the next one counts
                    }
                }
                options.onLine?.(seat, line, "stdout");
            });
            eachLine(child.stderr, (line) => {
                if (/error|stopped|failed/i.test(line)) lastError = line.slice(0, 300);
                options.onLine?.(seat, line, "stderr");
            });
            const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((done) =>
                child.on("close", (c, s) => done([c, s])),
            );
            live.delete(child);
            if (code === 0) return summary;
            if (options.signal?.aborted) return { ...summary, end: "stopped" };
            summary.reason = lastError ?? `exited ${code ?? signal}`;
            if (summary.restarts >= maxRestarts) {
                log(`agent-${seat} failed for good: ${summary.reason}`);
                return { ...summary, end: "failed" };
            }
            summary.restarts++;
            const delay = restartDelay(summary.restarts);
            log(`agent-${seat} exited ${code ?? signal} (${summary.reason}); restart ${summary.restarts} in ${Math.round(delay / 1000)} s`);
            await sleep(delay, options.signal);
        }
    };

    const runs: Promise<SeatSummary>[] = [];
    for (const [i, seat] of options.seats.entries()) {
        if (i > 0) await sleep(gapMin + random() * (gapMax - gapMin), options.signal);
        if (options.signal?.aborted) break;
        log(`agent-${seat} starting`);
        runs.push(runSeat(seat));
    }
    try {
        return await Promise.all(runs);
    } finally {
        options.signal?.removeEventListener("abort", stopAll);
        stopAll();
    }
}
