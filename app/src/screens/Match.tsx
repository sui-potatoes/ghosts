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
    fetchPendingSeats,
    hireRecruitsTx,
    useCurrentGame,
    useGhostsAction,
    type ChainAccount,
    type ChainRecruit,
    type ChainSeat,
} from "../chain";
import type { ChainGame } from "../chain/bcs";
import { chainDriver, matchScenario } from "../chain/driver";
import { useMatchIntel, useOpponentName } from "../chain/useMatchIntel";
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
    deployUntil,
    experienceFor,
    fallenOf,
    isDeploying,
    isOver,
    MAX_MISSED_TURNS,
    missedTurns,
    outcomeFor,
    rankWith,
    squadOf,
    squadSize,
    turnStartedAt,
    turnLimitMs,
    unitsOnMap,
    type Outcome,
} from "../chain/match-rules";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { engineSettings } from "../engineSettings";
import { MatchDebrief } from "../features/debrief/MatchDebrief";
import { figuresOf } from "../features/debrief/figures";
import { deployedOf, type MatchResult } from "../features/debrief/result";
import { RecruitCard } from "../features/headquarters/components/RecruitCard";
import { toLocalRecruits } from "../features/headquarters/mapping";
import { useRecruitPortraits } from "../features/squad/useRecruitPortraits";
import { SquadSelect } from "../features/squad-view/SquadSelect";
import { useBack } from "../hooks/useBack";
import { useMenuNav } from "../hooks/useMenuNav";
import { PauseMenu } from "../PauseMenu";
import "../features/squad/squad.css";
import "../features/headquarters/headquarters.css";

/**
 * The squad selection before the field. `true`: the podium screen in the shared
 * interface (`src/features/squad-view/SquadSelect.tsx`). `false`: the card pick
 * it replaced (`SquadPick` below), kept until the new one is signed off.
 */
const PODIUM_SQUAD_SELECT = true;

/**
 * How a match ends. `true`: the result on the podium diorama
 * (`src/features/debrief/`), with the field unmounted behind it. `false`: the
 * card (`Result` below) over the field, kept until the new one is signed off.
 */
const PODIUM_RESULT = true;

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
    seat,
    action,
    onAbandon,
}: {
    game: ChainGame;
    side: number;
    gameId: string;
    accountId: string;
    recruits: ChainRecruit[];
    deployedSquad: ChainRecruit[];
    /** The seat the match sent this player, until it is accepted: no deploying before. */
    seat: ChainSeat["ref"] | null;
    action: Action;
    onAbandon: () => void;
}) {
    const size = squadSize(game, side);
    const remaining = useRemaining(deployUntil(game));
    const deployed = squadOf(game, side).length > 0;
    const opponentDeployed = squadOf(game, 1 - side).length > 0;
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
                                disabled={!squad.length || action.busy || !!seat}
                                onClick={() =>
                                    void action.run([() => deploySquadTx(gameId, accountId, squad)])
                                }
                            >
                                {seat ? "Joining…" : `Deploy ${squad.length} / ${size}`}
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
    const remaining = useRemaining(turnStartedAt(game) + turnLimitMs(game.turn));
    const mine = activeSide(game) === side;
    const [missed, theirMissed] = [missedTurns(game, side), missedTurns(game, 1 - side)];
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
        const mine = squadOf(game, side).flatMap((id) => recruits.filter((r) => r.objectId === id));
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

    // The unit readout: names, rank and gear from the recruits already read, the opponent's line.
    const { intel, opponent } = useMatchIntel(game, recruits, side);

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
                intel={intel}
                opponent={opponent}
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

/**
 * How a game wrapped up before this screen saw it end, as the `Account` scores it:
 * an opponent who walks out wraps the game up in the same transaction.
 */
type Settled = "settled-win" | "settled-loss" | "settled-draw";
type Score = ChainAccount["score"];

/** Which result the `Account` gained since the game started; null while it has none. */
function settledOutcome(before: Score, after: Score): Settled | null {
    if (Number(after.wins) > Number(before.wins)) return "settled-win";
    if (Number(after.losses) > Number(before.losses)) return "settled-loss";
    if (Number(after.draws) > Number(before.draws)) return "settled-draw";
    return null;
}

const HEADLINES: Record<Outcome | Settled | "ended", [title: string, detail: string]> = {
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
    "settled-win": ["Victory", "Your opponent is out of the match. Your squad is coming home."],
    "settled-loss": ["Defeat", "The match went to your opponent. Whoever survived is home."],
    "settled-draw": ["Draw", "Nobody won this one. Your survivors are coming home."],
    ended: ["Match over", "The match is finished, and whoever survived is home."],
};

const WINS: (Outcome | Settled | "ended")[] = [
    "settled-win",
    "victory",
    "opponent-abandoned",
    "opponent-forfeited",
    "opponent-no-show",
];

/**
 * Wrapping a finished game up: the winner sends it after a short grace, the
 * other side steps in later, and the player can send it at once. A seat the
 * other player never accepted is accepted on the way.
 */
function useWrapUp({
    gone,
    wins,
    gameId,
    players,
    action,
}: {
    gone: boolean;
    wins: boolean;
    gameId: string;
    players: string[];
    action: Action;
}): () => void {
    const { run } = action;
    const send = () =>
        void run([
            async () =>
                completeGameTx(
                    gameId,
                    players,
                    await fetchPendingSeats(action.client, gameId, players),
                ),
        ]);
    const sent = useRef(false);
    useEffect(() => {
        if (gone || sent.current) return;
        const timer = window.setTimeout(
            () => {
                sent.current = true;
                send();
            },
            wins ? WINNER_GRACE_MS : LOSER_GRACE_MS,
        );
        return () => window.clearTimeout(timer);
    }, [gone, wins, gameId, players]);
    return send;
}

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
    outcome: Outcome | Settled | "ended";
    gone: boolean;
    gameId: string;
    players: string[];
    action: Action;
    report?: {
        rating: [before: number, after: number] | null;
        squad: { name: string; xp: number; promotion: string | null }[];
        fallen: string[];
    };
}) {
    const navigate = useNavigate();
    const [title, detail] = HEADLINES[outcome];
    const wins = WINS.includes(outcome);

    const wrapUp = useWrapUp({ gone, wins, gameId, players, action });

    return (
        <Panel>
            <h1 className="font-mono text-3xl font-light tracking-[0.28em]">{title}</h1>
            <p className="label normal-case text-secondary">{detail}</p>
            {report && (
                <dl className="match-report">
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
                onClick={() => (gone ? navigate("/") : wrapUp())}
            >
                {gone ? "Continue" : "Wrap up"}
            </button>
        </Panel>
    );
}

/**
 * The result on the podium diorama. The squad is every recruit of this side
 * the app saw in the game (the game lets go of the fallen, so `seen` keeps
 * them), the fallen are the `UnitKIA` records, the experience before is what
 * the game took them in with, and what they came home with is read from the
 * `Account` once the game is wrapped up.
 */
function ResultScreen({
    game,
    side,
    gameId,
    outcome,
    over,
    gone,
    seen,
    home,
    rating,
    action,
    onHire,
}: {
    game: ChainGame;
    side: number;
    gameId: string;
    outcome: MatchResult["outcome"];
    over: boolean;
    gone: boolean;
    seen: ChainRecruit[];
    /** The `Account`'s recruits as read now. */
    home: ChainRecruit[];
    rating: [number, number] | null;
    action: Action;
    onHire: () => void;
}) {
    const opponent = useOpponentName(game, side);
    const wins = WINS.includes(outcome);
    const wrapUp = useWrapUp({ gone, wins, gameId, players: game.players, action });

    const { result, figures } = useMemo(() => {
        const alive = squadOf(game, side);
        const fallen = fallenOf(game, side, seen).map((r) => r.objectId);
        const squad = deployedOf(seen, game.players[side], alive, fallen);
        const figs = figuresOf(squad);
        const byId = new Map(home.map((r) => [r.objectId, r]));
        // Home is only believed once every survivor is there: the read can be a poll behind.
        const homeReady = gone && alive.every((id) => byId.has(id));
        const result: MatchResult = {
            outcome,
            earned: over ? experienceFor(game, side) : null,
            rating,
            squad: squad.map((r, i) => ({
                objectId: r.objectId,
                name: figs[i].callsign,
                rank: r.rank.$kind,
                xp: Number(r.xp),
            })),
            fallen,
            history: game.history,
            home: homeReady
                ? Object.fromEntries(
                      alive.flatMap((id) => {
                          const r = byId.get(id);
                          return r ? [[id, { rank: r.rank.$kind, xp: Number(r.xp) }]] : [];
                      }),
                  )
                : null,
            recruitsHome: homeReady ? home.length : null,
            opponent,
        };
        return { result, figures: figs };
        // `rating` is a new pair on every render: its numbers stand for it.
    }, [game, side, seen, home, gone, outcome, over, rating?.[0], rating?.[1], opponent]);

    return (
        <MatchDebrief
            result={result}
            figures={figures}
            gone={gone}
            busy={action.busy}
            error={action.error}
            clearError={action.clearError}
            onWrapUp={wrapUp}
            onHire={onHire}
        />
    );
}

/**
 * A match, from the squad pick to the result. Everything on screen comes from
 * the `Game`; the `Account` only says which game (or the seat a match sent it,
 * taken with the squad), and is `Idle` again once the game is deleted. The last
 * read of the game stays around to show how it ended.
 */
export default function Match() {
    const accountId = useAccountId();
    const [gameId, setGameId] = useState<string | null>(null);
    const account = useGhostsAccount(accountId.data, gameId ? POLL_MS : undefined);
    const recruits = useChainRecruits(account.data);
    const action = useGhostsAction();

    // the game the `Account` is in, or has a seat in from the match that found it
    const current = useCurrentGame();
    const playing = current.gameId;
    if (playing && playing !== gameId) setGameId(playing);

    /** Sent home: the `Account` is out of the game, which is deleted by now. */
    const gone = !!gameId && !!account.data && !playing;
    const game = useGame(gameId, gone ? undefined : POLL_MS);
    const inGame = useGameRecruits(game.data);
    // every recruit seen in the game, the fallen too: the game lets go of them
    const seen = useRef(new Map<string, ChainRecruit>());
    for (const recruit of inGame.data ?? []) seen.current.set(recruit.objectId, recruit);
    const seenList = useMemo(() => [...seen.current.values()], [inGame.data]);
    const [confirming, setConfirming] = useState(false);
    const [abandoned, setAbandoned] = useState(false);
    const [played, setPlayed] = useState(false);
    // The `Account` going in, for what the game did to it once it is wrapped up.
    const atStart = useRef<{ rating: number; score: Score } | null>(null);
    if (playing && account.data && atStart.current === null)
        atStart.current = {
            rating: Number(account.data.rating.rating),
            score: account.data.score,
        };
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
    // Wrapped up and deleted before the last read saw it end: the `Account` says how.
    const settled =
        gone && !over && atStart.current && account.data
            ? settledOutcome(atStart.current.score, account.data.score)
            : null;
    const outcome = abandoned
        ? "abandoned"
        : over
          ? outcomeFor(game.data, side)
          : (settled ?? "ended");
    const fieldReady = (inGame.data?.length ?? 0) >= unitsOnMap(game.data).length;
    const abandon = () => setConfirming(true);
    /** Abandon without asking (the caller asked): the opponent wins, the squad comes home. */
    const abandonNow = () => {
        setAbandoned(true);
        const players = game.data!.players;
        void action
            .run([
                async () =>
                    abandonGameTx(
                        gameId,
                        accountId.data!,
                        players,
                        await fetchPendingSeats(action.client, gameId, players),
                    ),
            ])
            .then((done) => setAbandoned(done));
    };
    const deploying = isDeploying(game.data);
    const showResult = finished && (played || abandoned || deploying || !fieldReady);
    const mine = squadOf(game.data, side);

    const earned = experienceFor(game.data, side);
    const ratingNow = Number(account.data?.rating.rating ?? 0);
    const start = atStart.current;
    const rating =
        gone && start && ratingNow !== start.rating
            ? ([start.rating, ratingNow] as [number, number])
            : null;
    const report = over
        ? {
              rating,
              squad: (inGame.data ?? [])
                  .filter((r) => mine.includes(r.objectId))
                  .map((r) => {
                      const xp = earned;
                      const rank = rankWith(r.rank.$kind, r.xp + xp);
                      return {
                          name: r.metadata.name,
                          xp,
                          promotion: rank === r.rank.$kind ? null : `Promoted to ${rank}`,
                      };
                  }),
              fallen: fallenOf(game.data, side, seen.current.values()).map((r) => r.metadata.name),
          }
        : settled && start
          ? {
                // What the squad came home with.
                rating,
                squad: (inGame.data ?? [])
                    .filter((r) => mine.includes(r.objectId))
                    .flatMap((r) => {
                        const home = recruits.data?.find((h) => h.objectId === r.objectId);
                        if (!home) return [];
                        return [
                            {
                                name: r.metadata.name,
                                xp: home.xp - r.xp,
                                promotion:
                                    home.rank.$kind === r.rank.$kind
                                        ? null
                                        : `Promoted to ${home.rank.$kind}`,
                            },
                        ];
                    }),
                fallen: fallenOf(game.data, side, seen.current.values()).map(
                    (r) => r.metadata.name,
                ),
            }
          : undefined;

    const podiumResult = PODIUM_RESULT && showResult;

    return (
        <>
            {podiumResult && (
                <ResultScreen
                    game={game.data}
                    side={side}
                    gameId={gameId}
                    outcome={outcome}
                    over={over}
                    gone={gone}
                    seen={seenList}
                    home={recruits.data ?? []}
                    rating={rating}
                    action={action}
                    onHire={() => void action.run([() => hireRecruitsTx(accountId.data!)])}
                />
            )}
            {podiumResult ? null : deploying ? (
                !finished &&
                (PODIUM_SQUAD_SELECT ? (
                    <SquadSelect
                        podiums={squadSize(game.data, side) + mine.length}
                        roster={recruits.data ?? []}
                        deployed={
                            mine.length
                                ? (inGame.data ?? []).filter((r) => mine.includes(r.objectId))
                                : null
                        }
                        deadline={deployUntil(game.data)}
                        opponentDeployed={squadOf(game.data, 1 - side).length > 0}
                        joining={!!current.seat}
                        busy={action.busy}
                        error={action.error}
                        clearError={action.clearError}
                        onDeploy={(ids) =>
                            action.run([() => deploySquadTx(gameId, accountId.data!, ids)])
                        }
                        onTimeUp={() =>
                            void action.run([() => nextTurnTx(gameId, accountId.data!)])
                        }
                        onAbandon={abandonNow}
                    />
                ) : (
                    <SquadPick
                        game={game.data}
                        side={side}
                        gameId={gameId}
                        accountId={accountId.data}
                        recruits={recruits.data ?? []}
                        deployedSquad={(inGame.data ?? []).filter((r) => mine.includes(r.objectId))}
                        seat={current.seat?.ref ?? null}
                        action={action}
                        onAbandon={abandon}
                    />
                ))
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
            {showResult && !PODIUM_RESULT && (
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
                    abandonNow();
                }}
            >
                Your opponent wins and your squad comes home, but you can't search for a match for a
                minute.
            </ConfirmDialog>
        </>
    );
}
