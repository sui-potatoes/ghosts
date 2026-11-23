// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Finding a match. The player's `Account` says where they stand: `Idle`,
 * `Searching { order, since, queue, commitment }` or `Playing`, with a suspension
 * in its own field. A search names its queue: the queue for owned recruits
 * (`GHOSTS.matchmaker`), a ranked queue of a size (named by the `Rules`, and the
 * search holds the commitment to its squad), or `Lobbies` for a friendly game.
 *
 * Whoever finds someone waiting starts the game in the same transaction and is
 * `Playing` it. The player who waited can't be in that transaction, so they are
 * sent a `Seat` in the game, to their `Account`: for owned recruits it is accepted
 * (anyone can), for ranked the owner reveals the squad the search committed to,
 * with the salt this device kept. A search the queue drops (its ticket lives
 * `TICKET_TTL_MS`) is sent a `Seat` in no game: a notice, dismissed here, and the
 * player told, never queued again on their behalf. Re-reading the `Account` and its
 * seats is how a waiting player learns what happened. A game lives at `/match`.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";

import { callPlayerBack } from "../audio";
import { GHOSTS } from "../constants";
import { Account, Game, Seat, type ChainGame } from "./bcs";
import {
    createAccountTx,
    fetchAccountId,
    FREE_RECRUITS,
    hireRecruitsTx,
    useAccountId,
    useGhostsAccount,
    useGhostsAction,
    type ChainAccount,
} from "./ghosts";
import { beforeGame } from "./funds";
import { useLobbyPlace } from "./lobby";
import type { Place } from "./lobby-core";
import {
    bytesOf,
    forgetSquad,
    keptSquad,
    searchKind,
    sweepSquads,
    type SearchKind,
} from "./ranked-core";
import {
    cancelRankedTx,
    dismissSeatTx,
    revealSquadTx,
    saltStores,
    takeSeat,
    useRules,
} from "./ranked";
import { useSaving } from "./saving";

type Client = ReturnType<typeof useCurrentClient>;

/** How often a waiting player re-reads their `Account` and seat: a match found is a second away at most. */
const POLL_MS = 1_000;

/** `SEARCH_TIMEOUT_MS` in `ghosts::ghosts`: past it, anyone can cancel a search. */
export const SEARCH_TIMEOUT_MS = 120_000;

/**
 * `TICKET_TTL_MS` in `ghosts::ghosts`: how long a search waits in a queue. Past it,
 * the next search to visit its bucket drops it and sends a notice.
 */
export const TICKET_TTL_MS = 300_000;

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** A `Seat` sent to an `Account`, with the reference that receives it; `game` null for a notice. */
export interface ChainSeat {
    game: string | null;
    ref: { objectId: string; version: string; digest: string };
}

/** A seat in a game, not a notice. */
export type GameSeat = ChainSeat & { game: string };

/**
 * Pair with a compatible waiting player, starting the game, or leave an order in the queue.
 * Games for stakes start on Black Rain (`GHOSTS.preset`).
 */
function findGameTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("find_game"),
        arguments: [
            tx.object(GHOSTS.matchmaker),
            tx.object(accountId),
            tx.object(GHOSTS.preset),
            tx.object.random(),
            tx.object.clock(),
        ],
    });
    return tx;
}

/** Accept the seat a match sent to `accountId`, putting it into the game; anyone can. Not a ranked seat. */
export function acceptSeat(tx: Transaction, accountId: string, seat: ChainSeat["ref"]) {
    tx.moveCall({
        target: target("accept_seat"),
        arguments: [tx.object(accountId), tx.receivingRef(seat)],
    });
}

function acceptSeatTx(accountId: string, seat: ChainSeat["ref"]): Transaction {
    const tx = new Transaction();
    acceptSeat(tx, accountId, seat);
    return tx;
}

/** Leave the queue for owned recruits. A search a match found is left through its game instead. */
function cancelSearchTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("cancel_search"),
        arguments: [tx.object(GHOSTS.matchmaker), tx.object(accountId), tx.object.clock()],
    });
    return tx;
}

/** The seats sent to an `Account`, games and notices. A listing lags a write by a moment. */
async function fetchSeats(client: Client, accountId: string): Promise<ChainSeat[]> {
    const { objects } = await client.core.listOwnedObjects({
        owner: accountId,
        type: `${GHOSTS.package}::ghosts::Seat`,
        include: { content: true },
    });
    return objects.map(({ objectId, version, digest, content }) => {
        const { game } = Seat.parse(content);
        return { game: game ?? null, ref: { objectId, version, digest } };
    });
}

/**
 * The seats in `gameId` its players have yet to take, to take on the way to
 * wrapping it up: a player who never came to the game is still on their search.
 */
export async function fetchPendingSeats(
    client: Client,
    gameId: string,
    players: string[],
): Promise<{ accountId: string; seat: ChainSeat["ref"] }[]> {
    const pending = await Promise.all(
        players.map(async (accountId) => {
            const { object } = await client.core.getObject({
                objectId: accountId,
                include: { content: true },
            });
            if (Account.parse(object.content).state.$kind !== "Searching") return [];
            const seats = await fetchSeats(client, accountId);
            return seats
                .filter((seat) => seat.game === gameId)
                .map((seat) => ({ accountId, seat: seat.ref }));
        }),
    );
    return pending.flat();
}

/**
 * The seats sent to the `Account` on its search `order`, re-read while it waits.
 * Each search reads afresh: a seat listed for the last one, taken since, is never
 * taken for a new match.
 */
function useSeats(accountId?: string | null, order?: string | null) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["ghosts", "seats", accountId, order],
        enabled: !!accountId && !!order,
        refetchInterval: POLL_MS,
        // A poll is someone waiting on the chain, and they may be in another tab.
        refetchIntervalInBackground: true,
        queryFn: () => fetchSeats(client, accountId!),
    });
}

/** What a `Searching` account waits in, from the ids this build knows and the live rules. */
export function kindOf(
    state: ChainAccount["state"] | undefined,
    rules: Parameters<typeof searchKind>[1]["rules"],
): SearchKind | null {
    if (state?.$kind !== "Searching") return null;
    const { queue, commitment } = state.Searching;
    const kind = searchKind(queue, {
        stakes: GHOSTS.matchmaker,
        lobbies: GHOSTS.lobbies,
        rules,
    });
    // A ranked search always holds a commitment: its size waits on the rules.
    if (kind.kind === "unknown" && commitment) return { kind: "ranked", size: 0 };
    return kind;
}

/**
 * The player's game: the one they are `Playing`, or the one a seat answering their
 * search puts them in, with that seat, until it is taken. Null while in none.
 */
export function useCurrentGame(): {
    gameId: string | null;
    seat: GameSeat | null;
    notice: ChainSeat | null;
} {
    const accountId = useAccountId().data;
    const search = useGhostsAccount(accountId).data?.state;
    const order = search?.$kind === "Searching" ? search.Searching.order : null;
    const seats = useSeats(accountId, order).data ?? [];
    const seat = (seats.find((s) => s.game !== null) as GameSeat | undefined) ?? null;
    const notice = seats.find((s) => s.game === null) ?? null;
    if (search?.$kind === "Playing") return { gameId: search.Playing, seat: null, notice: null };
    if (search?.$kind !== "Searching") return { gameId: null, seat: null, notice: null };
    return { gameId: seat?.game ?? null, seat, notice: seat ? null : notice };
}

// === Told on this device ====================================================

/** A search the queue let go of without a match, until the player has read it. */
export type Expired = { kind: "ranked" | "stakes"; size: number };

let expired: Expired | null = null;
const expiredListeners = new Set<() => void>();

function setExpired(next: Expired | null) {
    expired = next;
    expiredListeners.forEach((listener) => listener());
}

/** The search that ran out of time, until `acknowledgeExpired`. */
export function useExpired(): Expired | null {
    return useSyncExternalStore(
        (listener) => {
            expiredListeners.add(listener);
            return () => expiredListeners.delete(listener);
        },
        () => expired,
        () => expired,
    );
}

export const acknowledgeExpired = () => setExpired(null);

/** How the reveal of a ranked squad is going, by game. */
export type Reveal =
    | { phase: "revealing" }
    | { phase: "done" }
    /** No squad and salt on this device for the search: the match is given up. */
    | { phase: "lost" }
    /** The reveal limit passed before this device could show the squad. */
    | { phase: "late" }
    | { phase: "failed"; line: string };

const reveals = new Map<string, Reveal>();
const revealListeners = new Set<() => void>();

function setReveal(gameId: string, reveal: Reveal) {
    reveals.set(normalizeSuiAddress(gameId), reveal);
    revealListeners.forEach((listener) => listener());
}

/** The reveal of the player's squad in `gameId`, as this device runs it; null when none ran. */
export function useReveal(gameId: string | null): Reveal | null {
    return useSyncExternalStore(
        (listener) => {
            revealListeners.add(listener);
            return () => revealListeners.delete(listener);
        },
        () => (gameId ? (reveals.get(normalizeSuiAddress(gameId)) ?? null) : null),
        () => null,
    );
}

// === The player's place =====================================================

/** A search in a queue, as screens show it. */
export type QueueSearch = {
    kind: "ranked" | "stakes";
    /** Units a side, for ranked; 0 while the rules are unread. */
    size: number;
    sinceMs: number;
    order: string;
    queue: string;
};

/** The player's place in matchmaking, read off their `Account`, and what they can do about it. */
export function useMatchSearch() {
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const account = useGhostsAccount(accountId).data;
    const rules = useRules().data ?? null;
    const action = useGhostsAction();
    const busy = useSaving();
    const [hiring, setHiring] = useState(false);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const { gameId, seat, notice } = useCurrentGame();
    const state = account?.state;
    const kind = kindOf(state, rules);
    // A lobby search: where in the lobby, the host's or the guest's place.
    const place = useLobbyPlace(accountId, kind?.kind === "lobby" ? account : undefined);
    const lobby: Exclude<Place, { kind: "queue" }> | null =
        kind?.kind === "lobby" && place && place.kind !== "queue" ? place : null;

    const searching: QueueSearch | null =
        state?.$kind === "Searching" &&
        !seat &&
        !notice &&
        (kind?.kind === "ranked" || kind?.kind === "stakes")
            ? {
                  kind: kind.kind,
                  size: kind.kind === "ranked" ? kind.size : 0,
                  sinceMs: Number(state.Searching.sinceMs),
                  order: state.Searching.order,
                  queue: state.Searching.queue,
              }
            : null;

    const send = (build: (id: string) => Transaction) => {
        if (!accountId || busy) return;
        void action.run([() => build(accountId)]);
    };

    /**
     * Into the queue for owned recruits, with whatever that takes: a player short of
     * a squad gets their free recruits on the way, and an `Account` to keep them in if
     * they have none. Reads what the hooks don't know yet, so a press before they load is safe.
     */
    const find = async () => {
        if (!owner || busy || hiring || state?.$kind === "Searching") return;
        const { client } = action;
        acknowledgeExpired();
        // The balance is topped up for this game in the background; waited for only if the queue could not be paid.
        await beforeGame(owner);
        const known = accountId ?? (await fetchAccountId(client, owner));
        let recruits = account?.recruits;
        if (known && recruits === undefined) {
            const { object } = await client.core.getObject({
                objectId: known,
                include: { content: true },
            });
            recruits = Account.parse(object.content).recruits;
        }
        if (known && Number(recruits) >= FREE_RECRUITS) return send(findGameTx);

        const idOf = async () => {
            const id = known ?? (await fetchAccountId(client, owner, true));
            if (!id) throw new Error("No account on file for this address.");
            return id;
        };
        setHiring(true);
        await action.run([
            ...(known ? [] : [createAccountTx]),
            async () => hireRecruitsTx(await idOf()),
            async () => findGameTx(await idOf()),
        ]);
        setHiring(false);
    };

    return {
        /** A squad is being hired on the way into the queue. */
        hiring,
        /** The search, while it waits in a queue (not a friendly lobby). */
        searching,
        /** The friendly lobby the player hosts or waits in; null while in none. */
        lobby,
        /** The game the player is in, or has a seat in. */
        playing: gameId,
        /** Until when matchmaking is closed to the player; 0 when it is not. */
        suspendedUntilMs: Number(account?.suspendedUntil ?? 0),
        busy,
        error: action.error || lookupError,
        find: () => {
            setLookupError(null);
            void find().catch((e: unknown) => {
                setHiring(false);
                setLookupError(e instanceof Error ? e.message : "Could not reach the network");
            });
        },
        /** Leave the queue the search waits in. Active as soon as the `Account` shows the search. */
        cancel: () => {
            if (!searching || !accountId) return;
            const commitment =
                state?.$kind === "Searching" ? (state.Searching.commitment ?? null) : null;
            if (searching.kind === "stakes") return send(cancelSearchTx);
            send((id) => cancelRankedTx(searching.queue, id));
            if (commitment) forgetSquad(saltStores(), commitment);
        },
    };
}

/** Read a game as it is now. */
async function readGame(client: Client, gameId: string): Promise<ChainGame | null> {
    try {
        const { object } = await client.core.getObject({
            objectId: gameId,
            include: { content: true },
        });
        return Game.parse(object.content);
    } catch {
        return null;
    }
}

/** Give up the reveal: take the seat without a squad and walk out, so the game ends at once. */
function giveUpTx(gameId: string, accountId: string, seat: ChainSeat["ref"]) {
    const tx = new Transaction();
    takeSeat(tx, gameId, accountId, seat);
    tx.moveCall({
        target: target("abandon_game"),
        arguments: [tx.object(gameId), tx.object(accountId)],
    });
    return tx;
}

/** Past the reveal limit: take the seat and call the deployment over, the game a no-show. */
function lateTx(gameId: string, accountId: string, seat: ChainSeat["ref"], deploying: boolean) {
    const tx = new Transaction();
    takeSeat(tx, gameId, accountId, seat);
    if (deploying)
        tx.moveCall({
            target: target("next_turn"),
            arguments: [tx.object(gameId), tx.object(accountId), tx.object.clock()],
        });
    return tx;
}

/**
 * Call once, inside the router: re-reads the `Account` and its seats while it
 * waits; takes the seat a match sends (accepted for owned recruits, the squad
 * revealed for ranked); dismisses a notice and keeps it to tell; takes the player
 * to the game when one starts, theirs or one they were found for.
 */
export function useMatchmakingDriver() {
    const navigate = useNavigate();
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const account = useGhostsAccount(accountId).data;
    const rules = useRules().data ?? null;
    const { gameId, seat, notice } = useCurrentGame();
    const { run, attempt, client } = useGhostsAction();

    useGhostsAccount(accountId, account?.state.$kind === "Searching" ? POLL_MS : undefined);

    const state = account?.state;
    const commitment = state?.$kind === "Searching" ? (state.Searching.commitment ?? null) : null;

    // What no search needs any more goes: a squad kept for a search that is over.
    useEffect(() => {
        if (accountId && state) sweepSquads(saltStores(), accountId, commitment);
    }, [accountId, state?.$kind, commitment]);

    // The seat is taken as soon as it shows up: the player's one transaction of the
    // match, and nothing in the game can happen before it.
    const taken = useRef<string | null>(null);
    useEffect(() => {
        if (!seat || !accountId || !owner || taken.current === seat.ref.objectId) return;
        taken.current = seat.ref.objectId;
        const retry = (done: boolean) => {
            if (!done) taken.current = null;
        };
        if (!commitment) {
            void run([() => acceptSeatTx(accountId, seat.ref)]).then(retry);
            return;
        }
        const gameId = seat.game;
        const kept = keptSquad(saltStores(), commitment);
        void (async () => {
            const game = await readGame(client, gameId);
            const deploying = game?.state.$kind === "Deploying";
            const until =
                game?.state.$kind === "Deploying" ? Number(game.state.Deploying.untilMs) : 0;
            if (!kept) {
                setReveal(gameId, { phase: "lost" });
                const sent = await attempt([() => giveUpTx(gameId, accountId, seat.ref)]);
                return retry(sent.ok);
            }
            if (!deploying || Date.now() > until) {
                setReveal(gameId, { phase: "late" });
                const sent = await attempt([() => lateTx(gameId, accountId, seat.ref, deploying)]);
                if (sent.ok) forgetSquad(saltStores(), commitment);
                return retry(sent.ok);
            }
            setReveal(gameId, { phase: "revealing" });
            const sent = await attempt([
                () =>
                    revealSquadTx(
                        gameId,
                        accountId,
                        seat.ref,
                        bytesOf(kept.squad),
                        bytesOf(kept.salt),
                    ),
            ]);
            if (sent.ok) {
                forgetSquad(saltStores(), commitment);
                setReveal(gameId, { phase: "done" });
                return;
            }
            // A squad the commitment does not match never will: the match is given up.
            if (/, 31\)|abort code:?\s*31/.test(sent.message)) {
                setReveal(gameId, { phase: "lost" });
                const given = await attempt([() => giveUpTx(gameId, accountId, seat.ref)]);
                return retry(given.ok);
            }
            setReveal(gameId, { phase: "failed", line: revealLine(sent.message) });
            retry(false);
        })();
    }, [seat, accountId, owner, commitment]);

    // A notice: the queue let the search go. Dismissed at once, and told until read.
    const dismissed = useRef<string | null>(null);
    useEffect(() => {
        if (!notice || !accountId || dismissed.current === notice.ref.objectId) return;
        dismissed.current = notice.ref.objectId;
        const kind = kindOf(state, rules);
        setExpired({
            kind: kind?.kind === "ranked" ? "ranked" : "stakes",
            size: kind?.kind === "ranked" ? kind.size : 0,
        });
        void run([() => dismissSeatTx(accountId, notice.ref)]).then((done) => {
            if (!done) dismissed.current = null;
            else if (commitment) forgetSquad(saltStores(), commitment);
        });
    }, [notice, accountId]);

    // Into the game as it starts; the clock for picking a squad is running. Only
    // once the `Account` was read without one, so a reload stays where it is.
    const read = account !== undefined;
    const previous = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (!read) return;
        if (gameId && previous.current === null) {
            navigate("/match");
            callPlayerBack("Match found");
        }
        previous.current = gameId;
    }, [read, gameId, navigate]);
}

/** A failed reveal in the player's words. */
function revealLine(message: string): string {
    if (/, 15\)|abort code:?\s*15/.test(message)) return "The time to show the squad is over";
    return "Could not show the squad. Trying again";
}
