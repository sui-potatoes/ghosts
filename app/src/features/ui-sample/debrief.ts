// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The debrief sample's results: SAMPLE data over the sample's roster. The
 * mapping to plates is the product's (`../debrief/result.ts`).
 */

import type { MatchResult, ResultRecord, ResultRecruit } from "../debrief/result";

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
