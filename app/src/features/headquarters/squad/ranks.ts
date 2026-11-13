// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A recruit's rank as the screens draw it: the insignia step and the
 * progress toward the next rank. Ranks gate nothing in the armory; they are
 * the recruit's record. Pure, tested in `tests/hq-squad.test.ts`.
 */

import { nextRankXp, RANKS } from "../../../chain/match-rules.ts";

export const rankIndex = (rank: string) => (RANKS as readonly string[]).indexOf(rank);

/** The pictogram step for a rank: one chevron per two ranks, three at most. */
export const rankIcon = (rank: string): "rank1" | "rank2" | "rank3" => {
    const i = rankIndex(rank);
    return i >= 4 ? "rank3" : i >= 2 ? "rank2" : "rank1";
};

/** Experience toward the next rank; `next` is undefined at the top. */
export function rankProgress(rank: string, xp: number): { xp: number; next?: number } {
    return { xp, next: nextRankXp(rank) };
}
