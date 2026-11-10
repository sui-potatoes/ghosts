// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Finding a match. The player's `Account` says where they stand: `search` is
 * `Idle`, `Searching` or `Playing`. Whoever finds someone waiting starts the game
 * in the same transaction and is `Playing` it. The player who waited can't be in
 * that transaction, so they are sent a `Seat` in the game, to their `Account`,
 * and accepting it puts them in: their one transaction, sent as soon as the seat
 * shows up. Anyone can accept a seat, so the other player does it on the way to
 * wrapping up a game the seated player never came to. Re-reading the `Account`
 * and its seat is how a waiting player learns what happened. A game then lives at
 * the `/match` screen.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { callPlayerBack } from "../audio";
import { GHOSTS } from "../constants";
import { Account, Seat } from "./bcs";
import {
    createAccountTx,
    fetchAccountId,
    FREE_RECRUITS,
    hireRecruitsTx,
    useAccountId,
    useGhostsAccount,
    useGhostsAction,
} from "./ghosts";
import { useSaving } from "./saving";

type Client = ReturnType<typeof useCurrentClient>;

/** How often a waiting player re-reads their `Account` and seat: a match found is a second away at most. */
const POLL_MS = 1_000;

/** `SEARCH_TIMEOUT_MS` in `ghosts::ghosts`: past it, anyone can cancel a search. */
export const SEARCH_TIMEOUT_MS = 120_000;

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** A `Seat` sent to an `Account`, with the reference that receives it. */
export interface ChainSeat {
    game: string;
    ref: { objectId: string; version: string; digest: string };
}

/** Pair with a compatible waiting player, starting the game, or leave an order in the queue. */
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

/** Accept the seat a match sent to `accountId`, putting it into the game; anyone can. */
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

/** Leave the queue. A search a match found is left through its game instead. */
function cancelSearchTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("cancel_search"),
        arguments: [tx.object(GHOSTS.matchmaker), tx.object(accountId), tx.object.clock()],
    });
    return tx;
}

/** The seats sent to an `Account`: one at most. A listing lags a write by a moment. */
async function fetchSeats(client: Client, accountId: string): Promise<ChainSeat[]> {
    const { objects } = await client.core.listOwnedObjects({
        owner: accountId,
        type: `${GHOSTS.package}::ghosts::Seat`,
        include: { content: true },
    });
    return objects.map(({ objectId, version, digest, content }) => {
        const { game } = Seat.parse(content);
        return { game, ref: { objectId, version, digest } };
    });
}

/**
 * The seats in `gameId` its players have yet to accept, to accept on the way to
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
            if (Account.parse(object.content).search.$kind !== "Searching") return [];
            const seats = await fetchSeats(client, accountId);
            return seats
                .filter((seat) => seat.game === gameId)
                .map((seat) => ({ accountId, seat: seat.ref }));
        }),
    );
    return pending.flat();
}

/**
 * The seat sent to the `Account` on its search `order`, re-read while it waits.
 * Each search reads afresh: a seat listed for the last one, accepted since, is
 * never taken for a new match.
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

/**
 * The player's game: the one they are `Playing`, or the one a seat answering their
 * search puts them in, with that seat, until it is accepted. Null while in none.
 */
export function useCurrentGame(): { gameId: string | null; seat: ChainSeat | null } {
    const accountId = useAccountId().data;
    const search = useGhostsAccount(accountId).data?.search;
    const order = search?.$kind === "Searching" ? search.Searching.order : null;
    const seat = useSeats(accountId, order).data?.[0] ?? null;
    if (search?.$kind === "Playing") return { gameId: search.Playing, seat: null };
    return { gameId: seat?.game ?? null, seat };
}

/** The player's place in matchmaking, read off their `Account`, and what they can do about it. */
export function useMatchSearch() {
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const account = useGhostsAccount(accountId).data;
    const action = useGhostsAction();
    const busy = useSaving();
    const [hiring, setHiring] = useState(false);
    const { gameId, seat } = useCurrentGame();
    const search = account?.search;

    const send = (build: (id: string) => Transaction) => {
        if (!accountId || busy) return;
        void action.run([() => build(accountId)]);
    };

    /**
     * Into the queue, with whatever that takes: a player short of a squad gets their
     * free recruits on the way, and an `Account` to keep them in if they have none.
     * Reads what the hooks don't know yet, so a press before they load is safe.
     */
    const find = async () => {
        if (!owner || busy || hiring) return;
        const { client } = action;
        const known = accountId ?? (await fetchAccountId(client, owner));
        let recruits = account?.recruits.size;
        if (known && recruits === undefined) {
            const { object } = await client.core.getObject({
                objectId: known,
                include: { content: true },
            });
            recruits = Account.parse(object.content).recruits.size;
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
        /** The search, while it is in the queue. */
        searching: search?.$kind === "Searching" && !seat ? search.Searching : null,
        /** The game the player is in, or has a seat in. */
        playing: gameId,
        suspendedUntilMs: Number(account?.suspendedUntilMs ?? 0),
        busy,
        error: action.error,
        find: () => void find().catch(() => {}),
        cancel: () => send(cancelSearchTx),
    };
}

/**
 * Call once, inside the router: re-reads the `Account` and its seat while it
 * waits, accepts the seat a match sends, and takes the player to the game when
 * one starts, theirs or one they were found for.
 */
export function useMatchmakingDriver() {
    const navigate = useNavigate();
    const accountId = useAccountId().data;
    const account = useGhostsAccount(accountId).data;
    const { gameId, seat } = useCurrentGame();
    const { run } = useGhostsAction();

    useGhostsAccount(accountId, account?.search.$kind === "Searching" ? POLL_MS : undefined);

    // The seat is accepted as soon as it shows up: the player's one transaction
    // of the match, and nothing in the game can happen before it.
    const accepted = useRef<string | null>(null);
    useEffect(() => {
        if (!seat || !accountId || accepted.current === seat.ref.objectId) return;
        accepted.current = seat.ref.objectId;
        void run([() => acceptSeatTx(accountId, seat.ref)]).then((done) => {
            if (!done) accepted.current = null;
        });
    }, [seat, accountId]);

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
