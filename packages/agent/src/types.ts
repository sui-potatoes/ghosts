// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The plain view of the game the SDK, the rules and the MCP tools share. */

export interface Stats {
    mobility: number;
    aim: number;
    health: number;
    armor: number;
    dodge: number;
    defense: number;
    damage: number;
    spread: number;
    plusOne: number;
    critChance: number;
    canBeDodged: number;
    areaSize: number;
    envDamage: number;
    range: number;
    ammo: number;
}

/** Cover sides hold 0 (none), 1 (low) or 2 (high). */
export type Tile =
    | { kind: "empty" | "unwalkable" | "wall" }
    | { kind: "cover"; left: number; top: number; right: number; bottom: number };

/** `x` is the row and `y` the column, as in Move. */
export interface Unit {
    recruit: string;
    side: number;
    x: number;
    y: number;
    /** Usable AP this turn: Move resets AP lazily, so this is already normalized. */
    ap: number;
    apMax: number;
    hp: number;
    hpMax: number;
    ammo: number;
    ammoMax: number;
    grenadeUsed: boolean;
    stats: Stats;
}

export type GameStatus =
    { kind: "deploying" } | { kind: "active" } | { kind: "finished"; winner: string | null };

export interface GameState {
    id: string;
    /** Object version: a state at one version never changes, so it can be cached forever. */
    version: string;
    rows: number;
    cols: number;
    turn: number;
    /** Index into `players` of the side that acts now: the turn, modulo the players. */
    active: number;
    /** `Account` ids, in turn order; the index is the player's side. */
    players: string[];
    /** Recruit ids each side has on the map; the fallen are taken out. */
    squads: string[][];
    /** How many recruits each side has lost. */
    fallen: number[];
    /** Spawn positions each side has left, used from the back. Sets the squad size. */
    positions: number[][][];
    /** Everything that happened, in order. This is the only record: there are no events. */
    history: GameRecord[];
    /** Turns each side let run out in a row. Three lose the game. */
    missed: number[];
    /** The `Account` that gave up or missed too many turns. */
    abandonedBy: string | null;
    /** When deployment or the current turn runs out. */
    deadlineMs: number;
    status: GameStatus;
    tiles: Tile[][];
    units: Unit[];
}

export type Search =
    | { kind: "idle" }
    | { kind: "searching"; order: string; sinceMs: number }
    | { kind: "found"; order: string; opponent: string }
    | { kind: "playing"; game: string };

export interface AccountView {
    id: string;
    owner: string;
    rating: number;
    deviation: number;
    score: { wins: number; losses: number; draws: number };
    recruits: number;
    search: Search;
    /** The account can't search for a game before this time, after misbehaving. */
    suspendedUntilMs: number;
    /** The wallet that can take this account over, if the owner named one. */
    recovery: string | null;
}

/** What one order resolved into: the decoded `ghosts::history::Record`s. */
export type GameRecord =
    | { kind: "reload"; x: number; y: number }
    | { kind: "next_turn"; turn: number }
    | { kind: "move"; path: number[] }
    | { kind: "attack"; from: number[]; to: number[] }
    | { kind: "placed"; x: number; y: number }
    | { kind: "damage"; amount: number }
    | { kind: "miss" }
    | { kind: "explosion"; x: number; y: number; radius: number }
    | { kind: "critical_hit"; amount: number }
    | { kind: "grenade"; from: number[]; to: number[] }
    | { kind: "kia"; recruit: string }
    | { kind: "dodged" };

export interface Receipt {
    digest: string;
    /** Net gas paid, in MIST: a string so results stay plain JSON. */
    gasMist: string;
    records: GameRecord[];
}

export type Action =
    /** `recruits` are filled in by the backend, which knows the account's squad. */
    | { kind: "deploy"; recruits?: string[] }
    | { kind: "move"; x: number; y: number; path: number[] }
    | { kind: "reload"; x: number; y: number }
    | { kind: "attack"; x: number; y: number; tx: number; ty: number }
    | { kind: "grenade"; x: number; y: number; tx: number; ty: number }
    | { kind: "next_turn" }
    /** Wrap up a finished game. Anyone can, so the opponent may get there first. */
    | { kind: "complete" }
    /** Give up: the opponent wins and the account is suspended for an hour. Completes the game. */
    | { kind: "abandon" };

export type ActionErrorCode =
    | "bad_action"
    | "illegal_action"
    | "no_game"
    | "no_account"
    | "not_aliased"
    | "no_name"
    | "bad_name"
    | "name_taken"
    | "over_budget"
    | "low_balance"
    | "rejected"
    | "congested";

/** A refusal an agent can read and react to; `retryable` says trying again may work. */
export class ActionError extends Error {
    code: ActionErrorCode;
    retryable: boolean;

    constructor(code: ActionErrorCode, message: string, retryable = false) {
        super(message);
        this.name = "ActionError";
        this.code = code;
        this.retryable = retryable;
    }
}
