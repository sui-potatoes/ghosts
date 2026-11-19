// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The mock lobby store for friendly matches: fixture lobbies, the open-games
 * feed (deterministic from a seed and the clock), lobbies hosted in this browser
 * session, and the one session a player is in (host or guest). Nothing here is on
 * chain or on a network; state lives in sessionStorage through an injected store
 * so tests run without a browser. Tested in `tests/play-friendly.test.ts`.
 */

import type { Loadout, Mode } from "../economy/index.ts";
import { TIERS } from "../economy/index.ts";
import {
    ANY_RULE,
    codeFromId,
    hash32,
    parseCode,
    parseRule,
    rng,
    withCheck,
    type Rule,
} from "./model.ts";

export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Visibility = "invite" | "open";
export type Player = { name: string; rating: number };

export type Lobby = {
    id: string;
    /** Canonical code, 8 characters. */
    code: string;
    mode: Mode;
    visibility: Visibility;
    /** Which squads the lobby accepts; both players build under it. */
    rule: Rule;
    host: Player & { you: boolean };
    openedAt: number;
    source: "mine" | "fixture" | "feed";
    /** A fixture lobby that already has its guest. */
    full?: boolean;
    /** A fixture host who closes the lobby after a guest joins. */
    cancels?: boolean;
    /** Hosted by this player and closed (cancelled or played). */
    closed?: boolean;
};

export type Session = {
    role: "host" | "guest";
    lobby: Lobby;
    squad: Loadout[];
    names: string[];
    /** The squad is built in the builder (a budget, or an any-squad player who chose to). */
    builds: boolean;
    /** Your squad has no issues under the rule. */
    ready: boolean;
    /** The first thing wrong with it, while it is not ready. */
    issue: string | null;
    /** Host only: when the arrived opponent has a squad ready. */
    opponentReadyAt: number;
    /** When the next thing happens: the opponent arrives (host), the host starts or cancels (guest). */
    resolvesAt: number;
    resolution: "arrive" | "start" | "cancel";
    opponent: Player;
};

const HANDLES = [
    "kestrel-9",
    "dust-fox",
    "halcyon",
    "nine-lives",
    "rook",
    "vesper",
    "cinder",
    "bluebell",
    "static",
    "orrin",
    "tamsin",
    "greywater",
];

/** Who arrives in a host's lobby. */
const OPPONENTS = ["marlow", "ashgrove", "pike", "winterbourne", "quill", "sable"];

/** A guest who is not ready yet: the host has nothing to start. */
export const NEVER = Number.MAX_SAFE_INTEGER;

const KEY = "ghosts:play-friendly";
const SLOT = 20_000;
const MIN_LIFE = 30_000;
const MAX_LIFE = 180_000;
export const FEED_SEED = 7;

const rating = (h: number): number => 1100 + (h % 900);

/**
 * Fixture lobbies with fixed codes, for anyone trying the join flow: an
 * invite-only 3x3, an invite-only 4x4, a full one and one whose host cancels.
 */
export const FIXTURES: Lobby[] = [
    fixture("HARBER2", "kestrel-9", "3x3", {}),
    fixture("CABART4", "greywater", "4x4", { rule: { kind: "budget", tier: "operative" } }),
    fixture("PACKED7", "rook", "3x3", { full: true, rule: { kind: "budget", tier: "rookie" } }),
    fixture("DEPART3", "vesper", "3x3", {
        cancels: true,
        rule: { kind: "budget", tier: "contractor" },
    }),
];

function fixture(payload: string, host: string, mode: Mode, extra: Partial<Lobby>): Lobby {
    const code = withCheck(payload);
    return {
        id: `fixture-${payload}`,
        code,
        mode,
        visibility: "invite",
        rule: ANY_RULE,
        host: { name: host, rating: rating(hash32(host)), you: false },
        openedAt: 0,
        source: "fixture",
        ...extra,
    };
}

// === The open-games feed ====================================================

export type RuleFilter = "all" | "any" | "budget";
export type OpenGame = { lobby: Lobby; closesAt: number };

function feedEntry(n: number, seed: number): OpenGame | null {
    const h = hash32(`feed:${seed}:${n}`);
    if (h % 4 === 0) return null;
    const next = rng(h);
    const openedAt = n * SLOT + Math.floor(next() * SLOT);
    const closesAt = openedAt + MIN_LIFE + Math.floor(next() * (MAX_LIFE - MIN_LIFE));
    const host = HANDLES[hash32(`host:${seed}:${n}`) % HANDLES.length];
    const id = `feed-${seed}-${n}`;
    return {
        closesAt,
        lobby: {
            id,
            code: codeFromId(id),
            mode: next() < 0.5 ? "3x3" : "4x4",
            visibility: "open",
            host: { name: host, rating: 1000 + Math.floor(next() * 1000), you: false },
            openedAt,
            source: "feed",
            // A few hosts close the lobby on the first guest, so cancelling is reachable.
            cancels: next() < 0.15,
            // Drawn last so the fields above stay as they were: a third play any squad.
            rule: feedRule(next()),
        },
    };
}

function feedRule(draw: number): Rule {
    if (draw < 0.3) return ANY_RULE;
    const tier = TIERS[Math.min(TIERS.length - 1, Math.floor(((draw - 0.3) / 0.7) * TIERS.length))];
    return { kind: "budget", tier: tier.id };
}

const LOOKBACK = Math.ceil(MAX_LIFE / SLOT) + 2;

function feedWindow(now: number, seed: number): OpenGame[] {
    const at = Math.floor(now / SLOT);
    const out: OpenGame[] = [];
    for (let n = at - LOOKBACK; n <= at; n++) {
        const entry = feedEntry(n, seed);
        if (entry) out.push(entry);
    }
    return out;
}

/** The public games open at `now`, oldest first. The same seed and time give the same list. */
export function openGames(
    now: number,
    filter: Mode | "any" = "any",
    seed = FEED_SEED,
    rule: RuleFilter = "all",
): Lobby[] {
    return feedWindow(now, seed)
        .filter((e) => e.lobby.openedAt <= now && now < e.closesAt)
        .filter((e) => filter === "any" || e.lobby.mode === filter)
        .filter((e) => rule === "all" || e.lobby.rule.kind === rule)
        .map((e) => e.lobby)
        .sort((a, b) => a.openedAt - b.openedAt);
}

// === State in the store =====================================================

type State = { hosted: Lobby[]; session: Session | null; recent: string[] };

function read(kv: KV): State {
    try {
        const raw = kv.getItem(KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<State>;
            return {
                hosted: Array.isArray(parsed.hosted) ? parsed.hosted.map(withRule) : [],
                session: parsed.session ? withSessionRule(parsed.session) : null,
                recent: Array.isArray(parsed.recent) ? parsed.recent : [],
            };
        }
    } catch {
        // Fall through to an empty state.
    }
    return { hosted: [], session: null, recent: [] };
}

const withRule = (l: Lobby): Lobby => ({ ...l, rule: parseRule(l.rule) });
const withSessionRule = (s: Session): Session => ({
    ...s,
    lobby: withRule(s.lobby),
    builds: s.builds ?? false,
    ready: s.ready ?? true,
    issue: s.issue ?? null,
    opponentReadyAt: s.opponentReadyAt ?? s.resolvesAt,
});

function write(kv: KV, state: State): void {
    try {
        kv.setItem(KEY, JSON.stringify(state));
    } catch {
        // Storage may be unavailable; the screen keeps its own state.
    }
}

export const readSession = (kv: KV): Session | null => read(kv).session;
export const hostedLobbies = (kv: KV): Lobby[] => read(kv).hosted;
export const recentCodes = (kv: KV): string[] => read(kv).recent;

const randomId = (next: () => number): string =>
    Array.from({ length: 12 }, () => Math.floor(next() * 16).toString(16)).join("");

export function opponentFor(lobbyId: string): Player {
    const h = hash32(`opponent:${lobbyId}`);
    return { name: OPPONENTS[h % OPPONENTS.length], rating: 1200 + (h % 600) };
}

export type HostInput = {
    mode: Mode;
    visibility: Visibility;
    rule: Rule;
    squad: Loadout[];
    names: string[];
    builds: boolean;
    ready: boolean;
    you: Player;
};

/** Open a lobby as the host; the opponent arrives a few seconds later. */
export function hostLobby(
    kv: KV,
    input: HostInput,
    now: number,
    next: () => number = Math.random,
): Session {
    const id = randomId(next);
    const lobby: Lobby = {
        id,
        code: codeFromId(id),
        mode: input.mode,
        visibility: input.visibility,
        rule: input.rule,
        host: { ...input.you, you: true },
        openedAt: now,
        source: "mine",
    };
    const arrival = now + 4000 + Math.floor(next() * 3000);
    const session: Session = {
        role: "host",
        lobby,
        squad: input.squad,
        names: input.names,
        builds: input.builds,
        ready: input.ready,
        issue: null,
        resolvesAt: arrival,
        // The opponent builds for a few seconds after arriving.
        opponentReadyAt: arrival + 2500 + Math.floor(next() * 2500),
        resolution: "arrive",
        opponent: opponentFor(id),
    };
    const state = read(kv);
    write(kv, { ...state, hosted: [...state.hosted, lobby], session });
    return session;
}

/** Skip the wait: the opponent arrives now. */
export function arriveNow(kv: KV, now: number): Session | null {
    const state = read(kv);
    if (!state.session || state.session.role !== "host") return state.session;
    const early = Math.max(0, state.session.resolvesAt - now);
    const session = {
        ...state.session,
        resolvesAt: Math.min(state.session.resolvesAt, now),
        opponentReadyAt: state.session.opponentReadyAt - early,
    };
    write(kv, { ...state, session });
    return session;
}

function closeHosted(state: State, id: string): Lobby[] {
    return state.hosted.map((l) => (l.id === id ? { ...l, closed: true } : l));
}

/** Leave the lobby: a host's lobby closes, a guest just walks out. */
export function leaveSession(kv: KV): void {
    const state = read(kv);
    const s = state.session;
    write(kv, {
        ...state,
        hosted: s && s.role === "host" ? closeHosted(state, s.lobby.id) : state.hosted,
        session: null,
    });
}

export type Lookup =
    | { ok: true; lobby: Lobby; own: boolean }
    | { ok: false; reason: "malformed" | "unknown" | "full" | "closed"; message: string };

const NO = (reason: "malformed" | "unknown" | "full" | "closed", message: string): Lookup => ({
    ok: false,
    reason,
    message,
});

/** Resolve what a player typed: fixture lobbies, lobbies hosted here and the open feed. */
export function lookupCode(kv: KV, input: string, now: number, seed = FEED_SEED): Lookup {
    const parsed = parseCode(input);
    if (!parsed.ok) return NO("malformed", parsed.message);
    const code = parsed.code;

    const mine = read(kv).hosted.find((l) => l.code === code);
    if (mine) {
        return mine.closed
            ? NO("closed", "That match is closed")
            : { ok: true, lobby: mine, own: true };
    }
    const fx = FIXTURES.find((l) => l.code === code);
    if (fx) return fx.full ? NO("full", "That match is full") : { ok: true, lobby: fx, own: false };

    const entry = feedWindow(now, seed).find((e) => e.lobby.code === code);
    if (entry) {
        return now < entry.closesAt
            ? { ok: true, lobby: entry.lobby, own: false }
            : NO("closed", "That match is closed");
    }
    return NO("unknown", "No match has that code");
}

/** Join a lobby as the guest; the host starts, or closes it, a few seconds later. */
export function joinLobby(
    kv: KV,
    lobby: Lobby,
    input: { squad: Loadout[]; names: string[]; builds?: boolean; ready?: boolean },
    now: number,
): Session {
    const ready = input.ready ?? true;
    const session: Session = {
        role: "guest",
        lobby,
        squad: input.squad,
        names: input.names,
        builds: input.builds ?? false,
        ready,
        issue: null,
        opponentReadyAt: 0,
        resolvesAt: ready ? hostActsAt(lobby, now) : NEVER,
        resolution: lobby.cancels ? "cancel" : "start",
        opponent: lobby.host,
    };
    const state = read(kv);
    const code = lobby.code;
    const recent = [code, ...state.recent.filter((c) => c !== code)].slice(0, 3);
    write(kv, { ...state, session, recent });
    return session;
}

const hostActsAt = (lobby: Lobby, now: number): number => now + (lobby.cancels ? 3000 : 3500);

/**
 * The builder reported a squad: keep it with whether it is ready. A guest who
 * becomes ready starts the host's clock; one who stops being ready stops it.
 */
export function updateSquad(
    kv: KV,
    squad: Loadout[],
    issues: { message: string }[],
    now: number,
): Session | null {
    const state = read(kv);
    const s = state.session;
    if (!s) return null;
    const ready = issues.length === 0;
    let resolvesAt = s.resolvesAt;
    if (s.role === "guest") {
        if (!ready) resolvesAt = NEVER;
        else if (resolvesAt === NEVER) resolvesAt = hostActsAt(s.lobby, now);
    }
    const next: Session = { ...s, squad, ready, issue: issues[0]?.message ?? null, resolvesAt };
    write(kv, { ...state, session: next });
    return next;
}

/** Resume the player's own open lobby as host (a code they typed that is theirs). */
export function resumeOwn(kv: KV): Session | null {
    return read(kv).session;
}

/** The host started the match: the lobby is spent. */
export function finishSession(kv: KV): void {
    leaveSession(kv);
}

export type Phase = "waiting" | "ready" | "starting" | "cancelled";

/** Where a session stands at `now`. */
export function phaseOf(session: Session, now: number): Phase {
    if (now < session.resolvesAt) return "waiting";
    if (session.role === "host") return "ready";
    return session.resolution === "cancel" ? "cancelled" : "starting";
}

export type SideState = "absent" | "building" | "ready";

/** The other player in a host's lobby: not here yet, building, or ready. */
export function opponentState(session: Session, now: number): SideState {
    if (session.role !== "host" || now < session.resolvesAt) return "absent";
    return now < session.opponentReadyAt ? "building" : "ready";
}

/** Why the host cannot start yet, null when Start can run. */
export function startBlock(session: Session, now: number): string | null {
    if (session.role !== "host") return "Only the host starts the match";
    const them = opponentState(session, now);
    if (them === "absent") return "Waiting for an opponent";
    if (!session.ready) return session.issue ?? "Your squad is not ready";
    if (them === "building") return `${session.opponent.name} is building a squad`;
    return null;
}

/** Open games a player may join, as the landing counts them. */
export const openCount = (now: number): number => openGames(now).length;
