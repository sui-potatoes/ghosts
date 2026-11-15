// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for the find-match screen, in builds made with `VITE_FIND_QA=1`
 * only (the route is not registered otherwise, see `App.tsx`): the real
 * `FindMatch` over a fixture state, no chain, no sign-in. `?phase=starting|
 * hiring|searching|timeout`, and `&then=searching&after=MS` to move on to
 * another phase after a wait (the moment the cancel turns active). Cancels are
 * counted on `window.__cancels`.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { FindMatch, type FindOps } from "./FindMatch";

type Phase = "starting" | "hiring" | "searching" | "timeout";

const stateOf = (phase: Phase): FindOps["state"] => ({
    signedIn: true,
    playing: false,
    searching: phase === "searching" || phase === "timeout",
    hiring: phase === "hiring",
    suspendedMin: 0,
    error: null,
    timeoutMs: 120_000,
});

export default function FindQa() {
    const [params] = useSearchParams();
    const [phase, setPhase] = useState<Phase>((params.get("phase") as Phase) ?? "starting");
    const then = params.get("then") as Phase | null;
    const after = Number(params.get("after") ?? 4000);
    useEffect(() => {
        if (!then) return;
        const timer = window.setTimeout(() => setPhase(then), after);
        return () => window.clearTimeout(timer);
    }, [then, after]);

    const since = useState(() => Date.now() - (phase === "timeout" ? 130_000 : 8_000))[0];
    const log = (what: string) => {
        const w = window as unknown as { __cancels?: string[] };
        (w.__cancels ??= []).push(what);
    };
    return (
        <FindMatch
            ops={{
                state: stateOf(phase),
                sinceMs: phase === "searching" || phase === "timeout" ? since : null,
                find: () => log("find"),
                cancel: () => log("cancel"),
                signIn: () => log("sign-in"),
                resume: () => log("resume"),
                leave: () => log("leave"),
            }}
        />
    );
}
