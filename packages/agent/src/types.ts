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

/**
 * Cover sides hold 0 (none), 1 (low) or 2 (high). An `obstacle` is a prop: low cover on every side,
 * passed over but never stood on.
 */
export type Tile =
    | { kind: "empty" | "unwalkable" | "wall" | "obstacle" }
    | { kind: "cover"; left: number; top: number; right: number; bottom: number };

/**
 * What a unit may be ordered to do: `ghosts::action::ActionKind`, as the `kind` of the order.
 * `grenade` is the frag grenade; the flashbang and the smoke grenade have actions of their own.
 */
export type UnitAction =
    | "move"
    | "attack"
    | "reload"
    | "grenade"
    | "flashbang"
    | "smoke_grenade";

/** `ghosts::effect`: `daze` takes all the aim; `smoke` takes 30 aim and gives 30 defense. */
export type EffectKind = "daze" | "smoke";

/** A status effect on a unit (`ghosts::effect::Effect`): its kind and the turn changes left. */
export interface UnitEffect {
    kind: EffectKind;
    turns: number;
}

/**
 * An action a unit has (`ghosts::action::Action`): its kind and how many times it may still be
 * performed this match, `null` for unlimited.
 */
export interface UnitActionEntry {
    kind: UnitAction;
    uses: number | null;
}

/** `x` is the row and `y` the column, as in Move. */
export interface Unit {
    recruit: string;
    /** The `Account` the recruit fights for: `Unit.owner`, one of the game's `players`. */
    owner: string;
    side: number;
    x: number;
    y: number;
    /** AP left this turn: `next_turn` gives a side its units' AP back as its turn begins. */
    ap: number;
    apMax: number;
    hp: number;
    hpMax: number;
    ammo: number;
    ammoMax: number;
    stats: Stats;
    /**
     * The orders the unit may be given, in this order: `move`, the weapon's `attack` and `reload`,
     * then those of its utilities (a `grenade`), each with its uses left. Two of a kind are two
     * entries with their own counts.
     */
    actions: UnitActionEntry[];
    /**
     * Status effects, at most one of each kind, in the order the unit got them. `stats` stay the
     * base: `effectiveStats` has what counts in a shot.
     */
    effects: UnitEffect[];
}

/**
 * How a game ended: `ghosts::ghosts::Ending`. `by` is the `Account` it is pinned on
 * (`abandoned`, `forfeited`, `no_show`) or the winner (`won`); none for the rest.
 */
export type Ending =
    | { kind: "won"; by: string }
    | { kind: "draw" | "stalemate" | "nobody_showed"; by: null }
    | { kind: "abandoned" | "forfeited" | "no_show"; by: string };

/** `ghosts::ghosts::State`: `deploying`, `active` (Playing) or `finished` (Over). */
export type GameStatus =
    | { kind: "deploying" }
    | { kind: "active" }
    | { kind: "finished"; winner: string | null; ending: Ending };

/**
 * `ghosts::ghosts::Mode`. `stakes`: the stakes queue over owned recruits, unrated, with XP, death
 * and suspension. `friendly`: a lobby game of `size` that deploys 1 to `size` recruits a side and
 * moves no rating, score, suspension, XP or recruit: the fallen are home again at `complete`.
 * `ranked`: the ranked queue of `size`, between players of `tier`, squads built from loadouts
 * (no recruit in it); the only mode that moves rating and score.
 */
export type GameMode =
    | { kind: "stakes" }
    | { kind: "friendly"; size: number }
    | { kind: "ranked"; size: number; tier: number };

export interface GameState {
    id: string;
    /** Object version: a state at one version never changes, so it can be cached forever. */
    version: string;
    /**
     * The level the game is played on: its `Preset`'s ID, which the map keeps as `Map.id`
     * (`levelMap` in `maps.ts` names the known ones). Absent in a state built by hand.
     */
    level?: string;
    rows: number;
    cols: number;
    turn: number;
    /** Index into `players` of the side that acts now: the turn, modulo the players. */
    active: number;
    /** `Account` ids, in turn order; the index is the player's side. */
    players: string[];
    /** Recruit ids each side has on the map, from the units' owners; the fallen are off it. */
    squads: string[][];
    /**
     * Recruits killed since the last turn change, off their tiles but not yet buried
     * (`Map.fallen`). A kill never frees storage in the call that rolled it.
     */
    fallen: string[];
    /** Spawn positions each side has left, used from the back. Sets the squad size. */
    positions: number[][][];
    /** Everything that happened, in order. This is the only record: there are no events. */
    history: GameRecord[];
    /** Turns each side let run out in a row, from `State::Playing`. Three lose the game. */
    missed: number[];
    /** The `Account` the ending is pinned on (abandoned, forfeited or never deployed). */
    abandonedBy: string | null;
    /** When deployment or the current turn runs out; 0 once the game is over. */
    deadlineMs: number;
    status: GameStatus;
    mode: GameMode;
    tiles: Tile[][];
    units: Unit[];
}

/**
 * `ghosts::account::State`. A search a match found stays `searching` until its `Seat` is taken,
 * and one the queue dropped until its notice is dismissed. A suspension is a field of its own.
 */
export type Search =
    | { kind: "idle" }
    /**
     * `queue` is the `Matchmaker` (stakes, or ranked of a size) or the `Lobbies`; `order` a queue
     * ticket or a lobby's key (`classifySearch` in `lobby.ts` says which). A ranked search holds
     * the `commitment` to its squad, `blake2b256(squad ‖ salt)`.
     */
    | {
          kind: "searching";
          order: string;
          sinceMs: number;
          queue: string;
          commitment: string | null;
      }
    | { kind: "playing"; game: string };

export interface AccountView {
    id: string;
    owner: string;
    rating: number;
    deviation: number;
    /** Ranked games only: their sum is what the placement floor reads. */
    score: { wins: number; losses: number; draws: number };
    /** The games the Glicko rating counted, and when it last moved (0: never). */
    ratedGames: number;
    lastPlayedMs: number;
    recruits: number;
    search: Search;
    /** `Account.suspended_until`: the account can't start a game before this time. 0 if never. */
    suspendedUntilMs: number;
    /** How many times the rating was reset, and when it last was (0: never). */
    resets: number;
    lastResetMs: number;
    /** The wallet that can take this account over, if the owner named one. */
    recovery: string | null;
}

/** What one order resolved into: the decoded `ghosts::history::Record`s. A dodge is one record. */
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
    | { kind: "kia"; recruit: string; x: number; y: number }
    | { kind: "dodged" }
    | { kind: "flashbang"; from: number[]; to: number[] }
    | { kind: "smoke_grenade"; from: number[]; to: number[] }
    /** The unit on `(x, y)` has `effect`, with `turns` left: new, or refreshed to the longer. */
    | { kind: "effect_start"; x: number; y: number; effect: EffectKind; turns: number }
    /** The effect ran out on the unit on `(x, y)`. A dead unit's effects end without one. */
    | { kind: "effect_end"; x: number; y: number; effect: EffectKind };

/** `ghosts::ghosts::GameStarted`: a game was created; `players` in drawn turn order. */
export interface GameStartedEvent {
    game: string;
    players: string[];
    mode: GameMode;
    /** False only for an invite-only lobby's game. */
    listed: boolean;
}

/** `ghosts::ghosts::GameEnded`: a game was wrapped up and deleted, and how it ended. */
export interface GameEndedEvent {
    game: string;
    ending: Ending;
    /** The chain clock when it was wrapped up. */
    endedMs: number;
}

/** A `Matchmaker` as far as status needs it. */
export interface QueueView {
    id: string;
    /** Tickets in the queue, expired ones not yet dropped included. */
    waiting: number;
    ticketTtlMs: number;
    bucketSize: number;
    maxWindow: number;
}

export interface Receipt {
    digest: string;
    /** Net gas paid, in MIST: a string so results stay plain JSON. */
    gasMist: string;
    records: GameRecord[];
}

/** An object by reference, as `Receiving` takes it: at the version the account holds. */
export interface ObjectRef {
    objectId: string;
    version: string;
    digest: string;
}

export type Action =
    /** `recruits` are filled in by the backend, which knows what the account holds at home. */
    | { kind: "deploy"; recruits?: ObjectRef[] }
    | { kind: "move"; x: number; y: number; path: number[] }
    | { kind: "reload"; x: number; y: number }
    | { kind: "attack"; x: number; y: number; tx: number; ty: number }
    | { kind: "grenade"; x: number; y: number; tx: number; ty: number }
    | { kind: "flashbang"; x: number; y: number; tx: number; ty: number }
    | { kind: "smoke_grenade"; x: number; y: number; tx: number; ty: number }
    | { kind: "next_turn" }
    /** Wrap up a finished game. Anyone can, so the opponent may get there first. */
    | { kind: "complete" }
    /** Give up: the opponent wins and the account is suspended for a minute. Completes the game. */
    | { kind: "abandon" };

export type ActionErrorCode =
    | "bad_action"
    | "illegal_action"
    | "no_game"
    | "no_account"
    | "no_lobby"
    | "not_aliased"
    | "no_name"
    | "bad_name"
    | "name_taken"
    | "over_budget"
    | "low_balance"
    | "rejected"
    | "congested"
    /** Ranked: no valid squad, a missing secret to reveal with, or a deployment without `Rules`. */
    | "bad_squad"
    | "no_rules";

/** A refusal an agent can read and react to; `retryable` says trying again may work. */
export class ActionError extends Error {
    code: ActionErrorCode;
    retryable: boolean;
    /** The Move abort behind a refusal, when there was one: what callers branch on. */
    declare abort?: MoveAbort;

    constructor(code: ActionErrorCode, message: string, retryable = false, abort?: MoveAbort) {
        super(message);
        this.name = "ActionError";
        this.code = code;
        this.retryable = retryable;
        if (abort) this.abort = abort;
    }
}

/** A Move abort: the module that aborted and its code. */
export interface MoveAbort {
    module: string;
    code: number;
}

/** Whether an error is the Move abort `code` of `module`. */
export function isAbort(error: unknown, module: string, code: number): boolean {
    return (
        error instanceof ActionError && error.abort?.module === module && error.abort.code === code
    );
}
