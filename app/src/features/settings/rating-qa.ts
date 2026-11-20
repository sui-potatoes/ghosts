// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked record Settings shows, and the reset it sends: the player's
 * `Account` on chain (`useStanding`, `account::reset_rating`), or in builds made
 * with `VITE_RATING_QA=1` a fixture from the settings route's query, so every
 * state of the reset row can be seen without a wallet:
 * `?rating=1720&games=12&resets=1&reset=2d&busy=search|match`, where `reset` is
 * how long ago the last reset was (`2d`, `5h`, `30m`). The fixture's reset only
 * counts on `window.__resets`; nothing is sent.
 */

import { useState } from "react";

import { useGhostsAction, useMatchSearch } from "../../chain";
import { resetRatingTx } from "../../chain/ranked";
import { resetDeny } from "../../chain/ranked-core";
import { economyRules } from "../play/economy";
import { NEW_PLAYER, standingOf, type Standing } from "../play/rating";
import { useStanding } from "../play/useStanding";

export type RatingRecord = {
    signedIn: boolean;
    standing: Standing;
    /** Why the reset is inactive; undefined when it can be sent. */
    deny: string | undefined;
    /** Send the reset; resolves true once the chain took it. */
    reset: () => Promise<boolean>;
    busy: boolean;
    error: string;
};

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000 };

/** `2d`, `5h`, `30m` as milliseconds; null when it does not read. */
function agoMs(text: string | null): number | null {
    const match = text ? /^(\d+)([dhm])$/.exec(text.trim()) : null;
    return match ? Number(match[1]) * UNIT_MS[match[2]] : null;
}

/** The QA fixture of the query, or null outside a QA build or without `rating`. */
function fixture(): { standing: Standing; busy: "match" | "search" | null } | null {
    if (!import.meta.env.VITE_RATING_QA) return null;
    const params = new URLSearchParams(window.location.search);
    const rating = Number(params.get("rating") ?? NaN);
    if (!Number.isFinite(rating) || rating < 0) return null;
    const games = Math.max(0, Math.floor(Number(params.get("games") ?? 12)) || 0);
    const resets = Math.max(0, Math.floor(Number(params.get("resets") ?? 0)) || 0);
    const ago = agoMs(params.get("reset"));
    const busy = params.get("busy");
    const wins = Math.ceil(games / 2);
    return {
        standing: standingOf({
            ...NEW_PLAYER,
            rating: { rating: Math.round(rating), deviation: 80 },
            score: { wins, losses: games - wins, draws: 0 },
            resets,
            lastResetMs: ago === null ? 0 : Date.now() - ago,
        }),
        busy: busy === "match" || busy === "search" ? busy : null,
    };
}

/** The record and the reset, from the chain or the QA fixture. `inMatch`: Settings opened from a match. */
export function useRatingRecord(inMatch: boolean): RatingRecord {
    const [qa] = useState(fixture);
    const chain = useStanding();
    const match = useMatchSearch();
    const action = useGhostsAction();
    const standing = qa?.standing ?? chain.standing;
    const busy =
        qa?.busy ??
        (inMatch || match.playing ? "match" : match.searching || match.lobby ? "search" : null);
    const deny = resetDeny({
        rating: standing.rating,
        busy,
        resets: standing.resets,
        lastResetMs: standing.lastResetMs ?? 0,
        cooldownMs: economyRules().resetCooldownMs,
        now: Date.now(),
    });
    const reset = async () => {
        if (qa) {
            const w = window as unknown as { __resets?: number };
            w.__resets = (w.__resets ?? 0) + 1;
            return true;
        }
        if (!chain.accountId) return false;
        return action.run([() => resetRatingTx(chain.accountId!)]);
    };
    return {
        signedIn: !!qa || chain.signedIn,
        standing,
        deny: action.busy ? "Saving" : deny,
        reset,
        busy: action.busy,
        error: action.error,
    };
}
