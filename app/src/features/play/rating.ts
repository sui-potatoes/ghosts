// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The player's ranked standing, read from their `Account` on chain: the Glicko
 * rating, the ranked games behind it (`Score`, ranked games only), the tier the
 * contract puts them in (`rules::tier_of`, with the placement floor), the budget
 * each size builds to, the resets and the suspension. Nothing is stored on the
 * device. Pure: the account's numbers and the economy's rules come in; tested in
 * `tests/play-rating.test.ts`.
 */

import {
    budgetOf,
    economyRules,
    standingRating,
    tierOf,
    type Mode,
    type Tier,
} from "./economy/index.ts";

/** `glicko::default()`: a new player's rating, and where a reset puts it. */
export const DEFAULT_RATING = 1500;
/** The deviation of a player who has never played; also its upper bound. */
export const DEFAULT_DEVIATION = 350;

/** The `Account` fields the standing is read from, as `Account` decodes them. */
export type AccountNumbers = {
    rating: { rating: string | number; deviation: string | number };
    score: { wins: string | number; losses: string | number; draws: string | number };
    suspendedUntil: string | number;
    resets: number;
    lastResetMs: string | number;
};

export type Standing = {
    rating: number;
    deviation: number;
    /** Ranked games finished. */
    games: number;
    wins: number;
    losses: number;
    draws: number;
    /** The tier the contract puts the player in, the placement floor included. */
    tier: Tier;
    /** A rating inside `tier`: what the economy's rating-keyed functions take. */
    standing: number;
    /** Ranked games left before the placement floor lifts; 0 once placed. */
    placementLeft: number;
    budgets: Record<Mode, number>;
    resets: number;
    /** When the rating was last reset; null when never. */
    lastResetMs: number | null;
    /** Until when matchmaking is closed to the player; 0 when it is not. */
    suspendedUntilMs: number;
};

/** A player with no `Account` yet: the default rating, no games, the placement floor. */
export const NEW_PLAYER: AccountNumbers = {
    rating: { rating: DEFAULT_RATING, deviation: DEFAULT_DEVIATION },
    score: { wins: 0, losses: 0, draws: 0 },
    suspendedUntil: 0,
    resets: 0,
    lastResetMs: 0,
};

export function standingOf(account: AccountNumbers): Standing {
    const rating = Number(account.rating.rating);
    const wins = Number(account.score.wins);
    const losses = Number(account.score.losses);
    const draws = Number(account.score.draws);
    const games = wins + losses + draws;
    const standing = standingRating(rating, games);
    const placement = economyRules().placement;
    const lastReset = Number(account.lastResetMs);
    return {
        rating,
        deviation: Number(account.rating.deviation),
        games,
        wins,
        losses,
        draws,
        tier: tierOf(standing),
        standing,
        placementLeft: Math.max(0, placement.games - games),
        budgets: { "3x3": budgetOf(standing, "3x3"), "4x4": budgetOf(standing, "4x4") },
        resets: account.resets,
        lastResetMs: account.resets > 0 ? lastReset : null,
        suspendedUntilMs: Number(account.suspendedUntil),
    };
}

/** A ranked game's change of rating and tier, for the debrief. */
export type RatingChange = {
    before: number;
    after: number;
    delta: number;
    /** The tier's name before and after, when it changed. */
    tier: { before: string; after: string } | null;
};

/**
 * What a ranked game did to the player: the rating before and after as the
 * `Account` reads, and the tier, each with the games played then (the placement
 * floor holds while they are few).
 */
export function ratingChange(
    before: { rating: number; games: number },
    after: { rating: number; games: number },
): RatingChange {
    const from = tierOf(standingRating(before.rating, before.games));
    const to = tierOf(standingRating(after.rating, after.games));
    return {
        before: before.rating,
        after: after.rating,
        delta: after.rating - before.rating,
        tier: from.id === to.id ? null : { before: from.name, after: to.name },
    };
}
