// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game on chain: reading it, and every action a player can take. All of it is
 * authorized by the player's `Account`, and `Game` is the only thing to read:
 * the two players learn what the other did from its `history`.
 */

import { useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import { GHOSTS } from "../constants";
import { Game, Recruit, type ChainGame } from "./bcs";
import type { Order } from "./fast-lane";
import { useTable } from "./ghosts";
import { useBcsObject } from "./objects";

type Client = ReturnType<typeof useCurrentClient>;

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** Read a game fresh. */
export async function fetchGame(client: Client, id: string): Promise<ChainGame> {
    const { object } = await client.core.getObject({ objectId: id, include: { content: true } });
    return Game.parse(object.content);
}

/** The game, re-read every `refetchInterval` while given. */
export function useGame(id?: string | null, refetchInterval?: number) {
    return useBcsObject({ id, schema: Game, refetchInterval });
}

/** The recruits in a game, of both sides. */
export function useGameRecruits(game?: ChainGame) {
    return useTable("game-recruits", game?.recruits, Recruit);
}

/** Pick the squad: these recruits go on the map, the rest stay in the `Account`. */
export function deploySquadTx(
    gameId: string,
    accountId: string,
    recruitIds: string[],
): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("deploy_squad"),
        arguments: [
            tx.object(gameId),
            tx.object(accountId),
            tx.object.clock(),
            tx.pure.vector("id", recruitIds),
        ],
    });
    return tx;
}

/** The shared objects an order names, resolved once, so sending one takes no lookups. */
export interface GameRefs {
    game: SharedRef;
    /** Read only: an order takes the `Account` to check who is giving it. */
    account: SharedRef;
    clock: SharedRef;
    random: SharedRef;
}

interface SharedRef {
    objectId: string;
    initialSharedVersion: string;
    mutable: boolean;
}

export async function fetchGameRefs(
    client: Client,
    gameId: string,
    accountId: string,
): Promise<GameRefs> {
    const shared = async (id: string, mutable: boolean): Promise<SharedRef> => {
        const objectId = normalizeSuiAddress(id);
        const { owner } = (await client.core.getObject({ objectId })).object;
        if (owner.$kind !== "Shared") throw new Error(`${objectId} is not a shared object`);
        return { objectId, initialSharedVersion: owner.Shared.initialSharedVersion, mutable };
    };
    const [game, account, clock, random] = await Promise.all([
        shared(gameId, true),
        shared(accountId, false),
        shared("0x6", false),
        shared("0x8", false),
    ]);
    return { game, account, clock, random };
}

/** Walk a unit along a path, as `encodePath` lays it out. */
export const moveUnitOrder =
    (refs: GameRefs, path: number[]): Order =>
    (tx) => {
        tx.moveCall({
            target: target("move_unit"),
            arguments: [
                tx.sharedObjectRef(refs.game),
                tx.sharedObjectRef(refs.account),
                tx.sharedObjectRef(refs.clock),
                tx.pure.vector("u8", path),
            ],
        });
    };

export const reloadOrder =
    (refs: GameRefs, [row, col]: [number, number]): Order =>
    (tx) => {
        tx.moveCall({
            target: target("perform_reload"),
            arguments: [
                tx.sharedObjectRef(refs.game),
                tx.sharedObjectRef(refs.account),
                tx.sharedObjectRef(refs.clock),
                tx.pure.u16(row),
                tx.pure.u16(col),
            ],
        });
    };

/** Take up the weapon lying on the unit's tile. */
export const pickUpOrder =
    (refs: GameRefs, [row, col]: [number, number]): Order =>
    (tx) => {
        tx.moveCall({
            target: target("pick_up_weapon"),
            arguments: [
                tx.sharedObjectRef(refs.game),
                tx.sharedObjectRef(refs.account),
                tx.sharedObjectRef(refs.clock),
                tx.pure.u16(row),
                tx.pure.u16(col),
            ],
        });
    };

/** Fire from one tile at another, or throw a grenade; the dice roll on chain. */
export const strikeOrder =
    (
        action: "perform_attack" | "perform_grenade",
        refs: GameRefs,
        from: [number, number],
        to: [number, number],
    ): Order =>
    (tx) => {
        tx.moveCall({
            target: target(action),
            arguments: [
                tx.sharedObjectRef(refs.game),
                tx.sharedObjectRef(refs.account),
                tx.sharedObjectRef(refs.random),
                tx.sharedObjectRef(refs.clock),
                tx.pure.u16(from[0]),
                tx.pure.u16(from[1]),
                tx.pure.u16(to[0]),
                tx.pure.u16(to[1]),
            ],
        });
    };

export const nextTurnOrder =
    (refs: GameRefs): Order =>
    (tx) => {
        tx.moveCall({
            target: target("next_turn"),
            arguments: [
                tx.sharedObjectRef(refs.game),
                tx.sharedObjectRef(refs.account),
                tx.sharedObjectRef(refs.clock),
            ],
        });
    };

/** End the turn: the player's own at any time, the other's once it ran out of time. */
export function nextTurnTx(gameId: string, accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("next_turn"),
        arguments: [tx.object(gameId), tx.object(accountId), tx.object.clock()],
    });
    return tx;
}

/**
 * Wrap up a game that is over: survivors and dog tags go home, the result goes on
 * both scores, both `Account`s are `Idle` again, whoever misbehaved is suspended
 * and the `Game` is deleted. Anyone can send this; `players` are in the game's order.
 */
function completeGame(tx: Transaction, gameId: string, players: string[]) {
    tx.moveCall({
        target: target("complete_game"),
        arguments: [
            tx.object(gameId),
            tx.object(players[0]),
            tx.object(players[1]),
            tx.object.clock(),
        ],
    });
}

export function completeGameTx(gameId: string, players: string[]): Transaction {
    const tx = new Transaction();
    completeGame(tx, gameId, players);
    return tx;
}

/** Give up a running game: it ends for both, and the `Account` is suspended for a minute. */
export function abandonGameTx(gameId: string, accountId: string, players: string[]): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("abandon_game"),
        arguments: [tx.object(gameId), tx.object(accountId)],
    });
    completeGame(tx, gameId, players);
    return tx;
}
