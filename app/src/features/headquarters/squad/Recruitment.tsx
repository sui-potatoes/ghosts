// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Recruitment on the podium diorama (the one squad selection and the match
 * result use): four podiums stand dark and empty; the primary command hires
 * the free squad; as the recruits land the podiums come up one at a time,
 * left to right — the light, the figurine with its rifle, then the plate with
 * its name and rank (cut, not crossfaded). Confirm or Back skips to the end;
 * reduced motion (the OS or the game's setting) shows the end at once. Then
 * the primary continues to the squad. Recruits already on file stand lit from
 * the start, so a partial squad only reveals its new hires.
 *
 * The reveal is timers over plain state (`recruit-reveal.ts`), never an
 * animation event: a throttled or hidden tab still ends in the right state.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { uiLampOn } from "../../../audio";
import type { ChainRecruit } from "../../../chain";
import { getSettings } from "../../../settings/store";
import { FocusScope, Icon, useFocusable, useFocusState } from "../../../ui";
import { FREE_RECRUITS } from "../../debrief/result";
import { figuresOf } from "../../debrief/figures";
import type { Anchor } from "../../squad-view/podium-scene";
import { PodiumCanvas, podiumBox } from "../../squad-view/podiums";
import { rankIcon } from "./ranks";
import {
    advance,
    beatBefore,
    BUILD_WAIT,
    cuesBetween,
    litOf,
    namedOf,
    nextStep,
    phaseOf,
    settle,
    standing,
    type Stages,
} from "./recruit-reveal";

/** The OS preference or the game's own setting. */
export const motionReduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    getSettings().display.reduceMotion;

/**
 * The reveal's progress. Starts with everyone on file standing; moves one step
 * per beat once the figurines are built (or after `BUILD_WAIT`). Reduced
 * motion reads as settled without any step.
 */
export function useRecruitReveal(slots: (ChainRecruit | null)[], ready: boolean, reduced: boolean) {
    const [stages, setStages] = useState<Stages>(() => standing(slots));
    const [fast, setFast] = useState(true);
    const now = useRef(stages);
    now.current = stages;
    /** Sound the switch-on cues for a move between two states (none under reduced motion). */
    const sound = (to: Stages, instant: boolean) => {
        if (!reduced)
            for (const c of cuesBetween(slots, now.current, to, instant)) uiLampOn(c.index, c.last);
        now.current = to;
    };
    const shown = useMemo(
        () => (reduced ? settle(slots, stages) : stages),
        [reduced, slots, stages],
    );
    const step = nextStep(slots, shown);
    const first = !!step && step.to === 1 && !slots.some((s, i) => s && i < step.index);
    useEffect(() => {
        if (!step) return;
        const wait = ready ? beatBefore(step, first) : BUILD_WAIT;
        const timer = window.setTimeout(() => {
            setFast(false);
            const to = advance(slots, now.current);
            sound(to, false);
            setStages(to);
        }, wait);
        return () => window.clearTimeout(timer);
        // The step stands for the state it was derived from.
    }, [step?.id, step?.to, ready]);
    const skip = () => {
        setFast(true);
        const to = settle(slots, now.current);
        sound(to, true);
        setStages(to);
    };
    return { stages: shown, skip, instant: fast || reduced };
}

type Props = {
    slots: (ChainRecruit | null)[];
    /** A hire is in flight or its recruits are still arriving. */
    pending: boolean;
    onHire: () => void;
    /** Into the squad, on the first recruit. */
    onEnter: () => void;
};

export function Recruitment({ slots, pending, onHire, onEnter }: Props) {
    const store = useFocusState();
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });
    const reduced = motionReduced();
    const { stages, skip, instant } = useRecruitReveal(
        slots,
        !stage.loading || !!stage.error,
        reduced,
    );
    const phase = phaseOf(slots, stages, pending);
    const lit = litOf(slots, stages);
    const named = namedOf(slots, stages);
    // Everything that has landed is built behind the dark; a podium shows its figurine with its light.
    const figures = useMemo(() => {
        const landed = slots.filter((s): s is ChainRecruit => !!s);
        const built = figuresOf(landed);
        let n = 0;
        return slots.map((s) => (s ? built[n++] : null));
    }, [slots]);

    useLayoutEffect(() => store.relayout(), [store, anchors]);
    // The cursor follows the primary as it changes hands.
    const last = useRef<string | null>(null);
    useLayoutEffect(() => {
        const id =
            phase === "revealing" ? "rec-skip" : phase === "idle" ? "rec-hire" : "rec-primary";
        if (last.current !== id) store.focus(id, false);
        last.current = id;
    }, [phase, store]);

    const revealing = phase === "revealing";
    return (
        <section
            className="sqv-diorama"
            data-instant={instant || undefined}
            aria-label="Recruitment"
            onPointerDown={revealing ? skip : undefined}
        >
            <PodiumCanvas
                key={slots.length}
                projector
                figures={figures}
                focus={null}
                lit={lit}
                hidden={lit.map((l) => !l)}
                instant={instant}
                onAnchors={setAnchors}
                onState={setStage}
            />
            {slots.map((s, i) => (
                <div className="sqv-podium" key={i} style={podiumBox(anchors[i])}>
                    <div className="sqv-plate-mount">
                        <Plate index={i} recruit={named[i] ? s : null} />
                    </div>
                </div>
            ))}
            {revealing ? (
                <FocusScope id="rec-reveal" back={{ action: "back", label: "Skip", run: skip }}>
                    <Plaque id="rec-skip" label="Skip" hint="Show the squad" run={skip} swipe />
                </FocusScope>
            ) : phase === "settled" ? (
                <Plaque id="rec-primary" label="Continue" hint="Into headquarters" run={onEnter} />
            ) : phase === "idle" ? (
                <Intro open={slots.filter((s) => !s).length} onHire={onHire} />
            ) : (
                <Plaque
                    id="rec-primary"
                    label="Hire squad"
                    deny="The squad is on its way"
                    run={onHire}
                />
            )}
            {stage.loading && <div className="gui-stage-status">Bringing the squad in</div>}
            {stage.error && (
                <div className="gui-stage-status" data-error>
                    The squad could not be shown
                </div>
            )}
        </section>
    );
}

/**
 * The empty state: what this is and what the primary does, above the dark
 * stands. It gives way once the hire is under way (the plaque takes its old
 * place) so it never covers the figures.
 */
function Intro({ open, onHire }: { open: number; onHire: () => void }) {
    return (
        <div className="sqv-intro" role="group" aria-labelledby="rec-intro-title">
            <span className="gui-prompt-eyebrow">Recruitment</span>
            <h2 className="gui-prompt-title" id="rec-intro-title">
                {open === FREE_RECRUITS ? "Your squad is empty" : "Your squad has vacancies"}
            </h2>
            <p className="gui-prompt-body">
                {open === FREE_RECRUITS
                    ? `Hire up to ${COUNT_WORDS[open]} recruits at no cost.`
                    : `Hire ${COUNT_WORDS[open] ?? open} more at no cost.`}{" "}
                They report to the stands below, ready to equip.
            </p>
            <Plaque id="rec-hire" label="Hire squad" hint="Free" run={onHire} variant="intro" />
        </div>
    );
}

const COUNT_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four" };

/** A podium's engraved plate: its number while empty, the recruit's name and rank once named. */
function Plate({ index, recruit }: { index: number; recruit: ChainRecruit | null }) {
    if (!recruit)
        return (
            <div className="sqv-plate-engraved" data-vacant>
                <span className="sqv-plate-name">{String(index + 1).padStart(2, "0")}</span>
            </div>
        );
    const rank = recruit.rank.$kind;
    return (
        <div className="sqv-plate-engraved">
            <span className="sqv-plate-head">
                <span className="sqv-plate-name">{recruit.metadata.name}</span>
            </span>
            <span className="sqv-plate-line">
                <Icon name={rankIcon(rank)} size={12} />
                {rank}
            </span>
        </div>
    );
}

/** The screen's primary as the stencilled plaque the other podium screens use. */
function Plaque({
    id,
    label,
    hint,
    run,
    deny,
    swipe,
    variant,
}: {
    id: string;
    label: string;
    hint?: string;
    run: () => void;
    deny?: string;
    /** While it is Skip, any direction skips too. */
    swipe?: boolean;
    /** `intro`: inside the empty-state block instead of the screen corner. */
    variant?: "intro";
}) {
    const { props } = useFocusable<HTMLButtonElement>({
        id,
        group: "continue",
        title: label,
        hint,
        commands: [{ action: "confirm", label, tone: "primary", deny, run }],
        directions: swipe
            ? () => {
                  run();
                  return true;
              }
            : undefined,
        // One press, as the cards were: hire, skip and continue are all one tap.
        instant: true,
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="sqv-plaque"
            data-intro={variant === "intro" ? "" : undefined}
            {...props}
        >
            {label}
        </button>
    );
}
