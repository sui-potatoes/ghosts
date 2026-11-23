// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    basicsTraining,
    BASICS_ID,
    closeEncounterDebrief,
    Encounter,
    openBriefing,
    restartEncounter,
} from "@ghosts/engine";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { engineSettings } from "../engineSettings";
import { markTrainingDone } from "../features/play/demo/progress";
import { useBack } from "../hooks/useBack";
import { PauseMenu } from "../PauseMenu";

/**
 * `/demo-basics`: Basics, the first training. The engine's guided run over a
 * small yard (`basicsTraining`): one order at a time, each waiting until it is
 * carried out, with its own fixed squad, fully local. Completing it is
 * remembered on the device for the training list; Skip and the pause menu's
 * Quit go back to that list. The guide's closing card is the end: no debrief.
 */
export default function Basics() {
    const navigate = useNavigate();
    const toTraining = () => navigate("/play/training");
    const [paused, setPaused] = useState(false);
    // Built once per mount: a restart replays the same run on a fresh game.
    const [training] = useState(() =>
        basicsTraining({
            onComplete: () => markTrainingDone(BASICS_ID),
            onLeave: toTraining,
            exits: [
                { label: "Play", run: () => navigate("/play") },
                { label: "Training", run: toTraining },
            ],
        }),
    );

    // A back key the engine did not take (still loading, focus elsewhere) pauses.
    useBack(() => setPaused(true));

    return (
        <div className="fixed inset-0 h-dvh w-full bg-surface">
            <Encounter
                scenario={training.scenario}
                driver={training.driver}
                squad={training.squad}
                guide={training.guide}
                settings={engineSettings}
                paused={paused}
                // The guide's closing card ends the run: the field stays, no debrief.
                onDebrief={() => closeEncounterDebrief()}
                onPause={() => setPaused(true)}
                onQuit={toTraining}
            />
            <PauseMenu
                open={paused}
                onResume={() => setPaused(false)}
                onBriefing={() => {
                    openBriefing();
                    setPaused(false);
                }}
                onRestart={() => {
                    restartEncounter();
                    setPaused(false);
                }}
                onQuit={toTraining}
            />
        </div>
    );
}
