// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the viewer assumes about the deployed package, in one place: the type
 * it lists games by, the two events a game announces itself and its end with,
 * the calls it reads endings, lobbies and squad placements from, the recruit
 * entries a squad deployment writes, and when a game nobody plays any more
 * drops off the live list. The `Game` layout itself is `Game` in `bcs.ts`
 * (shared with the players' client), as are the events' (`GameStarted`,
 * `GameEnded`). A deployment that renames or reshapes any of these is an edit
 * here.
 */

import { bcs } from "@mysten/sui/bcs";

import { GHOSTS } from "../constants.ts";
import { GameEnded, GameStarted, Recruit } from "./bcs.ts";
import { MAX_MISSED_TURNS, TURN_LIMIT_MS } from "./match-rules.ts";

/** The module every game call is in (`ghosts::ghosts`). */
export const GAME_MODULE = "ghosts";

/** `ghosts::ghosts::Game`, the shared object a game is. */
export const GAME_TYPE = `${GHOSTS.package}::${GAME_MODULE}::Game`;

/**
 * `ghosts::ghosts::GameStarted { game, players, mode, listed }`: emitted once, by the
 * transaction that creates a game (`listed` false only for `join_lobby`, an invite code).
 * The full address: the fullnode rejects a short one in a type filter.
 */
export const GAME_STARTED_TYPE = `${GHOSTS.package}::${GAME_MODULE}::GameStarted`;

/** `ghosts::ghosts::GameEnded { game, ending, ended_ms }`: emitted once, in `complete_game`, which deletes the game. */
export const GAME_ENDED_TYPE = `${GHOSTS.package}::${GAME_MODULE}::GameEnded`;

/** The events' layouts, as `bcs.ts` decodes them. */
export const STARTED_EVENT = GameStarted;
export const ENDED_EVENT = GameEnded;

/** The calls the viewer reads, by what they mean to it. */
export const CALLS = {
    /** A side places its squad: it writes one recruit entry per recruit. */
    deploy: "deploy_squad",
    /** The ranked queue's finder: creates the game with its own squad already placed (virtual units). */
    findRanked: "find_ranked",
    /** The ranked queue's waiter reveals the squad it committed to: placed, play begins. */
    reveal: "reveal_squad",
    /** A ranked waiter takes its seat without a squad (a no-show). */
    takeSeat: "take_seat",
    /** The game is wrapped up and deleted. */
    complete: "complete_game",
    /** A player walks out (the other wins). */
    abandon: "abandon_game",
    /** A turn ends, or a clock that ran out is called (a forfeit, a no-show). */
    nextTurn: "next_turn",
    /** A friendly game from a listed lobby: anyone may watch it from the list. */
    startListed: "start_friendly",
    /** A friendly game from an invite code: watchable by link only. */
    joinProtected: "join_lobby",
    /** A contract game (owned recruits, unrated) from the queue. */
    findGame: "find_game",
} as const;

/**
 * The calls that put a squad on the map: `deploy_squad` (contract and friendly games,
 * either side), and in a ranked game `find_ranked` (the finder's, as it creates the
 * game) and `reveal_squad` (the waiter's). Play starts with the last of them.
 */
export const PLACEMENT_CALLS: readonly string[] = [CALLS.deploy, CALLS.findRanked, CALLS.reveal];

/** The calls that create a game, each public (listed) or not: an invite code's is watched by link only. */
export const CREATION_CALLS: Readonly<Record<string, boolean>> = {
    [CALLS.findGame]: true,
    [CALLS.findRanked]: true,
    [CALLS.startListed]: true,
    [CALLS.joinProtected]: false,
};

/** `MAX_TURNS` in `ghosts::ghosts`: the turn a game that goes nowhere ends on. */
export const MAX_TURNS = 60;

/** `sui::dynamic_field::Field<ID, Recruit>`: one entry of a game's table of recruits. */
export const RecruitField = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: Recruit,
});

/** Whether an object type is an entry of a game's recruit table (`Table<ID, Recruit>`). */
export const isRecruitEntry = (type: string | undefined | null): boolean =>
    !!type && type.includes("::dynamic_field::Field<") && /::recruit::Recruit>$/.test(type);

/**
 * How long a game may sit without a move before the live list drops it: a turn
 * nobody ends never moves on (only a player can call `next_turn`), so a game whose
 * turn started this long ago has no one left at the table. Three turns' clocks:
 * by then the game would have been forfeited had anyone called it.
 */
export const STALE_PLAYING_MS = MAX_MISSED_TURNS * TURN_LIMIT_MS;

/** How long past its deploy deadline a game still picking squads stays listed. */
export const STALE_DEPLOYING_MS = TURN_LIMIT_MS;
