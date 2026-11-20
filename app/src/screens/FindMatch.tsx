// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play/contract`: the queue for owned recruits (`useMatchSearch().find`), its
 * state drawn by `src/features/find-match/`. A match found is entered by the
 * shell's matchmaking driver, from any screen; a search the queue let go of is
 * told here and never queued again without the player.
 */

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
    acknowledgeExpired,
    TICKET_TTL_MS,
    useExpired,
    useFundsWaiting,
    useMatchSearch,
} from "../chain";
import { FindMatch } from "../features/find-match/FindMatch";
import { useGoUp } from "../hooks/useGoUp";
import { requestSignIn } from "../signIn";

export default function FindMatchScreen() {
    const account = useCurrentAccount();
    const match = useMatchSearch();
    const expired = useExpired();
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
                    searching: match.searching?.kind === "stakes",
                    lobby: !!match.lobby,
                    ranked: match.searching?.kind === "ranked",
                    expired: expired?.kind === "stakes",
                    hiring: match.hiring,
                    funding: preparing,
                    suspendedMin:
                        match.suspendedUntilMs > Date.now()
                            ? Math.ceil((match.suspendedUntilMs - Date.now()) / 60_000)
                            : 0,
                    busy: match.busy,
                    error: match.error || null,
                    timeoutMs: TICKET_TTL_MS,
                },
                sinceMs:
                    match.searching?.kind === "stakes" ? Number(match.searching.sinceMs) : null,
                find: () => {
                    acknowledgeExpired();
                    match.find();
                },
                cancel: match.cancel,
                signIn: requestSignIn,
                resume: () => navigate("/match"),
                lobby: () => navigate("/play/friendly"),
                ranked: () => navigate("/play/ranked"),
                leave,
            }}
        />
    );
}
