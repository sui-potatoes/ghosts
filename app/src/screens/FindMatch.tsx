// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/find`: where Find Match lands at once. The lookups and the queue
 * transaction run here (`useMatchSearch().find`), their state drawn by
 * `src/features/find-match/`. A match found is entered by the shell's
 * matchmaking driver, from any screen.
 */

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { SEARCH_TIMEOUT_MS, useFundsWaiting, useMatchSearch } from "../chain";
import { FindMatch } from "../features/find-match/FindMatch";
import { useGoUp } from "../hooks/useGoUp";
import { requestSignIn } from "../signIn";

export default function FindMatchScreen() {
    const account = useCurrentAccount();
    const match = useMatchSearch();
    const preparing = useFundsWaiting();
    const navigate = useNavigate();
    const leave = useGoUp();

    // Already in a game (a deep link, a reload): straight to it.
    useEffect(() => {
        if (match.playing) navigate("/match", { replace: true });
    }, [match.playing, navigate]);

    return (
        <FindMatch
            ops={{
                state: {
                    signedIn: !!account,
                    playing: !!match.playing,
                    searching: !!match.searching,
                    hiring: match.hiring,
                    funding: preparing,
                    suspendedMin:
                        match.suspendedUntilMs > Date.now()
                            ? Math.ceil((match.suspendedUntilMs - Date.now()) / 60_000)
                            : 0,
                    busy: match.busy,
                    error: match.error || null,
                    timeoutMs: SEARCH_TIMEOUT_MS,
                },
                sinceMs: match.searching ? Number(match.searching.sinceMs) : null,
                find: match.find,
                cancel: match.cancel,
                signIn: requestSignIn,
                resume: () => navigate("/match"),
                leave,
            }}
        />
    );
}
