// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Encounter, openBriefing, restartEncounter, paperTrail } from "@ghosts/engine";
import { savedRecruits, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { engineSettings } from "../engineSettings";
import { useBack } from "../hooks/useBack";
import { PauseMenu } from "../PauseMenu";

/**
 * The Tokyo street encounter. The engine handles its own keys and reports a
 * cancel it did not use (no targeting, no dialog open); this screen answers
 * with the pause menu and freezes the encounter while it is up. Leaving the
 * route unmounts the encounter, which releases its renderer and audio.
 */
export default function Demo({ office = false }: { office?: boolean }) {
    const navigate = useNavigate();
    const [paused, setPaused] = useState(false);
    // The roster as saved when the encounter starts; playing never writes it back.
    const [squad] = useState(() => {
        try {
            return savedRecruits(localStorage.getItem(SQUAD_STORAGE_KEY));
        } catch {
            return null;
        }
    });

    // A back key the engine did not take (still loading, focus elsewhere) pauses too.
    useBack(() => setPaused(true));

    return (
        <div className="fixed inset-0 h-dvh w-full bg-surface">
            <Encounter
                key={office ? "office" : "kora"}
                scenario={office ? paperTrail : undefined}
                squad={squad}
                settings={engineSettings}
                paused={paused}
                onPause={() => setPaused(true)}
                onQuit={() => navigate("/")}
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
                onQuit={() => navigate("/")}
            />
        </div>
    );
}
