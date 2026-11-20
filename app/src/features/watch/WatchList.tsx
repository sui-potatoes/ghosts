// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/watch`: the games to watch. Live games, being played now by anyone (rated
 * games and friendly games from a listed lobby; a game started from an invite
 * code is watched by its link only), with both players, the mode, the turn and
 * whose it is, read again every few seconds and when the window comes back.
 * Your games: the signed-in player's finished games, each opening its replay.
 * On this device: the demo games recorded here. Confirm opens a game in the
 * viewer. QA builds (`VITE_WATCH_QA=1`) add Reset on a recorded game: the same
 * game released as if it were being played now.
 */

import { scenarioById } from "@ghosts/engine";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAccountId } from "../../chain";
import { useGoUp } from "../../hooks/useGoUp";
import {
    EmptyState,
    FocusCommandBar,
    FocusRoot,
    List,
    ListRow,
    Panel,
    ScreenFrame,
    StatusChip,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../ui";
import { useLiveGames, useRecentGames } from "./chain/data";
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
        <FocusRoot back={{ action: "back", label: "Menu", run: leave }}>
            <Screen leave={leave} />
        </FocusRoot>
    );
}

function Screen({ leave }: { leave: () => void }) {
    const glyphs = useGlyphSet();
    const live = useLiveGames();
    const count = live.data?.length ?? 0;
    return (
        <ScreenFrame
            location={["Menu", "Watch"]}
            onLocation={leave}
            status={
                live.data ? (
                    <StatusChip
                        label="Live games"
                        value={String(count)}
                        state={count ? "live" : "idle"}
                    />
                ) : undefined
            }
            columns="minmax(0, 1fr)"
            commands={<FocusCommandBar glyphs={glyphs} />}
        >
            <div className="watch-hub">
                <LivePanel live={live} />
                <YourGames />
                <DeviceGames />
            </div>
        </ScreenFrame>
    );
}

function LivePanel({ live }: { live: ReturnType<typeof useLiveGames> }) {
    const navigate = useNavigate();
    const rows = live.data ?? [];
    // The cursor starts on the live games, once they are read.
    const store = useFocusStore();
    const placed = useRef(false);
    const first = live.isPending ? null : rows[0] ? `live-${rows[0].id}` : "live-empty";
    useEffect(() => {
        if (!first || placed.current) return;
        placed.current = true;
        store.focus(first, false);
    }, [first, store]);
    return (
        <Panel
            label="Live games"
            meta={live.data ? `${rows.length} on` : undefined}
            className="watch-hub-live"
        >
            {live.isPending ? (
                <p className="gui-note">Looking for games</p>
            ) : rows.length ? (
                <List label="Live games">
                    {rows.map((row) => (
                        <ListRow
                            key={row.id}
                            id={`live-${row.id}`}
                            group="live"
                            name={row.name}
                            kind={row.kind}
                            tag={row.tag}
                            tagTone="accent"
                            title={row.name}
                            hint={row.hint}
                            instant
                            commands={[
                                NAV,
                                {
                                    action: "confirm",
                                    label: "Watch",
                                    tone: "primary",
                                    run: () => navigate(`/watch/${row.id}`),
                                },
                            ]}
                        />
                    ))}
                </List>
            ) : (
                <EmptyState
                    id="live-empty"
                    group="live"
                    headline={
                        live.isError ? "The games could not be read" : "No games being played now"
                    }
                    action="Look again"
                    commands={[
                        {
                            action: "confirm",
                            label: "Look again",
                            tone: "primary",
                            run: () => void live.refetch(),
                        },
                    ]}
                >
                    {live.isError
                        ? "The network did not answer."
                        : "Rated games and open friendly games show here while they are played."}
                </EmptyState>
            )}
        </Panel>
    );
}

function YourGames() {
    const navigate = useNavigate();
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const recent = useRecentGames(accountId, owner);
    if (!owner || !accountId) return null;
    const rows = recent.data ?? [];
    return (
        <Panel
            label="Your games"
            meta={recent.data ? `${rows.length} recent` : undefined}
            className="watch-hub-own"
        >
            {recent.isPending ? (
                <p className="gui-note">Reading your games</p>
            ) : rows.length ? (
                <List label="Your games">
                    {rows.map((row) => (
                        <ListRow
                            key={row.gameId}
                            id={`own-${row.gameId}`}
                            group="own"
                            name={row.name}
                            kind={row.kind}
                            tag={row.tag}
                            tagTone={row.won ? "accent" : "dim"}
                            title={row.name}
                            hint={`${row.tag} · ${row.kind}`}
                            instant
                            commands={[
                                NAV,
                                {
                                    action: "confirm",
                                    label: "Watch replay",
                                    tone: "primary",
                                    run: () => navigate(`/watch/${row.gameId}`),
                                },
                            ]}
                        />
                    ))}
                </List>
            ) : (
                <EmptyState
                    id="own-empty"
                    group="own"
                    headline={
                        recent.isError ? "Your games could not be read" : "No finished games yet"
                    }
                    action="Play"
                    commands={[
                        {
                            action: "confirm",
                            label: "Play",
                            tone: "primary",
                            run: () => navigate("/play"),
                        },
                    ]}
                >
                    Games you finish are kept here to watch again.
                </EmptyState>
            )}
        </Panel>
    );
}

function DeviceGames() {
    const navigate = useNavigate();
    const [journals] = useState(() => readJournals(deviceStorage()));
    return (
        <Panel
            label="On this device"
            meta={journals.length ? `${journals.length} kept` : undefined}
            className="watch-hub-device"
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
    );
}
