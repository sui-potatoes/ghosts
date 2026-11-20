// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * How a match's ending reads, said once: the plain-words reason and the title
 * for each ending the contract has. The replay card, the result banner, the
 * scene's last line and the Recent and My matches rows all take their words from
 * here, so an ending reads the same everywhere. No React, no client: tested in
 * `tests/watch-chain.test.ts`.
 */

import type { WatchOutcome } from "@ghosts/engine";

import type { GameEnding } from "../../../chain/ending.ts";

/** The endings, as the viewer tells them apart (`ghosts::Ending`; "won" is a win on the field). */
export type EndingKind =
    "won" | "draw" | "stalemate" | "abandoned" | "forfeited" | "no-show" | "nobody-showed";

/** An outcome as the viewer builds it: the engine's, and which ending it was. */
export type EndingOutcome = WatchOutcome & { kind?: EndingKind };

/** The turns in a row a side may miss: `MAX_MISSED_TURNS` in `ghosts::ghosts`. */
export const MISS_LIMIT = 3;

/** How a match is won on the field. */
export const ELIMINATION = "by elimination";

/** The reason a match ended, in plain words; `who` is the side at fault, where one is. */
export function reasonOf(kind: EndingKind, who = "A player"): string {
    switch (kind) {
        case "won":
            return ELIMINATION;
        case "draw":
            return "Both squads fell";
        case "stalemate":
            return "Turn limit reached";
        case "abandoned":
            return `${who} left the match`;
        case "forfeited":
            return `${who} missed ${MISS_LIMIT} turns in a row`;
        case "no-show":
            return `${who} did not deploy in time`;
        case "nobody-showed":
            return "Neither side deployed";
    }
}

/**
 * What the scene says last, for an ending that leaves units standing: the match
 * was not settled on the field. None for the rest.
 */
export const VERDICT: Partial<Record<EndingKind, string>> = {
    forfeited: "Match forfeited",
    abandoned: "Match abandoned",
    stalemate: "Match drawn",
};

/** The ending a contract `Ending` is. */
export function kindOf(ending: GameEnding): EndingKind {
    switch (ending.$kind) {
        case "Won":
            return "won";
        case "Draw":
            return "draw";
        case "Stalemate":
            return "stalemate";
        case "Abandoned":
            return "abandoned";
        case "Forfeited":
            return "forfeited";
        case "NoShow":
            return "no-show";
        case "NobodyShowed":
            return "nobody-showed";
    }
}

/** What the title says when nobody won. */
export const noWinner = (kind: EndingKind | undefined) =>
    kind === "draw" || kind === "stalemate" ? "Draw" : "No winner";

/** The ending of an outcome, when it says which; undefined for a win the field decided. */
export const endingKindOf = (outcome: WatchOutcome | null): EndingKind | undefined =>
    (outcome as EndingOutcome | null)?.kind;
