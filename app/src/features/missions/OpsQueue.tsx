// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { InlineCommands, List, Panel, useFocusable } from "../../ui";
import type { Mission } from "./model";
import { useNarrowConsole } from "./OpsConsole";

/** The focus id of a mission's queue line; `missionOfNode` reads it back. */
export const queueId = (mission: Pick<Mission, "id">) => `ops-${mission.id}`;

/** The mission id a queue line's focus id names, or null for any other node. */
export const missionOfNode = (node: string | null): string | null =>
    node?.startsWith("ops-") && node !== COMMIT_ID ? node.slice(4) : null;

/** The console's commit control (`BriefingPanel`). */
export const COMMIT_ID = "ops-commit";

const STATE_TAG: Record<Mission["state"], string> = {
    open: "Open",
    done: "Cleared",
    locked: "Locked",
};

/** What the state column says: Next for the one to take, else the state. */
const tagOf = (mission: Mission) => (mission.next ? "Next" : STATE_TAG[mission.state]);

type OpsQueueProps = {
    missions: Mission[];
    /** The mission the board is locked on: a notch in the gutter. */
    selected: string | null;
    onDeploy: (mission: Mission) => void;
    label?: string;
    meta?: string;
};

/**
 * The operations queue: the missions as status lines (index, name, file code
 * and place, state), one cursor target each. A line's primary is the
 * mission's commit (Deploy): keys and pad run it at once, a click locks the
 * board on the line and the next click (or the line's own button) commits.
 * The line previews: the board follows the pointer while it rests on a line.
 * A long queue scrolls inside its panel; on a phone the whole console scrolls
 * as one column instead, so the lines are a plain column there.
 */
export function OpsQueue({
    missions,
    selected,
    onDeploy,
    label = "Operations",
    meta,
}: OpsQueueProps) {
    const narrow = useNarrowConsole();
    const lines = missions.map((mission, i) => (
        <QueueLine
            key={mission.id}
            mission={mission}
            index={i}
            selected={mission.id === selected}
            onDeploy={onDeploy}
        />
    ));
    return (
        <Panel label={label} meta={meta} className="gui-ops-queue">
            {narrow ? (
                <div className="gui-ops-lines" role="listbox" aria-label={label}>
                    {lines}
                </div>
            ) : (
                <List label={label}>{lines}</List>
            )}
        </Panel>
    );
}

function QueueLine({
    mission,
    index,
    selected,
    onDeploy,
}: {
    mission: Mission;
    index: number;
    selected: boolean;
    onDeploy: (mission: Mission) => void;
}) {
    const { props, inline, armedCommand } = useFocusable<HTMLButtonElement>({
        id: queueId(mission),
        group: "ops-queue",
        title: mission.name,
        hint: mission.locked ?? mission.location,
        previews: true,
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
    const tag = tagOf(mission);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-row gui-ops-line"
            data-selected={selected || undefined}
            data-state={mission.state}
            aria-selected={selected}
            {...props}
        >
            <span className="gui-ops-line-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="gui-row-main">
                <span className="gui-row-name">{mission.name}</span>
                <span className="gui-row-kind">{mission.location}</span>
            </span>
            {inline ? (
                <InlineCommands armed={armedCommand} />
            ) : (
                <span className="gui-ops-line-side">
                    <span
                        className="gui-row-tag"
                        data-state={mission.next ? "next" : mission.state}
                        data-tone={
                            mission.state === "done" ? "accent" : mission.next ? undefined : "dim"
                        }
                    >
                        {mission.state === "locked" && <i className="gui-lock" aria-hidden />}
                        {mission.state === "done" && <i className="gui-ops-tick" aria-hidden />}
                        <span className="gui-ops-line-word">{tag}</span>
                    </span>
                    {mission.code && <span className="gui-ops-line-code">{mission.code}</span>}
                </span>
            )}
        </button>
    );
}
