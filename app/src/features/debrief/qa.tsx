// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for the match result, in builds made with `VITE_RESULT_QA=1`
 * only (the route is not registered otherwise, see `App.tsx`): the real
 * `MatchDebrief` over fixture `MatchResult`s and the sample roster, no chain.
 * `?case=win|costly|loss|wipe|walkover|abandoned|forfeited|stalemate|noshow|four`,
 * `&gone=1` for a wrapped-up game, `&opponent=NAME`.
 */

import { initialSquad } from "@ghosts/squad/model";
import { useMemo } from "react";

import { rankWith } from "../../chain/match-rules";
import { MatchDebrief } from "./MatchDebrief";
import type { MatchResult } from "./result";

const turns = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ $kind: "NextTurn", NextTurn: i + 1 }));
const kia = (id: string, at: number) => [
    ...turns(at),
    { $kind: "UnitKIA", UnitKIA: [id, 1, 1] as const },
];

export default function ResultQa() {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("case") ?? "costly";
    const gone = params.get("gone") === "1";
    const opponent = params.get("opponent") ?? "NOVA";
    const roster = useMemo(() => initialSquad().recruits, []);
    const count = kind === "noshow" ? 0 : kind === "four" ? 4 : 3;
    const figures = roster.slice(0, count);
    const ranks = [
        ["Sergeant", 19],
        ["Lieutenant", 31],
        ["Corporal", 13],
        ["Rookie", 1],
    ] as const;
    const squad = figures.map((r, i) => ({
        objectId: r.id,
        name: r.callsign,
        rank: ranks[i][0],
        xp: ranks[i][1],
    }));
    const ids = squad.map((r) => r.objectId);
    const base = { rating: null, history: turns(9), recruitsHome: null, opponent, squad };

    const result: MatchResult = useMemo(() => {
        const home = (earned: number, fell: string[]) =>
            gone
                ? Object.fromEntries(
                      squad
                          .filter((r) => !fell.includes(r.objectId))
                          .map((r) => [
                              r.objectId,
                              { rank: rankWith(r.rank, r.xp + earned), xp: r.xp + earned },
                          ]),
                  )
                : null;
        const wrapped = (fell: string[]) => (gone ? 4 - fell.length : null);
        const rating = (a: number, b: number): [number, number] | null => (gone ? [a, b] : null);
        switch (kind) {
            case "win":
                return {
                    ...base,
                    outcome: "victory",
                    earned: 2,
                    fallen: [],
                    home: home(2, []),
                    recruitsHome: wrapped([]),
                    rating: rating(1512, 1529),
                };
            case "wipe":
                return {
                    ...base,
                    outcome: "defeat",
                    earned: 1,
                    fallen: ids,
                    history: [...kia(ids[2], 3), ...kia(ids[0], 5), ...kia(ids[1], 8)],
                    home: home(1, ids),
                    recruitsHome: wrapped(ids),
                    rating: rating(1512, 1497),
                };
            case "loss":
                return {
                    ...base,
                    outcome: "defeat",
                    earned: 1,
                    fallen: ids.slice(1, 2),
                    history: kia(ids[1], 6),
                    home: home(1, ids.slice(1, 2)),
                    recruitsHome: wrapped(ids.slice(1, 2)),
                    rating: rating(1512, 1497),
                };
            case "walkover":
                return {
                    ...base,
                    outcome: "opponent-abandoned",
                    earned: 1,
                    fallen: [],
                    home: home(1, []),
                    recruitsHome: wrapped([]),
                    rating: rating(1512, 1520),
                };
            case "abandoned":
                return {
                    ...base,
                    outcome: "abandoned",
                    earned: 0,
                    fallen: [],
                    home: home(0, []),
                    recruitsHome: wrapped([]),
                    rating: rating(1512, 1498),
                };
            case "forfeited":
                return {
                    ...base,
                    outcome: "forfeited",
                    earned: 0,
                    fallen: ids.slice(0, 1),
                    history: kia(ids[0], 2),
                    home: home(0, ids.slice(0, 1)),
                    recruitsHome: wrapped(ids.slice(0, 1)),
                    rating: rating(1512, 1495),
                };
            case "stalemate":
                return {
                    ...base,
                    outcome: "stalemate",
                    earned: 1,
                    fallen: [],
                    home: home(1, []),
                    recruitsHome: wrapped([]),
                };
            case "noshow":
                return {
                    ...base,
                    outcome: "no-show",
                    earned: 0,
                    fallen: [],
                    recruitsHome: gone ? 4 : null,
                };
            case "four":
                return {
                    ...base,
                    outcome: "victory",
                    earned: 2,
                    fallen: ids.slice(3),
                    history: kia(ids[3], 4),
                    home: home(2, ids.slice(3)),
                    recruitsHome: wrapped(ids.slice(3)),
                    rating: rating(1500, 1516),
                };
            default:
                return {
                    ...base,
                    outcome: "victory",
                    earned: 2,
                    fallen: ids.slice(1, 2),
                    history: kia(ids[1], 4),
                    home: home(2, ids.slice(1, 2)),
                    recruitsHome: wrapped(ids.slice(1, 2)),
                    rating: rating(1512, 1524),
                };
        }
    }, [kind, gone]);

    return (
        <MatchDebrief
            result={result}
            figures={figures}
            gone={gone}
            busy={false}
            error=""
            clearError={() => {}}
            onWrapUp={() => {}}
            onHire={() => {}}
        />
    );
}
