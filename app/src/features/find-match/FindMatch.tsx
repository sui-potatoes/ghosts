// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The contract screen at `/play/contract`, in the shared interface language: the
 * queue for the player's own recruits, who earn experience and can be lost, with
 * no rating at stake. The lookups and the queue transaction happen here, with
 * their state on screen. Back leaves it and the search carries on (the title and
 * the squad show it in their header).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
    EmptyState,
    FocusCommandBar,
    FocusRoot,
    Meter,
    Panel,
    ScreenFrame,
    StatusChip,
    useGlyphSet,
    type Command,
} from "../../ui";
import { clockOf, findView, takeFindRequest, type FindAction, type FindState } from "./model";
import "./find-match.css";

export type FindOps = {
    /** The player's state in the queue. */
    state: Omit<FindState, "elapsedMs" | "starting">;
    sinceMs: number | null;
    /** Queue the squad. */
    find: () => void;
    cancel: () => void;
    signIn: () => void;
    resume: () => void;
    /** To the friendly game the player is in. */
    lobby?: () => void;
    /** To the ranked search the player is in. */
    ranked?: () => void;
    leave: () => void;
};

/** Ticks once a second while `on`. */
function useNow(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [on]);
    return now;
}

export function FindMatch({ ops }: { ops: FindOps }) {
    const glyphs = useGlyphSet();
    const { state } = ops;

    // The arrival that asked for a search queues it, once, from here.
    const [started, setStarted] = useState(false);
    const asked = useRef(false);
    // Before the first paint, so an arrival that asked for a search never shows the idle screen.
    useLayoutEffect(() => {
        if (asked.current) return;
        asked.current = true;
        if (!takeFindRequest()) return;
        setStarted(true);
        ops.find();
        // Once, on arrival.
    }, []);

    const now = useNow(ops.sinceMs !== null);
    const elapsedMs = ops.sinceMs === null ? 0 : Math.max(0, now - ops.sinceMs);
    // Sent, and nothing to show for it yet: the account has not caught up.
    const starting =
        started &&
        !state.searching &&
        !state.hiring &&
        !state.playing &&
        !state.lobby &&
        !state.ranked &&
        !state.error;
    const view = findView({ ...state, elapsedMs, starting });

    const act: Record<FindAction, () => void> = {
        "sign-in": ops.signIn,
        resume: ops.resume,
        lobby: ops.lobby ?? ops.leave,
        ranked: ops.ranked ?? ops.leave,
        find: () => {
            setStarted(true);
            ops.find();
        },
        retry: () => {
            setStarted(true);
            ops.find();
        },
        cancel: () => {
            ops.cancel();
            ops.leave();
        },
        menu: ops.leave,
    };
    const run = act[view.action.id];

    const back: Command = { action: "back", label: "Back", run: ops.leave };
    const searching = state.searching;
    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Contract"]}
                onLocation={ops.leave}
                status={
                    <StatusChip
                        label="Match"
                        value={searching ? `Searching ${clockOf(elapsedMs)}` : view.headline}
                        state={view.pending ? "live" : "idle"}
                    />
                }
                columns="minmax(0, 480px)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <Panel label="Contract" className="gui-find-panel">
                    <div className="gui-find-mark" data-pending={view.pending ? "" : undefined} />
                    <EmptyState
                        id="find-action"
                        group="find"
                        title={view.action.label}
                        hint={view.note}
                        headline={view.headline}
                        action={view.action.label}
                        instant={view.action.id !== "cancel"}
                        commands={[
                            {
                                action: "confirm",
                                label: view.action.label,
                                tone: "primary",
                                deny: view.action.inactive,
                                run,
                            },
                        ]}
                    >
                        {view.note}
                    </EmptyState>
                    {searching && (
                        <Meter
                            label="Search"
                            value={Math.min(elapsedMs, state.timeoutMs)}
                            max={state.timeoutMs}
                            readout={clockOf(elapsedMs)}
                            tone={view.phase === "timeout" ? "warn" : undefined}
                        />
                    )}
                </Panel>
            </ScreenFrame>
        </FocusRoot>
    );
}
