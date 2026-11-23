// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    blackRain,
    closeEncounterDebrief,
    deployedIntel,
    Encounter,
    type EncounterDebrief,
    nightShift,
    openBriefing,
    restartEncounter,
    paperTrail,
    type Scenario,
} from "@ghosts/engine";
import { playtestScenario } from "@ghosts/engine/editor";
import { savedRecruits, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { editorPath, isSlot, slotLevel } from "../editorDrafts";
import { DemoDebrief } from "../features/debrief/DemoDebrief";
import { engineSettings } from "../engineSettings";
import { useBack } from "../hooks/useBack";
import { PauseMenu } from "../PauseMenu";

/**
 * How the demo ends: the podium debrief (the diorama a match ends on) when
 * true, the engine's own after-action card screen when false.
 */
const PODIUM_DEBRIEF = true;

/** The street encounter, each game (and each restart) in a freshly drawn time of day and weather. */
const STREET: Scenario = { ...blackRain, look: "drawn" };

/** The training operations this screen plays, by route: Black Rain unless told otherwise. */
export type Operation = "black-rain" | "paper-trail" | "night-shift";

/** The encounter an operation plays; Night Shift registers its scenery on first use. */
function operationScenario(operation: Operation): Scenario {
    if (operation === "paper-trail") return paperTrail;
    if (operation === "night-shift") return nightShift();
    return STREET;
}

/**
 * An editor draft as the demo plays it (`?level=<slot>`): the scenario, or
 * why the level cannot be played (an unknown slot, deployment the rules refuse).
 */
function playtestOf(slot: string | null) {
    if (slot === null) return null;
    if (!isSlot(slot)) return { error: [`No editor level named "${slot}"`] };
    try {
        return { scenario: playtestScenario(slotLevel(slot)) };
    } catch (error) {
        return { error: String((error as Error).message ?? error).split(" · ") };
    }
}

/**
 * A training operation: the Tokyo street encounter (`/demo`), the office
 * (`/demo-2`) or Night Shift (`/demo-night-shift`). The engine handles its own keys and reports a
 * cancel it did not use (no targeting, no dialog open); this screen answers
 * with the pause menu and freezes the encounter while it is up. Leaving the
 * route unmounts the encounter, which releases its renderer and audio.
 *
 * `?level=<slot>` playtests the level editor's draft in that slot instead
 * (`/demo?level=scratch`): the same encounter on the draft's grid, and every
 * way out (pause menu, debrief) goes back to the editor on that slot.
 */
export default function Demo({ operation = "black-rain" }: { operation?: Operation }) {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const slot = params.get("level");
    // Built once per mount: the draft as it was saved when the playtest opened.
    const [playtest] = useState(() => playtestOf(slot));
    const [scenario] = useState(() => playtest?.scenario ?? operationScenario(operation));
    const quit = () =>
        navigate(slot !== null ? editorPath(isSlot(slot) ? slot : "scratch") : "/play/training");
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
    useBack(() => (playtest?.error ? quit() : setPaused(true)));

    if (playtest?.error)
        return (
            <main className="fixed inset-0 flex h-dvh w-full items-center justify-center bg-surface px-4">
                <div className="flex w-full max-w-md flex-col gap-4 border border-line bg-surface px-6 py-5">
                    <h1 className="label">This level cannot be playtested</h1>
                    <ul className="flex flex-col gap-1 text-xs leading-relaxed text-secondary">
                        {playtest.error.map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                    <button className="btn self-start" autoFocus onClick={quit}>
                        Back to the editor
                    </button>
                </div>
            </main>
        );

    return (
        <div className="fixed inset-0 h-dvh w-full bg-surface">
            <Encounter
                key={playtest ? `level:${slot}` : operation}
                scenario={scenario}
                squad={squad}
                intel={deployedIntel}
                settings={engineSettings}
                paused={paused || !!debrief}
                onDebrief={PODIUM_DEBRIEF ? setDebrief : undefined}
                onPause={() => setPaused(true)}
                onQuit={quit}
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
                        onQuit={quit}
                        quitLabel={slot !== null ? "Editor" : undefined}
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
                onQuit={quit}
                quitLabel={slot !== null ? "Back to editor" : undefined}
            />
        </div>
    );
}
