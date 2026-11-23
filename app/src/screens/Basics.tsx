// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    basicsTraining,
    BASICS_CHAPTERS,
    BASICS_ID,
    closeEncounterDebrief,
    Encounter,
    openBriefing,
    restartEncounter,
    withChapter,
} from "@ghosts/engine";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { engineSettings } from "../engineSettings";
import { markTrainingDone } from "../features/play/demo/progress";
import { useBack } from "../hooks/useBack";
import { PauseMenu } from "../PauseMenu";
import { completedChapters, saveChapters } from "./basics-progress";

/**
 * `/demo-basics`: Basics, the first training. One continuous guided run
 * through a simulation room that rebuilds itself for each lesson
 * (`basicsTraining`): one order at a time, each waiting until it is carried
 * out, a fixed squad, fully local. `?lesson=` opens on a lesson; the card's
 * lesson list jumps between them. Lessons completed are remembered on the
 * device; the training list marks Basics done once the run is finished.
 * Skip and the pause menu's Quit go back to that list; Restart restarts the
 * lesson in play. The guide's closing card is the end: no debrief.
 */
export default function Basics() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const toTraining = () => navigate("/play/training");
    const [paused, setPaused] = useState(false);
    // Built once per mount: the lessons follow one another on the same field.
    const [training] = useState(() => {
        const run = basicsTraining(
            {
                done: completedChapters(),
                onStage: (id) => {
                    const done = withChapter(BASICS_CHAPTERS, completedChapters(), id);
                    saveChapters(done);
                    run.guide.host.done = done;
                },
                onComplete: () => markTrainingDone(BASICS_ID),
                onLeave: toTraining,
                onPlay: () => navigate("/play"),
                onTraining: toTraining,
            },
            params.get("lesson") ?? undefined,
        );
        return run;
    });

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
