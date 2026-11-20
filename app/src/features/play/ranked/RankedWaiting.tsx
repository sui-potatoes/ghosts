// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A ranked match before its first turn: the opponent is found, and one squad is
 * on the map while the other is shown (`waiting.ts`). Back abandons the match,
 * behind the match screen's own prompt.
 */

import { useEffect, useLayoutEffect, useState } from "react";

import { HqCommandBar } from "../../headquarters/frame";
import {
    EmptyState,
    FocusRoot,
    Meter,
    Panel,
    ScreenFrame,
    StatusChip,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../../ui";
import { waitingView, type WaitingPhase } from "./waiting";
import "../../find-match/find-match.css";

export type RankedWaitingProps = {
    phase: WaitingPhase;
    line?: string;
    /** The reveal limit, ms. Past it, `waiting` reads as `called` and Continue is sent once. */
    deadline: number;
    /** How long the reveal may take in all, ms: the meter's span. */
    limitMs: number;
    /** `Ranked 3x3`. */
    title: string;
    busy: boolean;
    error?: string;
    clearError?: () => void;
    onContinue: () => void;
    onAbandon: () => void;
};

export function RankedWaiting(props: RankedWaitingProps) {
    const glyphs = useGlyphSet();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    // The finder's wait ends at the limit: the opponent never showed, and the match is called.
    const phase =
        props.phase === "waiting" && now > props.deadline + 2_000 ? "called" : props.phase;
    const view = waitingView({ ...props, phase, now });
    const called = phase === "called";
    const { onContinue } = props;
    useEffect(() => {
        if (called) onContinue();
        // Once, as the limit passes; Continue sends it again by hand.
    }, [called]);
    const back: Command = {
        action: "back",
        label: "Abandon",
        tone: "danger",
        deny: props.busy ? "Saving a change" : undefined,
        run: props.onAbandon,
    };
    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Match", props.title]}
                status={<StatusChip label="Match" value={view.headline} state="live" />}
                columns="minmax(0, 480px)"
                commands={
                    <HqCommandBar
                        glyphs={glyphs}
                        error={props.error ?? ""}
                        clearError={props.clearError ?? (() => {})}
                    />
                }
            >
                <Body {...props} view={view} back={back} now={now} />
            </ScreenFrame>
        </FocusRoot>
    );
}

function Body({
    view,
    back,
    deadline,
    limitMs,
    onContinue,
    now,
}: RankedWaitingProps & { view: ReturnType<typeof waitingView>; back: Command; now: number }) {
    const store = useFocusStore();
    useLayoutEffect(() => {
        store.focus("ranked-waiting", false);
    }, [store]);
    const commands: Command[] = view.action
        ? [
              {
                  action: "confirm",
                  label: view.action.label,
                  tone: "primary",
                  deny: view.action.deny,
                  run: onContinue,
              },
              back,
          ]
        : [back];
    return (
        <Panel label="Ranked match" className="gui-find-panel">
            <div className="gui-find-mark" data-pending={view.pending ? "" : undefined} />
            <EmptyState
                id="ranked-waiting"
                group="waiting"
                title={view.headline}
                hint={view.note}
                headline={view.headline}
                action={view.action?.label ?? back.label}
                instant={!!view.action}
                commands={commands}
            >
                {view.note}
            </EmptyState>
            {view.left !== null && (
                <Meter
                    label="Time to show the squad"
                    value={Math.max(0, deadline - now)}
                    max={limitMs}
                    readout={view.left}
                />
            )}
        </Panel>
    );
}
