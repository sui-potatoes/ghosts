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
 * `ghosts::ghosts::Mode`. A friendly game of `size` deploys 1 to `size` recruits a side and
 * moves no rating, score, suspension, XP or recruit: the fallen are home again at `complete`.
 */
export type GameMode = { kind: "rated" } | { kind: "friendly"; size: number };

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
 * `ghosts::account::State`. `Suspended` reads as `idle` with `suspendedUntilMs` set. A
 * search a match found stays `searching` until its `Seat` is accepted.
 */
export type Search =
    | { kind: "idle" }
    /** `order` is a queue ticket, or a lobby's key: `lobbyRole` in `lobby.ts` says which. */
    | { kind: "searching"; order: string; sinceMs: number }
    | { kind: "playing"; game: string };

export interface AccountView {
    id: string;
    owner: string;
    rating: number;
    deviation: number;
    score: { wins: number; losses: number; draws: number };
    recruits: number;
    search: Search;
    /** From `State::Suspended`: the account can't search for a game before this time. 0 if not. */
    suspendedUntilMs: number;
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
