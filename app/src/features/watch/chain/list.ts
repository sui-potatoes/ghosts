// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The watch screen's lists as plain data: which shared games count as live
 * (not over, not abandoned at the table, not from an invite), what a live row,
 * a finished game of anyone's and one of the player's own say, and whether a
 * game is watched live or as a replay. No React, no client: tested in
 * `tests/watch-chain.test.ts` and `tests/watch-recent.test.ts`.
 */

import type { ChainGame } from "../../../chain/bcs.ts";
import type { GameEnding } from "../../../chain/ending.ts";
import {
    activeSide,
    deployUntil,
    friendlySize,
    isOver,
    rankedOf,
    turnStartedAt,
} from "../../../chain/match-rules.ts";
import {
    CREATION_CALLS,
    STALE_DEPLOYING_MS,
    STALE_PLAYING_MS,
} from "../../../chain/watch-layout.ts";
import { TIERS } from "../../play/economy/index.ts";
import { kindOf, reasonOf } from "./phrases.ts";
import type { RecentGame } from "./recent.ts";

/** A game nobody is playing any more, or one waiting only to be wrapped up: off the live list. */
export function offTheList(game: ChainGame, now: number): boolean {
    if (isOver(game)) return true;
    if (game.state.$kind === "Deploying") return now - deployUntil(game) > STALE_DEPLOYING_MS;
    return now - turnStartedAt(game) > STALE_PLAYING_MS;
}

/** A friendly game is listed only when it came from a listed lobby; which one, its creating transaction says. */
export const needsCreationCheck = (game: Pick<ChainGame, "mode">) => friendlySize(game) !== null;

/**
 * Whether a game's creating transaction makes it public: a queue game (contract or
 * ranked), or a friendly one from a listed lobby; one from an invite code is not, and
 * neither is a transaction that creates nothing the viewer knows.
 */
export function listedBy(calls: readonly string[]): boolean {
    const created = calls.filter((call) => call in CREATION_CALLS);
    return created.length > 0 && created.every((call) => CREATION_CALLS[call]);
}

/** A player as a row shows them. */
export interface PlayerLine {
    name: string;
    rating: number | null;
}

/** What the player's own HUD calls the turn in play: both sides' goes in a round share it. */
export const roundOf = (game: Pick<ChainGame, "turn">) => Math.floor(game.turn / 2);

const two = (n: number) => String(n).padStart(2, "0");

/** A tier's name by its index in the rules; a tier this build does not know by its number. */
export const tierName = (tier: number) => TIERS[tier]?.name ?? `Rank ${tier + 1}`;

/**
 * A game's mode in words: "Ranked 3x3 · Contractor" (squad size a side, and the tier
 * it was played at), "Friendly 3x3", or "Contract" (owned recruits from the queue).
 */
export function modeText(game: Pick<ChainGame, "mode">): string {
    const ranked = rankedOf(game);
    if (ranked) return `Ranked ${ranked.size}x${ranked.size} · ${tierName(ranked.tier)}`;
    const size = friendlySize(game);
    return size === null ? "Contract" : `Friendly ${size}x${size}`;
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

/** Who is named in an ending, by side: null for an account that is neither player. */
const sideIn = (players: readonly string[], account: string) => {
    const at = players.indexOf(account);
    return at === 0 || at === 1 ? at : null;
};

/**
 * How a finished game ended, for anyone: a short tag (who won, "Draw" or "No winner") and
 * the line that says why, in plain words, with the players' names (`names` by side). The
 * words are the viewer's too (`phrases.ts`).
 */
export function endingText(
    ending: GameEnding | null,
    players: readonly string[],
    names: readonly [string, string],
): { tag: string; line: string } {
    if (!ending) return { tag: "No result", line: "The ending was not recorded" };
    const name = (account: string) => {
        const side = sideIn(players, account);
        return side === null ? "A player" : names[side];
    };
    const other = (account: string) => {
        const side = sideIn(players, account);
        return side === null ? "The other player" : names[1 - side];
    };
    const kind = kindOf(ending);
    switch (ending.$kind) {
        case "Won":
            return { tag: `${name(ending.Won)} won`, line: reasonOf(kind) };
        case "Draw":
        case "Stalemate":
            return { tag: "Draw", line: reasonOf(kind) };
        case "NobodyShowed":
            return { tag: "No winner", line: reasonOf(kind) };
        case "Abandoned":
            return {
                tag: `${other(ending.Abandoned)} won`,
                line: reasonOf(kind, name(ending.Abandoned)),
            };
        case "Forfeited":
            return {
                tag: `${other(ending.Forfeited)} won`,
                line: reasonOf(kind, name(ending.Forfeited)),
            };
        case "NoShow":
            return {
                tag: `${other(ending.NoShow)} won`,
                line: reasonOf(kind, name(ending.NoShow)),
            };
    }
}

/** How long ago something happened, in words: "Just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoText(at: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - at) / 60_000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** A recent game as a row: both players, the mode, how it ended and how long ago. */
export interface RecentRow {
    id: string;
    name: string;
    kind: string;
    tag: string;
    hint: string;
}

/** A recent game as its row says it, with the players' names and when it ended. */
export function recentRow(
    game: Pick<RecentGame, "gameId" | "players" | "mode" | "ending">,
    names: readonly [string, string],
    endedAt: number | undefined,
    now: number,
): RecentRow {
    const ended = endingText(game.ending, game.players, names);
    const mode = modeText(game);
    const ago = endedAt === undefined ? null : agoText(endedAt, now);
    const how = `${ended.tag} · ${ended.line}`;
    return {
        id: game.gameId,
        name: `${names[0]} vs ${names[1]}`,
        kind: `${mode} · ${how}`,
        tag: ago ?? ended.tag,
        hint: [ended.tag, ended.line, ago].filter(Boolean).join(" · "),
    };
}

/** Whether a game is opened live (it still exists) or as a replay. */
export type Opening = "live" | "replay";

/** A read of the game decides: still there, live; deleted, its replay. */
export const openingOf = (current: ChainGame | null): Opening => (current ? "live" : "replay");

/** Whether a path segment is a game id: a 32-byte hex address. */
export const isGameId = (id: string | undefined): id is string =>
    !!id && /^0x[0-9a-fA-F]{64}$/.test(id);
