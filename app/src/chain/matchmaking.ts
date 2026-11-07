// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Finding a match. The player's `Account` says it all: `search` is `Idle`,
 * `Searching`, `Matched` or `Playing`, and re-reading it is how a waiting player
 * learns what happened. Whoever finds someone waiting is `Matched` by their own
 * transaction and starts the game for both in a follow-up, which the shell's
 * `useMatchmakingDriver` sends. A game then lives at the `/match` screen.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { callPlayerBack } from "../audio";
import { GHOSTS } from "../constants";
import { Account, Clock } from "./bcs";
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

/** How often a waiting player re-reads their `Account`. */
const POLL_MS = 3_000;

/** `SEARCH_TIMEOUT_MS` in `ghosts::ghosts`: past it, anyone can cancel a search. */
export const SEARCH_TIMEOUT_MS = 120_000;

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** Pair with a compatible waiting player, or leave an order in the queue. */
function findGameTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("find_game"),
        arguments: [
            tx.object(GHOSTS.matchmaker),
            tx.object(accountId),
            tx.object.random(),
            tx.object.clock(),
        ],
    });
    return tx;
}

/** Leave the queue. Only for a search: walking away from a match held costs a suspension. */
function cancelSearchTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("cancel_search"),
        arguments: [tx.object(GHOSTS.matchmaker), tx.object(accountId), tx.object.clock()],
    });
    return tx;
}

/** Start the game this `Account` is matched for, for both players. */
function startGameTx(accountId: string, opponentId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("start_game"),
        arguments: [
            tx.object(accountId),
            tx.object(opponentId),
            tx.object(GHOSTS.preset),
            tx.object.clock(),
        ],
    });
    return tx;
}

/** Let go of a match the opponent is no longer waiting on, without blame. */
function releaseMatchTx(accountId: string, opponentId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("release_match"),
        arguments: [tx.object(accountId), tx.object(opponentId), tx.object.clock()],
    });
    return tx;
}

/** The player's place in matchmaking, read off their `Account`, and what they can do about it. */
export function useMatchSearch() {
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const account = useGhostsAccount(accountId).data;
    const action = useGhostsAction();
    const busy = useSaving();
    const [hiring, setHiring] = useState(false);
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
            const id = known ?? (await fetchAccountId(client, owner));
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
        searching: search?.$kind === "Searching" ? search.Searching : null,
        matched: search?.$kind === "Matched" ? search.Matched : null,
        playing: search?.$kind === "Playing" ? search.Playing : null,
        suspendedUntilMs: Number(account?.suspendedUntilMs ?? 0),
        busy,
        error: action.error,
        find: () => void find().catch(() => {}),
        cancel: () => send(cancelSearchTx),
    };
}

/**
 * Follow up on a match: start the game if the opponent is still waiting on it,
 * or let go of the match if they cancelled or ran out of time, going by the same
 * clock the contract does. A reload picks this up again.
 */
async function followUp(
    client: Client,
    accountId: string,
    matchId: string,
    opponent: string,
): Promise<Transaction> {
    const opponentId = await fetchAccountId(client, opponent);
    if (!opponentId) throw new Error("The opponent is gone. Try again.");

    const read = (objectId: string) =>
        client.core.getObject({ objectId, include: { content: true } });
    const [theirs, clock] = await Promise.all([read(opponentId), read(SUI_CLOCK_OBJECT_ID)]);
    const { search } = Account.parse(theirs.object.content);
    const now = Number(Clock.parse(clock.object.content).timestampMs);

    const waiting =
        search.$kind === "Searching" &&
        search.Searching.order === matchId &&
        now - Number(search.Searching.sinceMs) <= SEARCH_TIMEOUT_MS;
    return (waiting ? startGameTx : releaseMatchTx)(accountId, opponentId);
}

/**
 * Call once, inside the router: re-reads the `Account` while it waits, sends the
 * follow-up to a match, and takes the player to the game when one starts. A
 * follow-up that failed waits for `retry`, as it may take a wallet's signature.
 */
export function useMatchmakingDriver() {
    const client = useCurrentClient();
    const navigate = useNavigate();
    const accountId = useAccountId().data;
    const search = useGhostsAccount(accountId).data?.search;
    const { run, busy, error } = useGhostsAction();

    useGhostsAccount(accountId, search?.$kind === "Searching" ? POLL_MS : undefined);

    const matched = search?.$kind === "Matched" ? search.Matched : null;
    const send = () => {
        if (!accountId || !matched) return;
        void run([() => followUp(client, accountId, matched.matchId, matched.opponent)]);
    };
    const followed = useRef<string | null>(null);
    useEffect(() => {
        if (!matched || !accountId || followed.current === matched.matchId) return;
        followed.current = matched.matchId;
        send();
    }, [client, accountId, matched]);

    // Into the game as it starts; the clock for picking a squad is running.
    const kind = search?.$kind;
    const previous = useRef(kind);
    useEffect(() => {
        if (kind === "Playing" && previous.current && previous.current !== "Playing") {
            navigate("/match");
            callPlayerBack("Match found");
        }
        previous.current = kind;
    }, [kind, navigate]);

    return { busy, error: matched ? error : "", retry: send };
}
