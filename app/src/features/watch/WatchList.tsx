// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/watch`, the Spectate screen: matches to watch. Live matches, being played
 * now by anyone (ranked and contract matches and friendly ones from a listed
 * lobby; one started from an invite code is watched by its link only), with
 * both players, the mode, the turn and whose it is, read again every few
 * seconds and when the window comes back. Recent matches: the latest finished
 * matches of anyone, 25 and then up to 50 with More. My matches: the
 * signed-in player's own finished matches. Confirm opens a match in the
 * viewer, live or as its replay. QA builds (`VITE_WATCH_QA=1`) can fill
 * Recent matches with fixture rows (`?recent=rows|few|empty|error`, `qa.ts`).
 */

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAccountId } from "../../chain";
import { useGoUp } from "../../hooks/useGoUp";
import {
    ActionRow,
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
import { useLiveGames, useRecentFinished, useYourGames, type RecentRows } from "./chain/data";
import { RECENT_CAP, RECENT_FIRST } from "./chain/recent";
import { offlineLine, useReportError } from "./failure";
import { forgetDeviceRecordings } from "./forget";
import { recentQaRows, recentQaState } from "./qa";
import "./watch.css";

/** QA builds only: the Recent matches fixture rows. */
export const WATCH_QA = import.meta.env.VITE_WATCH_QA === "1";

// Matches are no longer recorded on the device: what older builds kept there goes.
forgetDeviceRecordings();

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

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
            location={["Menu", "Spectate"]}
            onLocation={leave}
            status={
                live.data ? (
                    <StatusChip
                        label="Live matches"
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
                <RecentPanel />
                <MyMatches />
            </div>
        </ScreenFrame>
    );
}

function LivePanel({ live }: { live: ReturnType<typeof useLiveGames> }) {
    useReportError(live.error, "could not load live matches");
    const navigate = useNavigate();
    const rows = live.data ?? [];
    // The cursor starts on the live matches, once they are read.
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
            label="Live matches"
            meta={live.data ? `${rows.length} live` : undefined}
            className="watch-hub-live"
        >
            {live.isPending ? (
                <p className="gui-note">Reading live matches</p>
            ) : rows.length ? (
                <List label="Live matches">
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
                    instant
                    group="live"
                    headline={live.isError ? "Could not load live matches" : "No live matches"}
                    action="Refresh"
                    commands={[
                        {
                            action: "confirm",
                            label: "Refresh",
                            tone: "primary",
                            run: () => void live.refetch(),
                        },
                    ]}
                >
                    {live.isError ? offlineLine() : "Matches being played show here."}
                </EmptyState>
            )}
        </Panel>
    );
}

/** The signed-in player's own finished matches; signed out, the reason there are none. */
function MyMatches() {
    const navigate = useNavigate();
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const mine = useYourGames(accountId, owner);
    useReportError(mine.error, "could not load your matches");
    const rows = mine.data ?? [];
    return (
        <Panel
            label="My matches"
            meta={owner && accountId && mine.data ? `${rows.length} finished` : undefined}
            className="watch-hub-own"
        >
            {!owner || !accountId ? (
                <p className="gui-note">Sign in to see your matches</p>
            ) : mine.isPending ? (
                <p className="gui-note">Reading my matches</p>
            ) : rows.length ? (
                <List label="My matches">
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
            ) : mine.isError ? (
                <EmptyState
                    id="own-empty"
                    instant
                    group="own"
                    headline="Could not load your matches"
                    action="Refresh"
                    commands={[
                        {
                            action: "confirm",
                            label: "Refresh",
                            tone: "primary",
                            run: () => void mine.refetch(),
                        },
                    ]}
                >
                    {offlineLine()}
                </EmptyState>
            ) : (
                <EmptyState
                    id="own-empty"
                    instant
                    group="own"
                    headline="No matches yet"
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
                    Your finished matches show here.
                </EmptyState>
            )}
        </Panel>
    );
}

/** The recent matches as the panel reads them: the network's, or a QA build's fixture rows. */
function useRecentPanel(limit: number): {
    data: RecentRows | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => void;
} {
    const { search } = useLocation();
    const qa = WATCH_QA ? recentQaState(search) : null;
    const query = useRecentFinished(limit, !qa);
    const [now] = useState(() => Date.now());
    if (!qa) return { ...query, refetch: () => void query.refetch() };
    return {
        data: qa === "error" ? undefined : recentQaRows(qa, limit, now),
        isPending: false,
        isError: qa === "error",
        error: null,
        isFetching: false,
        refetch: () => {},
    };
}

/** The latest finished matches of anyone, newest first; each opens its replay. */
function RecentPanel() {
    const navigate = useNavigate();
    const store = useFocusStore();
    const [limit, setLimit] = useState(RECENT_FIRST);
    const recent = useRecentPanel(limit);
    useReportError(recent.error, "could not load recent matches");
    const rows = recent.data?.rows ?? [];
    // More stays, as a quiet line, until the rows it asked for are in.
    const loadingMore = limit === RECENT_CAP && recent.isFetching && rows.length <= RECENT_FIRST;
    const canMore = (limit < RECENT_CAP && !!recent.data?.more) || loadingMore;
    // After More, the cursor goes on to the first of the rows it added.
    const moved = useRef(false);
    const next = rows[RECENT_FIRST];
    useEffect(() => {
        if (limit === RECENT_FIRST || moved.current || !next) return;
        moved.current = true;
        store.focus(`recent-${next.id}`, false);
    }, [limit, next, store]);
    return (
        <Panel
            label="Recent matches"
            meta={recent.data ? `${rows.length} finished` : undefined}
            className="watch-hub-recent"
        >
            {recent.isPending ? (
                <p className="gui-note">Reading recent matches</p>
            ) : rows.length ? (
                <List label="Recent matches">
                    {rows.map((row) => (
                        <ListRow
                            key={row.id}
                            id={`recent-${row.id}`}
                            group="recent"
                            name={row.name}
                            kind={row.kind}
                            tag={row.tag}
                            tagTone="dim"
                            title={row.name}
                            hint={row.hint}
                            instant
                            commands={[
                                NAV,
                                {
                                    action: "confirm",
                                    label: "Watch replay",
                                    tone: "primary",
                                    run: () => navigate(`/watch/${row.id}`),
                                },
                            ]}
                        />
                    ))}
                    {canMore && (
                        <ActionRow
                            id="recent-more"
                            group="recent"
                            label={loadingMore ? "Reading more matches" : "More"}
                            title="More matches"
                            hint={`Up to ${RECENT_CAP} finished matches`}
                            commands={[
                                NAV,
                                {
                                    action: "confirm",
                                    label: "More",
                                    tone: "primary",
                                    run: () => setLimit(RECENT_CAP),
                                },
                            ]}
                        />
                    )}
                </List>
            ) : (
                <EmptyState
                    id="recent-empty"
                    instant
                    group="recent"
                    headline={
                        recent.isError ? "Could not load recent matches" : "No recent matches"
                    }
                    action="Refresh"
                    commands={[
                        {
                            action: "confirm",
                            label: "Refresh",
                            tone: "primary",
                            run: recent.refetch,
                        },
                    ]}
                >
                    {recent.isError ? offlineLine() : "Finished matches show here."}
                </EmptyState>
            )}
        </Panel>
    );
}
