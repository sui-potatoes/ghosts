// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * How a friendly game ended when it was gone before the app saw it end. The other
 * player's client can end and wrap a game up in one transaction (`abandon_game` and
 * `complete_game`), so no poll sees it `Over`, and a friendly game moves no score
 * that could say who won. What is left to read is the transaction that deleted the
 * game: it is the last one to touch the player's `Account` (`complete_game` frees
 * it), so the `Account`'s previous transaction names the sender and the calls. With
 * the game as last seen, that settles who won and why. No pure rule, no React; tested
 * in `tests/friendly-ending.test.ts`.
 */

import type { ClientWithCoreApi } from "@mysten/sui/client";

import type { ChainGame, Ending } from "./bcs.ts";
import { activeSide, isDeploying, isOver, squadOf, type Outcome } from "./match-rules.ts";
import { CALLS, ENDED_EVENT, GAME_ENDED_TYPE, MAX_TURNS } from "./watch-layout.ts";

/** The transaction that wrapped a game up: who sent it and which `ghosts` calls it made, in order. */
export type EndingTx = { sender: string; calls: readonly string[] };

/** The client the reads go through. */
export type EndingClient = ClientWithCoreApi;

type TxData = {
    sender?: string | null;
    commands: readonly object[];
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The `ghosts::ghosts` calls of a transaction, in order. */
export function callsOf(tx: TxData, pkg: string): string[] {
    return tx.commands.flatMap((command) => {
        const call = (
            command as { MoveCall?: { package: string; module: string; function: string } }
        ).MoveCall;
        return call && call.module === "ghosts" && sameAddress(call.package, pkg)
            ? [call.function]
            : [];
    });
}

/** Package ids compare by value: `0x2` and its padded form are one. */
const sameAddress = (a: string, b: string) =>
    BigInt(a.startsWith("0x") ? a : `0x${a}`) === BigInt(b.startsWith("0x") ? b : `0x${b}`);

/**
 * The last transaction on the `Account`: two reads, the object's previous transaction
 * and its commands. Null when either is missing.
 */
export async function fetchEndingTx(
    client: EndingClient,
    accountId: string,
    pkg: string,
): Promise<EndingTx | null> {
    const { objects } = await client.core.getObjects({
        objectIds: [accountId],
        include: { previousTransaction: true },
    });
    const object = objects[0];
    if (!object || object instanceof Error || !object.previousTransaction) return null;
    const result = await client.core.getTransaction({
        digest: object.previousTransaction,
        include: { transaction: true },
    });
    const tx: TxData | undefined = (result.Transaction ?? result.FailedTransaction)?.transaction;
    if (!tx?.sender) return null;
    return { sender: tx.sender, calls: callsOf(tx, pkg) };
}

/**
 * How a friendly game that was deleted before it was seen `Over` ended for `side`, from the
 * game as last read and the transaction that wrapped it up; null when that cannot be told.
 *
 * - `abandon_game` in it: the sender gave up, so the opponent won;
 * - `next_turn`: a clock ran out. While squads were picked, the side with nobody deployed did
 *   not show; in play, the side whose turn it was forfeited, or at the turn limit nobody won;
 * - any other call that ends a game is an action (an attack, a grenade), by the side that took
 *   it, which was the last one standing.
 */
export function vanishedOutcome(
    game: ChainGame,
    side: number,
    ending: EndingTx | null,
    me: string,
): Outcome | null {
    if (!ending || isOver(game)) return null;
    const mine = same(ending.sender, me);
    const calls = ending.calls.filter((call) => call !== "complete_game");
    if (calls.includes("abandon_game")) return mine ? "abandoned" : "opponent-abandoned";
    if (calls.includes("next_turn")) {
        if (isDeploying(game)) {
            const ours = squadOf(game, side).length > 0;
            const theirs = squadOf(game, 1 - side).length > 0;
            if (!ours) return "no-show";
            return theirs ? null : "opponent-no-show";
        }
        if (game.turn + 1 >= MAX_TURNS) return "stalemate";
        return activeSide(game) === side ? "forfeited" : "opponent-forfeited";
    }
    if (calls.length === 0) return null;
    return mine ? "victory" : "defeat";
}

/** `ghosts::ghosts::Ending` as decoded: how a game ended, a player named by their `Account` ID. */
export type GameEnding = typeof Ending.$inferType;

/**
 * How a game ended, as the contract would have written it, for anyone watching: the
 * game's state when it is `Over`, else (deleted in the transaction that ended it, so no
 * `Over` was ever written) worked out from that transaction as `vanishedOutcome` does for
 * a player. `senderSide` is the player who sent it, null when neither did (anyone may
 * wrap a game up). Null when that cannot be told.
 */
export function endingOf(
    game: ChainGame,
    ending: Pick<EndingTx, "calls"> | null,
    senderSide: number | null,
): GameEnding | null {
    if (game.state.$kind === "Over") return game.state.Over;
    if (!ending) return null;
    const player = (side: number) => game.players[side];
    const calls = ending.calls.filter((call) => call !== CALLS.complete);
    if (calls.includes(CALLS.abandon))
        return senderSide === null ? null : { $kind: "Abandoned", Abandoned: player(senderSide) };
    if (calls.includes(CALLS.nextTurn)) {
        if (isDeploying(game)) {
            const [first, second] = [0, 1].map((side) => squadOf(game, side).length > 0);
            if (!first && !second) return { $kind: "NobodyShowed", NobodyShowed: true };
            if (!first || !second) return { $kind: "NoShow", NoShow: player(first ? 1 : 0) };
            return null;
        }
        if (game.turn + 1 >= MAX_TURNS) return { $kind: "Stalemate", Stalemate: true };
        return { $kind: "Forfeited", Forfeited: player(activeSide(game)) };
    }
    if (calls.length === 0 || senderSide === null) return null;
    return { $kind: "Won", Won: player(senderSide) };
}

/** An event as a transaction carries it: its type and its BCS. */
type TxEvent = { eventType: string; bcs: Uint8Array };

const sameType = (a: string, b: string) => {
    const [pa, ...rest] = a.split("::");
    const [pb, ...restB] = b.split("::");
    try {
        return sameAddress(pa, pb) && rest.join("::") === restB.join("::");
    } catch {
        return false;
    }
};

/**
 * How a game ended, as `complete_game` announced it: the `GameEnded` of `gameId` among a
 * transaction's events (`complete_game` emits it as it deletes the game). Null when the
 * transaction has none for that game. This is the ending itself, not worked out.
 */
export function endingFromEvents(
    events: readonly TxEvent[],
    gameId: string,
    type: string = GAME_ENDED_TYPE,
): GameEnding | null {
    for (const event of events) {
        if (!sameType(event.eventType, type)) continue;
        try {
            const ended = ENDED_EVENT.parse(event.bcs);
            if (sameAddress(ended.game, gameId)) return ended.ending;
        } catch {
            // not this layout: keep looking
        }
    }
    return null;
}

/** The `GameEnded` of a game in the transaction that wrapped it up (`digest`); null when not there or not read. */
export async function fetchGameEnded(
    client: EndingClient,
    digest: string,
    gameId: string,
): Promise<GameEnding | null> {
    try {
        const result = await client.core.getTransaction({ digest, include: { events: true } });
        const events = (result.Transaction ?? result.FailedTransaction)?.events ?? [];
        return endingFromEvents(events, gameId);
    } catch {
        return null;
    }
}
