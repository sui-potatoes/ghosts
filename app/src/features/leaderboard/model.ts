// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The leaderboard's pure rules, tested in `tests/leaderboard.test.ts`: who is
 * on it (a finished ranked match at least), the order (rating, then fewer
 * games, then name), the tier each player is shown in (the contract's
 * `rules::tier_of`, the placement floor included, so the tier the game matches
 * them in), the distribution over the tiers, the player's own row and the line
 * above the table, the row's texts and the cursor's order. No React, no chain.
 */

import type { LeaderAccount } from "../../chain/leaderboard.ts";

/** A tier as the live `Rules` have it, named the way the game names it. */
export type TierBand = { name: string; min: number };
/** `Rules.placement_games` and `Rules.placement_tier`. */
export type Placement = { games: number; tier: number };

/** An account with the name it shows under. */
export type NamedAccount = LeaderAccount & { name: string };

export type LeaderRow = NamedAccount & {
    /** 1 for the top of the table. */
    rank: number;
    /** Index into the tiers. */
    tier: number;
    /** The signed-in player's own row. */
    own: boolean;
};

/** `rules::tier_of`: the highest tier the rating reaches, no lower than the placement tier while placing. */
export function displayedTier(
    tiers: readonly TierBand[],
    placement: Placement,
    rating: number,
    games: number,
): number {
    let tier = 0;
    tiers.forEach((t, i) => {
        if (t.min <= rating) tier = i;
    });
    if (games < placement.games) tier = Math.max(tier, Math.min(placement.tier, tiers.length - 1));
    return tier;
}

/** Rating high to low, then fewer games, then name, then the account id so the order never wavers. */
export function compareRows(a: NamedAccount, b: NamedAccount): number {
    if (a.rating !== b.rating) return b.rating - a.rating;
    if (a.games !== b.games) return a.games - b.games;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
}

/** The table: players with a finished ranked match, in order, ranked and tiered. */
export function rankRows(
    accounts: readonly NamedAccount[],
    tiers: readonly TierBand[],
    placement: Placement,
    ownAccountId: string | null,
): LeaderRow[] {
    return accounts
        .filter((a) => a.games > 0)
        .sort(compareRows)
        .map((a, i) => ({
            ...a,
            rank: i + 1,
            tier: displayedTier(tiers, placement, a.rating, a.games),
            own: !!ownAccountId && a.accountId === ownAccountId,
        }));
}

export type Distribution = {
    tiers: { name: string; players: number }[];
    /** Players on the table. */
    ranked: number;
    /** Ranked matches finished: every match is on two players' scores. */
    matches: number;
};

export function distribution(rows: readonly LeaderRow[], tiers: readonly TierBand[]): Distribution {
    const counts = tiers.map(() => 0);
    let games = 0;
    for (const row of rows) {
        counts[row.tier]++;
        games += row.games;
    }
    return {
        tiers: tiers.map((t, i) => ({ name: t.name, players: counts[i] })),
        ranked: rows.length,
        matches: Math.ceil(games / 2),
    };
}

/** A bar's share: the tier's players against the fullest tier. */
export const barShare = (players: number, d: Distribution): number => {
    const top = Math.max(0, ...d.tiers.map((t) => t.players));
    return top ? players / top : 0;
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `3 won · 1 lost · 0 drawn`. */
export const recordText = (r: { wins: number; losses: number; draws: number }) =>
    `${r.wins} won · ${r.losses} lost · ${r.draws} drawn`;

/** `Rank 4 · Contractor · Rating 1522`: the bar's line for a row. */
export const rowHint = (row: LeaderRow, tiers: readonly TierBand[]) =>
    `Rank ${row.rank} · ${tiers[row.tier]?.name ?? ""} · Rating ${row.rating} · ${plural(row.games, "ranked match", "ranked matches")}`;

/** What the line above the table says to the signed-in player; null signed out. */
export type OwnLine = { kind: "ranked"; rank: number; rowId: string } | { kind: "unranked" } | null;

export function ownLine(signedIn: boolean, rows: readonly LeaderRow[]): OwnLine {
    if (!signedIn) return null;
    const own = rows.find((r) => r.own);
    return own ? { kind: "ranked", rank: own.rank, rowId: rowId(own) } : { kind: "unranked" };
}

export const rowId = (row: { accountId: string }) => `lb-${row.accountId}`;
export const OWN_ID = "lb-own";
export const REFRESH_ID = "lb-refresh";
export const EMPTY_ID = "lb-empty";

/**
 * The cursor's targets top to bottom: the own line, the table's rows (or the
 * empty block), then Refresh beside the tiers. The cursor starts on the first row.
 */
export function focusOrder(own: OwnLine, rows: readonly LeaderRow[]): string[] {
    const ids: string[] = [];
    if (own) ids.push(OWN_ID);
    if (rows.length) ids.push(...rows.map(rowId));
    else ids.push(EMPTY_ID);
    ids.push(REFRESH_ID);
    return ids;
}

export function startTarget(rows: readonly LeaderRow[]): string {
    return rows[0] ? rowId(rows[0]) : EMPTY_ID;
}
