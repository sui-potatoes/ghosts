// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A mock match's result on the debrief diorama (`features/debrief`): the
 * squad that went out on the podiums, the fallen dark, each plate with its
 * preset, weapon and kills; the outcome, the opponent and, for ranked, the
 * rating old → new with the rank change (`mockDebriefOf`). Play again is the
 * primary, Menu the other command and Back.
 */

import type { Recruit } from "@ghosts/squad/types";
import { useMemo } from "react";

import { FocusRoot, StatusChip, useGlyphSet, type Command } from "../../../ui";
import { DebriefView } from "../../debrief/Debrief";
import { HqCommandBar } from "../../headquarters/frame";
import {
    matchChip,
    matchTitle,
    mockDebriefOf,
    type MatchPlan,
    type MockMatch,
    type SettledMatch,
} from "./model";

export type MockDebriefProps = {
    match: MockMatch;
    plan: MatchPlan;
    settled: SettledMatch;
    /** The player's virtual recruits, in deployment order. */
    figures: Recruit[];
    onAgain: () => void;
    onMenu: () => void;
};

export function MockDebrief(props: MockDebriefProps) {
    return (
        <FocusRoot back={{ action: "back", label: "Menu", run: props.onMenu }}>
            <Screen {...props} />
        </FocusRoot>
    );
}

function Screen({ match, plan, settled, figures: squad, onAgain, onMenu }: MockDebriefProps) {
    const glyphs = useGlyphSet();
    const debrief = useMemo(() => mockDebriefOf(match, plan, settled), [match, plan, settled]);
    const figures = useMemo(
        () => Array.from({ length: debrief.plates.length }, (_, i) => squad[i] ?? null),
        [squad, debrief.plates.length],
    );
    const extras: Command[] = [{ action: "reset", label: "Menu", short: "Menu", run: onMenu }];
    return (
        <div className="fixed inset-0 z-10 bg-surface">
            <DebriefView
                debrief={debrief}
                figures={figures}
                resetKey={settled.id}
                extras={extras}
                frame={{
                    location: ["Play", matchTitle(match), "Result"],
                    onLeave: onMenu,
                    status: <StatusChip label="Match" value={matchChip(match)} />,
                    commands: <HqCommandBar glyphs={glyphs} error="" clearError={() => {}} />,
                }}
                primary={{
                    label: "Play again",
                    hint:
                        match.kind === "ranked" ? "Back to the squad builder" : "Back to Friendly",
                    run: onAgain,
                }}
            />
        </div>
    );
}
