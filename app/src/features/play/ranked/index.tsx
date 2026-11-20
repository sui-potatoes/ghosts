// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked matches on chain: the builder over the player's standing (their
 * `Account`, the live `Rules`) and the ranked queue. A match found, either way,
 * is entered by the shell's matchmaking driver (`/match`); a search the queue
 * let go of is told here, and never queued again without the player.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
    acknowledgeExpired,
    TICKET_TTL_MS,
    useExpired,
    useMatchSearch,
} from "../../../chain/matchmaking";
import { useRankedSearch, type RankedPhase } from "../../../chain/ranked";
import { requestSignIn } from "../../../signIn";
import { applyRules, rulesFromChain, type Mode } from "../economy";
import { useStanding } from "../useStanding";
import { RankedView, type BuiltSquad } from "./RankedView";
import type { SearchPhase } from "./search";

/** How long "joining" waits for the `Account` to show the search before trusting it went nowhere. */
const JOIN_WAIT_MS = 20_000;

const MODE_OF: Record<number, Mode> = { 3: "3x3", 4: "4x4" };

function phaseOf(
    queue: RankedPhase,
    searching: boolean,
    joining: boolean,
    expired: boolean,
): SearchPhase {
    if (searching) return "searching";
    if (queue.phase === "checking") return "checking";
    if (queue.phase === "sending")
        return queue.branch === "wait" ? "sending-wait" : "sending-match";
    if (queue.phase === "refused") return "refused";
    if (joining) return "joining";
    if (expired) return "expired";
    return "idle";
}

/** Ranked matches: pick 3x3 or 4x4 and build a squad within the tier's budget. */
export function RankedScreen() {
    const navigate = useNavigate();
    const { standing, signedIn, loading } = useStanding();
    const match = useMatchSearch();
    const expired = useExpired();
    const ranked = useRankedSearch((rules) => applyRules(rulesFromChain(rules)));
    const [joining, setJoining] = useState<number | null>(null);

    const searching = match.searching?.kind === "ranked" ? match.searching : null;
    // Sent and taken: until the `Account` shows the search (or the game), the card says joining.
    const queued = ranked.state.phase === "idle" && joining !== null;
    useEffect(() => {
        if (searching || match.playing) setJoining(null);
    }, [!!searching, !!match.playing]);
    useEffect(() => {
        if (joining === null) return;
        const timer = window.setTimeout(() => setJoining(null), JOIN_WAIT_MS);
        return () => window.clearTimeout(timer);
    }, [joining]);

    const suspendedMs = Math.max(0, match.suspendedUntilMs - Date.now());
    const phase = phaseOf(ranked.state, !!searching, queued, expired?.kind === "ranked");

    return (
        <RankedView
            standing={standing}
            searchMode={searching && MODE_OF[searching.size] ? MODE_OF[searching.size] : null}
            state={{
                signedIn,
                loading,
                playing: !!match.playing,
                lobby: !!match.lobby,
                contract: match.searching?.kind === "stakes",
                suspendedMin: suspendedMs > 0 ? Math.ceil(suspendedMs / 60_000) : 0,
                phase,
                sinceMs: searching?.sinceMs ?? null,
                ttlMs: TICKET_TTL_MS,
                busy: match.busy,
                line: ranked.state.phase === "refused" ? ranked.state.line : undefined,
            }}
            ops={{
                find: (mode: Mode, squad: BuiltSquad) => {
                    acknowledgeExpired();
                    setJoining(Date.now());
                    ranked.queue({
                        size: mode === "3x3" ? 3 : 4,
                        units: squad.units.map(({ weapon, armor, utility }) => ({
                            weapon,
                            armor,
                            utility,
                        })),
                        labels: squad.labels,
                    });
                },
                cancel: match.cancel,
                close: () => {
                    acknowledgeExpired();
                    ranked.clear();
                    setJoining(null);
                },
                signIn: requestSignIn,
                resume: () => navigate("/match"),
                leave: () => navigate("/play", { replace: true }),
            }}
        />
    );
}
