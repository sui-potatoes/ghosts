// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for ranked, in builds made with `VITE_RANKED_QA=1` only (the route is
 * not registered otherwise, see `App.tsx`): the real `RankedView` and
 * `RankedWaiting` over fixtures, no chain, no sign-in.
 *
 * `/qa/ranked?state=` one of
 * - `builder` (`&rating=1720&games=12` for any tier, `&open4=1` to give 4x4 a level),
 * - `checking`, `joining`, `found`, `searching`, `timeout`, `expired`,
 * - `refused&line=over-budget|locked|level|suspended|searching`,
 * - `signed-out`, `suspended`, `contract`, `playing`,
 * - the wait before a ranked match: `revealing`, `lost`, `late`, `failed`, `waiting`, `called`.
 * Commands are counted on `window.__ranked`.
 */

import { useMemo, useState } from "react";

import { applyRules, DEFAULT_RULES } from "../economy";
import { NEW_PLAYER, standingOf } from "../rating";
import { RankedView, type RankedViewState } from "./RankedView";
import { RankedWaiting } from "./RankedWaiting";
import type { SearchPhase } from "./search";
import type { WaitingPhase } from "./waiting";

const LINES: Record<string, string> = {
    "over-budget": "The squad costs more than your budget",
    locked: "The squad carries an item your rank has not unlocked",
    level: "No 4x4 level yet",
    suspended: "Suspended",
    searching: "You are already searching or in a match",
};

const WAITING: WaitingPhase[] = ["revealing", "lost", "late", "failed", "waiting", "called"];

function log(what: string) {
    const w = window as unknown as { __ranked?: string[] };
    (w.__ranked ??= []).push(what);
}

export default function RankedQa() {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state") ?? "builder";
    useState(() => {
        applyRules({ ...DEFAULT_RULES, open: { "3x3": true, "4x4": params.get("open4") === "1" } });
        return null;
    });
    const [since] = useState(() => Date.now() - (state === "timeout" ? 310_000 : 84_000));
    const [deadline] = useState(() => Date.now() + (state === "called" ? -3_000 : 42_000));
    const standing = useMemo(() => {
        const rating = Number(params.get("rating") ?? 1520);
        const games = Number(params.get("games") ?? 12);
        const wins = Math.ceil(games / 2);
        return standingOf({
            ...NEW_PLAYER,
            rating: { rating, deviation: 90 },
            score: { wins, losses: games - wins, draws: 0 },
        });
    }, []);

    if ((WAITING as string[]).includes(state))
        return (
            <RankedWaiting
                phase={state as WaitingPhase}
                line={state === "failed" ? "Could not show the squad" : undefined}
                deadline={deadline}
                limitMs={60_000}
                title="Ranked 3x3"
                busy={false}
                onContinue={() => log("continue")}
                onAbandon={() => log("abandon")}
            />
        );

    const phases: Record<string, SearchPhase> = {
        checking: "checking",
        joining: "sending-wait",
        found: "sending-match",
        searching: "searching",
        timeout: "searching",
        expired: "expired",
        refused: "refused",
    };
    const view: RankedViewState = {
        signedIn: state !== "signed-out",
        loading: false,
        playing: state === "playing",
        lobby: false,
        contract: state === "contract",
        suspendedMin: state === "suspended" ? 3 : 0,
        phase: phases[state] ?? "idle",
        sinceMs: state === "searching" || state === "timeout" ? since : null,
        ttlMs: 300_000,
        busy: false,
        line: LINES[params.get("line") ?? "over-budget"],
    };
    return (
        <RankedView
            standing={standing}
            state={view}
            ops={{
                find: () => log("find"),
                cancel: () => log("cancel"),
                close: () => log("close"),
                signIn: () => log("sign-in"),
                resume: () => log("resume"),
                leave: () => log("leave"),
            }}
        />
    );
}
