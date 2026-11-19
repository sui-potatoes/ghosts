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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    useGlyphSet,
    type Command,
} from "../../../ui";
import { presetsFor, squadSize, tierOf, type Mode } from "../economy";
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
    phaseOf,
    readSession,
    recentCodes,
    type Lobby,
    type Session,
    type Visibility,
} from "./lobbies";
import {
    ageLabel,
    bringSquad,
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
    const [squadKind, setSquadKind] = useState<SquadKind>("saved");
    const [refusal, setRefusal] = useState<Refusal>(null);
    const [typing, setTyping] = useState("");
    const [prompt, setPrompt] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const saved = useMemo(savedSquad, []);
    const copyTimer = useRef(0);
    const now = useNow(view === "lobby" ? 500 : view === "open" ? 2000 : null);

    useEffect(() => () => window.clearTimeout(copyTimer.current), []);

    const goView = (next: View) => {
        setRefusal(null);
        setPrompt(false);
        setView(next);
    };

    const leaveScreen = () => navigate("/play", { replace: true });

    /** Try a code the player typed, pasted or followed; true when it led into a lobby. */
    const attempt = useCallback(
        (input: string): boolean => {
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
            const bring = bringSquad(squadKind, saved, found.lobby.mode, rating);
            setSession(joinLobby(kv(), found.lobby, bring, t));
            setView("lobby");
            return true;
        },
        [rating, saved, squadKind],
    );

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

    const back: Command =
        view === "landing"
            ? { action: "back", label: "Play", run: leaveScreen }
            : view === "lobby"
              ? {
                    action: "back",
                    label: session?.role === "host" ? "Cancel match" : "Leave",
                    run: endLobby,
                }
              : { action: "back", label: "Friendly", run: () => goView("landing") };

    const bring = bringSquad(squadKind, saved, mode, rating);

    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Friendly", ...(view === "landing" ? [] : [TITLES[view]])]}
                onLocation={back.run}
                status={
                    <>
                        <StatusChip label="Preview" value="This device" state="idle" />
                        {copied && <StatusChip label="Clipboard" value="Copied" />}
                        {phase === "starting" && (
                            <StatusChip label="Match" value="Starting" state="live" />
                        )}
                    </>
                }
                columns={COLUMNS}
                commands={<FocusCommandBar glyphs={glyphs} />}
                overlay={
                    prompt && view === "join" ? (
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
                        squadKind={bring.kind}
                        setSquadKind={setSquadKind}
                        hasSaved={saved !== null && saved.length > 0}
                        names={bring.names}
                        loadouts={bring.squad.map((l) => l.preset)}
                        rating={rating}
                        create={() => {
                            setSession(
                                hostLobby(
                                    kv(),
                                    {
                                        mode,
                                        visibility,
                                        squad: bring.squad,
                                        names: bring.names,
                                        you: { name: "You", rating },
                                    },
                                    Date.now(),
                                ),
                            );
                            started.current = false;
                            setView("lobby");
                        }}
                    />
                )}
                {view === "join" && (
                    <JoinView
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
                            started.current = false;
                            const b = bringSquad(squadKind, saved, lobby.mode, rating);
                            setSession(joinLobby(kv(), found.lobby, b, Date.now()));
                            setRefusal(null);
                            setView("lobby");
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
                        start={() => startMatch(session)}
                        end={endLobby}
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
    squadKind,
    setSquadKind,
    hasSaved,
    names,
    loadouts,
    rating,
    create,
}: {
    mode: Mode;
    setMode: (m: Mode) => void;
    visibility: Visibility;
    setVisibility: (v: Visibility) => void;
    squadKind: SquadKind;
    setSquadKind: (k: SquadKind) => void;
    hasSaved: boolean;
    names: string[];
    loadouts: string[];
    rating: number;
    create: () => void;
}) {
    const presets = presetsFor(rating);
    const squadOptions: [string, string][] = hasSaved
        ? [
              ["saved", "Your squad"],
              ["default", "Default squad"],
          ]
        : [["default", "Default squad"]];
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
                    id="host-squad"
                    group="main"
                    label="Squad"
                    title="Squad"
                    hint={
                        hasSaved
                            ? "The squad saved on this device, or a default one"
                            : "Nothing saved on this device: a default squad is used"
                    }
                    options={squadOptions}
                    value={squadKind}
                    onChange={(v) => setSquadKind(v as SquadKind)}
                />
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
            <Panel label="Squad" meta={`${squadSize(mode)} units`} className="gfr-side">
                {names.map((name, i) => (
                    <ReadoutLine key={i} label={name}>
                        {presets.find((p) => p.id === loadouts[i])?.name ?? loadouts[i]}
                    </ReadoutLine>
                ))}
                {!hasSaved && (
                    <p className="gui-note">
                        Nothing saved on this device, so a default squad plays.
                    </p>
                )}
            </Panel>
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
}: {
    session: Session;
    now: number;
    copy: (what: string, text: string) => void;
    copied: string | null;
    skip: () => void;
    start: () => void;
    end: () => void;
}) {
    const { lobby } = session;
    const { rating } = useRating();
    const phase = phaseOf(session, now);
    const host = session.role === "host";
    const link = shareLink(lobby.code, window.location.origin);
    const opponent = host ? session.opponent : lobby.host;
    const tier = tierOf(opponent.rating).name;

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
                <ReadoutLine label={host ? "You" : "Host"}>
                    {host ? "You, host" : lobby.host.name}
                </ReadoutLine>
                <ReadoutLine label={host ? "Opponent" : "You"} empty={host && phase === "waiting"}>
                    {host
                        ? phase === "waiting"
                            ? "Waiting for someone to join"
                            : `${session.opponent.name} · ${tier}`
                        : "You, guest"}
                </ReadoutLine>
                {!host && (
                    <ReadoutLine label="Status" empty>
                        Waiting for the host to start
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
                                deny: phase === "ready" ? undefined : "Waiting for an opponent",
                                run: start,
                            },
                        ]}
                    />
                )}
                {host && phase === "waiting" && (
                    <ActionRow
                        id="arrive"
                        group="main"
                        label="Preview: an opponent arrives now"
                        title="Preview only"
                        hint="Skips the wait; a simulated opponent joins the lobby"
                        instant
                        commands={[{ action: "confirm", label: "Bring in opponent", run: skip }]}
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
            <Panel label="Squad" meta={`${session.squad.length} units`} className="gfr-side">
                {session.names.map((name, i) => (
                    <ReadoutLine key={i} label={name}>
                        {presetName(session.squad[i]?.preset, rating)}
                    </ReadoutLine>
                ))}
            </Panel>
        </>
    );
}

function presetName(id: string | undefined, rating: number): string {
    if (!id) return "";
    return presetsFor(rating).find((p) => p.id === id)?.name ?? id;
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
    typing,
    refusal,
    openPrompt,
    paste,
    pick,
}: {
    typing: string;
    refusal: Refusal;
    openPrompt: () => void;
    paste: () => void;
    pick: (code: string) => void;
}) {
    const recent = useMemo(() => recentCodes(kv()), []);
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
    const games = openGames(now, size);
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
                            kind={`${lobby.mode} · ${tierOf(lobby.host.rating).name}`}
                            tag={ageLabel(now - lobby.openedAt)}
                            title={lobby.host.name}
                            hint={`${lobby.mode}, open ${ageLabel(now - lobby.openedAt)}`}
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
