#!/usr/bin/env -S node --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { parseArgs } from "node:util";

import { playGames } from "../agent.ts";
import { referencePolicy } from "../bot.ts";
import { agentFromEnv } from "../config.ts";

const { values } = parseArgs({
    options: { games: { type: "string", default: "1" }, name: { type: "string" } },
});

const agent = agentFromEnv();
const { results } = await playGames(agent, referencePolicy, {
    games: Number(values.games),
    name: values.name,
    onEvent: ({ situation, receipt }) => {
        if (receipt) console.log(situation.phase, receipt.records.map((r) => r.kind).join(" "));
    },
});
console.log(JSON.stringify({ results, status: await agent.status() }));
