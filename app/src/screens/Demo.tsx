// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    closeEncounterDebrief,
    deployedIntel,
    Encounter,
    type EncounterDebrief,
    openBriefing,
    restartEncounter,
    paperTrail,
} from "@ghosts/engine";
import { savedRecruits, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DemoDebrief } from "../features/debrief/DemoDebrief";
import { engineSettings } from "../engineSettings";
import { useBack } from "../hooks/useBack";
import { PauseMenu } from "../PauseMenu";

/**
 * How the demo ends: the podium debrief (the diorama a match ends on) when
 * true, the engine's own after-action card screen when false.
 */
const PODIUM_DEBRIEF = true;

/**
 * The Tokyo street encounter. The engine handles its own keys and reports a
 * cancel it did not use (no targeting, no dialog open); this screen answers
 * with the pause menu and freezes the encounter while it is up. Leaving the
 * route unmounts the encounter, which releases its renderer and audio.
 */
export default function Demo({ office = false }: { office?: boolean }) {
    const navigate = useNavigate();
    const [paused, setPaused] = useState(false);
    // The podium debrief, up from the encounter's end until the field or a redeploy.
    const [debrief, setDebrief] = useState<EncounterDebrief | null>(null);
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
                intel={deployedIntel}
                settings={engineSettings}
                paused={paused || !!debrief}
                onDebrief={PODIUM_DEBRIEF ? setDebrief : undefined}
                onPause={() => setPaused(true)}
                onQuit={() => navigate("/")}
            />
            {debrief && (
                <div className="fixed inset-0 z-10 bg-surface">
                    <DemoDebrief
                        debrief={debrief}
                        squad={squad}
                        onField={() => {
                            setDebrief(null);
                            closeEncounterDebrief();
                        }}
                        onRedeploy={() => {
                            setDebrief(null);
                            restartEncounter();
                        }}
                        onQuit={() => navigate("/")}
                    />
                </div>
            )}
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
