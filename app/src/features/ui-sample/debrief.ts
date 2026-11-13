// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The debrief's plates from a match result: plain TypeScript, no React, tested
 * in `tests/debrief.test.ts`. The input is shaped like what `screens/Match.tsx`
 * already holds when a game is over, so the same mapping can take chain data:
 *
 * - `outcome`: `outcomeFor(game, side)` (or the `Account` score's settled
 *   result, or `"ended"` when nothing is left to read);
 * - `earned`: `experienceFor(game, side)`, what each survivor gains;
 * - `rating`: `Account.rating.rating` at the start and after the wrap-up;
 * - `squad`: the side's recruits as the game took them in (`Game.recruits`):
 *   name, rank and experience before the match;
 * - `fallen`: the ids `fallenOf(game, side, …)` returns;
 * - `history`: `Game.history`, for the turn each one fell on;
 * - `recruitsHome`: `Account.recruits` once the game is wrapped up.
 *
 * The fixtures at the bottom are SAMPLE results built over the sample's
 * roster; everything else mirrors `ghosts::ghosts` and `ghosts::account`.
 */

import { nextRankXp, RANKS, rankWith, type Outcome } from "../../chain/match-rules.ts";

/** How a game wrapped up before the result screen saw it end (see `Match.tsx`). */
export type Settled = "settled-win" | "settled-loss" | "settled-draw";
export type ResultOutcome = Outcome | Settled | "ended";

/** A recruit as the game took them in: `Recruit.metadata.name`, `rank.$kind`, `xp`. */
export type ResultRecruit = { objectId: string; name: string; rank: string; xp: number };

/** The two `Game.history` records the debrief reads; any other record passes through. */
export type ResultRecord = {
    $kind: string;
    NextTurn?: number;
    UnitKIA?: readonly [string, number, number];
};

export type MatchResult = {
    outcome: ResultOutcome;
    earned: number;
    rating: [before: number, after: number] | null;
    squad: ResultRecruit[];
    fallen: string[];
    history: readonly ResultRecord[];
    /** Null while the game is not wrapped up (the `Account` is still in it). */
    recruitsHome: number | null;
};

export type HeadlineTone = "win" | "loss" | "draw" | "blame";

/** The title each outcome has on the Match result today, and how it is coloured. */
const HEADLINES: Record<ResultOutcome, [title: string, tone: HeadlineTone]> = {
    victory: ["Victory", "win"],
    defeat: ["Defeat", "loss"],
    draw: ["Draw", "draw"],
    stalemate: ["Draw", "draw"],
    abandoned: ["Match abandoned", "blame"],
    "opponent-abandoned": ["Victory", "win"],
    forfeited: ["Match forfeited", "blame"],
    "opponent-forfeited": ["Victory", "win"],
    "no-show": ["No squad deployed", "blame"],
    "opponent-no-show": ["Victory", "win"],
    "settled-win": ["Victory", "win"],
    "settled-loss": ["Defeat", "loss"],
    "settled-draw": ["Draw", "draw"],
    ended: ["Match over", "draw"],
};

/** A survivor's experience inside the band of the rank they held going in. */
export type XpBand = {
    /** Total experience at the band's start and end (the next rank's threshold). */
    start: number;
    end: number;
    /** Where the bar starts filling and where it stops, as fractions of the band. */
    from: number;
    to: number;
};

export type Plate =
    | {
          kind: "home";
          id: string;
          name: string;
          rankBefore: string;
          rankAfter: string;
          promoted: boolean;
          xpBefore: number;
          xpAfter: number;
          gained: number;
          /** Null at the top rank: nothing left to fill. */
          band: XpBand | null;
      }
    | {
          kind: "kia";
          id: string;
          name: string;
          /** The rank on the dog tag. */
          rank: string;
          /** The turn they fell on (1-based), when the history has it. */
          turn: number | null;
      }
    /** Nobody stood here: the side deployed fewer than three. */
    | { kind: "vacant" };

/** `FREE_RECRUITS` and `MAX_RECRUITS` in `ghosts::account`. */
export const FREE_RECRUITS = 4;
export const MAX_RECRUITS = 8;

/** What hiring after the match would call, or why it can't yet. */
export type Replacement =
    | { call: "hire_recruits"; count: number }
    | { call: "hire_recruit"; count: 1 }
    | { deny: string };

export type Debrief = {
    title: string;
    tone: HeadlineTone;
    rating: { before: number; after: number; delta: number } | null;
    plates: Plate[];
    /** Null when nobody fell. */
    replacement: Replacement | null;
};

/** The total experience a rank takes to reach (0 for `Rookie`). */
function rankStart(rank: string): number {
    const i = RANKS.indexOf(rank as never);
    return i > 0 ? (nextRankXp(RANKS[i - 1]) ?? 0) : 0;
}

/** The bar for a survivor: the band of the rank they went in with, full on a promotion. */
export function xpBand(rankBefore: string, xpBefore: number, xpAfter: number): XpBand | null {
    // A promotion fills the old band to its end; the insignia then changes.
    const promoted = rankWith(rankBefore, xpAfter) !== rankBefore;
    const end = nextRankXp(rankBefore);
    if (end === undefined) return null;
    const start = rankStart(rankBefore);
    const frac = (xp: number) => Math.max(0, Math.min(1, (xp - start) / (end - start)));
    return { start, end, from: frac(xpBefore), to: promoted ? 1 : frac(xpAfter) };
}

/** `PROMOTION_AIM` and `PROMOTION_HEALTH` in `ghosts::recruit`. */
const PROMOTION_AIM = 2;
const PROMOTION_HEALTH = 1;

/**
 * What the promotions between two ranks add to the recruit's stats, as
 * `add_xp` applies them: aim on every rank, health on every even one.
 */
export function promotionBonus(before: string, after: string): { aim: number; health: number } {
    const from = RANKS.indexOf(before as never);
    const to = RANKS.indexOf(after as never);
    let aim = 0;
    let health = 0;
    for (let k = from + 1; k <= to; k++) {
        aim += PROMOTION_AIM;
        if (k % 2 === 0) health += PROMOTION_HEALTH;
    }
    return { aim, health };
}

/** The turn each recruit fell on, from the history: `NextTurn(n)` opens turn n (0-based). */
export function fallTurns(history: readonly ResultRecord[]): Map<string, number> {
    const turns = new Map<string, number>();
    let turn = 0;
    for (const record of history) {
        if (record.$kind === "NextTurn" && record.NextTurn !== undefined) turn = record.NextTurn;
        else if (record.$kind === "UnitKIA" && record.UnitKIA)
            turns.set(record.UnitKIA[0], turn + 1);
    }
    return turns;
}

/**
 * Hiring after the match: the free squad tops the roster up to
 * `FREE_RECRUITS` (`hire_recruits`), past it one at a time up to
 * `MAX_RECRUITS` (`hire_recruit`). Both refuse while the `Account` is in a
 * game, so neither works before the wrap-up. A hire is a new random recruit
 * for the roster, never the fallen one back.
 */
export function replacementFor(recruitsHome: number | null): Replacement {
    if (recruitsHome === null) return { deny: "Hiring opens once the match is wrapped up" };
    if (recruitsHome < FREE_RECRUITS)
        return { call: "hire_recruits", count: FREE_RECRUITS - recruitsHome };
    if (recruitsHome < MAX_RECRUITS) return { call: "hire_recruit", count: 1 };
    return { deny: `The roster is full at ${MAX_RECRUITS}` };
}

/** A match result as the debrief shows it: one plate per podium, left to right. */
export function debriefOf(result: MatchResult, podiums = 3): Debrief {
    const [title, tone] = HEADLINES[result.outcome];
    const fallen = new Set(result.fallen);
    const turns = fallTurns(result.history);
    const plates: Plate[] = Array.from({ length: podiums }, (_, i) => {
        const r = result.squad[i];
        if (!r) return { kind: "vacant" };
        if (fallen.has(r.objectId))
            return {
                kind: "kia",
                id: r.objectId,
                name: r.name,
                rank: r.rank,
                turn: turns.get(r.objectId) ?? null,
            };
        const xpAfter = r.xp + result.earned;
        const rankAfter = rankWith(r.rank, xpAfter);
        return {
            kind: "home",
            id: r.objectId,
            name: r.name,
            rankBefore: r.rank,
            rankAfter,
            promoted: rankAfter !== r.rank,
            xpBefore: r.xp,
            xpAfter,
            gained: result.earned,
            band: xpBand(r.rank, r.xp, xpAfter),
        };
    });
    const rating = result.rating && {
        before: result.rating[0],
        after: result.rating[1],
        delta: result.rating[1] - result.rating[0],
    };
    return {
        title,
        tone,
        rating: rating && rating.delta !== 0 ? rating : null,
        plates,
        replacement: fallen.size ? replacementFor(result.recruitsHome) : null,
    };
}

// === Sample results ====================================================

export type FixtureKind = "win" | "costly" | "wipe";

export const FIXTURES: { id: FixtureKind; label: string }[] = [
    { id: "win", label: "Clean win" },
    { id: "costly", label: "Costly win" },
    { id: "wipe", label: "Wipe" },
];

/**
 * SAMPLE results over the deployed squad (`squad`, podium order) and the
 * roster size before the match: the outcome, ratings and turns are made up,
 * the shapes and the experience rules are the game's.
 */
export function fixtureResult(
    kind: FixtureKind,
    squad: ResultRecruit[],
    roster: number,
): MatchResult {
    const ids = squad.map((r) => r.objectId);
    const turns = (n: number) =>
        Array.from({ length: n }, (_, i): ResultRecord => ({ $kind: "NextTurn", NextTurn: i + 1 }));
    const kia = (id: string | undefined): ResultRecord[] =>
        id ? [{ $kind: "UnitKIA", UnitKIA: [id, 4, 7] }] : [];
    const home = (fallen: string[]) => roster - fallen.length;
    switch (kind) {
        case "win":
            // `experienceFor` for the winner: SURVIVAL_XP + WIN_XP.
            return {
                outcome: "victory",
                earned: 2,
                rating: [1512, 1529],
                squad,
                fallen: [],
                history: turns(9),
                recruitsHome: home([]),
            };
        case "costly": {
            const fallen = ids.slice(1, 2);
            return {
                outcome: "victory",
                earned: 2,
                rating: [1512, 1524],
                squad,
                fallen,
                history: [...turns(5), ...kia(fallen[0]), ...turns(11).slice(5)],
                recruitsHome: home(fallen),
            };
        }
        case "wipe":
            // The loser's survivors would get SURVIVAL_XP; there are none.
            return {
                outcome: "defeat",
                earned: 1,
                rating: [1512, 1497],
                squad,
                fallen: ids,
                history: [
                    ...turns(3),
                    ...kia(ids[2]),
                    ...turns(6).slice(3),
                    ...kia(ids[0]),
                    ...turns(8).slice(6),
                    ...kia(ids[1]),
                ],
                recruitsHome: home(ids),
            };
    }
}
