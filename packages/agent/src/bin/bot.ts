#!/usr/bin/env -S node --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The reference bot in one seat. It picks up wherever its `Account` is (a search, a reveal due,
 * a match, a suspension) and plays `--games` from there. Lines it prints for a fleet parent:
 * `result {...}` per finished game, `rpc {...}` with its request counts each minute. A busy node
 * never ends it; a lasting error does, said on stderr as `stopped: <code>: <reason>`, after it
 * cancels a search it would leave behind. SIGTERM or SIGINT stops it once the game in progress
 * is over; a second one exits at once.
 */

import { parseArgs } from "node:util";

import { playGames } from "../agent.ts";
import { referencePolicy } from "../bot.ts";
import { agentFromEnv, playModeFrom } from "../config.ts";
import { isTransient, statsLine } from "../rpc.ts";
import { ActionError } from "../types.ts";

const { values } = parseArgs({
    options: {
        games: { type: "string", default: "1" },
        name: { type: "string" },
        /** `ranked`, `stakes`; the environment's `GHOSTS_MODE` otherwise. */
        mode: { type: "string" },
        size: { type: "string" },
        /** Seconds a search may go unanswered before the bot stops. */
        patience: { type: "string" },
    },
});

const at = () => new Date().toISOString();
const agent = agentFromEnv();
if (values.mode) {
    const sized = values.mode === "ranked" && values.size;
    agent.mode = playModeFrom(sized ? `ranked:${values.size}` : values.mode);
}
// squads only once they are public: matched in the clear, or revealed
agent.onRanked = (event) => console.log("ranked", JSON.stringify({ at: at(), ...event }));

let stopping = false;
let signals = 0;
const onSignal = (name: string) => {
    signals++;
    stopping = true;
    console.error(`${at()} ${name}: stopping after the game in progress`);
    if (signals > 1) process.exit(130);
};
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));
// a stray rejection from a busy node is logged, never the end of the seat
process.on("unhandledRejection", (error) => {
    console.error(`${at()} unhandled ${isTransient(error) ? "transient " : ""}rejection: ${(error as Error)?.message ?? error}`);
    if (!isTransient(error)) process.exit(1);
});

const counts = setInterval(() => console.log("rpc", JSON.stringify(statsLine())), 60_000);
let lastPhase: string | null = null;

try {
    const { results } = await playGames(agent, referencePolicy, {
        games: Number(values.games),
        name: values.name,
        patienceMs: values.patience ? Number(values.patience) * 1000 : undefined,
        keepQueueing: () => !stopping,
        onResult: ({ game, result, ending }) =>
            console.log("result", JSON.stringify({ at: at(), game, result: result ?? "unknown", ending })),
        onTransient: ({ error, inMatch, failures, delayMs }) =>
            console.error(
                `${at()} transient (${inMatch ? "in a match" : "between games"}, ${failures} in a row, ` +
                    `again in ${Math.round(delayMs / 100) / 10} s): ${(error as Error).message?.slice(0, 200)}`,
            ),
        onEvent: ({ situation, receipt }) => {
            if (receipt) console.log(situation.phase, receipt.records.map((r) => r.kind).join(" "));
            else if (situation.phase === "game_over") {
                const { game, result, ending } = situation;
                console.log("game_over", JSON.stringify({ game, result, ending }));
            } else if (situation.phase !== lastPhase && situation.phase === "suspended") {
                console.log("suspended", JSON.stringify({ at: at(), until: new Date(situation.suspendedUntilMs ?? 0).toISOString() }));
            }
            lastPhase = situation.phase;
        },
    });
    console.log("rpc", JSON.stringify(statsLine()));
    console.log(JSON.stringify({ results, status: await agent.status().catch(() => null) }));
    clearInterval(counts);
} catch (error) {
    clearInterval(counts);
    const code = error instanceof ActionError ? error.code : isTransient(error) ? "transient" : "error";
    console.log("rpc", JSON.stringify(statsLine()));
    // a search left behind would pair someone with a seat nobody plays
    try {
        const role = await agent.backend.searchRole();
        if (role?.kind === "queued") {
            await agent.cancelSearch();
            console.error(`${at()} cancelled the search before stopping`);
        }
    } catch (cleanup) {
        console.error(`${at()} could not cancel the search: ${(cleanup as Error).message}`);
    }
    console.error(`${at()} stopped: ${code}: ${(error as Error).message ?? error}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exit(1);
}
process.exit(0);
