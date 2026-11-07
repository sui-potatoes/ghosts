// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Encounter, followOpponent } from "@ghosts/engine";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { audioFocused, callPlayerBack } from "../audio";
import {
    useAccountId,
    useChainRecruits,
    useGhostsAccount,
    useGhostsAction,
    type ChainRecruit,
} from "../chain";
import type { ChainGame } from "../chain/bcs";
import { chainDriver, matchScenario } from "../chain/driver";
import {
    abandonGameTx,
    completeGameTx,
    deploySquadTx,
    nextTurnTx,
    useGame,
    useGameRecruits,
} from "../chain/game";
import {
    activeSide,
    earningsFor,
    isOver,
    MAX_MISSED_TURNS,
    outcomeFor,
    rankWith,
    squadSize,
    TURN_LIMIT_MS,
    unitsOnMap,
    type Outcome,
} from "../chain/match-rules";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { engineSettings } from "../engineSettings";
import { RecruitCard } from "../features/headquarters/components/RecruitCard";
import { toLocalRecruits } from "../features/headquarters/mapping";
import { useRecruitPortraits } from "../features/squad/useRecruitPortraits";
import { useBack } from "../hooks/useBack";
import { useMenuNav } from "../hooks/useMenuNav";
import { PauseMenu } from "../PauseMenu";
import "../features/squad/squad.css";
import "../features/headquarters/headquarters.css";

/** How often the game is re-read here; the driver follows the opponent's turn on its own. */
const POLL_MS = 2_000;
/**
 * How long a finished game stands before it is wrapped up and deleted: a few
 * polls, so the other player reads how it ended. The winner sends it, and the
 * other side steps in if they don't.
 */
const WINNER_GRACE_MS = 5_000;
const LOSER_GRACE_MS = 12_000;
/** The answer to the last shot is in at once: let the field play it before the result covers it. */
const LAST_SHOT_MS = 3_000;

/** The time left until `untilMs`, ticking once a second. */
function useRemaining(untilMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return Math.max(0, untilMs - now);
}

const clock = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

type Action = ReturnType<typeof useGhostsAction>;

/** The panel the match screens share: a house-style card on the dark. */
function Panel({ children }: { children: React.ReactNode }) {
    return (
        <main className="match-panel fixed inset-0 z-[150] flex items-center justify-center bg-overlay p-6">
            <div className="flex max-h-full w-full max-w-md flex-col gap-6 overflow-y-auto">
                {children}
            </div>
        </main>
    );
}

/**
 * The two minutes after a match: pick who goes, up to what the map allows. The
 * first recruits are picked already, so running out of time takes some doing.
 * Once deployed, the roster is the squad on the map.
 */
function SquadPick({
    game,
    side,
    gameId,
    accountId,
    recruits,
    deployedSquad,
    action,
    onAbandon,
}: {
    game: ChainGame;
    side: number;
    gameId: string;
    accountId: string;
    recruits: ChainRecruit[];
    deployedSquad: ChainRecruit[];
    action: Action;
    onAbandon: () => void;
}) {
    const size = squadSize(game, side);
    const remaining = useRemaining(Number(game.deployUntilMs));
    const deployed = game.squads[side].length > 0;
    const opponentDeployed = game.squads[1 - side].length > 0;
    const [picked, setPicked] = useState<string[] | null>(null);
    const squad = picked ?? recruits.slice(0, size).map((r) => r.objectId);
    const items = useMenuNav(!deployed);

    const roster = deployed ? deployedSquad : recruits;
    const locals = useMemo(() => toLocalRecruits(roster), [roster]);
    const { portraits, studioHost } = useRecruitPortraits(locals);

    const toggle = (id: string) =>
        setPicked(
            squad.includes(id)
                ? squad.filter((other) => other !== id)
                : squad.length < size
                  ? [...squad, id]
                  : squad,
        );

    const expired = remaining === 0;
    return (
        <main className="squad-screen hq-screen squad-pick">
            <div ref={studioHost} className="squad-pick-studio" aria-hidden="true" />
            <header className="squad-pick-header">
                <div>
                    <span className="label text-accent">Match found</span>
                    <h1 className="squad-title">
                        {deployed ? "Squad deployed" : "Pick your squad"}
                    </h1>
                </div>
                <div className={`squad-pick-clock ${remaining < 20_000 ? "is-low" : ""}`}>
                    <small className="label">Deployment</small>
                    <strong>{clock(remaining)}</strong>
                </div>
            </header>

            <nav aria-label="Squad" className="squad-pick-cards">
                {roster.map((recruit, i) => (
                    <RecruitCard
                        key={recruit.objectId}
                        index={i}
                        variant="deck"
                        recruit={recruit}
                        portrait={portraits[recruit.objectId]}
                        selected={deployed || squad.includes(recruit.objectId)}
                        disabled={deployed}
                        buttonRef={(el) => {
                            items.current[i] = el;
                        }}
                        onClick={() => toggle(recruit.objectId)}
                    />
                ))}
            </nav>

            <footer className="squad-pick-footer">
                <div
                    className={`squad-pick-opponent ${opponentDeployed ? "is-ready" : ""}`}
                    role="status"
                >
                    <i aria-hidden="true" />
                    <span className="label">
                        {opponentDeployed ? "Opponent deployed" : "Opponent is picking their squad"}
                    </span>
                </div>
                {action.error && <p className="label normal-case text-warn">{action.error}</p>}
                <div className="squad-pick-actions">
                    <button className="btn" disabled={action.busy} onClick={onAbandon}>
                        Abandon
                    </button>
                    {expired ? (
                        <button
                            className="btn"
                            disabled={action.busy}
                            onClick={() => void action.run([() => nextTurnTx(gameId, accountId)])}
                        >
                            Time is up: continue
                        </button>
                    ) : (
                        !deployed && (
                            <button
                                ref={(el) => {
                                    items.current[roster.length] = el;
                                }}
                                className="btn squad-pick-deploy"
                                disabled={!squad.length || action.busy}
                                onClick={() =>
                                    void action.run([() => deploySquadTx(gameId, accountId, squad)])
                                }
                            >
                                Deploy {squad.length} / {size}
                            </button>
                        )
                    )}
                </div>
            </footer>
        </main>
    );
}

/** Whose turn it is and how long it has left; past the limit, anyone can move the game on. */
function TurnClock({
    game,
    side,
    gameId,
    accountId,
    action,
}: {
    game: ChainGame;
    side: number;
    gameId: string;
    accountId: string;
    action: Action;
}) {
    const remaining = useRemaining(Number(game.turnStartedMs) + TURN_LIMIT_MS);
    const mine = activeSide(game) === side;
    const [missed, theirMissed] = [game.missed[side], game.missed[1 - side]];
    const lastChance = missed === MAX_MISSED_TURNS - 1;

    // Someone who stepped away is the one who misses turns: tell them it's on them.
    useEffect(() => {
        if (mine && !audioFocused()) callPlayerBack("Your turn");
    }, [mine]);

    return (
        <div className="match-clock" role="status">
            <span className={`label ${mine ? "text-accent" : "text-secondary"}`}>
                {mine ? "Your turn" : "Opponent's turn"}
            </span>
            <span className={`label tabular-nums ${remaining < 10_000 ? "text-warn" : ""}`}>
                {clock(remaining)}
            </span>
            {missed > 0 && (
                <span className="label text-warn">
                    {lastChance
                        ? "One more missed turn forfeits"
                        : `Missed ${missed} / ${MAX_MISSED_TURNS}`}
                </span>
            )}
            {theirMissed > 0 && (
                <span className="label text-secondary">
                    Opponent missed {theirMissed} / {MAX_MISSED_TURNS}
                </span>
            )}
            {remaining === 0 && !isOver(game) && (
                <button
                    className="btn"
                    disabled={action.busy}
                    onClick={() => void action.run([() => nextTurnTx(gameId, accountId)])}
                >
                    Next turn
                </button>
            )}
        </div>
    );
}

/** The field: the engine plays the game, and the chain decides it. */
function Field({
    game,
    gameId,
    side,
    accountId,
    recruits,
    action,
    updatedAt,
    onAbandon,
}: {
    game: ChainGame;
    gameId: string;
    side: number;
    accountId: string;
    recruits: ChainRecruit[];
    action: Action;
    updatedAt: number;
    onAbandon: () => void;
}) {
    const client = useCurrentClient();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [paused, setPaused] = useState(false);

    // The encounter is built once, from the game as it stands when the field opens.
    const [setup] = useState(() => {
        const names = new Map(recruits.map((r) => [r.objectId, r.metadata.name]));
        const mine = unitsOnMap(game)
            .map(({ unit }) => unit.recruit)
            .filter((id) => game.squads[side].includes(id))
            .flatMap((id) => recruits.filter((r) => r.objectId === id));
        return {
            scenario: matchScenario(game, side, names),
            driver: chainDriver({
                client,
                gameId,
                accountId,
                side,
                start: game,
                // Fresher than any poll: the clock and the result go by this.
                onGame: (fresh) => queryClient.setQueryData(["object", gameId], fresh),
            }),
            squad: toLocalRecruits(mine),
        };
    });

    // The opponent's turn on chain: make sure the field follows, with every read.
    const onTheirTurn = activeSide(game) !== side;
    useEffect(() => {
        if (onTheirTurn) void followOpponent();
    }, [onTheirTurn, updatedAt]);

    useBack(() => setPaused(true));

    return (
        <div className="fixed inset-0 h-dvh w-full bg-surface">
            <Encounter
                scenario={setup.scenario}
                driver={setup.driver}
                squad={setup.squad}
                settings={engineSettings}
                paused={paused}
                onPause={() => setPaused(true)}
                onQuit={() => navigate("/")}
            />
            <TurnClock
                game={game}
                side={side}
                gameId={gameId}
                accountId={accountId}
                action={action}
            />
            <PauseMenu
                open={paused}
                onResume={() => setPaused(false)}
                quitLabel="Abandon match"
                onQuit={() => {
                    setPaused(false);
                    onAbandon();
                }}
            />
        </div>
    );
}

const HEADLINES: Record<Outcome | "ended", [title: string, detail: string]> = {
    victory: ["Victory", "The other side is down. Your survivors are coming home."],
    defeat: ["Defeat", "Your squad is gone. Their dog tags go on the wall."],
    draw: ["Draw", "Nobody walked away from this one."],
    stalemate: ["Draw", "Neither side finished it in time. Your survivors are coming home."],
    abandoned: ["Match abandoned", "You can't search for a match for a minute."],
    "opponent-abandoned": ["Victory", "Your opponent walked out. Your squad is coming home."],
    forfeited: [
        "Match forfeited",
        `You missed ${MAX_MISSED_TURNS} turns in a row. You can't search for a match for a minute.`,
    ],
    "opponent-forfeited": ["Victory", "Your opponent stopped playing. Your squad is coming home."],
    "no-show": ["No squad deployed", "You can't search for a match for a minute."],
    "opponent-no-show": ["Victory", "Your opponent never deployed. Your squad is coming home."],
    ended: ["Match over", "The match is finished, and whoever survived is home."],
};

const WINS: (Outcome | "ended")[] = [
    "victory",
    "opponent-abandoned",
    "opponent-forfeited",
    "opponent-no-show",
];

/**
 * How it ended. The game is wrapped up and deleted behind this, by whoever gets
 * to it first; `gone` once it is. A player who misses the last few polls has
 * nothing left to read, and gets the plain `ended`.
 */
function Result({
    outcome,
    gone,
    gameId,
    players,
    action,
    report,
}: {
    outcome: Outcome | "ended";
    gone: boolean;
    gameId: string;
    players: string[];
    action: Action;
    report?: {
        credits: number;
        rating: [before: number, after: number] | null;
        squad: { name: string; xp: number; promotion: string | null }[];
        fallen: string[];
    };
}) {
    const navigate = useNavigate();
    const [title, detail] = HEADLINES[outcome];
    const wins = WINS.includes(outcome);

    const { run } = action;
    const sent = useRef(false);
    useEffect(() => {
        if (gone || sent.current) return;
        const timer = window.setTimeout(
            () => {
                sent.current = true;
                void run([() => completeGameTx(gameId, players)]);
            },
            wins ? WINNER_GRACE_MS : LOSER_GRACE_MS,
        );
        return () => window.clearTimeout(timer);
    }, [gone, wins, gameId, players]);

    return (
        <Panel>
            <h1 className="font-mono text-3xl font-light tracking-[0.28em]">{title}</h1>
            <p className="label normal-case text-secondary">{detail}</p>
            {report && (
                <dl className="match-report">
                    <div>
                        <dt className="label">Credits</dt>
                        <dd>+{report.credits}</dd>
                    </div>
                    {report.rating && (
                        <div>
                            <dt className="label">Rating</dt>
                            <dd>
                                {report.rating[0]} → {report.rating[1]}
                            </dd>
                        </div>
                    )}
                    {report.squad.map(({ name, xp, promotion }) => (
                        <div key={name}>
                            <dt className="label normal-case">{name}</dt>
                            <dd>
                                +{xp} XP
                                {promotion && <span className="text-accent"> · {promotion}</span>}
                            </dd>
                        </div>
                    ))}
                    {report.fallen.map((name) => (
                        <div key={name}>
                            <dt className="label normal-case text-secondary">{name}</dt>
                            <dd className="text-secondary">Fallen</dd>
                        </div>
                    ))}
                </dl>
            )}
            {!gone && action.error && <p className="label normal-case text-warn">{action.error}</p>}
            <button
                className="btn self-start"
                disabled={!gone && action.busy}
                onClick={() =>
                    gone ? navigate("/") : void run([() => completeGameTx(gameId, players)])
                }
            >
                {gone ? "Continue" : "Wrap up"}
            </button>
        </Panel>
    );
}

/**
 * A match, from the squad pick to the result. Everything on screen comes from
 * the `Game`; the `Account` only says which game, and is `Idle` again once the
 * game is deleted. The last read of the game stays around to show how it ended.
 */
export default function Match() {
    const accountId = useAccountId();
    const [gameId, setGameId] = useState<string | null>(null);
    const account = useGhostsAccount(accountId.data, gameId ? POLL_MS : undefined);
    const recruits = useChainRecruits(account.data);
    const action = useGhostsAction();

    const search = account.data?.search;
    const playing = search?.$kind === "Playing" ? search.Playing : null;
    if (playing && playing !== gameId) setGameId(playing);

    /** Sent home: the `Account` is out of the game, which is deleted by now. */
    const gone = !!gameId && !!account.data && !playing;
    const game = useGame(gameId, gone ? undefined : POLL_MS);
    const inGame = useGameRecruits(game.data);
    const [confirming, setConfirming] = useState(false);
    const [abandoned, setAbandoned] = useState(false);
    const [played, setPlayed] = useState(false);
    // The rating going in, for what the game did to it once it is wrapped up.
    const ratingAtStart = useRef<number | null>(null);
    if (playing && account.data && ratingAtStart.current === null)
        ratingAtStart.current = Number(account.data.rating.rating);
    const ended = !!game.data && (isOver(game.data) || gone);
    useEffect(() => {
        if (!ended) return;
        const timer = window.setTimeout(() => setPlayed(true), LAST_SHOT_MS);
        return () => window.clearTimeout(timer);
    }, [ended]);

    // `isLoading`, not `isPending`: signed out, these never run, and it's back to the menu
    if (accountId.isLoading || account.isLoading) return <LoadingSpinner />;
    if (!gameId) return <Navigate to="/" replace />;
    if (!game.data || !accountId.data) return <LoadingSpinner />;

    const side = game.data.players.indexOf(accountId.data);
    if (side < 0) return <Navigate to="/" replace />;

    const over = isOver(game.data);
    const finished = over || gone;
    const outcome = abandoned ? "abandoned" : over ? outcomeFor(game.data, side) : "ended";
    const fieldReady = (inGame.data?.length ?? 0) >= unitsOnMap(game.data).length;
    const abandon = () => setConfirming(true);
    const showResult = finished && (played || abandoned || game.data.deploying || !fieldReady);
    const mine = game.data.squads[side];

    const earned = earningsFor(game.data, side);
    const ratingNow = Number(account.data?.rating.rating ?? 0);
    const report = over
        ? {
              credits: earned.credits,
              rating:
                  gone && ratingAtStart.current !== null && ratingNow !== ratingAtStart.current
                      ? ([ratingAtStart.current, ratingNow] as [number, number])
                      : null,
              squad: (inGame.data ?? [])
                  .filter((r) => mine.includes(r.objectId))
                  .map((r) => {
                      const xp = earned.xpOf(r.objectId);
                      const rank = rankWith(r.rank.$kind, r.xp + xp);
                      return {
                          name: r.metadata.name,
                          xp,
                          promotion: rank === r.rank.$kind ? null : `Promoted to ${rank}`,
                      };
                  }),
              fallen: game.data.fallen[side].map((tag) => tag.metadata.name),
          }
        : undefined;

    return (
        <>
            {game.data.deploying ? (
                !finished && (
                    <SquadPick
                        game={game.data}
                        side={side}
                        gameId={gameId}
                        accountId={accountId.data}
                        recruits={recruits.data ?? []}
                        deployedSquad={(inGame.data ?? []).filter((r) => mine.includes(r.objectId))}
                        action={action}
                        onAbandon={abandon}
                    />
                )
            ) : fieldReady ? (
                <Field
                    game={game.data}
                    gameId={gameId}
                    side={side}
                    accountId={accountId.data}
                    recruits={inGame.data ?? []}
                    action={action}
                    updatedAt={game.dataUpdatedAt}
                    onAbandon={abandon}
                />
            ) : (
                !finished && <LoadingSpinner />
            )}
            {showResult && (
                <Result
                    outcome={outcome}
                    gone={gone}
                    gameId={gameId}
                    players={game.data.players}
                    action={action}
                    report={report}
                />
            )}
            <ConfirmDialog
                open={confirming}
                title="Abandon the match?"
                confirmLabel="Abandon"
                danger
                onClose={() => setConfirming(false)}
                onConfirm={() => {
                    setConfirming(false);
                    setAbandoned(true);
                    void action
                        .run([() => abandonGameTx(gameId, accountId.data!, game.data!.players)])
                        .then((done) => setAbandoned(done));
                }}
            >
                Your opponent wins and your squad comes home, but you can't search for a match for a
                minute.
            </ConfirmDialog>
        </>
    );
}
