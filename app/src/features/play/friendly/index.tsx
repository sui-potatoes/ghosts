// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play/friendly`: friendly games on chain, with the player's own recruits.
 * This feeds `FriendlyView` from the `Account` (where the player stands: free,
 * hosting, a guest, queued, playing), the lobby it names, the open list and
 * the level's spawn count, and sends the lobby calls through the game's one
 * write path. A started game is entered by the shell's matchmaking driver.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
    closeLobbyTx,
    codeHash,
    codeText,
    DROPPED_LINES,
    droppedWhy,
    fetchLobby,
    findInviteHost,
    isExpired,
    joinLobbyTx,
    joinOpenTx,
    keepCode,
    keptCode,
    kickGuestTx,
    leaveLobbyTx,
    openLobbyTx,
    protectedKey,
    randomCode,
    startFriendlyTx,
    useAccountId,
    useAssignedName,
    useGhostsAccount,
    useGhostsAction,
    useMatchSearch,
    useOpenLobbies,
    usePresetSide,
    type Step,
} from "../../../chain";
import { beforeGame } from "../../../chain/funds";
import { useGoUp } from "../../../hooks/useGoUp";
import { requestSignIn } from "../../../signIn";
import { FriendlyView, type FriendlyOps } from "./FriendlyView";
import { FRIENDLY_ROUTE, gateOf, linkCode, parseCode, type LobbyState } from "./model";

/** How often a guest re-reads the host's `Account`, for the lobby's clock. */
const HOST_POLL_MS = 5_000;

/** A player's assigned name by address, for the open list's rows. */
function useName(address: string | null): string | null {
    return useAssignedName(address ?? undefined) ?? null;
}

export function FriendlyScreen() {
    const navigate = useNavigate();
    const location = useLocation();
    const leaveScreen = useGoUp();
    const client = useCurrentClient();
    const queryClient = useQueryClient();
    const wallet = useCurrentAccount();
    const owner = wallet?.address;
    const accountId = useAccountId();
    const id = accountId.data ?? null;
    const account = useGhostsAccount(id);
    const match = useMatchSearch();
    const action = useGhostsAction();
    const presetSide = usePresetSide().data ?? null;
    const [watching, setWatching] = useState(false);
    const open = useOpenLobbies(watching);
    const [localError, setLocalError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    // A followed link fills the code field; the query is spent at once, so the code
    // stays out of the history.
    const [link] = useState(() => linkCode(location.search));
    useEffect(() => {
        if (location.search) navigate(FRIENDLY_ROUTE, { replace: true });
    }, [location.search, navigate]);

    const state = account.data?.state;
    const sinceMs = state?.$kind === "Searching" ? Number(state.Searching.sinceMs) : null;
    const place = match.lobby;

    // The other player in the lobby: the guest in the host's slot, or the guest's host.
    const otherId =
        place?.kind === "host-open" ? place.guest : place?.kind === "guest" ? place.host : null;
    const other = useGhostsAccount(otherId, place?.kind === "guest" ? HOST_POLL_MS : undefined);
    const otherName = useAssignedName(other.data?.owner) ?? null;
    const otherSince =
        other.data?.state.$kind === "Searching" ? Number(other.data.state.Searching.sinceMs) : null;

    const lobby: LobbyState | null = useMemo(() => {
        if (!place) return null;
        const person = {
            name: otherName,
            rating: other.data ? Number(other.data.rating.rating) : null,
        };
        if (place.kind === "guest")
            return { kind: "guest", size: place.size, sinceMs: otherSince, host: person };
        return {
            kind: "host",
            listed: place.kind === "host-open",
            size: place.size,
            sinceMs: sinceMs ?? Date.now(),
            code: place.kind === "host-invite" ? keptCode(place.key) : null,
            guest:
                place.kind === "host-open" && place.guest ? { id: place.guest, ...person } : null,
        };
    }, [place, otherName, other.data, otherSince, sinceMs]);

    // Out of a lobby without having left it: removed, closed, or expired. Said once, on the list.
    const last = useRef<{ role: "host" | "guest"; host: string; since: number | null } | null>(
        null,
    );
    const ownExit = useRef(false);
    useEffect(() => {
        if (place && id) {
            last.current = {
                role: place.kind === "guest" ? "guest" : "host",
                host: place.kind === "guest" ? place.host : id,
                since: place.kind === "guest" ? otherSince : sinceMs,
            };
            return;
        }
        const was = last.current;
        if (!was || !state || state.$kind === "Searching") return;
        last.current = null;
        if (ownExit.current || state.$kind === "Playing") {
            ownExit.current = false;
            return;
        }
        if (was.role === "host") {
            setNotice(
                was.since !== null && isExpired(was.since, Date.now())
                    ? "This game has expired"
                    : "This game was closed",
            );
            return;
        }
        void fetchLobby(client, "Open", was.host)
            .catch(() => null)
            .then((read) => setNotice(DROPPED_LINES[droppedWhy(id!, read, was.since, Date.now())]));
    }, [place, id, state, otherSince, sinceMs, client]);

    const suspendedMs =
        state?.$kind === "Suspended"
            ? Math.max(0, Number(state.Suspended.untilMs) - Date.now())
            : 0;
    const gate = gateOf({
        signedIn: !!wallet,
        loading: accountId.isLoading || (!!id && account.isLoading),
        hasAccount: !!id,
        recruits: Number(account.data?.recruits ?? 0),
        playing: !!match.playing,
        queued: !!match.searching,
        suspendedMin: suspendedMs > 0 ? Math.ceil(suspendedMs / 60_000) : 0,
    });

    /** A lobby call: the balance checked as before any game, then the one write path. */
    const send = async (steps: Step[]) => {
        setLocalError(null);
        setNotice(null);
        if (owner) await beforeGame(owner);
        const done = await action.run(steps);
        void queryClient.invalidateQueries({ queryKey: ["ghosts", "lobby-place"] });
        void queryClient.invalidateQueries({ queryKey: ["ghosts", "open-lobbies"] });
        return done;
    };

    const guestOf = () => (place?.kind === "host-open" ? place.guest : null);

    const ops: FriendlyOps = {
        host: (size, listed) => {
            if (!id || gate) return;
            if (listed) return void send([() => openLobbyTx(id, size, null)]);
            const code = randomCode();
            // Kept on this device before the code goes out, under the key the chain files it at.
            keepCode(protectedKey(code), codeText(code));
            void send([() => openLobbyTx(id, size, codeHash(code))]);
        },
        joinCode: (text) => {
            if (!id || gate || checking) return;
            const parsed = parseCode(text);
            if (!parsed.ok) return setLocalError(parsed.message);
            setLocalError(null);
            setChecking(true);
            void findInviteHost(client, parsed.bytes, id)
                .then(async (found) => {
                    if (!found.ok) return setLocalError(found.message);
                    if (found.own) return setLocalError("This is your own game");
                    await send([() => joinLobbyTx(found.hostId, id, parsed.bytes)]);
                })
                .catch(() => setLocalError("Connection lost. Try again."))
                .finally(() => setChecking(false));
        },
        joinOpen: (hostId) => {
            if (!id || gate) return;
            void send([() => joinOpenTx(hostId, id)]);
        },
        leave: () => {
            if (!id) return;
            ownExit.current = true;
            void send([() => leaveLobbyTx(id)]).then((done) => {
                if (!done) ownExit.current = false;
            });
        },
        kick: () => {
            const guest = guestOf();
            if (id && guest) void send([() => kickGuestTx(id, guest)]);
        },
        start: () => {
            const guest = guestOf();
            if (id && guest) void send([() => startFriendlyTx(id, guest)]);
        },
        close: () => {
            if (!id) return;
            ownExit.current = true;
            const guest = guestOf();
            void send([() => closeLobbyTx(id, guest)]).then((done) => {
                if (!done) ownExit.current = false;
            });
        },
        gateAction: () => {
            switch (gate?.action?.id) {
                case "sign-in":
                    return requestSignIn();
                case "resume":
                    return navigate("/match");
                case "queue":
                    return navigate("/find");
                case "headquarters":
                    return navigate("/headquarters");
            }
        },
        leaveScreen,
        clearError: () => {
            setLocalError(null);
            action.clearError();
        },
        clearNotice: () => setNotice(null),
        watchOpen: setWatching,
        useName,
    };

    const games = useMemo(
        () => open.data?.filter((g) => g.hostId !== id) ?? (open.isError ? [] : null),
        [open.data, open.isError, id],
    );

    return (
        <FriendlyView
            data={{
                gate,
                presetSide,
                lobby,
                games,
                busy: action.busy || checking,
                error: localError ?? (action.error || null),
                notice,
                linkCode: link,
            }}
            ops={ops}
        />
    );
}
