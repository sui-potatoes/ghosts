// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly matches, the pure part: the invite code's text (from the chain
 * layer, `src/chain/lobby-core.ts`), the share link, the sizes a lobby offers on
 * the current level, why the player cannot open or join a game right now, and
 * the shapes the screen draws. No React, no storage, no clock; tested in
 * `tests/play-friendly.test.ts`.
 */

export {
    CODE_ALPHABET,
    CODE_LENGTH,
    formatCode,
    LOBBY_LIFETIME_MS,
    parseCode,
    timeLeft,
    typingProblem,
} from "../../../chain/lobby-core.ts";
import { formatCode } from "../../../chain/lobby-core.ts";

export const FRIENDLY_ROUTE = "/play/friendly";

/** The link that opens the join field with the code filled in. */
export function shareLink(code: string, origin: string): string {
    return `${origin}${FRIENDLY_ROUTE}?code=${formatCode(code)}`;
}

/** The code in a location's query string, or null. */
export function linkCode(search: string): string | null {
    const value = new URLSearchParams(search).get("code");
    return value === null || value === "" ? null : value;
}

/** The sizes a lobby can have (`MIN_SIZE`, `MAX_SIZE` in `ghosts::lobby`): the most recruits each side deploys. */
export const SIZES = [3, 4] as const;
export type Size = (typeof SIZES)[number];

/** `3 x 3`. */
export const sizeLabel = (size: number): string => `${size} x ${size}`;

/**
 * Why a size cannot be opened on the level games start on, null when it can:
 * a side deploys at most as many recruits as the level has spawn positions for
 * it, so a lobby larger than that would play smaller than it says.
 */
export function sizeBlock(size: number, presetSide: number | null): string | null {
    if (presetSide === null) return size > 3 ? "No 4x4 level yet" : null;
    return size > presetSide ? `No ${size}x${size} level yet` : null;
}

/** What stands between the player and a friendly game, and the one thing that helps. */
export type Gate = {
    reason: string;
    action?: { id: "sign-in" | "resume" | "queue" | "headquarters"; label: string };
};

export type GateInput = {
    signedIn: boolean;
    /** The account and its recruits are still being read. */
    loading: boolean;
    /** An `Account` is on file for the address. */
    hasAccount: boolean;
    /** Recruits at home. */
    recruits: number;
    /** In a game (or a seat waits in one). */
    playing: boolean;
    /** Searching a queue: ranked, or the contract queue. */
    queued: boolean;
    /** Whole minutes of a suspension left; 0 when none. */
    suspendedMin: number;
};

/** Null when the player may open or join a friendly game: free, with a squad. */
export function gateOf(s: GateInput): Gate | null {
    if (!s.signedIn)
        return { reason: "Sign in to play", action: { id: "sign-in", label: "Sign in" } };
    if (s.loading) return { reason: "Reading your squad" };
    if (s.playing)
        return { reason: "You are in a match", action: { id: "resume", label: "Resume match" } };
    if (s.queued)
        return {
            reason: "Cancel your search first",
            action: { id: "queue", label: "Open search" },
        };
    if (s.suspendedMin > 0) return { reason: `Suspended for ${s.suspendedMin} min` };
    if (!s.hasAccount || s.recruits === 0)
        return {
            reason: "Hire a squad first",
            action: { id: "headquarters", label: "Headquarters" },
        };
    return null;
}

/** A player as a lobby shows them; a name or rating not read yet is null. */
export type Person = { name: string | null; rating: number | null };

/** "kestrel · Rating 1520", as far as it is known. */
export function personLine(p: Person): string {
    const name = p.name ?? "Unnamed";
    return p.rating === null ? name : `${name} · Rating ${p.rating}`;
}

/** The lobby the player is in, as the screen draws it. */
export type LobbyState =
    | {
          kind: "host";
          /** Listed in Open games, or invite only. */
          listed: boolean;
          size: number;
          /** When the host opened it: the lifetime runs from here. */
          sinceMs: number;
          /** The invite code's text, on the device that opened it; null elsewhere and for a listed game. */
          code: string | null;
          guest: (Person & { id: string }) | null;
      }
    | {
          kind: "guest";
          size: number;
          /** The host's `since`, once read. */
          sinceMs: number | null;
          host: Person;
      };

/** A listed game on the open list. */
export type OpenGame = {
    hostId: string;
    /** The host's address, for their name. */
    owner: string;
    rating: number;
    size: number;
    sinceMs: number;
    full: boolean;
    /** The host removed this player from it: they cannot join it again. */
    removed?: boolean;
};

/** Why the host cannot start yet, null when Start can run. */
export function startBlock(lobby: LobbyState, now: number, lifetimeMs: number): string | null {
    if (lobby.kind !== "host") return "Only the host starts the match";
    if (now - lobby.sinceMs > lifetimeMs) return "This game has expired";
    if (!lobby.listed) return "The match starts when your friend joins";
    if (!lobby.guest) return "Nobody has joined yet";
    return null;
}

/** Why a listed game cannot be joined, null when it can. */
export function joinBlock(
    game: OpenGame,
    gate: Gate | null,
    presetSide: number | null,
): string | null {
    if (gate) return gate.reason;
    if (game.removed) return "The host removed you from this game";
    if (game.full) return "This game is full";
    return sizeBlock(game.size, presetSide);
}

/** A lobby write in flight: what the player pressed, and for a listed game which one. */
export type Pending = {
    what: "host" | "join" | "leave" | "kick" | "start" | "close";
    /** The listed game being joined (its host's `Account` ID). */
    id?: string;
};

/** What the pressed row or button says while its write is on its way. */
export const DOING: Record<Pending["what"], string> = {
    host: "Opening game",
    join: "Joining",
    leave: "Leaving",
    kick: "Removing guest",
    start: "Starting match",
    close: "Closing game",
};

/**
 * Why a row cannot be pressed while a lobby write is in flight, undefined when it can: the
 * pressed one says what it is doing, every other waits for it, so nothing is sent twice.
 */
export function writeBlock(
    pending: Pending | null,
    busy: boolean,
    what: Pending["what"],
    id?: string,
): string | undefined {
    if (pending && pending.what === what && pending.id === id) return DOING[what];
    return pending || busy ? "Saving a change" : undefined;
}

/** A notice about a game the player was in: what to say, and the game's host. */
export type Notice = { line: string; host: string; at: number };

/**
 * Whether a notice is out of date: the open list was read after it was raised and the game it
 * names is no longer on it. A removed player's game stays listed, and its notice with it.
 */
export function noticeStale(
    notice: Notice,
    list: { at: number; hosts: readonly string[] } | null,
): boolean {
    return !!list && list.at > notice.at && !list.hosts.includes(notice.host);
}
