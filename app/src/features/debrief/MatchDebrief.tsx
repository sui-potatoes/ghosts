// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The result of a match, in the shared interface (the debrief diorama over
 * real data): the deployed squad on its podiums, lights out for the fallen,
 * experience and promotions for the survivors, the outcome, rating change
 * and the opponent. `screens/Match.tsx` builds the `MatchResult` from the
 * `Game` and the `Account`; this only presents it.
 *
 * Commands: the primary is Wrap up while the game is still on the `Account`
 * (the survivors are not home yet), then Continue to the menu. Back leaves for
 * the menu too (`useGoUp`: hierarchical, see `routes.ts`). There is no
 * "play again" here: a new match starts from the menu's Find Match.
 */

import { useMemo, useState } from "react";

import type { Recruit } from "@ghosts/squad/types";
import { useGoUp } from "../../hooks/useGoUp";
import { FocusRoot, StatusChip, useGlyphSet } from "../../ui";
import { HqCommandBar } from "../headquarters/frame";
import { DebriefView, hireCommand } from "./Debrief";
import { debriefOf, type MatchResult } from "./result";

export type MatchDebriefProps = {
    result: MatchResult;
    /** The deployed squad's figures (`figuresOf`), in the order of `result.squad`. */
    figures: Recruit[];
    /** The game is wrapped up: the survivors are home. */
    gone: boolean;
    /** A transaction is in flight. */
    busy: boolean;
    error: string;
    clearError: () => void;
    /** Send the wrap-up now. */
    onWrapUp: () => void;
    /** Top the roster up (`hire_recruits`). */
    onHire: () => void;
};

export function MatchDebrief(props: MatchDebriefProps) {
    const leave = useGoUp();
    return (
        <FocusRoot back={{ action: "back", label: "Menu", run: leave }}>
            <Screen {...props} leave={leave} />
        </FocusRoot>
    );
}

function Screen({
    result,
    figures: squad,
    gone,
    busy,
    error,
    clearError,
    onWrapUp,
    onHire,
    leave,
}: MatchDebriefProps & { leave: () => void }) {
    const glyphs = useGlyphSet();
    const [hired, setHired] = useState(false);
    const debrief = useMemo(() => debriefOf(result), [result]);
    const figures = useMemo(() => {
        return Array.from({ length: debrief.plates.length }, (_, i) => squad[i] ?? null);
    }, [squad, debrief.plates.length]);

    const hire = hireCommand(debrief.replacement, { hired, busy }, () => {
        setHired(true);
        onHire();
    });

    return (
        <DebriefView
            debrief={debrief}
            figures={figures}
            frame={{
                location: ["Match", "Result"],
                onLeave: leave,
                status: (
                    <>
                        {!gone && <StatusChip label="Match" value="Wrapping up" state="busy" />}
                        {hired && <StatusChip label="Roster" value="Recruits hired" />}
                    </>
                ),
                commands: <HqCommandBar glyphs={glyphs} error={error} clearError={clearError} />,
            }}
            primary={
                gone
                    ? { label: "Continue", hint: "Back to the menu", run: leave }
                    : {
                          label: "Wrap up",
                          hint: "Send the survivors home",
                          run: onWrapUp,
                          deny: busy ? "Wrapping up" : undefined,
                      }
            }
            replacement={hire}
        />
    );
}
