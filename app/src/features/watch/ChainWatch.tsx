// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/watch/<game>`: a game on chain in the viewer, live while it exists (the
 * field follows it as it is played; rewind, pause and back to live work as in
 * a replay), else its replay from the game's versions. No wallet is needed. A
 * live game that ends while watched shows its result and offers the replay.
 * A game still picking squads holds on a card until play starts; one that
 * never started, or whose history is out of reach, says so plainly.
 */

import { useCurrentClient } from "@mysten/dapp-kit-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { LoadingSpinner } from "../../components/LoadingSpinner";
import { useGoUp } from "../../hooks/useGoUp";
import {
    EmptyState,
    FocusCommandBar,
    FocusRoot,
    ScreenFrame,
    useGlyphSet,
    type Command,
} from "../../ui";
import { openChainGame, readGameNow, type ChainOpened } from "./chain/data";
import { Viewer } from "./WatchScreen";
import "./watch.css";

/** How often a game still picking squads is read. */
const DEPLOY_POLL_MS = 2_000;

export default function ChainWatch() {
    const { gameId = "" } = useParams();
    const leave = useGoUp();
    const client = useCurrentClient();
    const queryClient = useQueryClient();
    /** Opened as a replay even while the game exists: asked for from a live game's result. */
    const [replay, setReplay] = useState(false);
    const opened = useQuery({
        queryKey: ["watch", "open", gameId, replay],
        queryFn: () => openChainGame(client, gameId, replay),
        staleTime: Infinity,
        gcTime: 0,
        retry: 1,
    });

    if (opened.isPending) return <LoadingSpinner />;
    if (opened.isError)
        return (
            <Notice
                leave={leave}
                headline="This game could not be read"
                line="The network did not answer."
                action={{
                    label: "Try again",
                    run: () =>
                        void queryClient.resetQueries({ queryKey: ["watch", "open", gameId] }),
                }}
            />
        );
    const data = opened.data;
    switch (data.kind) {
        case "watch":
            return (
                <Viewer
                    key={`${data.gameId}:${data.live}`}
                    source={data.source}
                    start={data.live && data.source.events().length ? "live" : "start"}
                    squad={data.squad}
                    intel={data.intel}
                    leave={leave}
                    extras={{
                        link: `${window.location.origin}/watch/${data.gameId}`,
                        onReplay: data.live ? () => setReplay(true) : undefined,
                    }}
                />
            );
        case "deploying":
            return (
                <Deploying
                    data={data}
                    leave={leave}
                    onStart={() =>
                        void queryClient.resetQueries({ queryKey: ["watch", "open", gameId] })
                    }
                />
            );
        case "unplayed":
            return <Notice leave={leave} headline={data.title} line={data.line} />;
        case "unavailable":
            return (
                <Notice
                    leave={leave}
                    headline="This replay is no longer available"
                    line="The network no longer keeps this game's history."
                />
            );
        case "missing":
            return (
                <Notice
                    leave={leave}
                    headline="There is no game at this link"
                    line="Check the link and try again."
                />
            );
    }
}

/** Squads are being picked: the card holds until play starts, then the field opens. */
function Deploying({
    data,
    leave,
    onStart,
}: {
    data: Extract<ChainOpened, { kind: "deploying" }>;
    leave: () => void;
    onStart: () => void;
}) {
    const client = useCurrentClient();
    const game = useQuery({
        queryKey: ["watch", "deploying", data.gameId],
        queryFn: () => readGameNow(client, data.gameId),
        refetchInterval: DEPLOY_POLL_MS,
        gcTime: 0,
    });
    const started = game.data !== undefined && game.data?.state.$kind !== "Deploying";
    useEffect(() => {
        if (started) onStart();
    }, [started, onStart]);
    const left = useSecondsLeft(data.until);
    return (
        <Notice
            leave={leave}
            headline={`${data.sides[0].name} vs ${data.sides[1].name}`}
            line={
                left > 0
                    ? `Squads are being deployed · ${left} s left`
                    : "Squads are being deployed"
            }
        />
    );
}

function useSecondsLeft(until: number) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return Math.max(0, Math.ceil((until - now) / 1000));
}

/** A plain line in place of the field, with the way back to the lists. */
function Notice({
    leave,
    headline,
    line,
    action,
}: {
    leave: () => void;
    headline: string;
    line: string;
    action?: { label: string; run: () => void };
}) {
    return (
        <FocusRoot back={{ action: "back", label: "Leave", run: leave }}>
            <NoticeFrame leave={leave} headline={headline} line={line} action={action} />
        </FocusRoot>
    );
}

function NoticeFrame({
    leave,
    headline,
    line,
    action,
}: {
    leave: () => void;
    headline: string;
    line: string;
    action?: { label: string; run: () => void };
}) {
    const glyphs = useGlyphSet();
    const navigate = useNavigate();
    const commands: Command[] = action
        ? [
              { action: "confirm", label: action.label, tone: "primary", run: action.run },
              { action: "reset", label: "Watch screen", run: () => navigate("/watch") },
          ]
        : [{ action: "confirm", label: "Watch screen", tone: "primary", run: leave }];
    return (
        <ScreenFrame
            location={["Watch", "Game"]}
            onLocation={leave}
            columns="minmax(0, 560px)"
            commands={<FocusCommandBar glyphs={glyphs} />}
        >
            <EmptyState
                id="watch-notice"
                group="notice"
                headline={headline}
                action={action?.label ?? "Watch screen"}
                commands={commands}
            >
                {line}
            </EmptyState>
        </ScreenFrame>
    );
}
