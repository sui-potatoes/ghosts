// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly gamees in the shared interface language: a landing with three ways
 * in (host, join with a code, open games), the host's setup, the lobby (as host
 * or guest) and the list of open games. It draws what it is given: the live
 * screen (`index.tsx`) feeds it from the chain, the QA harness (`qa.tsx`) from
 * fixtures. Once a game starts, the shell's matchmaking driver takes both
 * players to `/match`: the squad pick, the field and the result of a rated game.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
    DOING,
    formatCode,
    joinBlock,
    LOBBY_LIFETIME_MS as LIFETIME_MS,
    personLine,
    shareLink,
    sizeBlock,
    sizeLabel,
    SIZES,
    startBlock,
    timeLeft,
    typingProblem,
    writeBlock,
    type Gate,
    type LobbyState,
    type OpenGame,
    type Pending,
} from "./model";
import "./friendly.css";

type View = "landing" | "host" | "open";

export type FriendlyData = {
    /** Why the player cannot open or join a game now; null when they can. */
    gate: Gate | null;
    /** Spawn positions a side has on the level: the largest size it holds; null until read. */
    presetSide: number | null;
    /** The lobby the player hosts or waits in. */
    lobby: LobbyState | null;
    /** The listed games; null while the first read is on its way. */
    games: OpenGame[] | null;
    /** A write is in flight. */
    busy: boolean;
    /** What the player pressed to send it; null while nothing is. */
    pending: Pending | null;
    /** The last refusal or failure, in plain words. */
    error: string | null;
    /** What happened to a game the player was in (removed, closed, expired). */
    notice: string | null;
    /** A code to fill the join field with (a followed link), once. */
    linkCode: string | null;
};

export type FriendlyOps = {
    host: (size: number, listed: boolean) => void;
    joinCode: (text: string) => void;
    joinOpen: (hostId: string) => void;
    leave: () => void;
    kick: () => void;
    start: () => void;
    close: () => void;
    /** The gate's own action: sign in, resume, the queue, Headquarters. */
    gateAction: () => void;
    leaveScreen: () => void;
    clearError: () => void;
    clearNotice: () => void;
    /** The open list is on screen: read it, and keep it fresh. */
    watchOpen: (on: boolean) => void;
    /** A player's assigned name by address; a hook, called once per row. */
    useName: (owner: string | null) => string | null;
};

const COLUMNS = "minmax(0, 520px) minmax(0, 420px) minmax(0, 1fr)";
const TITLES: Record<View, string> = { landing: "Friendly", host: "Host", open: "Open matches" };

/** The clock, ticking once a second while `on`. */
function useNow(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setNow(Date.now());
        if (!on) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [on]);
    return now;
}

export function FriendlyView({ data, ops }: { data: FriendlyData; ops: FriendlyOps }) {
    const glyphs = useGlyphSet();
    const [view, setView] = useState<View>("landing");
    const [size, setSize] = useState(3);
    const [listed, setListed] = useState(true);
    const [prompt, setPrompt] = useState(false);
    const [typing, setTyping] = useState("");
    const [copied, setCopied] = useState<string | null>(null);
    const copyTimer = useRef(0);
    const now = useNow(true);
    const { lobby, gate, error } = data;

    useEffect(() => () => window.clearTimeout(copyTimer.current), []);

    // A followed link opens the code field, filled in.
    const linked = useRef(false);
    useEffect(() => {
        if (linked.current || data.linkCode === null) return;
        linked.current = true;
        setTyping(data.linkCode);
        // After the screen's first layout, so the prompt opens over a placed frame.
        window.setTimeout(() => setPrompt(true), 0);
    }, [data.linkCode]);

    // Removed from a game, or it closed: the open list, with what happened.
    useEffect(() => {
        if (data.notice) setView("open");
    }, [data.notice]);

    const onList = !lobby && (view === "open" || view === "landing");
    useEffect(() => {
        ops.watchOpen(onList);
        // `ops` is new each render; only the visibility matters.
    }, [onList]);

    const goView = (next: View) => {
        ops.clearError();
        ops.clearNotice();
        setPrompt(false);
        setView(next);
    };

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

    const back: Command = lobby
        ? { action: "back", label: "Play", run: ops.leaveScreen }
        : view === "landing"
          ? { action: "back", label: "Play", run: ops.leaveScreen }
          : { action: "back", label: "Friendly", run: () => goView("landing") };

    const title = lobby ? (lobby.kind === "host" ? "Your match" : "Joined") : TITLES[view];

    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Friendly", ...(lobby || view !== "landing" ? [title] : [])]}
                onLocation={back.run}
                status={
                    <>
                        {copied && <StatusChip label="Clipboard" value="Copied" />}
                        {data.pending && (
                            <StatusChip
                                label="Match"
                                value={DOING[data.pending.what]}
                                state="busy"
                            />
                        )}
                        {lobby && (
                            <StatusChip
                                label="Time left"
                                value={
                                    lobby.sinceMs === null
                                        ? "Reading"
                                        : now - lobby.sinceMs > LIFETIME_MS
                                          ? "Expired"
                                          : timeLeft(lobby.sinceMs, now)
                                }
                                state="live"
                            />
                        )}
                    </>
                }
                columns={COLUMNS}
                commands={<FocusCommandBar glyphs={glyphs} />}
                overlay={
                    prompt && !lobby ? (
                        <CodePrompt
                            value={typing}
                            onChange={(v) => {
                                setTyping(v);
                                ops.clearError();
                            }}
                            refusal={error}
                            busy={data.busy}
                            gate={gate}
                            onSubmit={() => ops.joinCode(typing)}
                            onClose={() => {
                                setPrompt(false);
                                ops.clearError();
                            }}
                            glyphs={glyphs}
                        />
                    ) : undefined
                }
            >
                {lobby ? (
                    <LobbyPanel
                        lobby={lobby}
                        now={now}
                        busy={data.busy}
                        pending={data.pending}
                        error={error}
                        copy={copy}
                        copied={copied}
                        ops={ops}
                    />
                ) : view === "landing" ? (
                    <Landing
                        gate={gate}
                        count={data.games?.filter((g) => !g.full).length ?? null}
                        error={prompt ? null : error}
                        go={goView}
                        gateAction={ops.gateAction}
                        openPrompt={() => {
                            ops.clearError();
                            setTyping("");
                            setPrompt(true);
                        }}
                    />
                ) : view === "host" ? (
                    <HostSetup
                        gate={gate}
                        presetSide={data.presetSide}
                        size={size}
                        setSize={setSize}
                        listed={listed}
                        setListed={setListed}
                        busy={data.busy}
                        pending={data.pending}
                        error={error}
                        open={() => ops.host(size, listed)}
                    />
                ) : (
                    <OpenGames
                        games={data.games}
                        now={now}
                        gate={gate}
                        presetSide={data.presetSide}
                        busy={data.busy}
                        pending={data.pending}
                        line={data.notice ?? error}
                        join={ops.joinOpen}
                        host={() => goView("host")}
                        useName={ops.useName}
                    />
                )}
            </ScreenFrame>
        </FocusRoot>
    );
}

// === Landing ================================================================

function Landing({
    gate,
    count,
    error,
    go,
    gateAction,
    openPrompt,
}: {
    gate: Gate | null;
    count: number | null;
    error: string | null;
    go: (view: View) => void;
    gateAction: () => void;
    openPrompt: () => void;
}) {
    return (
        <Panel label="Friendly match" className="gfr-main">
            <List label="Ways in">
                {gate?.action && (
                    <ListRow
                        id="gate"
                        group="main"
                        name={gate.action.label}
                        kind={gate.reason}
                        title={gate.action.label}
                        hint={gate.reason}
                        instant
                        commands={[
                            {
                                action: "confirm",
                                label: gate.action.label,
                                tone: "primary",
                                run: gateAction,
                            },
                        ]}
                    />
                )}
                <ListRow
                    id="host"
                    group="main"
                    name="Host a match"
                    kind="Open to anyone, or invite only"
                    title="Host a match"
                    hint={gate?.reason ?? "Open a match with your recruits"}
                    instant
                    commands={[
                        {
                            action: "confirm",
                            label: "Host",
                            deny: gate?.reason,
                            run: () => go("host"),
                        },
                    ]}
                />
                <ListRow
                    id="join"
                    group="main"
                    name="Join with a code"
                    kind="Type, paste or follow a link"
                    title="Join with a code"
                    hint={gate?.reason ?? "Enter the code a friend sent you"}
                    instant
                    commands={[
                        { action: "confirm", label: "Join", deny: gate?.reason, run: openPrompt },
                    ]}
                />
                <ListRow
                    id="open"
                    group="main"
                    name="Open matches"
                    kind="Matches anyone can join"
                    tag={count === null ? undefined : String(count)}
                    tagTone={count ? "accent" : "dim"}
                    title="Open matches"
                    hint={
                        count === null
                            ? "Matches anyone can join"
                            : count > 0
                              ? `${count} waiting for an opponent`
                              : "Nobody is waiting now"
                    }
                    instant
                    commands={[{ action: "confirm", label: "Browse", run: () => go("open") }]}
                />
            </List>
            {error && (
                <ReadoutLine label="Refused">
                    <span className="gfr-warn">{error}</span>
                </ReadoutLine>
            )}
        </Panel>
    );
}

// === Host ===================================================================

function HostSetup({
    gate,
    presetSide,
    size,
    setSize,
    listed,
    setListed,
    busy,
    pending,
    error,
    open,
}: {
    gate: Gate | null;
    presetSide: number | null;
    size: number;
    setSize: (n: number) => void;
    listed: boolean;
    setListed: (v: boolean) => void;
    busy: boolean;
    pending: Pending | null;
    error: string | null;
    open: () => void;
}) {
    const blocked = sizeBlock(size, presetSide);
    // The cursor starts on the size the game has.
    const store = useFocusStore();
    useLayoutEffect(() => {
        store.focus(`host-size-${size}`, false);
        // Once, on arrival.
    }, [store]);
    return (
        <>
            <Panel label="Host a match" className="gfr-main">
                <Eyebrow>Size</Eyebrow>
                {SIZES.map((n) => {
                    const block = sizeBlock(n, presetSide);
                    return (
                        <ListRow
                            key={n}
                            id={`host-size-${n}`}
                            group="main"
                            name={sizeLabel(n)}
                            kind={`Up to ${n} recruits each`}
                            selected={size === n}
                            tag={size === n ? "Chosen" : (block ?? undefined)}
                            tagTone={size === n ? "accent" : "dim"}
                            title={sizeLabel(n)}
                            hint={block ?? `Up to ${n} of your recruits on each side`}
                            instant
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Choose",
                                    deny:
                                        block ?? (pending || busy ? "Saving a change" : undefined),
                                    run: () => setSize(n),
                                },
                            ]}
                        />
                    );
                })}
                <Stepper
                    id="host-kind"
                    group="main"
                    label="Open to"
                    title="Open to"
                    hint={
                        listed
                            ? "Listed in Open matches for anyone to join"
                            : "Only someone with the code or the link"
                    }
                    options={[
                        ["open", "Anyone"],
                        ["invite", "Invite only"],
                    ]}
                    value={listed ? "open" : "invite"}
                    onChange={(v) => setListed(v === "open")}
                />
                <ActionRow
                    id="host-create"
                    group="main"
                    label={pending?.what === "host" ? DOING.host : "Open match"}
                    title="Open match"
                    hint={listed ? "Anyone can take the other side" : "You get a code to share"}
                    instant
                    commands={[
                        {
                            action: "confirm",
                            label: "Open match",
                            tone: "primary",
                            deny: gate?.reason ?? blocked ?? writeBlock(pending, busy, "host"),
                            run: open,
                        },
                    ]}
                />
                {error && (
                    <ReadoutLine label="Refused">
                        <span className="gfr-warn">{error}</span>
                    </ReadoutLine>
                )}
            </Panel>
            <Panel label="Rules" className="gfr-side">
                <ReadoutLine label="Squad">{`1 to ${size} of your recruits`}</ReadoutLine>
                <ReadoutLine label="Rating">Unchanged</ReadoutLine>
                <ReadoutLine label="Fallen">Come home</ReadoutLine>
                <ReadoutLine label="Open for">10 min</ReadoutLine>
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

function LobbyPanel({
    lobby,
    now,
    busy,
    pending,
    error,
    copy,
    copied,
    ops,
}: {
    lobby: LobbyState;
    now: number;
    busy: boolean;
    pending: Pending | null;
    error: string | null;
    copy: (what: string, text: string) => void;
    copied: string | null;
    ops: FriendlyOps;
}) {
    const expired = lobby.sinceMs !== null && now - lobby.sinceMs > LIFETIME_MS;
    /** A button's own progress label, or its usual one. */
    const labelOf = (what: Pending["what"], usual: string) =>
        pending?.what === what ? DOING[what] : usual;

    if (lobby.kind === "guest") {
        return (
            <Panel label="Joined" meta={sizeLabel(lobby.size)} className="gfr-main">
                <ReadoutLine label="Host">{personLine(lobby.host)}</ReadoutLine>
                <ReadoutLine label="Size">{`Up to ${lobby.size} recruits each`}</ReadoutLine>
                <ReadoutLine label="Status" empty>
                    {expired ? "This match has expired" : "Waiting for the host to start"}
                </ReadoutLine>
                {error && (
                    <ReadoutLine label="Refused">
                        <span className="gfr-warn">{error}</span>
                    </ReadoutLine>
                )}
                <ActionRow
                    id="leave"
                    group="main"
                    label={labelOf("leave", "Leave match")}
                    tone="danger"
                    title="Leave match"
                    hint="Back to the open matches"
                    commands={[
                        {
                            action: "confirm",
                            label: "Leave",
                            tone: "danger",
                            deny: writeBlock(pending, busy, "leave"),
                            run: ops.leave,
                        },
                    ]}
                />
            </Panel>
        );
    }

    const block = startBlock(lobby, now, LIFETIME_MS);
    const link = lobby.code ? shareLink(lobby.code, window.location.origin) : null;
    return (
        <>
            <Panel
                label="Your match"
                meta={`${sizeLabel(lobby.size)} · ${lobby.listed ? "Open match" : "Invite only"}`}
                className="gfr-main"
            >
                {!lobby.listed &&
                    (lobby.code && link ? (
                        <>
                            <CodeBlock
                                code={lobby.code}
                                copied={copied === "code"}
                                copy={() => copy("code", formatCode(lobby.code!))}
                            />
                            <ListRow
                                id="link"
                                group="main"
                                name="Share link"
                                kind={link.replace(/^https?:\/\//, "")}
                                tag={copied === "link" ? "Copied" : "Copy"}
                                tagTone={copied === "link" ? "accent" : "default"}
                                title="Share link"
                                hint="Opens the join field with the code filled in"
                                instant
                                commands={[
                                    {
                                        action: "confirm",
                                        label: "Copy link",
                                        run: () => copy("link", link),
                                    },
                                ]}
                            />
                        </>
                    ) : (
                        <ReadoutLine label="Code" empty>
                            On the device that opened this match
                        </ReadoutLine>
                    ))}
                <Eyebrow>In the match</Eyebrow>
                {lobby.listed ? (
                    <ReadoutLine label="Guest" empty={!lobby.guest}>
                        {lobby.guest ? personLine(lobby.guest) : "Waiting for someone to join"}
                    </ReadoutLine>
                ) : (
                    <ReadoutLine label="Status" empty>
                        {expired ? "This match has expired" : "Starts when your friend joins"}
                    </ReadoutLine>
                )}
                {error && (
                    <ReadoutLine label="Refused">
                        <span className="gfr-warn">{error}</span>
                    </ReadoutLine>
                )}
                {lobby.listed && (
                    <ActionRow
                        id="start"
                        group="main"
                        label={labelOf("start", "Start match")}
                        title="Start match"
                        hint={block ?? "Both sides pick their squads"}
                        commands={[
                            {
                                action: "confirm",
                                label: "Start",
                                tone: "primary",
                                deny: block ?? writeBlock(pending, busy, "start"),
                                run: ops.start,
                            },
                        ]}
                    />
                )}
                {lobby.listed && lobby.guest && (
                    <ActionRow
                        id="kick"
                        group="main"
                        label={labelOf("kick", "Remove guest")}
                        tone="danger"
                        title="Remove guest"
                        hint="They cannot join this match again"
                        commands={[
                            {
                                action: "confirm",
                                label: "Remove",
                                tone: "danger",
                                deny: writeBlock(pending, busy, "kick"),
                                run: ops.kick,
                            },
                        ]}
                    />
                )}
                <ActionRow
                    id="close"
                    group="main"
                    label={labelOf("close", "Close match")}
                    tone="danger"
                    title="Close match"
                    hint={lobby.listed ? "Takes it off the list" : "The code stops working"}
                    commands={[
                        {
                            action: "confirm",
                            label: "Close",
                            tone: "danger",
                            deny: writeBlock(pending, busy, "close"),
                            run: ops.close,
                        },
                    ]}
                />
            </Panel>
            <Panel label="Rules" className="gfr-side">
                <ReadoutLine label="Squad">{`1 to ${lobby.size} of your recruits`}</ReadoutLine>
                <ReadoutLine label="Rating">Unchanged</ReadoutLine>
                <ReadoutLine label="Fallen">Come home</ReadoutLine>
            </Panel>
        </>
    );
}

// === Join ===================================================================

function CodePrompt({
    value,
    onChange,
    refusal,
    busy,
    gate,
    onSubmit,
    onClose,
    glyphs,
}: {
    value: string;
    onChange: (v: string) => void;
    refusal: string | null;
    busy: boolean;
    gate: Gate | null;
    onSubmit: () => void;
    onClose: () => void;
    glyphs: ReturnType<typeof useGlyphSet>;
}) {
    const problem = typingProblem(value);
    const deny =
        gate?.reason ??
        (busy ? "Joining" : value.trim() === "" ? "Enter the code" : (problem ?? undefined));
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
            Thirteen characters, with or without the dashes. A pasted link works too. The match
            starts as you join
            <TextField
                label="Code"
                value={value}
                maxLength={160}
                onChange={onChange}
                onSubmit={() => !deny && onSubmit()}
            />
        </Prompt>
    );
}

// === Open games =============================================================

function OpenGames({
    games,
    now,
    gate,
    presetSide,
    busy,
    pending,
    line,
    join,
    host,
    useName,
}: {
    games: OpenGame[] | null;
    now: number;
    gate: Gate | null;
    presetSide: number | null;
    busy: boolean;
    pending: Pending | null;
    line: string | null;
    join: (hostId: string) => void;
    host: () => void;
    useName: (owner: string | null) => string | null;
}) {
    const [size, setSize] = useState<"any" | "3" | "4">("any");
    const live = (games ?? []).filter((g) => now - g.sinceMs <= LIFETIME_MS);
    const shown = live.filter((g) => size === "any" || String(g.size) === size);
    // The cursor starts on the first game, not on the size filter above it.
    const store = useFocusStore();
    const first = shown[0]?.hostId;
    const placed = useRef(false);
    useLayoutEffect(() => {
        if (placed.current || !first) return;
        placed.current = true;
        store.focus(`open-${first}`, false);
    }, [store, first]);
    return (
        <Panel
            label="Open matches"
            meta={games === null ? undefined : String(shown.length)}
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
                    ["3", sizeLabel(3)],
                    ["4", sizeLabel(4)],
                ]}
                value={size}
                onChange={(v) => setSize(v as "any" | "3" | "4")}
            />
            {line && (
                <ReadoutLine label="Match">
                    <span className="gfr-warn">{line}</span>
                </ReadoutLine>
            )}
            {games === null ? (
                <ReadoutLine label="Matches" empty>
                    Reading the list
                </ReadoutLine>
            ) : shown.length === 0 ? (
                <EmptyState
                    id="open-empty"
                    group="main"
                    headline="NO OPEN MATCHES"
                    action="Host a match"
                    commands={[
                        {
                            action: "confirm",
                            label: "Host a match",
                            deny: gate?.reason,
                            run: host,
                        },
                    ]}
                >
                    Nobody is waiting right now. Host one and others can join it
                </EmptyState>
            ) : (
                <List label="Open matches">
                    {shown.map((game) => (
                        <OpenRow
                            key={game.hostId}
                            game={game}
                            now={now}
                            deny={
                                joinBlock(game, gate, presetSide) ??
                                writeBlock(pending, busy, "join", game.hostId) ??
                                null
                            }
                            joining={pending?.what === "join" && pending.id === game.hostId}
                            join={join}
                            useName={useName}
                        />
                    ))}
                </List>
            )}
        </Panel>
    );
}

function OpenRow({
    game,
    now,
    deny,
    joining,
    join,
    useName,
}: {
    game: OpenGame;
    now: number;
    deny: string | null;
    /** Its join is on its way. */
    joining: boolean;
    join: (hostId: string) => void;
    useName: (owner: string | null) => string | null;
}) {
    const name = useName(game.owner) ?? "Unnamed";
    const left = timeLeft(game.sinceMs, now);
    return (
        <ListRow
            id={`open-${game.hostId}`}
            group="main"
            name={name}
            kind={`${sizeLabel(game.size)} · Rating ${game.rating}`}
            tag={
                joining
                    ? DOING.join
                    : game.removed
                      ? "Removed"
                      : game.full
                        ? "Full"
                        : `${left} left`
            }
            tagTone={joining ? "accent" : game.full || game.removed ? "dim" : "default"}
            title={name}
            hint={deny ?? `${sizeLabel(game.size)} · ${left} left · You wait for the host to start`}
            commands={[
                {
                    action: "confirm",
                    label: "Join",
                    tone: "primary",
                    deny: deny ?? undefined,
                    run: () => join(game.hostId),
                },
            ]}
        />
    );
}
