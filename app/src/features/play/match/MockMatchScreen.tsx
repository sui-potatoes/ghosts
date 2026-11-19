// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play/match`: the staged mock match from the versus card through the field
 * to the debrief.
 *
 * - Nothing staged: a short empty state back to `/play`.
 * - The versus card: both names, the player's rank and the opponent's rating,
 *   size and kind, the squad going out. Deploy mounts the encounter.
 * - The field: `<Encounter>` on the match scenario (`scenario.ts`), the
 *   player's units as virtual recruits, the opponent's run by the AI. The
 *   pause menu has Resume, Options and Forfeit (a commit row), no Restart.
 * - The result: settled once per match (`settleMatch`), then the podium
 *   debrief with the field unmounted. Play again returns to `returnTo`, Menu
 *   to `/play`; both forget the staged match.
 *
 * A reload mid-match starts the same match over from the versus card (no
 * rating change); a reload on the debrief shows the same result again. The
 * browser's Back leaves the match without a result, as a reload would.
 */

import {
    deployedIntel,
    Encounter,
    encounterSnapshot,
    type EncounterDebrief,
    type OpponentIntel,
} from "@ghosts/engine";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { engineSettings } from "../../../engineSettings";
import { useBack } from "../../../hooks/useBack";
import { usePlayerName } from "../../../hooks/usePlayerName";
import {
    ActionRow,
    EmptyState,
    FocusCommandBar,
    FocusRoot,
    Panel,
    ScreenFrame,
    StatusChip,
    useFocusStore,
    useGlyphSet,
} from "../../../ui";
import { tierOf } from "../economy";
import { useRating } from "../rating";
import { MatchPause } from "./MatchPause";
import { MockDebrief } from "./MockDebrief";
import {
    LEVEL_NAME,
    MATCH_KEY,
    matchPlan,
    matchChip,
    matchTitle,
    outcomeOf,
    parseMatch,
    gearLine,
    presetName,
    readSettled,
    RESULT_KEY,
    sessionSlot,
    settleMatch,
    virtualRecruits,
    type MatchOutcome,
    type MatchPlan,
    type MockMatch,
    type SettledMatch,
} from "./model";
import { matchScenario } from "./scenario";
import "./match.css";

export default function MockMatchScreen() {
    // Read once per mount: the match as it was staged when the route opened.
    const [match] = useState(() => parseMatch(sessionSlot(MATCH_KEY).get()));
    return match ? <Play match={match} /> : <NoMatch />;
}

function forget() {
    sessionSlot(MATCH_KEY).set(null);
    sessionSlot(RESULT_KEY).set(null);
}

function NoMatch() {
    const navigate = useNavigate();
    const glyphs = useGlyphSet();
    const toPlay = () => navigate("/play", { replace: true });
    return (
        <FocusRoot back={{ action: "back", label: "Play", run: toPlay }}>
            <ScreenFrame
                location={["Play", "Match"]}
                onLocation={toPlay}
                columns="minmax(0, 1fr)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <div className="gui-mm gui-mm-empty">
                    <Panel>
                        <EmptyState
                            id="mm-none"
                            group="mm"
                            instant
                            headline="No match to play"
                            action="Play"
                            title="Play"
                            hint="Pick a mode to start a match"
                            commands={[
                                { action: "confirm", label: "Play", tone: "primary", run: toPlay },
                            ]}
                        >
                            Start a ranked or friendly match from Play.
                        </EmptyState>
                    </Panel>
                </div>
            </ScreenFrame>
        </FocusRoot>
    );
}

function Play({ match }: { match: MockMatch }) {
    const navigate = useNavigate();
    const plan = useMemo(() => matchPlan(match), [match]);
    const recruits = useMemo(() => virtualRecruits(plan.player, plan.seed), [plan]);
    const [settled, setSettled] = useState<SettledMatch | null>(() =>
        readSettled(sessionSlot(RESULT_KEY), plan.id),
    );
    const [field, setField] = useState(false);

    const finish = (outcome: MatchOutcome, debrief: EncounterDebrief) =>
        setSettled(settleMatch(match, outcome, debrief));
    const leave = (to: string) => {
        forget();
        navigate(to, { replace: true });
    };

    if (settled)
        return (
            <MockDebrief
                match={match}
                plan={plan}
                settled={settled}
                figures={recruits}
                onAgain={() => leave(match.returnTo)}
                onMenu={() => leave("/play")}
            />
        );
    if (!field)
        return (
            <Intro
                match={match}
                plan={plan}
                onDeploy={() => setField(true)}
                onLeave={() => leave(match.returnTo)}
            />
        );
    return <Field match={match} plan={plan} recruits={recruits} onEnd={finish} />;
}

// === The versus card ===

function Intro({
    match,
    plan,
    onDeploy,
    onLeave,
}: {
    match: MockMatch;
    plan: MatchPlan;
    onDeploy: () => void;
    onLeave: () => void;
}) {
    const glyphs = useGlyphSet();
    const title = matchTitle(match);
    return (
        <FocusRoot back={{ action: "back", label: "Leave", run: onLeave }}>
            <ScreenFrame
                location={["Play", title]}
                onLocation={onLeave}
                status={<StatusChip label="Match" value={matchChip(match)} />}
                columns="minmax(0, 1fr)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <IntroBody match={match} plan={plan} onDeploy={onDeploy} />
            </ScreenFrame>
        </FocusRoot>
    );
}

function IntroBody({
    match,
    plan,
    onDeploy,
}: {
    match: MockMatch;
    plan: MatchPlan;
    onDeploy: () => void;
}) {
    const store = useFocusStore();
    const rating = useRating();
    const { name } = usePlayerName();
    useLayoutEffect(() => {
        store.focus("mm-deploy", false);
        // Once, on arrival.
    }, [store]);
    const side = plan.player;
    return (
        <div className="gui-mm">
            <div className="gui-mm-versus">
                <div className="gui-mm-side">
                    <span className="gui-mm-eyebrow">Player</span>
                    <span className="gui-mm-name">{name || "You"}</span>
                    <span className="gui-mm-meta">
                        {tierOf(rating.rating).name} · {rating.rating}
                    </span>
                </div>
                <span className="gui-mm-vs" aria-label="versus">
                    VS
                </span>
                <div className="gui-mm-side" data-side="b">
                    <span className="gui-mm-eyebrow">Opponent</span>
                    <span className="gui-mm-name">{match.opponent.name}</span>
                    <span className="gui-mm-meta">
                        {tierOf(match.opponent.rating).name} · {match.opponent.rating}
                    </span>
                </div>
            </div>
            <p className="gui-mm-facts">
                {matchTitle(match)} · {LEVEL_NAME} ·{" "}
                {match.kind === "ranked" ? "Rating at stake" : "Rating unchanged"}
                {match.rule ? ` · Squads: ${match.rule.label}` : ""}
            </p>
            <div className="gui-mm-squads">
                <SquadPanel label="Your squad" side={side} />
                <SquadPanel label="Their squad" side={plan.opponent} />
            </div>
            <div className="gui-mm-go">
                <ActionRow
                    id="mm-deploy"
                    group="mm"
                    label="Deploy"
                    title="Deploy"
                    hint={`${side.ids.length} against ${plan.opponent.ids.length} on ${LEVEL_NAME}`}
                    instant
                    commands={[
                        { action: "confirm", label: "Deploy", tone: "primary", run: onDeploy },
                    ]}
                />
            </div>
        </div>
    );
}

/** One side's squad on the versus card: callsign, preset (and that it was modified), the gear by its economy names. */
function SquadPanel({ label, side }: { label: string; side: MatchPlan["player"] }) {
    return (
        <Panel label={label} meta={`${side.ids.length} units`} className="gui-mm-squad">
            {side.ids.map((id, i) => (
                <div key={id} className="gui-mm-unit">
                    <span className="gui-mm-sign">{side.callsigns[i]}</span>
                    <span className="gui-mm-preset">{presetName(side.loadouts[i])}</span>
                    <span className="gui-mm-gear">{gearLine(side.loadouts[i])}</span>
                </div>
            ))}
        </Panel>
    );
}

// === The field ===

/** QA builds only (`VITE_MATCH_QA=1`): end the match from the console, `__mockMatch.finish("victory")`. */
const QA = !!import.meta.env.VITE_MATCH_QA;

function Field({
    match,
    plan,
    recruits,
    onEnd,
}: {
    match: MockMatch;
    plan: MatchPlan;
    recruits: ReturnType<typeof virtualRecruits>;
    onEnd: (outcome: MatchOutcome, debrief: EncounterDebrief) => void;
}) {
    const [paused, setPaused] = useState(false);
    // Built once per mount: registers the level's scenery and fixes the units.
    const [scenario] = useState(() => matchScenario(match, plan));
    const opponent = useMemo<OpponentIntel>(
        () => ({ name: match.opponent.name, rating: match.opponent.rating }),
        [match],
    );
    const end = useRef(onEnd);
    end.current = onEnd;

    // A back key the engine did not take (still loading, focus elsewhere) pauses too.
    useBack(paused ? null : () => setPaused(true));

    useEffect(() => {
        if (!QA) return;
        const qa = {
            finish(outcome: MatchOutcome = "victory") {
                const snap = encounterSnapshot();
                end.current(outcome, {
                    ...snap,
                    report: { ...snap.report, victory: outcome === "victory" },
                });
            },
        };
        (window as unknown as { __mockMatch?: typeof qa }).__mockMatch = qa;
        return () => {
            delete (window as unknown as { __mockMatch?: typeof qa }).__mockMatch;
        };
    }, []);

    return (
        <div className="fixed inset-0 h-dvh w-full bg-surface">
            <Encounter
                key={plan.id}
                scenario={scenario}
                squad={recruits}
                intel={deployedIntel}
                settings={engineSettings}
                opponent={opponent}
                paused={paused}
                onDebrief={(debrief) => end.current(outcomeOf(debrief.report), debrief)}
                onPause={() => setPaused(true)}
            />
            <MatchPause
                open={paused}
                ranked={match.kind === "ranked"}
                onResume={() => setPaused(false)}
                onForfeit={() => {
                    setPaused(false);
                    end.current("forfeit", encounterSnapshot());
                }}
            />
        </div>
    );
}
