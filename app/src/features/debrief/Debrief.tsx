// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The match result on the same diorama squad selection uses. The squad that
 * was deployed stands on the podiums; on entering, the podiums resolve one at a
 * time, left to right: a survivor stays in its light and its plate fills with
 * the experience earned (a promotion changes the insignia), a fallen
 * operative's light goes out and leaves the figure a silhouette on a dark
 * plinth, its plate reading KIA. Any input skips to the end; reduced motion
 * shows the end at once.
 *
 * Presentational: the plates come from `result.ts`, the figures and the
 * commands from the host (`MatchDebrief.tsx` for a match, the `/ui-sample`
 * debrief for fixtures).
 */

import type { Recruit } from "@ghosts/squad/types";
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";

import { uiResolve } from "../../audio";
import { FocusScope, Icon, ScreenFrame, useFocusable, useFocusState, type Command } from "../../ui";
import { rankIcon } from "../headquarters/squad/ranks";
import type { Anchor } from "../squad-view/podium-scene";
import { Podium, PodiumCanvas } from "../squad-view/podiums";
import {
    promotionBonus,
    rankLabels,
    type Debrief as DebriefData,
    type Plate,
    type Replacement,
} from "./result";
import "./debrief.css";

/** The pause before the first podium resolves, and between the next ones (ms). */
const FIRST_BEAT = 700;
const BEAT = 1100;
/** One inspect step: a quarter turn of the figure. */
const TURN_STEP = Math.PI / 4;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type DebriefViewProps = {
    debrief: DebriefData;
    /** One per podium, left to right; null where nobody stood. Its length is the podium count. */
    figures: (Recruit | null)[];
    /** A new result (not an update of this one) starts the reveal over. */
    resetKey?: string;
    frame: {
        location: string[];
        onLeave: () => void;
        siblings?: React.ComponentProps<typeof ScreenFrame>["siblings"];
        status?: ReactNode;
        commands: ReactNode;
        overlay?: ReactNode;
    };
    /** The screen's primary once the reveal is over. */
    primary: { label: string; hint: string; run: () => void; deny?: string };
    /** The fallen podium's extra command (hiring), when there is one. */
    replacement?: Command | null;
    /** Something over the diorama's corner (the sample's result chooser). */
    corner?: ReactNode;
};

export function DebriefView({
    debrief,
    figures,
    resetKey = "",
    frame,
    primary,
    replacement = null,
    corner,
}: DebriefViewProps) {
    const store = useFocusState();
    const count = figures.length;
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    /** How many podiums have resolved, left to right. */
    const [resolved, setResolved] = useState(() => (reducedMotion() ? count : 0));
    /** Lights change without their fade: reduced motion, a skip, a fresh start. */
    const [instant, setInstant] = useState(true);
    const [inspecting, setInspecting] = useState<number | null>(null);
    const [turn, setTurn] = useState(0);

    const plates = debrief.plates;
    const platesNow = useRef(plates);
    platesNow.current = plates;
    const revealing = resolved < count;

    // A new result starts over: every light up, then the podiums resolve.
    const [shown, setShown] = useState(resetKey);
    if (shown !== resetKey) {
        setShown(resetKey);
        setInspecting(null);
        setTurn(0);
        setInstant(true);
        setResolved(reducedMotion() ? count : 0);
    }

    // The reveal: one podium per beat, once the figures stand.
    useEffect(() => {
        if (!revealing || stage.loading) return;
        const timer = window.setTimeout(
            () => {
                const plate = platesNow.current[resolved];
                if (plate?.kind === "kia") uiResolve("fallen");
                else if (plate?.kind === "home") uiResolve(plate.promoted ? "promoted" : "home");
                setInstant(false);
                setResolved((n) => n + 1);
            },
            resolved === 0 ? FIRST_BEAT : BEAT,
        );
        return () => window.clearTimeout(timer);
    }, [revealing, resolved, stage.loading]);

    const skip = () => {
        setInstant(true);
        setResolved(count);
    };

    // After the reveal the cursor rests on the primary.
    useLayoutEffect(() => {
        if (!revealing) store.focus("debrief-continue", false);
    }, [revealing, store]);
    useLayoutEffect(() => store.relayout(), [store, anchors]);

    const lit = plates.map((plate, i) => {
        if (plate.kind === "vacant") return false;
        return plate.kind === "home" || i >= resolved;
    });
    const focusedId = store.node(store.focused)?.id ?? "";
    const focusIndex =
        inspecting ?? (focusedId.startsWith("podium-") ? Number(focusedId.slice(7)) : null);

    const stopInspect = () => {
        setInspecting(null);
        setTurn(0);
    };
    // A click on another podium ends the inspection.
    useEffect(() => {
        if (inspecting !== null && focusedId !== `podium-${inspecting}`) stopInspect();
    }, [inspecting, focusedId]);

    const podiumCommands = (i: number): Command[] => {
        const plate = plates[i];
        if (plate.kind === "vacant") return [];
        if (inspecting === i)
            return [
                {
                    action: "confirm",
                    label: "Turn",
                    tone: "primary",
                    run: () => setTurn((a) => a + TURN_STEP),
                },
                { action: "back", label: "Done", run: stopInspect },
            ];
        return [
            {
                action: "confirm",
                label: "Inspect",
                tone: "primary",
                run: () => {
                    setTurn(0);
                    setInspecting(i);
                },
            },
            ...(plate.kind === "kia" && replacement ? [replacement] : []),
        ];
    };

    const turnBy = (dir: "up" | "down" | "left" | "right") => {
        if (dir === "left") setTurn((a) => a - TURN_STEP);
        else if (dir === "right") setTurn((a) => a + TURN_STEP);
        return true;
    };

    const { rating } = debrief;
    const parts = useMemo(
        () => [debrief.opponent && `vs ${debrief.opponent}`, debrief.note],
        [debrief],
    );

    return (
        <ScreenFrame
            location={frame.location}
            onLocation={frame.onLeave}
            siblings={frame.siblings}
            status={frame.status}
            columns="minmax(0, 1fr)"
            commands={frame.commands}
            overlay={frame.overlay}
        >
            <section
                className="sqv-diorama"
                data-debrief=""
                data-instant={instant || undefined}
                onPointerDown={revealing ? skip : undefined}
            >
                <PodiumCanvas
                    key={count}
                    figures={figures}
                    focus={revealing ? null : focusIndex}
                    lit={lit}
                    instant={instant}
                    inspect={inspecting}
                    turn={inspecting !== null ? turn : undefined}
                    onAnchors={setAnchors}
                    onState={setStage}
                />
                <header className="dbf-outcome" data-tone={debrief.tone}>
                    <span className="dbf-outcome-title">{debrief.title}</span>
                    {(rating || parts.some(Boolean)) && (
                        <span className="dbf-outcome-lines">
                            {parts.map(
                                (p) =>
                                    p && (
                                        <span className="dbf-outcome-line" key={p}>
                                            {p}
                                        </span>
                                    ),
                            )}
                            {rating && (
                                <span className="dbf-outcome-line">
                                    Rating {rating.after} <b>{signed(rating.delta)}</b>
                                </span>
                            )}
                        </span>
                    )}
                </header>
                {!revealing && corner}
                {plates.map((plate, i) => (
                    <Podium
                        key={i}
                        index={i}
                        anchor={anchors[i]}
                        title={plateTitle(plate, i)}
                        hint={plateHint(plate, i < resolved)}
                        commands={podiumCommands(i)}
                        directions={inspecting === i ? turnBy : undefined}
                    >
                        <ResultPlate plate={plate} done={i < resolved} instant={instant} />
                    </Podium>
                ))}
                {revealing ? (
                    <FocusScope
                        id="debrief-reveal"
                        back={{ action: "back", label: "Skip", run: skip }}
                    >
                        <Plaque id="debrief-skip" label="Skip" hint="Show the result" run={skip} />
                    </FocusScope>
                ) : (
                    <Plaque
                        id="debrief-continue"
                        label={primary.label}
                        hint={primary.hint}
                        run={primary.run}
                        deny={primary.deny}
                    />
                )}
                {stage.loading && <div className="gui-stage-status">Bringing the squad in</div>}
                {stage.error && (
                    <div className="gui-stage-status" data-error>
                        The squad could not be shown
                    </div>
                )}
            </section>
        </ScreenFrame>
    );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The fallen podium's hire command, from what the contract allows right now. */
export function hireCommand(
    replacement: Replacement | null,
    state: { hired: boolean; busy?: boolean },
    run: () => void,
): Command | null {
    if (!replacement) return null;
    if ("deny" in replacement)
        return { action: "reset", label: "Hire recruit", short: "Hire", deny: replacement.deny };
    return {
        action: "reset",
        label: replacement.count > 1 ? `Hire ${replacement.count} recruits` : "Hire a recruit",
        short: "Hire",
        deny: state.hired ? "Already hired" : state.busy ? "Hiring" : undefined,
        run,
    };
}

function plateTitle(plate: Plate, i: number): string {
    if (plate.kind === "vacant") return `Podium ${i + 1}`;
    if (plate.kind === "kia") return `${plate.name} · ${plate.rank} · KIA`;
    return `${plate.name} · ${plate.rankAfter}`;
}

function plateHint(plate: Plate, done: boolean): string | undefined {
    if (plate.kind === "vacant") return "Nobody deployed here";
    if (!done) return undefined;
    if (plate.kind === "kia")
        return `${plate.turn ? `Fell on turn ${plate.turn}. ` : ""}The dog tag came home; the slot is open`;
    if (plate.promoted) {
        const { aim, health } = promotionBonus(plate.rankBefore, plate.rankAfter);
        return `Promoted to ${plate.rankAfter}: aim +${aim}${health ? `, health +${health}` : ""}`;
    }
    if (plate.gained === null) return "Home";
    if (plate.gained === 0) return "No experience this match";
    if (!plate.band) return `+${plate.gained} XP · top rank`;
    return `${plate.xpAfter} / ${plate.band.end} XP to the next rank`;
}

/** A podium's engraved plate: as deployed until it resolves, then the result. */
function ResultPlate({ plate, done, instant }: { plate: Plate; done: boolean; instant: boolean }) {
    if (plate.kind === "vacant")
        return (
            <div className="sqv-plate-engraved" data-vacant>
                <span className="sqv-plate-name">Vacant</span>
            </div>
        );
    if (plate.kind === "kia" || !done) {
        const kia = plate.kind === "kia" && done;
        const r = plate.kind === "kia" ? plate.rank : plate.rankBefore;
        return (
            <div className="sqv-plate-engraved" data-kia={kia || undefined}>
                <span className="sqv-plate-head">
                    <span className="sqv-plate-name">{plate.name}</span>
                    {kia && <span className="dbf-plate-marker">KIA</span>}
                </span>
                <span className="sqv-plate-line">
                    <Icon name={rankIcon(r)} size={12} />
                    {r}
                </span>
                {kia ? (
                    <span className="sqv-plate-line dbf-plate-fate">
                        {plate.turn ? `Turn ${plate.turn} · ` : ""}Vacant
                    </span>
                ) : (
                    <span className="dbf-xp" aria-hidden />
                )}
            </div>
        );
    }
    const band = plate.band;
    const style = band ? ({ "--from": band.from, "--to": band.to } as CSSProperties) : undefined;
    return (
        <div className="sqv-plate-engraved" data-promoted={plate.promoted || undefined}>
            <span className="sqv-plate-head">
                <span className="sqv-plate-name">{plate.name}</span>
            </span>
            <RankLine plate={plate} instant={instant} />
            {plate.gained === null ? null : band ? (
                <span
                    className="dbf-xp"
                    style={style}
                    role="meter"
                    aria-label="Experience"
                    aria-valuemin={band.start}
                    aria-valuemax={band.end}
                    aria-valuenow={plate.xpAfter}
                >
                    <i className="dbf-xp-gain" />
                    <i className="dbf-xp-was" />
                </span>
            ) : (
                <span className="dbf-xp" data-full aria-hidden />
            )}
            {!!plate.gained && (
                <span className="dbf-plate-cost">
                    XP <b>+{plate.gained}</b>
                </span>
            )}
        </div>
    );
}

/** The screen's primary as a stencilled plaque: Skip while the reveal runs, then the result's own. */
function Plaque({
    id,
    label,
    hint,
    run,
    deny,
}: {
    id: string;
    label: string;
    hint: string;
    run: () => void;
    deny?: string;
}) {
    const store = useFocusState();
    const { props } = useFocusable<HTMLButtonElement>({
        id,
        group: "continue",
        title: label,
        hint,
        commands: [{ action: "confirm", label, tone: "primary", deny, run }],
        // While it is Skip, any direction skips too.
        directions:
            id === "debrief-skip"
                ? () => {
                      run();
                      return true;
                  }
                : undefined,
    });
    useLayoutEffect(() => {
        if (id === "debrief-skip") store.focus(id, false);
        // Once, as the reveal starts.
    }, []);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="sqv-plaque"
            data-refused={deny ? "" : undefined}
            {...props}
        >
            {label}
        </button>
    );
}

/** How long the old insignia stands on a promoted plate while the bar fills (ms). */
const SWAP_AT = 1100;

/**
 * A survivor's rank line. A promotion shows the old rank while the bar fills,
 * then cuts to the new one (a timer in state, so the final state never rests
 * on an animation event); skipped, instant or reduced motion shows the new
 * rank at once.
 */
function RankLine({
    plate,
    instant,
}: {
    plate: Extract<Plate, { kind: "home" }>;
    instant: boolean;
}) {
    const [swapping, setSwapping] = useState(plate.promoted && !instant && !reducedMotion());
    useEffect(() => {
        if (!swapping) return;
        const timer = window.setTimeout(() => setSwapping(false), SWAP_AT);
        return () => window.clearTimeout(timer);
    }, [swapping]);
    // A skip while it waits settles it too.
    if (swapping && instant) setSwapping(false);
    const [rank] = rankLabels(plate, swapping);
    return (
        <span className="sqv-plate-line dbf-rank-swap">
            <span className={swapping ? "dbf-rank-was" : "dbf-rank-now"} key={rank}>
                <Icon name={rankIcon(rank)} size={12} />
                {rank}
            </span>
        </span>
    );
}
