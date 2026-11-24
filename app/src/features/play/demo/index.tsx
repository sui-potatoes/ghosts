// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play/training`: the single-player operations as a mission console (the
 * pieces in `features/missions`): the operations queue, the situation board
 * locked on one of them, the briefing with the commit, and the status strip.
 * This file only maps the trainings onto missions (`missions.ts`) and deploys
 * to each one's route. No sign-in, no account. Back returns to Play; leaving
 * an operation returns here.
 */

import { Suspense, use, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useGoUp } from "../../../hooks/useGoUp";
import {
    FocusCommandBar,
    FocusRoot,
    Panel,
    ScreenFrame,
    StatusChip,
    useGlyphSet,
    type Command,
} from "../../../ui";
import {
    BriefingPanel,
    OpsBoard,
    OpsConsole,
    OpsQueue,
    StatusStrip,
    tally,
    useLockedMission,
    type Mission,
    type Readout,
} from "../../missions";
import { DEMO_SCENARIOS } from "../model";
import { loadTrainingSource, trainingMissions, type TrainingSource } from "./missions";

export function DemoScreen() {
    const leave = useGoUp();
    const glyphs = useGlyphSet();
    const back: Command = { action: "back", label: "Back", run: leave };
    const frame = { location: ["Play", "Training"], onLocation: leave, columns: "minmax(0, 1fr)" };
    return (
        <FocusRoot back={back}>
            <Suspense
                fallback={
                    <ScreenFrame {...frame} commands={<FocusCommandBar glyphs={glyphs} />}>
                        <OpsConsole>
                            <Panel label="Operations" className="gui-ops-queue">
                                {null}
                            </Panel>
                            <Panel label="Situation" className="gui-ops-board">
                                {null}
                            </Panel>
                            <Panel label="Briefing" className="gui-ops-briefing">
                                {null}
                            </Panel>
                        </OpsConsole>
                    </ScreenFrame>
                }
            >
                <Console source={loadTrainingSource()} frame={frame} />
            </Suspense>
        </FocusRoot>
    );
}

type FrameProps = { location: string[]; onLocation: () => void; columns: string };

function Console({ source, frame }: { source: Promise<TrainingSource>; frame: FrameProps }) {
    const { engine, editor } = use(source);
    const glyphs = useGlyphSet();
    const navigate = useNavigate();
    // Read once per visit: a training finished elsewhere shows on the next one.
    const [missions] = useState(() => trainingMissions(engine, editor));
    const [asked] = useState(lastDeployed);
    const { locked, shown } = useLockedMission(missions, asked);
    const deploy = (mission: Mission) => {
        const route = DEMO_SCENARIOS.find((s) => s.id === mission.id)?.route;
        if (!route) return;
        rememberDeployed(mission.id);
        navigate(route);
    };
    return (
        <ScreenFrame
            {...frame}
            status={<StatusChip label="Cleared" value={tally(missions)} />}
            commands={<FocusCommandBar glyphs={glyphs} />}
        >
            <OpsConsole>
                <OpsQueue missions={missions} selected={locked?.id ?? null} onDeploy={deploy} />
                <OpsBoard
                    mission={shown}
                    strip={<StatusStrip readouts={readoutsOf(shown)} clock />}
                />
                <BriefingPanel mission={shown} commit={locked} onDeploy={deploy} />
            </OpsConsole>
        </ScreenFrame>
    );
}

/** This tab's last deployment: leaving an operation brings the console back to it. */
const LAST_KEY = "ghosts:training-last";

function lastDeployed(): string | null {
    try {
        return sessionStorage.getItem(LAST_KEY);
    } catch {
        return null;
    }
}

function rememberDeployed(id: string) {
    try {
        sessionStorage.setItem(LAST_KEY, id);
    } catch {
        // No storage: the console opens on the next training instead.
    }
}

/** The strip's readouts for the mission on the board: only what it has. */
function readoutsOf(mission: Mission | null): Readout[] {
    if (!mission) return [];
    const out: Readout[] = [];
    if (mission.code) out.push({ label: "File", value: mission.code, tone: "accent" });
    out.push({ label: "Sector", value: mission.location });
    if (mission.coordinates)
        out.push({ label: "Grid ref", value: mission.coordinates.join(" "), minor: true });
    out.push({
        label: "Status",
        value: mission.state === "done" ? "Cleared" : mission.next ? "Next" : "Open",
    });
    return out;
}
