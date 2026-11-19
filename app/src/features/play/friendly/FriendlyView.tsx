// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly matches in the shared interface language: a landing with three ways
 * in (host, join with a code, open games), the host's setup and lobby, the join
 * field and the public list. All mock: the lobbies come from `lobbies.ts`, the
 * match from `stageMockMatch`. A reload in the middle of a lobby restores it
 * (the session lives in sessionStorage); coming back from a match lands on the
 * landing, because starting spends the lobby.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { savedRecruits, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import {
    ActionRow,
    EmptyState,
    Eyebrow,
    FocusCommandBar,
    FocusRoot,
    List,
    ListRow,
    Panel,
    Prompt,
    ReadoutLine,
    ScreenFrame,
    StatusChip,
    Stepper,
    TextField,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../../ui";
import {
    presetLabel,
    priceOf,
    squadPrice,
    squadSize,
    tierOf,
    type Issue,
    type Loadout,
    type Mode,
} from "../economy";
import { SquadBuilder } from "../ranked/SquadBuilder";
import { stageMockMatch } from "../match";
import { useRating } from "../rating";
import {
    arriveNow,
    finishSession,
    hostLobby,
    joinLobby,
    leaveSession,
    lookupCode,
    openGames,
    opponentState,
    phaseOf,
    readSession,
    recentCodes,
    startBlock,
    updateSquad,
    type Lobby,
    type RuleFilter,
    type Session,
    type Visibility,
} from "./lobbies";
import {
    ageLabel,
    asksBeforeClosing,
    bringSquad,
    budgetOptions,
    buildsSquad,
    defaultRule,
    matchRule,
    readiness,
    ruleBudget,
    ruleLabel,
    ruleRating,
    ruleTierName,
    type Rule,
    formatCode,
    FRIENDLY_ROUTE,
    linkCode,
    shareLink,
    typingProblem,
    type SquadKind,
} from "./model";
import "./friendly.css";

type View = "landing" | "host" | "join" | "open" | "lobby";
type Refusal = { message: string } | null;

const COLUMNS = "minmax(0, 520px) minmax(0, 420px) minmax(0, 1fr)";
const TITLES: Record<View, string> = {
    landing: "Friendly",
    host: "Host",
    join: "Join",
    open: "Open",
    lobby: "Lobby",
};

/** Where the lobby's builder keeps its squad, apart from ranked's. */
const BUILDER_KEY = "ghosts:friendly-squad";

/** QA builds only: a button that skips the opponent's arrival wait. */
const QA_SKIP = Boolean(import.meta.env.VITE_FRIENDLY_QA);

const kv = (): Storage => window.sessionStorage;

/** The clock, ticking while `ms` is set. */
function useNow(ms: number | null): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setNow(Date.now());
        if (ms === null) return;
        const id = window.setInterval(() => setNow(Date.now()), ms);
        return () => window.clearInterval(id);
    }, [ms]);
    return now;
}

function savedSquad(): { role: string; callsign: string }[] | null {
    try {
        return savedRecruits(localStorage.getItem(SQUAD_STORAGE_KEY));
    } catch {
        return null;
    }
}

export function FriendlyView() {
    const navigate = useNavigate();
    const location = useLocation();
    const { rating } = useRating();
    const glyphs = useGlyphSet();
    const [session, setSession] = useState<Session | null>(() => readSession(kv()));
    const [view, setView] = useState<View>(() => (readSession(kv()) ? "lobby" : "landing"));
    const [mode, setMode] = useState<Mode>("3x3");
    const [visibility, setVisibility] = useState<Visibility>("invite");
    const [ruleKind, setRuleKind] = useState<Rule["kind"]>("budget");
    const [tier, setTier] = useState(() => (defaultRule(rating) as { tier: string }).tier);
    const rule: Rule = ruleKind === "any" ? { kind: "any" } : { kind: "budget", tier };
    const [squadKind, setSquadKind] = useState<SquadKind>("saved");
    const [candidate, setCandidate] = useState<Lobby | null>(null);
    const [refusal, setRefusal] = useState<Refusal>(null);
    const [typing, setTyping] = useState("");
    const [prompt, setPrompt] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    // The host shared the code or link, so someone may be on the way.
    const [shared, setShared] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const saved = useMemo(savedSquad, []);
    const hasSaved = saved !== null && saved.length > 0;
    const kind: SquadKind = hasSaved ? squadKind : "build";
    const copyTimer = useRef(0);
    const now = useNow(view === "lobby" ? 500 : view === "open" ? 2000 : null);

    useEffect(() => () => window.clearTimeout(copyTimer.current), []);

    const goView = (next: View) => {
        setCandidate(null);
        setRefusal(null);
        setPrompt(false);
        setLeaving(false);
        setView(next);
    };

    const leaveScreen = () => navigate("/play", { replace: true });

    /** Try a code the player typed, pasted or followed; true when it led into a lobby. */
    const attempt = useCallback((input: string): boolean => {
        const t = Date.now();
        const found = lookupCode(kv(), input, t);
        if (!found.ok) {
            setRefusal({ message: found.message });
            return false;
        }
        setRefusal(null);
        setPrompt(false);
        if (found.own) {
            const own = readSession(kv());
            if (own && own.lobby.id === found.lobby.id) {
                setSession(own);
                setView("lobby");
                return true;
            }
            setRefusal({ message: "That match is closed" });
            return false;
        }
        // The rule is shown before joining; Join on that screen enters the lobby.
        setCandidate(found.lobby);
        setView("join");
        return true;
    }, []);

    /** Enter a lobby as the guest, bringing a squad that fits its rule. */
    const enterLobby = (lobby: Lobby) => {
        const t = Date.now();
        const b = bringSquad(kind, saved, lobby.mode, lobby.rule);
        started.current = false;
        setSession(
            joinLobby(
                kv(),
                lobby,
                {
                    ...b,
                    builds: buildsSquad(lobby.rule, b.kind),
                    ready: readiness(b.squad, lobby.rule, lobby.mode).length === 0,
                },
                t,
            ),
        );
        setCandidate(null);
        setRefusal(null);
        setView("lobby");
    };

    /** The builder reported the player's squad. */
    const onSquad = useCallback((squad: Loadout[], issues: Issue[]) => {
        const s = readSession(kv());
        if (!s) return;
        const message = issues[0]?.message ?? null;
        if (
            s.ready === (issues.length === 0) &&
            s.issue === message &&
            JSON.stringify(s.squad) === JSON.stringify(squad)
        )
            return;
        setSession(updateSquad(kv(), squad, issues, Date.now()));
    }, []);

    // A share link opens the join flow with its code; the query is spent.
    const linked = useRef(false);
    useEffect(() => {
        if (linked.current) return;
        const code = linkCode(location.search);
        if (code === null) return;
        linked.current = true;
        navigate(FRIENDLY_ROUTE, { replace: true });
        setTyping(code);
        if (!attempt(code)) {
            setView("join");
            setPrompt(true);
        }
    }, [location.search, attempt, navigate]);

    const copy = (what: string, text: string) => {
        const done = () => {
            setShared(true);
            setCopied(what);
            window.clearTimeout(copyTimer.current);
            copyTimer.current = window.setTimeout(() => setCopied(null), 2200);
        };
        try {
            navigator.clipboard.writeText(text).then(done, done);
        } catch {
            done();
        }
    };

    const startMatch = useCallback(
        (s: Session) => {
            const opponent = s.role === "host" ? s.opponent : s.lobby.host;
            const route = stageMockMatch({
                kind: "friendly",
                mode: s.lobby.mode,
                squad: s.squad,
                opponent: { name: opponent.name, rating: opponent.rating },
                rule: matchRule(s.lobby.rule, s.lobby.mode),
                returnTo: FRIENDLY_ROUTE,
            });
            finishSession(kv());
            navigate(route);
        },
        [navigate],
    );

    // A guest's host starts after a moment, or closes the lobby.
    const phase = session ? phaseOf(session, now) : null;
    const started = useRef(false);
    useEffect(() => {
        if (!session || session.role !== "guest" || phase !== "starting" || started.current) return;
        started.current = true;
        startMatch(session);
    }, [session, phase, startMatch]);

    const endLobby = () => {
        leaveSession(kv());
        setSession(null);
        goView(session?.role === "guest" ? "open" : "landing");
    };

    // A host lobby with an opponent in it, or whose code went out, is not closed by a slip:
    // Esc, Back and Cancel match ask first (the answer to the prompt is Keep lobby by Esc).
    const asksFirst =
        view === "lobby" && !!session && !!phase && asksBeforeClosing(session.role, phase, shared);
    const leaveLobby = () => (asksFirst ? setLeaving(true) : endLobby());

    const back: Command =
        view === "landing"
            ? { action: "back", label: "Play", run: leaveScreen }
            : view === "lobby"
              ? {
                    action: "back",
                    label: session?.role === "host" ? "Cancel match" : "Leave",
                    run: leaveLobby,
                }
              : { action: "back", label: "Friendly", run: () => goView("landing") };

    const bring = bringSquad(kind, saved, mode, rule);

    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Friendly", ...(view === "landing" ? [] : [TITLES[view]])]}
                onLocation={back.run}
                status={
                    <>
                        {copied && <StatusChip label="Clipboard" value="Copied" />}
                        {phase === "starting" && (
                            <StatusChip label="Match" value="Starting" state="live" />
                        )}
                    </>
                }
                columns={COLUMNS}
                commands={<FocusCommandBar glyphs={glyphs} />}
                overlay={
                    leaving && session ? (
                        <Prompt
                            id="prompt-leave"
                            tone="danger"
                            eyebrow="Friendly match"
                            title="Cancel this match?"
                            lines={[
                                ["Code", formatCode(session.lobby.code)],
                                [
                                    "Opponent",
                                    phase === "waiting" ? "Nobody yet" : session.opponent.name,
                                ],
                            ]}
                            confirm={{
                                label: "Cancel match",
                                run: () => {
                                    setLeaving(false);
                                    endLobby();
                                },
                            }}
                            cancel={{ label: "Keep lobby", run: () => setLeaving(false) }}
                            glyphs={glyphs}
                        >
                            The code stops working and anyone in the lobby is sent away.
                        </Prompt>
                    ) : prompt && view === "join" ? (
                        <CodePrompt
                            value={typing}
                            onChange={(v) => {
                                setTyping(v);
                                setRefusal(null);
                            }}
                            refusal={refusal?.message}
                            onSubmit={() => attempt(typing)}
                            onClose={() => setPrompt(false)}
                            glyphs={glyphs}
                        />
                    ) : undefined
                }
            >
                {view === "landing" && (
                    <Landing
                        count={openGames(now).length}
                        go={goView}
                        openPrompt={() => {
                            setTyping("");
                            setView("join");
                            setPrompt(true);
                        }}
                    />
                )}
                {view === "host" && (
                    <HostSetup
                        mode={mode}
                        setMode={setMode}
                        visibility={visibility}
                        setVisibility={setVisibility}
                        rule={rule}
                        setRuleKind={setRuleKind}
                        setTier={setTier}
                        squadKind={kind}
                        setSquadKind={setSquadKind}
                        hasSaved={hasSaved}
                        squad={bring.squad}
                        names={bring.names}
                        create={() => {
                            setSession(
                                hostLobby(
                                    kv(),
                                    {
                                        mode,
                                        visibility,
                                        rule,
                                        squad: bring.squad,
                                        names: bring.names,
                                        builds: buildsSquad(rule, bring.kind),
                                        ready: readiness(bring.squad, rule, mode).length === 0,
                                        you: { name: "You", rating },
                                    },
                                    Date.now(),
                                ),
                            );
                            started.current = false;
                            setShared(false);
                            setView("lobby");
                        }}
                    />
                )}
                {view === "join" && (
                    <JoinView
                        candidate={candidate}
                        enter={enterLobby}
                        otherCode={() => {
                            setCandidate(null);
                            setPrompt(true);
                        }}
                        hasSaved={hasSaved}
                        squadKind={kind}
                        setSquadKind={setSquadKind}
                        typing={typing}
                        refusal={prompt ? null : refusal}
                        openPrompt={() => setPrompt(true)}
                        paste={() => {
                            try {
                                navigator.clipboard.readText().then(
                                    (text) => {
                                        setTyping(text);
                                        attempt(text);
                                    },
                                    () =>
                                        setRefusal({
                                            message: "Paste is blocked here, type the code",
                                        }),
                                );
                            } catch {
                                setRefusal({ message: "Paste is blocked here, type the code" });
                            }
                        }}
                        pick={(code) => {
                            setTyping(code);
                            attempt(code);
                        }}
                    />
                )}
                {view === "open" && (
                    <OpenGames
                        now={now}
                        join={(lobby) => {
                            const found = lookupCode(kv(), lobby.code, Date.now());
                            if (!found.ok || found.own) {
                                setRefusal({
                                    message: found.ok ? "That match is closed" : found.message,
                                });
                                return;
                            }
                            enterLobby(found.lobby);
                        }}
                        host={() => goView("host")}
                        refusal={refusal}
                    />
                )}
                {view === "lobby" && session && (
                    <LobbyView
                        session={session}
                        now={now}
                        copy={copy}
                        copied={copied}
                        skip={() => setSession(arriveNow(kv(), Date.now()))}
                        onSquad={onSquad}
                        start={() => startMatch(session)}
                        end={leaveLobby}
                    />
                )}
                {view === "lobby" && !session && (
                    <Panel className="gfr-main">
                        <EmptyState
                            id="lobby-gone"
                            group="main"
                            headline="NO LOBBY"
                            action="Friendly"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Friendly",
                                    run: () => goView("landing"),
                                },
                            ]}
                        >
                            There is no lobby to return to.
                        </EmptyState>
                    </Panel>
                )}
            </ScreenFrame>
        </FocusRoot>
    );
}

// === Landing ================================================================

function Landing({
    count,
    go,
    openPrompt,
}: {
    count: number;
    go: (view: View) => void;
    openPrompt: () => void;
}) {
    return (
        <Panel label="Friendly match" className="gfr-main">
            <List label="Ways in">
                <ListRow
                    id="host"
                    group="main"
                    name="Host a match"
                    kind="Invite code or open to anyone"
                    title="Host a match"
                    hint="Open a lobby and bring an opponent in"
                    instant
                    commands={[{ action: "confirm", label: "Host", run: () => go("host") }]}
                />
                <ListRow
                    id="join"
                    group="main"
                    name="Join with a code"
                    kind="Type, paste or follow a link"
                    title="Join with a code"
                    hint="Enter the code a friend sent you"
                    instant
                    commands={[{ action: "confirm", label: "Join", run: openPrompt }]}
                />
                <ListRow
                    id="open"
                    group="main"
                    name="Open games"
                    kind="Lobbies anyone can join"
                    tag={String(count)}
                    tagTone={count > 0 ? "accent" : "dim"}
                    title="Open games"
                    hint={count > 0 ? `${count} waiting for an opponent` : "Nobody is waiting now"}
                    instant
                    commands={[{ action: "confirm", label: "Browse", run: () => go("open") }]}
                />
            </List>
        </Panel>
    );
}

// === Host ===================================================================

function HostSetup({
    mode,
    setMode,
    visibility,
    setVisibility,
    rule,
    setRuleKind,
    setTier,
    squadKind,
    setSquadKind,
    hasSaved,
    squad,
    names,
    create,
}: {
    mode: Mode;
    setMode: (m: Mode) => void;
    visibility: Visibility;
    setVisibility: (v: Visibility) => void;
    rule: Rule;
    setRuleKind: (k: Rule["kind"]) => void;
    setTier: (tier: string) => void;
    squadKind: SquadKind;
    setSquadKind: (k: SquadKind) => void;
    hasSaved: boolean;
    squad: Loadout[];
    names: string[];
    create: () => void;
}) {
    const squadOptions: [string, string][] = hasSaved
        ? [
              ["saved", "Your squad"],
              ["build", "Build one"],
          ]
        : [["build", "Build one"]];
    const budget = ruleBudget(rule, mode);
    return (
        <>
            <Panel label="Host a match" className="gfr-main">
                <Stepper
                    id="host-size"
                    group="main"
                    label="Size"
                    title="Size"
                    hint="Units on each side"
                    options={[
                        ["3x3", "3 x 3"],
                        ["4x4", "4 x 4"],
                    ]}
                    value={mode}
                    onChange={(v) => setMode(v as Mode)}
                />
                <Stepper
                    id="host-visibility"
                    group="main"
                    label="Who can join"
                    title="Who can join"
                    hint={
                        visibility === "invite"
                            ? "Only people with the code or link"
                            : "Also listed in Open games"
                    }
                    options={[
                        ["invite", "Invite only"],
                        ["open", "Open to anyone"],
                    ]}
                    value={visibility}
                    onChange={(v) => setVisibility(v as Visibility)}
                />
                <Stepper
                    id="host-rule"
                    group="main"
                    label="Squads"
                    title="Squads"
                    hint={
                        rule.kind === "any"
                            ? "No credit limit and every item available"
                            : "Both players build within the budget, with the gear of that rank"
                    }
                    options={[
                        ["any", "Any"],
                        ["budget", "Budgeted"],
                    ]}
                    value={rule.kind}
                    onChange={(v) => setRuleKind(v as Rule["kind"])}
                />
                {rule.kind === "budget" && (
                    <Stepper
                        id="host-budget"
                        group="main"
                        label="Budget"
                        title="Budget"
                        hint="The standard budget of a rank; it also sets the gear"
                        options={budgetOptions(mode)}
                        value={rule.tier}
                        onChange={setTier}
                    />
                )}
                {rule.kind === "any" && (
                    <Stepper
                        id="host-squad"
                        group="main"
                        label="Squad"
                        title="Squad"
                        hint={
                            hasSaved
                                ? "Bring your squad, or build one for this match"
                                : "Build a squad for this match"
                        }
                        options={squadOptions}
                        value={squadKind}
                        onChange={(v) => setSquadKind(v as SquadKind)}
                    />
                )}
                <ActionRow
                    id="host-create"
                    group="main"
                    label="Open lobby"
                    title="Open lobby"
                    hint="You get a code to share"
                    instant
                    commands={[{ action: "confirm", label: "Open lobby", run: create }]}
                />
            </Panel>
            <Panel label="Rules" meta={ruleLabel(rule, mode)} className="gfr-side">
                <ReadoutLine label="Size">{`${squadSize(mode)} units each`}</ReadoutLine>
                <ReadoutLine label="Budget">
                    {budget === null ? "None" : `${budget} cr`}
                </ReadoutLine>
                <ReadoutLine label="Gear">
                    {ruleTierName(rule) ? `${ruleTierName(rule)} and below` : "Everything"}
                </ReadoutLine>
                {squadKind !== "build" && rule.kind === "any" && (
                    <>
                        <Eyebrow>Your squad</Eyebrow>
                        <SquadLines squad={squad} names={names} />
                    </>
                )}
                {(squadKind === "build" || rule.kind === "budget") && (
                    <p className="gui-note">You build the squad in the lobby.</p>
                )}
            </Panel>
        </>
    );
}

/** One line per unit: its preset and what it costs. */
function SquadLines({ squad, names }: { squad: Loadout[]; names: string[] }) {
    return (
        <>
            {squad.map((unit, i) => (
                <ReadoutLine key={i} label={names[i] ?? `Unit ${i + 1}`}>
                    {`${presetLabel(unit)} · ${priceOf(unit)} cr`}
                </ReadoutLine>
            ))}
        </>
    );
}

// === Lobby ==================================================================

/** The code as a large, copyable block: one press copies it. */
function CodeBlock({ code, copied, copy }: { code: string; copied: boolean; copy: () => void }) {
    const { props } = useFocusable<HTMLButtonElement>({
        id: "code",
        group: "main",
        title: "Invite code",
        hint: "Read it out or copy it",
        instant: true,
        commands: [{ action: "confirm", label: copied ? "Copied" : "Copy code", run: copy }],
    });
    return (
        <button type="button" tabIndex={-1} className="gui-row gfr-code" {...props}>
            <span className="gfr-code-label">Invite code</span>
            <span className="gfr-code-text" aria-label={code.split("").join(" ")}>
                {formatCode(code)}
            </span>
            <span className="gfr-code-state" data-on={copied || undefined}>
                {copied ? "Copied" : "Copy"}
            </span>
        </button>
    );
}

function LobbyView({
    session,
    now,
    copy,
    copied,
    skip,
    start,
    end,
    onSquad,
}: {
    session: Session;
    now: number;
    copy: (what: string, text: string) => void;
    copied: string | null;
    skip: () => void;
    start: () => void;
    end: () => void;
    onSquad: (squad: Loadout[], issues: Issue[]) => void;
}) {
    const { lobby } = session;
    const phase = phaseOf(session, now);
    const host = session.role === "host";
    const link = shareLink(lobby.code, window.location.origin);
    const opponent = host ? session.opponent : lobby.host;
    const tier = tierOf(opponent.rating).name;
    const them = opponentState(session, now);
    const block = startBlock(session, now);
    const budget = ruleBudget(lobby.rule, lobby.mode);

    if (phase === "cancelled") {
        return (
            <Panel className="gfr-main">
                <EmptyState
                    id="cancelled"
                    group="main"
                    headline="MATCH CANCELLED"
                    action="Open games"
                    commands={[{ action: "confirm", label: "Open games", run: end }]}
                >
                    {lobby.host.name} closed the lobby before it started.
                </EmptyState>
            </Panel>
        );
    }

    return (
        <>
            <Panel
                label={host ? "Your lobby" : "Joined"}
                meta={`${lobby.mode} · ${lobby.visibility === "open" ? "Open" : "Invite only"}`}
                className="gfr-main"
            >
                <CodeBlock
                    code={lobby.code}
                    copied={copied === "code"}
                    copy={() => copy("code", formatCode(lobby.code))}
                />
                <ListRow
                    id="link"
                    group="main"
                    name="Share link"
                    kind={link.replace(/^https?:\/\//, "")}
                    tag={copied === "link" ? "Copied" : "Copy"}
                    tagTone={copied === "link" ? "accent" : "default"}
                    title="Share link"
                    hint="Opens the join screen with the code filled in"
                    instant
                    commands={[
                        { action: "confirm", label: "Copy link", run: () => copy("link", link) },
                    ]}
                />
                <Eyebrow>In the lobby</Eyebrow>
                <ReadoutLine label="Squads">{ruleLabel(lobby.rule, lobby.mode)}</ReadoutLine>
                <ReadoutLine label="You">
                    {`${host ? "Host" : "Guest"} · ${session.ready ? "Ready" : "Building"}`}
                </ReadoutLine>
                <ReadoutLine label={host ? "Opponent" : "Host"} empty={host && them === "absent"}>
                    {host
                        ? them === "absent"
                            ? "Waiting for someone to join"
                            : `${session.opponent.name} · ${tier} · ${them === "ready" ? "Ready" : "Building"}`
                        : `${lobby.host.name} · ${tier} · Ready`}
                </ReadoutLine>
                {!host && (
                    <ReadoutLine label="Status" empty>
                        {session.ready
                            ? "Waiting for the host to start"
                            : (session.issue ?? "Build your squad")}
                    </ReadoutLine>
                )}
                {host && (
                    <ActionRow
                        id="start"
                        group="main"
                        label="Start match"
                        title="Start match"
                        hint="Both squads deploy"
                        commands={[
                            {
                                action: "confirm",
                                label: "Start",
                                tone: "primary",
                                deny: block ?? undefined,
                                run: start,
                            },
                        ]}
                    />
                )}
                {QA_SKIP && host && phase === "waiting" && (
                    <ActionRow
                        id="arrive"
                        group="main"
                        label="Bring in the opponent"
                        title="Bring in the opponent"
                        hint="Skips the wait"
                        instant
                        commands={[{ action: "confirm", label: "Bring in", run: skip }]}
                    />
                )}
                <ActionRow
                    id="cancel"
                    group="main"
                    label={host ? "Cancel match" : "Leave lobby"}
                    tone="danger"
                    title={host ? "Cancel match" : "Leave lobby"}
                    hint={host ? "Closes the lobby and its code" : "Back to open games"}
                    commands={[
                        {
                            action: "confirm",
                            label: host ? "Cancel match" : "Leave",
                            tone: "danger",
                            run: end,
                        },
                    ]}
                />
            </Panel>
            <Panel
                label="Your squad"
                meta={
                    budget === null
                        ? `${squadPrice(session.squad)} cr`
                        : `${squadPrice(session.squad)} / ${budget} cr`
                }
                className="gfr-side"
            >
                <SquadLines squad={session.squad} names={session.names} />
                {session.builds && (
                    <SquadBuilder
                        mode={lobby.mode}
                        budget={budget}
                        rating={ruleRating(lobby.rule)}
                        storageKey={BUILDER_KEY}
                        onChange={onSquad}
                    />
                )}
            </Panel>
        </>
    );
}

// === Join ===================================================================

function CodePrompt({
    value,
    onChange,
    refusal,
    onSubmit,
    onClose,
    glyphs,
}: {
    value: string;
    onChange: (v: string) => void;
    refusal?: string;
    onSubmit: () => void;
    onClose: () => void;
    glyphs: ReturnType<typeof useGlyphSet>;
}) {
    const problem = typingProblem(value);
    const deny = value.trim() === "" ? "Enter the code" : (problem ?? undefined);
    return (
        <Prompt
            id="prompt-code"
            eyebrow="Invite code"
            title="Join with a code?"
            hint={refusal ?? problem ?? undefined}
            lines={refusal ? [["Refused", <span className="gfr-warn">{refusal}</span>]] : undefined}
            confirm={{ label: "Join", deny, run: onSubmit }}
            cancel={{ label: "Cancel", run: onClose }}
            glyphs={glyphs}
        >
            Eight characters, with or without the dash. A pasted link works too.
            <TextField
                label="Code"
                value={value}
                maxLength={120}
                onChange={onChange}
                onSubmit={() => !deny && onSubmit()}
            />
        </Prompt>
    );
}

function JoinView({
    candidate,
    enter,
    otherCode,
    hasSaved,
    squadKind,
    setSquadKind,
    typing,
    refusal,
    openPrompt,
    paste,
    pick,
}: {
    candidate: Lobby | null;
    enter: (lobby: Lobby) => void;
    otherCode: () => void;
    hasSaved: boolean;
    squadKind: SquadKind;
    setSquadKind: (k: SquadKind) => void;
    typing: string;
    refusal: Refusal;
    openPrompt: () => void;
    paste: () => void;
    pick: (code: string) => void;
}) {
    const recent = useMemo(() => recentCodes(kv()), []);
    if (candidate) {
        const { rule, mode, host } = candidate;
        const budget = ruleBudget(rule, mode);
        return (
            <Panel label="Match found" meta={formatCode(candidate.code)} className="gfr-main">
                <ReadoutLine label="Host">{`${host.name} · ${tierOf(host.rating).name}`}</ReadoutLine>
                <ReadoutLine label="Size">{mode}</ReadoutLine>
                <ReadoutLine label="Squads">{ruleLabel(rule, mode)}</ReadoutLine>
                <ReadoutLine label="Gear">
                    {ruleTierName(rule) ? `${ruleTierName(rule)} and below` : "Everything"}
                </ReadoutLine>
                {rule.kind === "any" && hasSaved && (
                    <Stepper
                        id="join-squad"
                        group="main"
                        label="Squad"
                        title="Squad"
                        hint="Bring your squad, or build one for this match"
                        options={[
                            ["saved", "Your squad"],
                            ["build", "Build one"],
                        ]}
                        value={squadKind}
                        onChange={(v) => setSquadKind(v as SquadKind)}
                    />
                )}
                <ActionRow
                    id="join-enter"
                    group="main"
                    label="Join"
                    title="Join"
                    hint={
                        budget === null
                            ? "Bring any squad"
                            : `Build a squad of up to ${budget} credits`
                    }
                    instant
                    commands={[
                        {
                            action: "confirm",
                            label: "Join",
                            tone: "primary",
                            run: () => enter(candidate),
                        },
                    ]}
                />
                <ActionRow
                    id="join-other"
                    group="main"
                    label="Use another code"
                    title="Use another code"
                    hint="Back to the code field"
                    instant
                    commands={[{ action: "confirm", label: "Another code", run: otherCode }]}
                />
            </Panel>
        );
    }
    return (
        <Panel label="Join with a code" className="gfr-main">
            <ReadoutLine label="Code" empty={!typing}>
                {typing ? formatCode(typing) || typing : "None entered"}
            </ReadoutLine>
            {refusal && (
                <ReadoutLine label="Refused">
                    <span className="gfr-warn">{refusal.message}</span>
                </ReadoutLine>
            )}
            <ActionRow
                id="join-type"
                group="main"
                label="Enter a code"
                title="Enter a code"
                hint="Type it or paste it into the field"
                instant
                commands={[{ action: "confirm", label: "Enter code", run: openPrompt }]}
            />
            <ActionRow
                id="join-paste"
                group="main"
                label="Paste from clipboard"
                title="Paste a code"
                hint="Reads the code or link you copied"
                instant
                commands={[{ action: "confirm", label: "Paste", run: paste }]}
            />
            {recent.length > 0 && <Eyebrow>Recent</Eyebrow>}
            {recent.map((code) => (
                <ListRow
                    key={code}
                    id={`recent-${code}`}
                    group="main"
                    name={formatCode(code)}
                    kind="Joined before"
                    title={formatCode(code)}
                    hint="Join this code again"
                    instant
                    commands={[{ action: "confirm", label: "Join", run: () => pick(code) }]}
                />
            ))}
        </Panel>
    );
}

// === Open games =============================================================

function OpenGames({
    now,
    join,
    host,
    refusal,
}: {
    now: number;
    join: (lobby: Lobby) => void;
    host: () => void;
    refusal: Refusal;
}) {
    const [size, setSize] = useState<"any" | Mode>("any");
    const [ruleFilter, setRuleFilter] = useState<RuleFilter>("all");
    const games = openGames(now, size, undefined, ruleFilter);
    // The cursor starts on the first game, not on the size filter above it.
    const store = useFocusStore();
    useLayoutEffect(() => {
        const first = openGames(Date.now())[0];
        if (first) store.focus(`open-${first.id}`, false);
        // Once, on arrival.
    }, [store]);
    return (
        <Panel
            label="Open games"
            meta={games.length > 0 ? String(games.length) : undefined}
            className="gfr-main gfr-open"
        >
            <Stepper
                id="open-size"
                group="main"
                label="Size"
                title="Size"
                hint="Show one size only"
                options={[
                    ["any", "Any"],
                    ["3x3", "3 x 3"],
                    ["4x4", "4 x 4"],
                ]}
                value={size}
                onChange={(v) => setSize(v as "any" | Mode)}
            />
            <Stepper
                id="open-rule"
                group="main"
                label="Squads"
                title="Squads"
                hint="Show one rule only"
                options={[
                    ["all", "All"],
                    ["any", "Any squad"],
                    ["budget", "Budgeted"],
                ]}
                value={ruleFilter}
                onChange={(v) => setRuleFilter(v as RuleFilter)}
            />
            {refusal && (
                <ReadoutLine label="Refused">
                    <span className="gfr-warn">{refusal.message}</span>
                </ReadoutLine>
            )}
            {games.length === 0 ? (
                <EmptyState
                    id="open-empty"
                    group="main"
                    headline="NO OPEN GAMES"
                    action="Host a match"
                    commands={[{ action: "confirm", label: "Host a match", run: host }]}
                >
                    Nobody is waiting right now. Host one and others can join it.
                </EmptyState>
            ) : (
                <List label="Open games">
                    {games.map((lobby) => (
                        <ListRow
                            key={lobby.id}
                            id={`open-${lobby.id}`}
                            group="main"
                            name={lobby.host.name}
                            kind={`${lobby.mode} · ${ruleLabel(lobby.rule, lobby.mode)}`}
                            tag={ageLabel(now - lobby.openedAt)}
                            title={lobby.host.name}
                            hint={`${tierOf(lobby.host.rating).name}, ${ruleLabel(lobby.rule, lobby.mode)}, open ${ageLabel(now - lobby.openedAt)}`}
                            instant
                            commands={[
                                { action: "confirm", label: "Join", run: () => join(lobby) },
                            ]}
                        />
                    ))}
                </List>
            )}
        </Panel>
    );
}
