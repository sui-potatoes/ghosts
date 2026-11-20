// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/leaderboard`: every player with a finished ranked match, by rating (ties:
 * fewer games, then name), with the tier the game matches them in, the rating,
 * the record and the ranked matches played; beside it how the players spread
 * over the tiers of the live `Rules`, and the totals. The signed-in player's row
 * is marked and the line above the table leads to it (or, unranked, to ranked
 * play). Confirm on a row opens the account on the explorer. Read again every
 * minute and when the window comes back; Refresh reads it now.
 */

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useAccountId } from "../../chain";
import { explorerUrl } from "../../constants";
import { useGoUp } from "../../hooks/useGoUp";
import {
    ActionRow,
    EmptyState,
    FocusCommandBar,
    FocusRoot,
    InlineCommands,
    List,
    Meter,
    Panel,
    ReadoutLine,
    ScreenFrame,
    StatusChip,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../ui";
import { useLeaderboard, useTierBands } from "./data";
import {
    barShare,
    distribution,
    EMPTY_ID,
    OWN_ID,
    ownLine,
    plural,
    rankRows,
    recordText,
    REFRESH_ID,
    rowHint,
    rowId,
    startTarget,
    type LeaderRow,
    type TierBand,
} from "./model";
import "./leaderboard.css";

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

export default function LeaderboardScreen() {
    const leave = useGoUp();
    return (
        <FocusRoot back={{ action: "back", label: "Menu", run: leave }}>
            <Screen leave={leave} />
        </FocusRoot>
    );
}

function Screen({ leave }: { leave: () => void }) {
    const glyphs = useGlyphSet();
    const navigate = useNavigate();
    const store = useFocusStore();
    const signedIn = !!useCurrentAccount();
    const accountId = useAccountId().data ?? null;
    const board = useLeaderboard();
    const { bands, isError: rulesError, refetch: refetchRules } = useTierBands();

    const rows = useMemo(
        () =>
            board.data && bands
                ? rankRows(board.data, bands.tiers, bands.placement, accountId)
                : [],
        [board.data, bands, accountId],
    );
    const loaded = !!board.data && !!bands;
    const failed = !loaded && (board.isError || rulesError);
    const dist = bands && loaded ? distribution(rows, bands.tiers) : null;
    const own = loaded ? ownLine(signedIn, rows) : null;

    const refreshing = loaded && board.isFetching;
    const refresh = () => {
        void board.refetch();
        refetchRules();
    };
    const refreshCommand: Command = {
        action: "reset",
        label: refreshing ? "Refreshing" : "Refresh",
        run: refresh,
    };

    // The cursor starts on the table's first row once it is read.
    const placed = useRef(false);
    const first = loaded ? startTarget(rows) : failed ? EMPTY_ID : null;
    useEffect(() => {
        if (!first || placed.current) return;
        placed.current = true;
        store.focus(first, false);
    }, [first, store]);

    return (
        <ScreenFrame
            location={["Menu", "Leaderboard"]}
            onLocation={leave}
            status={
                dist ? <StatusChip label="Players ranked" value={String(dist.ranked)} /> : undefined
            }
            columns="minmax(0, 1fr)"
            commands={<FocusCommandBar glyphs={glyphs} />}
        >
            <div className="lb-hub">
                <Panel label="Tiers" className="lb-side">
                    {dist ? (
                        <>
                            <div className="lb-tiers">
                                {dist.tiers.map((t) => (
                                    <Meter
                                        key={t.name}
                                        label={t.name}
                                        value={barShare(t.players, dist) * 100}
                                        max={100}
                                        readout={plural(t.players, "player", "players")}
                                    />
                                ))}
                            </div>
                            <div className="lb-totals">
                                <ReadoutLine label="Players ranked">{dist.ranked}</ReadoutLine>
                                <ReadoutLine label="Matches played">{dist.matches}</ReadoutLine>
                            </div>
                        </>
                    ) : null}
                    <ActionRow
                        id={REFRESH_ID}
                        group="side"
                        label={refreshing ? "Refreshing" : "Refresh"}
                        title="Refresh"
                        hint="Read the leaderboard again"
                        commands={[{ ...refreshCommand, action: "confirm", tone: "primary" }]}
                        instant
                    />
                </Panel>
                <Panel
                    label="Ranked players"
                    meta={loaded ? plural(rows.length, "player", "players") : undefined}
                    className="lb-main"
                >
                    {own?.kind === "ranked" && (
                        <ActionRow
                            id={OWN_ID}
                            group="table"
                            label={`You are rank ${own.rank}`}
                            title="My row"
                            hint={`Rank ${own.rank}`}
                            instant
                            commands={[
                                NAV,
                                {
                                    action: "confirm",
                                    label: "Go to my row",
                                    tone: "primary",
                                    run: () => store.focus(own.rowId),
                                },
                                refreshCommand,
                            ]}
                        />
                    )}
                    {own?.kind === "unranked" && (
                        <ActionRow
                            id={OWN_ID}
                            group="table"
                            label="You are not ranked yet"
                            title="Not ranked yet"
                            hint="Finish a ranked match to join the table"
                            instant
                            commands={[
                                NAV,
                                {
                                    action: "confirm",
                                    label: "Play ranked",
                                    tone: "primary",
                                    run: () => navigate("/play/ranked"),
                                },
                                refreshCommand,
                            ]}
                        />
                    )}
                    {!loaded && !failed ? (
                        <p className="gui-note">Loading the leaderboard</p>
                    ) : failed ? (
                        <EmptyState
                            id={EMPTY_ID}
                            group="table"
                            instant
                            headline="Could not load the leaderboard"
                            action="Refresh"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Refresh",
                                    tone: "primary",
                                    run: refresh,
                                },
                            ]}
                        >
                            {null}
                        </EmptyState>
                    ) : rows.length ? (
                        <>
                            <div className="lb-head" aria-hidden>
                                <span className="lb-rank">Rank</span>
                                <span className="lb-name">Name</span>
                                <span className="lb-tier">Tier</span>
                                <span className="lb-rating">Rating</span>
                                <span className="lb-record">Record</span>
                                <span className="lb-games">Matches</span>
                            </div>
                            <List label="Ranked players">
                                {rows.map((row) => (
                                    <BoardRow
                                        key={row.accountId}
                                        row={row}
                                        tiers={bands!.tiers}
                                        refresh={refreshCommand}
                                    />
                                ))}
                            </List>
                        </>
                    ) : (
                        <EmptyState
                            id={EMPTY_ID}
                            group="table"
                            instant
                            headline="No ranked players yet"
                            action="Play"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Play",
                                    tone: "primary",
                                    run: () => navigate("/play"),
                                },
                                refreshCommand,
                            ]}
                        >
                            Players show here after their first ranked match.
                        </EmptyState>
                    )}
                </Panel>
            </div>
        </ScreenFrame>
    );
}

/** One player: rank, name, tier, rating, record, ranked matches. */
function BoardRow({
    row,
    tiers,
    refresh,
}: {
    row: LeaderRow;
    tiers: readonly TierBand[];
    refresh: Command;
}) {
    const tier = tiers[row.tier]?.name ?? "";
    const { props, inline, commands, armedCommand } = useFocusable<HTMLButtonElement>({
        id: rowId(row),
        group: "table",
        title: row.own ? `${row.name} · You` : row.name,
        hint: rowHint(row, tiers),
        commands: [
            NAV,
            {
                action: "confirm",
                label: "View on explorer",
                tone: "primary",
                run: () => window.open(explorerUrl(row.accountId), "_blank", "noopener,noreferrer"),
            },
            refresh,
        ],
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-row lb-row"
            data-selected={row.own || undefined}
            {...props}
        >
            <span className="lb-rank">{row.rank}</span>
            <span className="lb-name">
                <span className="gui-row-name">{row.name}</span>
                {row.own && <span className="lb-you">You</span>}
            </span>
            <span className="lb-tier">{tier}</span>
            <span className="lb-rating">{row.rating}</span>
            <span className="lb-detail">
                <span className="lb-record">{recordText(row)}</span>
                <span className="lb-games">
                    {row.games}
                    <span className="lb-games-unit">{row.games === 1 ? " match" : " matches"}</span>
                </span>
            </span>
            {inline && <InlineCommands commands={commands} armed={armedCommand} />}
        </button>
    );
}
