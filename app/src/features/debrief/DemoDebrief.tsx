// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The end of the demo encounter on the debrief diorama: the squad that went
 * out stands on the podiums (the recruits the encounter deployed, in squad
 * order), each plate carrying the demo's record. The engine keeps the field
 * behind it and hands over the after-action report (`Encounter`'s
 * `onDebrief`); `demo.ts` turns it into plates.
 *
 * Commands: Redeploy squad is the primary, View battlefield is Reset, and
 * Back leaves for the menu.
 */

import type { EncounterDebrief } from "@ghosts/engine";
import { initialSquad } from "@ghosts/squad/model";
import type { Recruit } from "@ghosts/squad/types";
import { useMemo } from "react";

import { FocusRoot, useGlyphSet, type Command } from "../../ui";
import { HqCommandBar } from "../headquarters/frame";
import { DebriefView } from "./Debrief";
import { demoDebriefOf } from "./demo";

export type DemoDebriefProps = {
    debrief: EncounterDebrief;
    /** The roster the encounter was deployed with; the default squad when null. */
    squad: readonly Recruit[] | null;
    onField: () => void;
    onRedeploy: () => void;
    onQuit: () => void;
};

/** The figure of each unit that went out: its recruit by id, else by squad order. */
export function deployedFigures(
    ids: readonly string[],
    squad: readonly Recruit[] | null,
    podiums: number,
): (Recruit | null)[] {
    const roster = squad?.length ? squad : initialSquad().recruits;
    return Array.from({ length: podiums }, (_, i) =>
        i < ids.length ? (roster.find((r) => r.id === ids[i]) ?? roster[i] ?? null) : null,
    );
}

export function DemoDebrief(props: DemoDebriefProps) {
    return (
        <FocusRoot back={{ action: "back", label: "Menu", run: props.onQuit }}>
            <Screen {...props} />
        </FocusRoot>
    );
}

function Screen({ debrief: report, squad, onField, onRedeploy, onQuit }: DemoDebriefProps) {
    const glyphs = useGlyphSet();
    const debrief = useMemo(() => demoDebriefOf(report), [report]);
    const figures = useMemo(
        () =>
            deployedFigures(
                report.report.recruits.map((r) => r.id),
                squad,
                debrief.plates.length,
            ),
        [report, squad, debrief.plates.length],
    );
    const extras: Command[] = [
        { action: "reset", label: "View battlefield", short: "Field", run: onField },
    ];
    return (
        <DebriefView
            debrief={debrief}
            figures={figures}
            extras={extras}
            frame={{
                location: ["Demo", "After action"],
                onLeave: onQuit,
                commands: <HqCommandBar glyphs={glyphs} error="" clearError={() => {}} />,
            }}
            primary={{
                label: "Redeploy squad",
                hint: "Same squad, a fresh deployment",
                run: onRedeploy,
            }}
        />
    );
}
