// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA fixtures for the watch screen (`VITE_WATCH_QA=1` builds only): the Recent
 * games panel filled from made-up finished games instead of the network, by
 * `/watch?recent=<state>`: `rows` (60 games: 25 at first, More extends to 50),
 * `few` (6, no More), `empty`, `error`. The rows go through the real row copy
 * (`recentRow`). Their game ids lead nowhere, so opening one shows the plain
 * line of a replay that can no longer be loaded. Plain TypeScript.
 */

import type { ChainMode } from "../../chain/bcs.ts";
import type { GameEnding } from "../../chain/ending.ts";
import { recentRow, type RecentRow } from "./chain/list.ts";
import { RECENT_CAP } from "./chain/recent.ts";

export type RecentQaState = "rows" | "few" | "empty" | "error";

/** The QA state asked for in a search string; null for none. */
export function recentQaState(search: string): RecentQaState | null {
    const value = new URLSearchParams(search).get("recent");
    return value === "rows" || value === "few" || value === "empty" || value === "error"
        ? value
        : null;
}

const CALLSIGNS = ["Vex", "Halden", "Corder", "Mori", "Okafor", "Lind", "Sable", "Quill"];
const MODES: ChainMode[] = [
    { $kind: "Ranked", Ranked: { size: 3, tier: 1 } } as ChainMode,
    { $kind: "Friendly", Friendly: { size: 4 } } as ChainMode,
    { $kind: "Stakes", Stakes: true } as ChainMode,
    { $kind: "Ranked", Ranked: { size: 4, tier: 3 } } as ChainMode,
    { $kind: "Ranked", Ranked: { size: 2, tier: 0 } } as ChainMode,
];

const hex = (n: number, fill: string) => `0x${n.toString(16).padStart(4, "0")}${fill.repeat(60)}`;

function endingFor(i: number, players: [string, string]): GameEnding {
    const [a, b] = players;
    switch (i % 7) {
        case 0:
        case 3:
            return { $kind: "Won", Won: a } as GameEnding;
        case 1:
            return { $kind: "Won", Won: b } as GameEnding;
        case 2:
            return { $kind: "Abandoned", Abandoned: b } as GameEnding;
        case 4:
            return { $kind: "Forfeited", Forfeited: a } as GameEnding;
        case 5:
            return { $kind: "Stalemate", Stalemate: true } as GameEnding;
        default:
            return { $kind: "NoShow", NoShow: b } as GameEnding;
    }
}

/** The fixture rows for a state, at most `limit`, newest first, as of `now`. */
export function recentQaRows(
    state: RecentQaState,
    limit: number,
    now: number,
): { rows: RecentRow[]; more: boolean } {
    const total = state === "rows" ? 60 : state === "few" ? 6 : 0;
    const shown = Math.min(total, limit, RECENT_CAP);
    const rows = Array.from({ length: shown }, (_, i) => {
        const players: [string, string] = [hex(i * 2, "a"), hex(i * 2 + 1, "b")];
        const names: [string, string] = [
            CALLSIGNS[i % CALLSIGNS.length],
            CALLSIGNS[(i * 3 + 1) % CALLSIGNS.length],
        ];
        return recentRow(
            {
                gameId: hex(i, "e"),
                players,
                mode: MODES[i % MODES.length],
                ending: endingFor(i, players),
            },
            names,
            now - (i * i * 7 + i * 3) * 60_000,
            now,
        );
    });
    return { rows, more: total > shown };
}
