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

import type { ChainGame } from "./bcs.ts";
import { activeSide, isDeploying, isOver, squadOf, type Outcome } from "./match-rules.ts";

/** `MAX_TURNS` in `ghosts::ghosts`: the turn a game that goes nowhere ends on. */
const MAX_TURNS = 60;

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
