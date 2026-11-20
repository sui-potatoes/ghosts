// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for the first-sign-in name prompt, in builds made with
 * `VITE_NAME_QA=1` only (the route is not registered otherwise, see `App.tsx`):
 * the real `NameStepView` over fake deps, no chain, no sign-in.
 * `/qa/name?state=` one of `idle`, `invalid`, `taken`, `waiting` (Save pressed,
 * the balance still short: the real `waitForGas` polling a fake balance),
 * `saving` (past the gas wait, the send in flight), `failed` (the wait timed out).
 * Typing works: `taken` is the one name that is taken; any other saves after a moment.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { GasTimeout, waitForGas } from "../../chain/first-name-core";
import { NameStepView, type NameStepDeps } from "./NameStepView";

const INITIAL: Record<string, string> = {
    idle: "",
    invalid: "ab",
    taken: "taken",
    waiting: "kestrel",
    saving: "kestrel",
    failed: "kestrel",
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function NameQa() {
    const [params] = useSearchParams();
    const state = params.get("state") ?? "idle";
    const [saved, setSaved] = useState<string | null>(null);
    const [closed, setClosed] = useState(false);

    const deps = useMemo<NameStepDeps>(
        () => ({
            taken: async (name) => name === "taken",
            save: async (name) => {
                if (state === "saving") return new Promise<void>(() => {});
                await waitForGas({
                    // `failed` times out almost at once; `waiting` stays short for good.
                    balance: async () => 0n,
                    ensure: () => new Promise<void>(() => {}),
                    now: Date.now,
                    sleep,
                    timeoutMs: state === "failed" ? 1500 : Infinity,
                    pollMs: 250,
                }).catch((e) => {
                    throw e instanceof GasTimeout ? e : new Error("Could not save the name");
                });
                setSaved(name);
            },
            done: () => setClosed(true),
            later: () => setClosed(true),
        }),
        [state],
    );

    // The states past the first press are reached by pressing Save, once.
    useEffect(() => {
        if (!["waiting", "saving", "failed"].includes(state)) return;
        const timer = window.setTimeout(() => {
            document
                .querySelector<HTMLInputElement>(".gui-field-input")
                ?.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
                );
        }, 700);
        return () => window.clearTimeout(timer);
    }, [state]);

    if (closed)
        return (
            <p className="gui" data-testid="closed">
                {saved ? `Saved ${saved}` : "Later"}
            </p>
        );
    return <NameStepView deps={deps} initial={INITIAL[state] ?? ""} />;
}
