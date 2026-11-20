#!/usr/bin/env -S node --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { parseArgs } from "node:util";

import { playGames } from "../agent.ts";
import { referencePolicy } from "../bot.ts";
import { agentFromEnv, playModeFrom } from "../config.ts";

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

const agent = agentFromEnv();
if (values.mode) {
    const sized = values.mode === "ranked" && values.size;
    agent.mode = playModeFrom(sized ? `ranked:${values.size}` : values.mode);
}
// squads only once they are public: matched in the clear, or revealed
agent.onRanked = (event) =>
    console.log("ranked", JSON.stringify({ at: new Date().toISOString(), ...event }));
const { results } = await playGames(agent, referencePolicy, {
    games: Number(values.games),
    name: values.name,
    patienceMs: values.patience ? Number(values.patience) * 1000 : undefined,
    onEvent: ({ situation, receipt }) => {
        if (receipt) console.log(situation.phase, receipt.records.map((r) => r.kind).join(" "));
        else if (situation.phase === "game_over") {
            const { game, result, ending } = situation;
            console.log("game_over", JSON.stringify({ game, result, ending }));
        }
    },
});
console.log(JSON.stringify({ results, status: await agent.status() }));
