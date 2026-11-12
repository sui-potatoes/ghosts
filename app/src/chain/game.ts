// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game on chain: reading it, and every action a player can take. All of it is
 * authorized by the player's `Account`, and `Game` is the only thing to read:
 * the two players learn what the other did from its `history`.
 */

import { useCurrentClient } from "@mysten/dapp-kit-react";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { useQuery } from "@tanstack/react-query";

import { GHOSTS } from "../constants";
import { Game, Recruit, type ChainGame } from "./bcs";
import type { Order } from "./fast-lane";
import type { ChainRecruit } from "./ghosts";
import { acceptSeat, type ChainSeat } from "./matchmaking";
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

/** `sui::dynamic_field::Field<ID, Recruit>`: one entry of a game's `Table` of recruits. */
const RecruitField = bcs.struct("Field", { id: bcs.Address, name: bcs.Address, value: Recruit });

/**
 * Every recruit in a game's `Table`, decoded from the dynamic fields holding them.
 * `size` is the table's length as the game reports it: a listing a moment behind
 * is read again until it catches up.
 */
async function fetchGameRecruits(
    client: Client,
    tableId: string,
    size: number,
): Promise<ChainRecruit[]> {
    for (let attempt = 0; ; attempt++) {
        const fields: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await client.core.listDynamicFields({ parentId: tableId, cursor });
            fields.push(...page.dynamicFields.map((field) => field.fieldId));
            cursor = page.hasNextPage ? (page.cursor ?? undefined) : undefined;
        } while (cursor);
        if (fields.length >= size || attempt === 5) {
            if (!fields.length) return [];
            const { objects } = await client.core.getObjects({
                objectIds: fields,
                include: { content: true },
            });
            return objects.flatMap((object) => {
                if (object instanceof Error) return [];
                const { value } = RecruitField.parse(object.content);
                return [{ ...value, objectId: value.id }];
            });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

/** The recruits in a game, of both sides. */
export function useGameRecruits(game?: ChainGame) {
    const client = useCurrentClient();
    const table = game?.recruits;
    return useQuery({
        queryKey: ["ghosts", "game-recruits", table?.id, table?.size],
        enabled: !!table,
        placeholderData: (previous) => previous,
        queryFn: () => fetchGameRecruits(client, table!.id, Number(table!.size)),
    });
}

/**
 * Pick the squad: these recruits are received from the `Account` onto the map, the
 * rest stay home. Each goes in by its id; the fast lane passes it by its newest
 * reference.
 */
export function deploySquadTx(
    gameId: string,
    accountId: string,
    recruitIds: string[],
): Transaction {
    const tx = new Transaction();
    const recruits = tx.makeMoveVec({
        type: `0x2::transfer::Receiving<${GHOSTS.package}::recruit::Recruit>`,
        elements: recruitIds.map((id) => tx.object(id)),
    });
    tx.moveCall({
        target: target("deploy_squad"),
        arguments: [tx.object(gameId), tx.object(accountId), tx.object.clock(), recruits],
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

/** A seat in the game its player never accepted, and whose `Account` it is in. */
export type PendingSeat = { accountId: string; seat: ChainSeat["ref"] };

/**
 * Wrap up a game that is over: survivors go home, the result goes on
 * both scores, both `Account`s are `Idle` again, whoever misbehaved is suspended
 * and the `Game` is deleted. Anyone can send this; `players` are in the game's order.
 * A seat its player never accepted is accepted first: wrapping up needs both in.
 */
function completeGame(tx: Transaction, gameId: string, players: string[], pending: PendingSeat[]) {
    for (const { accountId, seat } of pending) acceptSeat(tx, accountId, seat);
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

export function completeGameTx(
    gameId: string,
    players: string[],
    pending: PendingSeat[] = [],
): Transaction {
    const tx = new Transaction();
    completeGame(tx, gameId, players, pending);
    return tx;
}

/**
 * Give up a running game: it ends for both, and the `Account` is suspended for a
 * minute. The player's own seat, still pending, is accepted first.
 */
export function abandonGameTx(
    gameId: string,
    accountId: string,
    players: string[],
    pending: PendingSeat[] = [],
): Transaction {
    const tx = new Transaction();
    const own = pending.filter((p) => p.accountId === accountId);
    for (const { seat } of own) acceptSeat(tx, accountId, seat);
    tx.moveCall({
        target: target("abandon_game"),
        arguments: [tx.object(gameId), tx.object(accountId)],
    });
    completeGame(
        tx,
        gameId,
        players,
        pending.filter((p) => p.accountId !== accountId),
    );
    return tx;
}
