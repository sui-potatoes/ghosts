// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The match result as the debrief shows it: plain TypeScript, no React, tested
 * in `tests/debrief.test.ts`. `MatchResult` is what `screens/Match.tsx` holds
 * when a game is over, so the real screen and the `/ui-sample` fixtures go
 * through the same `debriefOf`:
 *
 * - `outcome`: `outcomeFor(game, side)`, or the `Account` score's settled
 *   result, or `"ended"` when nothing is left to read;
 * - `earned`: `experienceFor(game, side)`, what each survivor gains, null when
 *   the game was deleted before the app saw it end;
 * - `rating`: `Account.rating.rating` before the game (kept at its start) and
 *   after the wrap-up;
 * - `squad`: the side's recruits as the game took them in (`Game.recruits`):
 *   name, rank and experience before the match;
 * - `fallen`: the ids `fallenOf(game, side, …)` returns, from `UnitKIA` records;
 * - `history`: `Game.history`, for the turn each one fell on;
 * - `home`: what the survivors came home with (`Account.recruits`), once wrapped up;
 * - `recruitsHome`: how many recruits `Account.recruits` holds once wrapped up.
 *
 * Kills per unit are not on chain (`UnitKIA` names the victim only), so none
 * are shown.
 */

import {
    MAX_MISSED_TURNS,
    nextRankXp,
    RANKS,
    rankWith,
    type Outcome,
} from "../../chain/match-rules.ts";

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
    /**
     * A friendly game (`Game.mode` is `Friendly`): no rating, experience or
     * suspension comes out of it, and the fallen go home with the survivors.
     */
    friendly?: boolean;
    /** What a survivor earns; null when the game was gone before it could be read. */
    earned: number | null;
    rating: [before: number, after: number] | null;
    squad: ResultRecruit[];
    fallen: string[];
    history: readonly ResultRecord[];
    /** Survivors as they came home, by id; absent or empty while the `Account` is in the game. */
    home?: Readonly<Record<string, { rank: string; xp: number }>> | null;
    /** Null while the game is not wrapped up (the `Account` is still in it). */
    recruitsHome: number | null;
    /** The opposing player's name, when known. */
    opponent?: string | null;
};

export type HeadlineTone = "win" | "loss" | "draw" | "blame";

type Headline = [title: string, tone: HeadlineTone, note?: string];

const SUSPENDED = "No new match for a minute";

/** The title each outcome has, how it is coloured, and what the player should know besides. */
const HEADLINES: Record<ResultOutcome, Headline> = {
    victory: ["Victory", "win"],
    defeat: ["Defeat", "loss"],
    draw: ["Draw", "draw"],
    stalemate: ["Draw", "draw", "Turn limit reached"],
    abandoned: ["Match abandoned", "blame", SUSPENDED],
    "opponent-abandoned": ["Victory", "win", "Opponent abandoned the match"],
    forfeited: [
        "Match forfeited",
        "blame",
        `Missed ${MAX_MISSED_TURNS} turns in a row · ${SUSPENDED}`,
    ],
    "opponent-forfeited": ["Victory", "win", "Opponent stopped playing"],
    "no-show": ["No squad deployed", "blame", SUSPENDED],
    "opponent-no-show": ["Victory", "win", "Opponent never deployed"],
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

/**
 * What a demo unit's plate carries beyond a match recruit's: the demo has no
 * chain rank, it counts levels (`encounterReport`) and kills per unit.
 */
export type FieldRecord = {
    role: string;
    /** The recruit's full name; the plate's name is the callsign. */
    full: string;
    kills: number;
    level: number;
    /** Experience inside the level reached, out of `levelXp`. */
    progress: number;
    levelXp: number;
    /** The plate's hint in place of the level line (a mock match's units earn no experience). */
    hint?: string;
};

export type Plate =
    | {
          kind: "home";
          id: string;
          field?: FieldRecord;
          name: string;
          rankBefore: string;
          rankAfter: string;
          promoted: boolean;
          xpBefore: number;
          xpAfter: number;
          /** Null when it can't be told (the game was gone before it was read). */
          gained: number | null;
          /** Null at the top rank: nothing left to fill. */
          band: XpBand | null;
          /** What the plate says in place of the experience line (a friendly game's). */
          hint?: string;
      }
    | {
          kind: "kia";
          id: string;
          field?: FieldRecord;
          name: string;
          /** The rank on the dog tag. */
          rank: string;
          /** The turn they fell on (1-based), when the history has it. */
          turn: number | null;
      }
    /** Nobody stood here: the side deployed fewer than the podiums. */
    | { kind: "vacant" };

/** `FREE_RECRUITS` in `ghosts::account`: the squad, and the most an `Account` holds. */
export const FREE_RECRUITS = 4;

/** What hiring after the match would call, or why it can't yet. */
export type Replacement = { call: "hire_recruits"; count: number } | { deny: string };

export type Debrief = {
    title: string;
    tone: HeadlineTone;
    /** What else the player should know about how it ended. */
    note: string | null;
    /** Further lines under the title (the demo's operation and tally). */
    lines?: string[];
    opponent: string | null;
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
 * Hiring after the match: `hire_recruits` tops the roster up to
 * `FREE_RECRUITS`, the most it holds. It refuses while the `Account` is in a
 * game, so it never works before the wrap-up. A hire is a new random recruit
 * for the roster, never the fallen one back.
 */
export function replacementFor(recruitsHome: number | null): Replacement {
    if (recruitsHome === null) return { deny: "Hiring opens once the match is wrapped up" };
    if (recruitsHome < FREE_RECRUITS)
        return { call: "hire_recruits", count: FREE_RECRUITS - recruitsHome };
    return { deny: `The squad is full at ${FREE_RECRUITS}` };
}

/**
 * What a survivor ends with. The `Account`'s own record once it shows the
 * game's pay; until then (a poll behind) the pay the rules promise.
 */
function survivorAfter(
    r: ResultRecruit,
    result: MatchResult,
): { rank: string; xp: number; gained: number | null } {
    const home = result.home?.[r.objectId];
    // Still the old experience while a payout is due: the `Account` is a poll behind.
    const stale = home && home.xp === r.xp && (result.earned ?? 0) > 0;
    if (home && !stale) return { rank: home.rank, xp: home.xp, gained: home.xp - r.xp };
    if (result.earned === null) return { rank: r.rank, xp: r.xp, gained: null };
    const xp = r.xp + result.earned;
    return { rank: rankWith(r.rank, xp), xp, gained: result.earned };
}

/**
 * The notes a friendly game keeps: how it ended, never a suspension, which a
 * friendly game does not give.
 */
const FRIENDLY_NOTES: Partial<Record<ResultOutcome, string>> = {
    stalemate: "Turn limit reached",
    forfeited: `Missed ${MAX_MISSED_TURNS} turns in a row`,
    "opponent-abandoned": "Your opponent left the match",
    "opponent-forfeited": "Opponent stopped playing",
    "opponent-no-show": "Opponent never deployed",
};

/** A friendly game's result: the outcome, and everyone deployed back home as they went in. */
function friendlyDebrief(result: MatchResult, podiums: number): Debrief {
    const [title, tone] = HEADLINES[result.outcome];
    const fallen = new Set(result.fallen);
    const turns = fallTurns(result.history);
    const plates: Plate[] = Array.from({ length: podiums }, (_, i) => {
        const r = result.squad[i];
        if (!r) return { kind: "vacant" };
        const turn = turns.get(r.objectId);
        return {
            kind: "home",
            id: r.objectId,
            name: r.name,
            rankBefore: r.rank,
            rankAfter: r.rank,
            promoted: false,
            xpBefore: r.xp,
            xpAfter: r.xp,
            gained: null,
            band: null,
            hint: fallen.has(r.objectId)
                ? `${turn ? `Fell on turn ${turn} · ` : "Fell · "}Home`
                : "Home",
        };
    });
    return {
        title,
        tone,
        note: FRIENDLY_NOTES[result.outcome] ?? null,
        lines: ["Friendly match · Everyone comes home"],
        opponent: result.opponent ?? null,
        rating: null,
        plates,
        replacement: null,
    };
}

/** A match result as the debrief shows it: one plate per podium, left to right. */
export function debriefOf(
    result: MatchResult,
    podiums = Math.max(3, result.squad.length),
): Debrief {
    if (result.friendly) return friendlyDebrief(result, podiums);
    const [title, tone, note] = HEADLINES[result.outcome];
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
        const after = survivorAfter(r, result);
        return {
            kind: "home",
            id: r.objectId,
            name: r.name,
            rankBefore: r.rank,
            rankAfter: after.rank,
            promoted: after.rank !== r.rank,
            xpBefore: r.xp,
            xpAfter: after.xp,
            gained: after.gained,
            band: after.gained === null ? null : xpBand(r.rank, r.xp, after.xp),
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
        note: note ?? null,
        opponent: result.opponent ?? null,
        rating: rating && rating.delta !== 0 ? rating : null,
        plates,
        replacement: fallen.size ? replacementFor(result.recruitsHome) : null,
    };
}

/**
 * The squad the side deployed, fallen included: every recruit seen in the game
 * that is its own (`leader`), standing now (`alive`) or fallen. The game lets go
 * of the fallen, so `seen` is what the app read while they were still in it.
 */
export function deployedOf<R extends { objectId: string; leader: string }>(
    seen: Iterable<R>,
    leader: string,
    alive: readonly string[],
    fallen: readonly string[],
): R[] {
    return [...seen].filter(
        (r) => r.leader === leader && (alive.includes(r.objectId) || fallen.includes(r.objectId)),
    );
}

/**
 * The rank labels a survivor's plate shows: the rank going in while a
 * promotion is still being swapped in, otherwise the one rank they have now.
 * Never both: the final state is this, not an animation's end.
 */
export function rankLabels(
    plate: Extract<Plate, { kind: "home" }>,
    swapping: boolean,
): [rank: string] {
    return [plate.promoted && swapping ? plate.rankBefore : plate.rankAfter];
}

/** The hint under a demo survivor's plate, from the level reached. */
export function fieldHint(plate: Extract<Plate, { kind: "home" }>): string {
    const f = plate.field;
    if (!f) return "Home";
    if (f.hint) return f.hint;
    const next = `${f.progress} / ${f.levelXp} XP to level ${f.level + 1}`;
    return plate.promoted ? `Promoted to level ${f.level} · ${next}` : next;
}
