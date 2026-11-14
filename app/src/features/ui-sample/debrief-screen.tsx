// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * HQ / Debrief: the match result on the same diorama mission prep uses. The
 * squad that was deployed stands on the three podiums; on entering, the
 * podiums resolve one at a time, left to right: a survivor stays in its light
 * and its plate fills with the experience earned (a promotion changes the
 * insignia), a fallen operative's light goes out and leaves the figure a
 * silhouette on a dark plinth, its plate reading KIA. Any input skips to the
 * end; reduced motion shows the end at once.
 *
 * The plates come from `debrief.ts`, which maps a result shaped like the
 * chain's; the result itself is a SAMPLE fixture (`?debrief=win|costly|wipe`,
 * or the chooser in the corner).
 */

import type { Recruit } from "@ghosts/squad/types";
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    type ComponentProps,
    type CSSProperties,
    type ReactNode,
} from "react";

import { uiResolve } from "../../audio";
import {
    FocusCommandBar,
    FocusScope,
    Icon,
    ScreenFrame,
    StatusChip,
    Stepper,
    useFocusable,
    useFocusState,
    type Command,
    type GlyphSet,
} from "../../ui";
import { rankIcon } from "./data";
import {
    debriefOf,
    FIXTURES,
    fixtureResult,
    promotionBonus,
    type FixtureKind,
    type Plate,
    type Replacement,
} from "./debrief";
import type { Anchor } from "../squad-view/podium-scene";
import { Podium, PodiumCanvas } from "../squad-view/podiums";

/** The pause before the first podium resolves, and between the next ones (ms). */
const FIRST_BEAT = 700;
const BEAT = 1100;
/** One inspect step: a quarter turn of the figure. */
const TURN_STEP = Math.PI / 4;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    const store = useFocusState();
    const { fixture, setFixture } = state;
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    /** How many podiums have resolved, left to right. */
    const [resolved, setResolved] = useState(() => (reducedMotion() ? 3 : 0));
    /** Lights change without their fade: reduced motion, a skip, a fresh start. */
    const [instant, setInstant] = useState(true);
    const [inspecting, setInspecting] = useState<number | null>(null);
    const [turn, setTurn] = useState(0);
    const [hired, setHired] = useState(false);

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
    const plates = debrief.plates;
    const revealing = resolved < 3;

    // A new result starts over: every light up, then the podiums resolve.
    const [shown, setShown] = useState(fixture);
    if (shown !== fixture) {
        setShown(fixture);
        setInspecting(null);
        setTurn(0);
        setHired(false);
        setInstant(true);
        setResolved(reducedMotion() ? 3 : 0);
    }

    // The reveal: one podium per beat, once the figures stand.
    useEffect(() => {
        if (!revealing || stage.loading) return;
        const timer = window.setTimeout(
            () => {
                const plate = plates[resolved];
                if (plate.kind === "kia") uiResolve("fallen");
                else if (plate.kind === "home") uiResolve(plate.promoted ? "promoted" : "home");
                setInstant(false);
                setResolved((n) => n + 1);
            },
            resolved === 0 ? FIRST_BEAT : BEAT,
        );
        return () => window.clearTimeout(timer);
    }, [revealing, resolved, stage.loading, plates]);

    const skip = () => {
        setInstant(true);
        setResolved(3);
    };

    // After the reveal the cursor rests on Continue.
    useLayoutEffect(() => {
        if (!revealing) store.focus("debrief-continue", false);
    }, [revealing, store]);
    useLayoutEffect(() => store.relayout(), [store, anchors]);

    const lit = [0, 1, 2].map((i) => {
        const plate = plates[i];
        if (plate.kind === "vacant") return false;
        return plate.kind === "home" || i >= resolved;
    });
    const focusedId = store.node(store.focused)?.id ?? "";
    const focusIndex =
        inspecting ?? (focusedId.startsWith("podium-") ? Number(focusedId.slice(-1)) : null);

    const stopInspect = () => {
        setInspecting(null);
        setTurn(0);
    };
    // A click on another podium ends the inspection.
    useEffect(() => {
        if (inspecting !== null && focusedId !== `podium-${inspecting}`) stopInspect();
    }, [inspecting, focusedId]);
    const replacement = hire(debrief.replacement, hired, () => setHired(true));

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

    return (
        <ScreenFrame
            location={["HQ", "Debrief"]}
            onLocation={frame.onLeave}
            siblings={frame.siblings}
            status={<>{hired && <StatusChip label="Roster" value="Recruits hired" />}</>}
            columns="minmax(0, 1fr)"
            commands={<FocusCommandBar glyphs={glyphs} />}
            overlay={frame.overlay}
        >
            <section
                className="sqv-diorama"
                data-debrief=""
                data-instant={instant || undefined}
                onPointerDown={revealing ? skip : undefined}
            >
                <PodiumCanvas
                    figures={[0, 1, 2].map((i) => figures[i] ?? null)}
                    focus={revealing ? null : focusIndex}
                    lit={lit}
                    instant={instant}
                    inspect={inspecting}
                    turn={inspecting !== null ? turn : undefined}
                    onAnchors={setAnchors}
                    onState={setStage}
                />
                <header className="uis-outcome" data-tone={debrief.tone}>
                    <span className="uis-outcome-title">{debrief.title}</span>
                    {debrief.rating && (
                        <span className="uis-outcome-rating">
                            Rating {debrief.rating.after} <b>{signed(debrief.rating.delta)}</b>
                        </span>
                    )}
                </header>
                {!revealing && <FixtureChooser value={fixture} onChange={setFixture} />}
                {[0, 1, 2].map((i) => {
                    const plate = plates[i];
                    const done = i < resolved;
                    return (
                        <Podium
                            key={i}
                            index={i}
                            anchor={anchors[i]}
                            title={plateTitle(plate, i)}
                            hint={plateHint(plate, done)}
                            commands={podiumCommands(i)}
                            directions={inspecting === i ? turnBy : undefined}
                        >
                            <ResultPlate plate={plate} done={done} />
                        </Podium>
                    );
                })}
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
                        label="Continue"
                        hint="Back to mission prep"
                        run={onContinue}
                    />
                )}
                {stage.loading && <div className="gui-stage-status">Bringing the squad in</div>}
            </section>
        </ScreenFrame>
    );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The fallen podium's hire command, from what the contract allows right now. */
function hire(replacement: Replacement | null, hired: boolean, run: () => void): Command | null {
    if (!replacement) return null;
    if ("deny" in replacement)
        return { action: "reset", label: "Hire recruit", short: "Hire", deny: replacement.deny };
    return {
        action: "reset",
        label: replacement.count > 1 ? `Hire ${replacement.count} recruits` : "Hire a recruit",
        short: "Hire",
        deny: hired ? "Already hired" : undefined,
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
    if (!plate.band) return `+${plate.gained} XP · top rank`;
    return `${plate.xpAfter} / ${plate.band.end} XP to the next rank`;
}

/** A podium's engraved plate: as deployed until it resolves, then the result. */
function ResultPlate({ plate, done }: { plate: Plate; done: boolean }) {
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
                    {kia && <span className="uis-plate-marker">KIA</span>}
                </span>
                <span className="sqv-plate-line">
                    <Icon name={rankIcon(r)} size={12} />
                    {r}
                </span>
                {kia ? (
                    <span className="sqv-plate-line uis-plate-fate">
                        {plate.turn ? `Turn ${plate.turn} · ` : ""}Vacant
                    </span>
                ) : (
                    <span className="uis-xp" aria-hidden />
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
            <span className="sqv-plate-line uis-rank-swap">
                {plate.promoted && (
                    <span className="uis-rank-was">
                        <Icon name={rankIcon(plate.rankBefore)} size={12} />
                        {plate.rankBefore}
                    </span>
                )}
                <span className="uis-rank-now">
                    <Icon name={rankIcon(plate.rankAfter)} size={12} />
                    {plate.rankAfter}
                </span>
            </span>
            {band ? (
                <span
                    className="uis-xp"
                    style={style}
                    role="meter"
                    aria-label="Experience"
                    aria-valuemin={band.start}
                    aria-valuemax={band.end}
                    aria-valuenow={plate.xpAfter}
                >
                    <i className="uis-xp-gain" />
                    <i className="uis-xp-was" />
                </span>
            ) : (
                <span className="uis-xp" data-full aria-hidden />
            )}
            <span className="uis-plate-cost">
                XP <b>+{plate.gained}</b>
            </span>
        </div>
    );
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

/** The screen's primary as a stencilled plaque: Skip while the reveal runs, then Continue. */
function Plaque({
    id,
    label,
    hint,
    run,
}: {
    id: string;
    label: string;
    hint: string;
    run: () => void;
}) {
    const store = useFocusState();
    const { props } = useFocusable<HTMLButtonElement>({
        id,
        group: "continue",
        title: label,
        hint,
        commands: [{ action: "confirm", label, tone: "primary", run }],
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
        <button type="button" tabIndex={-1} className="sqv-plaque" {...props}>
            {label}
        </button>
    );
}
