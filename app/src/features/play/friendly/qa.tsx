// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for the friendly screen, in builds made with `VITE_FRIENDLY_QA=1`
 * only (the route is not registered otherwise, see `App.tsx`): the real
 * `FriendlyView` over fixtures, no chain, no sign-in. `/qa/friendly?state=`
 * one of `landing`, `host-open`, `host-guest`, `invite`, `invite-elsewhere`,
 * `host-expired`, `guest`, `guest-expired`, `list`, `list-empty`, `kicked`,
 * `closed`, `expired`, `signed-out`, `no-recruits`, `queued`, `join-error`,
 * `four` (a level with 4 spawns a side). What the screen asks for is counted on
 * `window.__friendly`.
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { FriendlyView, type FriendlyData } from "./FriendlyView";
import type { Gate, OpenGame } from "./model";

const NAMES: Record<string, string> = {
    "0xa1": "kestrel",
    "0xa2": "greywater",
    "0xa3": "rook",
    "0xa4": "vesper",
};

const minutesAgo = (m: number) => Date.now() - m * 60_000;

const GAMES: OpenGame[] = [
    { hostId: "0x1", owner: "0xa1", rating: 1520, size: 3, sinceMs: minutesAgo(1.5), full: false },
    { hostId: "0x2", owner: "0xa2", rating: 1488, size: 3, sinceMs: minutesAgo(4), full: true },
    { hostId: "0x3", owner: "0xa3", rating: 1610, size: 4, sinceMs: minutesAgo(6), full: false },
    { hostId: "0x4", owner: "0xa9", rating: 1500, size: 3, sinceMs: minutesAgo(8.5), full: false },
];

const GUEST = { id: "0xg", name: "vesper", rating: 1544 };
const CODE = "24VMT8UT43YR9";

const GATES: Record<string, Gate> = {
    "signed-out": { reason: "Sign in to play", action: { id: "sign-in", label: "Sign in" } },
    "no-recruits": {
        reason: "Hire a squad first",
        action: { id: "headquarters", label: "Headquarters" },
    },
    queued: { reason: "You are in the match queue", action: { id: "queue", label: "Match queue" } },
};

function fixture(state: string): FriendlyData {
    const base: FriendlyData = {
        gate: GATES[state] ?? null,
        presetSide: state === "four" ? 4 : 3,
        lobby: null,
        games: GAMES,
        busy: false,
        error: null,
        notice: null,
        linkCode: null,
    };
    switch (state) {
        case "host-open":
            return {
                ...base,
                lobby: {
                    kind: "host",
                    listed: true,
                    size: 3,
                    sinceMs: minutesAgo(0.5),
                    code: null,
                    guest: null,
                },
            };
        case "host-guest":
            return {
                ...base,
                lobby: {
                    kind: "host",
                    listed: true,
                    size: 3,
                    sinceMs: minutesAgo(2),
                    code: null,
                    guest: GUEST,
                },
            };
        case "invite":
        case "invite-elsewhere":
            return {
                ...base,
                lobby: {
                    kind: "host",
                    listed: false,
                    size: 3,
                    sinceMs: minutesAgo(0.2),
                    code: state === "invite" ? CODE : null,
                    guest: null,
                },
            };
        case "host-expired":
            return {
                ...base,
                lobby: {
                    kind: "host",
                    listed: true,
                    size: 3,
                    sinceMs: minutesAgo(11),
                    code: null,
                    guest: GUEST,
                },
            };
        case "guest":
        case "guest-expired":
            return {
                ...base,
                lobby: {
                    kind: "guest",
                    size: 3,
                    sinceMs: minutesAgo(state === "guest" ? 3 : 10.5),
                    host: { name: "kestrel", rating: 1520 },
                },
            };
        case "list-empty":
            return { ...base, games: [] };
        case "kicked":
            return { ...base, notice: "The host removed you from this game" };
        case "closed":
            return { ...base, notice: "The host closed this game" };
        case "expired":
            return { ...base, notice: "This game has expired" };
        case "join-error":
            return { ...base, error: "No game with this code", linkCode: "24VM-T8UT-43YRA" };
        default:
            return base;
    }
}

export default function FriendlyQa() {
    const [params] = useSearchParams();
    const state = params.get("state") ?? "landing";
    const [data, setData] = useState(() => fixture(state));
    const log = (what: string) => {
        const w = window as unknown as { __friendly?: string[] };
        (w.__friendly ??= []).push(what);
    };
    return (
        <FriendlyView
            data={data}
            ops={{
                host: (size, listed) => log(`host ${size} ${listed ? "open" : "invite"}`),
                joinCode: (text) => log(`join-code ${text}`),
                joinOpen: (hostId) => log(`join-open ${hostId}`),
                leave: () => log("leave"),
                kick: () => log("kick"),
                start: () => log("start"),
                close: () => log("close"),
                gateAction: () => log("gate"),
                leaveScreen: () => log("leave-screen"),
                clearError: () => setData((d) => (d.error ? { ...d, error: null } : d)),
                clearNotice: () => setData((d) => (d.notice ? { ...d, notice: null } : d)),
                watchOpen: () => {},
                useName: (owner) => (owner ? (NAMES[owner] ?? null) : null),
            }}
        />
    );
}
