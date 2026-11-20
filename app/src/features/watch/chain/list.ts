// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The watch screen's lists as plain data: which shared games count as live
 * (not over, not abandoned at the table, not from an invite), what a live row
 * and a finished-game row say, and whether a game is watched live or as a
 * replay. No React, no client: tested in `tests/watch-chain.test.ts`.
 */

import type { ChainGame } from "../../../chain/bcs.ts";
import type { GameEnding } from "../../../chain/ending.ts";
import {
    activeSide,
    deployUntil,
    friendlySize,
    isOver,
    turnStartedAt,
} from "../../../chain/match-rules.ts";
import { CALLS, STALE_DEPLOYING_MS, STALE_PLAYING_MS } from "../../../chain/watch-layout.ts";

/** A game nobody is playing any more, or one waiting only to be wrapped up: off the live list. */
export function offTheList(game: ChainGame, now: number): boolean {
    if (isOver(game)) return true;
    if (game.state.$kind === "Deploying") return now - deployUntil(game) > STALE_DEPLOYING_MS;
    return now - turnStartedAt(game) > STALE_PLAYING_MS;
}

/** A friendly game is listed only when it came from a listed lobby; which one, its creating transaction says. */
export const needsCreationCheck = (game: ChainGame) => friendlySize(game) !== null;

/** Whether a game's creating transaction makes it public: a rated game, or a friendly one from a listed lobby. */
export function listedBy(calls: readonly string[]): boolean {
    if (calls.includes(CALLS.joinProtected)) return false;
    return calls.includes(CALLS.startListed) || calls.includes(CALLS.findGame);
}

/** A player as a row shows them. */
export interface PlayerLine {
    name: string;
    rating: number | null;
}

/** What the player's own HUD calls the turn in play: both sides' goes in a round share it. */
export const roundOf = (game: Pick<ChainGame, "turn">) => Math.floor(game.turn / 2);

const two = (n: number) => String(n).padStart(2, "0");

/** A game's mode in words: rated, or friendly with its squad size. */
export function modeText(game: Pick<ChainGame, "mode">): string {
    const size = friendlySize(game);
    return size === null ? "Rated" : `Friendly · ${size} a side`;
}

export interface LiveRow {
    id: string;
    name: string;
    kind: string;
    hint: string;
    tag: string;
}

/** A live game's row: both players, the mode, the turn and whose it is. */
export function liveRow(
    id: string,
    game: ChainGame,
    players: readonly [PlayerLine, PlayerLine],
): LiveRow {
    const [a, b] = players;
    const deploying = game.state.$kind === "Deploying";
    const where = deploying
        ? "Deploying squads"
        : `Turn ${two(roundOf(game))} · ${players[activeSide(game)]?.name ?? "A player"} to move`;
    const rating = (p: PlayerLine) =>
        p.rating === null ? `${p.name}, no rating` : `${p.name} rating ${p.rating}`;
    return {
        id,
        name: `${a.name} vs ${b.name}`,
        kind: `${modeText(game)} · ${where}`,
        hint: `${rating(a)} · ${rating(b)}`,
        tag: deploying ? "Starting" : "Live",
    };
}

/** How a finished game ended for the player who asks (side `side`), in a word. */
export function resultFor(
    ending: GameEnding | null,
    players: readonly string[],
    side: number,
): string {
    if (!ending) return "Ended";
    const me = players[side];
    switch (ending.$kind) {
        case "Won":
            return ending.Won === me ? "Won" : "Lost";
        case "Draw":
        case "Stalemate":
            return "Draw";
        case "Abandoned":
            return ending.Abandoned === me ? "Left" : "Won";
        case "Forfeited":
            return ending.Forfeited === me ? "Forfeited" : "Won";
        case "NoShow":
            return ending.NoShow === me ? "No show" : "Won";
        case "NobodyShowed":
            return "No show";
    }
}

/** Whether a game is opened live (it still exists) or as a replay. */
export type Opening = "live" | "replay";

/** A read of the game decides: still there, live; deleted, its replay. */
export const openingOf = (current: ChainGame | null): Opening => (current ? "live" : "replay");

/** Whether a path segment is a game id: a 32-byte hex address. */
export const isGameId = (id: string | undefined): id is string =>
    !!id && /^0x[0-9a-fA-F]{64}$/.test(id);
