// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useLayoutEffect, useRef, useState } from "react";

import { Eyebrow, InlineCommands, Panel, useFocusable } from "../../ui";
import { briefParts, type Mission } from "./model";
import { COMMIT_ID } from "./OpsQueue";

type BriefingPanelProps = {
    /** The mission the board is locked on. */
    mission: Mission | null;
    /** What the commit acts on, when not the mission shown (the board follows the pointer, the commit does not). */
    commit?: Mission | null;
    onDeploy: (mission: Mission) => void;
    label?: string;
};

/**
 * The briefing readout beside the board: who issued it, the operation's name
 * and place, the contract, the objectives, the intel facts with the threat as
 * pips, and under it all the console's commit control. The readout follows
 * the board; the commit acts on `commit` (the line the queue last selected),
 * never on a line the pointer only passed over, and names it.
 */
export function BriefingPanel({
    mission,
    commit = mission,
    onDeploy,
    label = "Briefing",
}: BriefingPanelProps) {
    const [ref, more] = useOverflow<HTMLDivElement>(mission?.id);
    return (
        <Panel
            label={label}
            meta={mission?.faction?.name}
            className="gui-ops-briefing"
            foot={commit && <Commit mission={commit} onDeploy={onDeploy} />}
        >
            {mission && (
                <div
                    ref={ref}
                    className="gui-ops-brief"
                    data-more={more || undefined}
                    data-gui-scroll
                >
                    <header className="gui-ops-brief-head">
                        {mission.issuer && <span className="gui-ops-issuer">{mission.issuer}</span>}
                        <h2 className="gui-ops-title">{mission.name}</h2>
                        <span className="gui-ops-place">
                            {mission.place ?? mission.location}
                            {mission.coordinates && (
                                <span className="gui-ops-coords">
                                    {mission.coordinates[0]} {mission.coordinates[1]}
                                </span>
                            )}
                        </span>
                    </header>
                    {mission.brief.length > 0 && (
                        <div className="gui-ops-contract">
                            {mission.brief.map((line) => (
                                <p key={line}>
                                    {briefParts(line).map((part, i) =>
                                        part.order ? (
                                            <em key={i} className="gui-ops-order">
                                                {part.text}
                                            </em>
                                        ) : (
                                            part.text
                                        ),
                                    )}
                                </p>
                            ))}
                        </div>
                    )}
                    {mission.objectives.length > 0 && (
                        <section className="gui-ops-brief-objectives">
                            <Eyebrow meta={String(mission.objectives.length).padStart(2, "0")}>
                                Objectives
                            </Eyebrow>
                            <ol className="gui-ops-objectives">
                                {mission.objectives.map((o, i) => (
                                    <li key={o.title}>
                                        <span className="gui-ops-objective-index">
                                            {String(i + 1).padStart(2, "0")}
                                        </span>
                                        <span className="gui-ops-objective-text">
                                            <span>{o.title}</span>
                                            {o.detail && o.detail !== o.title && (
                                                <span className="gui-ops-objective-detail">
                                                    {o.detail}
                                                </span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}
                    {(mission.facts.length > 0 || mission.threat || mission.reward) && (
                        <section className="gui-ops-brief-intel">
                            <Eyebrow>Intel</Eyebrow>
                            <dl className="gui-ops-facts">
                                {mission.facts.map((f) => (
                                    <div key={f.label} className="gui-ops-fact">
                                        <dt>{f.label}</dt>
                                        <dd>{f.value}</dd>
                                    </div>
                                ))}
                                {mission.threat && (
                                    <div className="gui-ops-fact">
                                        <dt>Threat</dt>
                                        <dd className="gui-ops-threat">
                                            <span className="gui-ops-pips" aria-hidden>
                                                {Array.from(
                                                    { length: mission.threat.max },
                                                    (_, i) => (
                                                        <i
                                                            key={i}
                                                            data-on={
                                                                i < mission.threat!.level ||
                                                                undefined
                                                            }
                                                        />
                                                    ),
                                                )}
                                            </span>
                                            {mission.threat.label}
                                        </dd>
                                    </div>
                                )}
                                {mission.reward && (
                                    <div className="gui-ops-fact">
                                        <dt>{mission.reward.label}</dt>
                                        <dd>{mission.reward.value}</dd>
                                    </div>
                                )}
                            </dl>
                        </section>
                    )}
                </div>
            )}
        </Panel>
    );
}

/** Whether the element's content runs past its foot: the readout fades there. */
function useOverflow<T extends HTMLElement>(key: unknown) {
    const ref = useRef<T>(null);
    const [more, setMore] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const read = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
        read();
        const observer = new ResizeObserver(read);
        observer.observe(el);
        el.addEventListener("scroll", read, { passive: true });
        return () => {
            observer.disconnect();
            el.removeEventListener("scroll", read);
        };
    }, [key]);
    return [ref, more] as const;
}

/** The console's primary control: commit the squad to the locked mission. */
function Commit({ mission, onDeploy }: { mission: Mission; onDeploy: (m: Mission) => void }) {
    const { props, inline, armedCommand } = useFocusable<HTMLButtonElement>({
        id: COMMIT_ID,
        group: "ops-commit",
        title: `${mission.verb} · ${mission.name}`,
        hint: mission.locked ?? mission.location,
        instant: !mission.locked,
        commands: [
            {
                action: "confirm",
                label: mission.verb,
                tone: mission.locked ? undefined : "primary",
                deny: mission.locked,
                run: () => onDeploy(mission),
            },
        ],
    });
    return (
        <button type="button" tabIndex={-1} className="gui-ops-commit" {...props}>
            <span className="gui-ops-commit-verb">{mission.verb}</span>
            <span className="gui-ops-commit-name">{mission.name}</span>
            {inline && <InlineCommands armed={armedCommand} />}
        </button>
    );
}
