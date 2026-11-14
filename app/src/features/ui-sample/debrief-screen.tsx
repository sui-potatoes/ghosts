// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Debrief in the sample: the product's debrief (`../debrief`) over SAMPLE
 * results (`?debrief=win|costly|wipe`, or the chooser in the corner) and the
 * sample's roster. Nothing here is a real match.
 */

import type { Recruit } from "@ghosts/squad/types";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";

import { FocusCommandBar, ScreenFrame, StatusChip, Stepper, type GlyphSet } from "../../ui";
import { DebriefView, hireCommand } from "../debrief/Debrief";
import { debriefOf } from "../debrief/result";
import { FIXTURES, fixtureResult, type FixtureKind } from "./debrief";

/** Which sample result the debrief shows; `?debrief=` picks it on load. */
export function useDebriefState() {
    const [fixture, setFixture] = useState<FixtureKind>(() => {
        const asked = new URLSearchParams(window.location.search).get("debrief");
        return FIXTURES.some((f) => f.id === asked) ? (asked as FixtureKind) : "costly";
    });
    return { fixture, setFixture };
}

export type DebriefState = ReturnType<typeof useDebriefState>;

type Props = {
    state: DebriefState;
    /** The roster and who stood on the podiums when the squad deployed. */
    roster: Recruit[];
    podiums: (string | null)[];
    rank: (id: string) => { rank: string; xp: number };
    glyphs: GlyphSet;
    frame: {
        siblings: ComponentProps<typeof ScreenFrame>["siblings"];
        onLeave: () => void;
        overlay: ReactNode;
    };
    /** Continue: back to mission prep. */
    onContinue: () => void;
};

export function Debrief({ state, roster, podiums, rank, glyphs, frame, onContinue }: Props) {
    const { fixture, setFixture } = state;
    const [hired, setHired] = useState(false);
    const [shown, setShown] = useState(fixture);
    if (shown !== fixture) {
        setShown(fixture);
        setHired(false);
    }

    // The deployed squad, in podium order; nobody missing in between.
    const figures = useMemo(
        () =>
            podiums
                .map((id) => roster.find((r) => r.id === id) ?? null)
                .filter((r): r is Recruit => !!r),
        [podiums, roster],
    );
    const debrief = useMemo(() => {
        const squad = figures.map((r) => ({
            objectId: r.id,
            name: r.callsign,
            rank: rank(r.id).rank,
            xp: rank(r.id).xp,
        }));
        return debriefOf(fixtureResult(fixture, squad, roster.length));
        // `rank` is a fixture by roster position: stable for these figures.
    }, [fixture, figures, roster.length]);
    const slots = useMemo(
        () => Array.from({ length: debrief.plates.length }, (_, i) => figures[i] ?? null),
        [figures, debrief.plates.length],
    );

    return (
        <DebriefView
            debrief={debrief}
            figures={slots}
            resetKey={fixture}
            frame={{
                location: ["HQ", "Debrief"],
                onLeave: frame.onLeave,
                siblings: frame.siblings,
                commands: <FocusCommandBar glyphs={glyphs} />,
                overlay: frame.overlay,
                status: hired ? <StatusChipHired /> : undefined,
            }}
            primary={{ label: "Continue", hint: "Back to mission prep", run: onContinue }}
            replacement={hireCommand(debrief.replacement, { hired }, () => setHired(true))}
            corner={<FixtureChooser value={fixture} onChange={setFixture} />}
        />
    );
}

function StatusChipHired() {
    return <StatusChip label="Roster" value="Recruits hired" />;
}

/** The sample result, as a small chooser in the diorama's corner. */
function FixtureChooser({
    value,
    onChange,
}: {
    value: FixtureKind;
    onChange: (id: FixtureKind) => void;
}) {
    return (
        <div className="uis-cap">
            <Stepper
                id="debrief-fixture"
                group="fixture"
                label="Result"
                options={FIXTURES.map((f) => [f.id, f.label])}
                value={value}
                onChange={(id) => onChange(id as FixtureKind)}
                title="Match result (sample)"
                hint="Sample results over the deployed squad"
                commands={[{ action: "nav", label: "Change", glyph: "lr" }]}
            />
        </div>
    );
}
