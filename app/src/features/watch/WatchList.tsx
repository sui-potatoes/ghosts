// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The games recorded on this device (`/watch/local`), newest first: confirm
 * replays one in the viewer. QA builds (`VITE_WATCH_QA=1`) add Reset: the
 * same game released as if it were being played now.
 */

import { scenarioById } from "@ghosts/engine";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useGoUp } from "../../hooks/useGoUp";
import {
    EmptyState,
    FocusCommandBar,
    FocusRoot,
    List,
    ListRow,
    Panel,
    ScreenFrame,
    useGlyphSet,
    type Command,
} from "../../ui";
import {
    deviceStorage,
    journalKills,
    journalTurns,
    readJournals,
    type LocalJournal,
} from "./journal";
import "./watch.css";

/** The growing test source is reachable only in QA builds. */
export const WATCH_QA = import.meta.env.VITE_WATCH_QA === "1";

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

const resultOf = (j: LocalJournal) =>
    j.result === "victory" ? "Won" : j.result === "defeat" ? "Lost" : "Unfinished";

export default function WatchList() {
    const leave = useGoUp();
    return (
        <FocusRoot back={{ action: "back", label: "Leave", run: leave }}>
            <Screen leave={leave} />
        </FocusRoot>
    );
}

function Screen({ leave }: { leave: () => void }) {
    const glyphs = useGlyphSet();
    const navigate = useNavigate();
    const [journals] = useState(() => readJournals(deviceStorage()));
    return (
        <ScreenFrame
            location={["Watch", "Recorded games"]}
            onLocation={leave}
            columns="minmax(0, 640px)"
            commands={<FocusCommandBar glyphs={glyphs} />}
        >
            <Panel
                label="Recorded games"
                meta={journals.length ? `${journals.length} kept` : undefined}
            >
                {journals.length ? (
                    <List label="Recorded games">
                        {journals.map((j) => {
                            const name =
                                scenarioById(j.scenario)?.briefing.title ?? "Unknown operation";
                            const turns = journalTurns(j.events);
                            const fell = journalKills(j.events);
                            const commands: Command[] = [
                                NAV,
                                {
                                    action: "confirm",
                                    label: "Watch",
                                    tone: "primary",
                                    run: () => navigate(`/watch/local/${j.id}`),
                                },
                            ];
                            if (WATCH_QA)
                                commands.splice(1, 0, {
                                    action: "reset",
                                    label: "Watch as live",
                                    short: "Live",
                                    run: () => navigate(`/watch/qa/${j.id}`),
                                });
                            return (
                                <ListRow
                                    key={j.id}
                                    id={`journal-${j.id}`}
                                    group="journals"
                                    name={name}
                                    kind={`${when(j.updatedAt)} · ${turns} turns · ${fell} fell`}
                                    tag={resultOf(j)}
                                    tagTone={j.result === "victory" ? "accent" : "dim"}
                                    title={name}
                                    hint={`${resultOf(j)} · ${turns} turns · ${fell} unit${fell === 1 ? "" : "s"} fell`}
                                    instant
                                    commands={commands}
                                />
                            );
                        })}
                    </List>
                ) : (
                    <EmptyState
                        id="journals-empty"
                        group="journals"
                        headline="No recorded games"
                        action="Play the demo"
                        commands={[
                            {
                                action: "confirm",
                                label: "Play the demo",
                                tone: "primary",
                                run: () => navigate("/demo"),
                            },
                        ]}
                    >
                        Games played in the demo are kept here to watch again.
                    </EmptyState>
                )}
            </Panel>
        </ScreenFrame>
    );
}
