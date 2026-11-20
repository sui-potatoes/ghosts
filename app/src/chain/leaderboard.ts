// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every player's `Account`, for the leaderboard. The shared `Registry` keeps
 * `accounts: Table<address, ID>` (owner to `Account` ID); its records are
 * dynamic fields of the table, so one gRPC `ListDynamicFields` page with the
 * values (up to `REGISTRY_PAGE` records) gives owners and Account IDs at once,
 * and the Accounts are then read in batches of `ACCOUNT_BATCH`. The read stops
 * after `REGISTRY_CAP` records: the table lists in field-id order, not by
 * rating, so past the cap a player may be missing; the cap bounds every load.
 *
 * No React, no constants: the client and the ids come in, so a node script
 * and the tests run the same code (`tests/leaderboard.test.ts`).
 */

import { bcs } from "@mysten/sui/bcs";

import { Account, Registry } from "./bcs.ts";

/** Records a `ListDynamicFields` page asks for: the node's largest page. */
export const REGISTRY_PAGE = 1000;
/** The registry records one load reads at most. */
export const REGISTRY_CAP = 3000;
/** Accounts per `BatchGetObjects` call, and how many such calls are in flight. */
export const ACCOUNT_BATCH = 50;
export const ACCOUNT_LANES = 4;

/** One `Registry.accounts` record: the owner and its `Account`. */
export type RegistryEntry = { owner: string; accountId: string };

/** An `Account` as the leaderboard reads it. */
export type LeaderAccount = {
    accountId: string;
    owner: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    /** Ranked games finished: the score's total, what `rules::tier_of` is given. */
    games: number;
};

/** The parts of `SuiGrpcClient` read here. */
export interface LeaderboardClient {
    listDynamicFields(input: {
        parentId: string;
        limit?: number;
        cursor?: string | null;
        include: { value: true };
    }): Promise<{
        dynamicFields: { name: { bcs: Uint8Array }; value?: { bcs: Uint8Array } }[];
        cursor: string | null;
        hasNextPage: boolean;
    }>;
    core: {
        getObject(input: {
            objectId: string;
            include: { content: true };
        }): Promise<{ object: { content: Uint8Array } }>;
        getObjects(input: {
            objectIds: string[];
            include: { content: true };
        }): Promise<{ objects: ({ content: Uint8Array } | Error)[] }>;
    };
}

/** A `Field<address, ID>` record from its name and value bytes; null when they are not one. */
export function parseRegistryEntry(name: Uint8Array, value: Uint8Array): RegistryEntry | null {
    if (name.length !== 32 || value.length !== 32) return null;
    return { owner: bcs.Address.parse(name), accountId: bcs.Address.parse(value) };
}

/** An `Account`'s content as the leaderboard needs it. */
export function parseAccount(content: Uint8Array): LeaderAccount {
    const a = Account.parse(content);
    const wins = Number(a.score.wins);
    const losses = Number(a.score.losses);
    const draws = Number(a.score.draws);
    return {
        accountId: a.id,
        owner: a.owner,
        rating: Number(a.rating.rating),
        wins,
        losses,
        draws,
        games: wins + losses + draws,
    };
}

/** The id of the `Registry`'s accounts table. */
export async function accountsTable(client: LeaderboardClient, registry: string): Promise<string> {
    const { object } = await client.core.getObject({
        objectId: registry,
        include: { content: true },
    });
    return Registry.parse(object.content).accounts.id;
}

/**
 * The table's records, a page at a time, stopping at `cap`. `capped` is true
 * when records were left unread.
 */
export async function readRegistry(
    client: LeaderboardClient,
    table: string,
    cap = REGISTRY_CAP,
): Promise<{ entries: RegistryEntry[]; capped: boolean; pages: number }> {
    const entries: RegistryEntry[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
        const page = await client.listDynamicFields({
            parentId: table,
            limit: Math.min(REGISTRY_PAGE, cap - entries.length),
            cursor,
            include: { value: true },
        });
        pages++;
        for (const field of page.dynamicFields) {
            if (entries.length >= cap) break;
            const entry = field.value && parseRegistryEntry(field.name.bcs, field.value.bcs);
            if (entry) entries.push(entry);
        }
        if (!page.hasNextPage || !page.cursor) return { entries, capped: false, pages };
        if (entries.length >= cap) return { entries, capped: true, pages };
        cursor = page.cursor;
    }
}

/** Run `work` over `items` with at most `lanes` in flight, results in order. */
export async function inLanes<T, R>(
    items: readonly T[],
    lanes: number,
    work: (item: T) => Promise<R>,
): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await work(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, lane));
    return out;
}

/** The Accounts behind registry records, read in batches; one that does not read is left out. */
export async function readAccounts(
    client: LeaderboardClient,
    ids: readonly string[],
): Promise<LeaderAccount[]> {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += ACCOUNT_BATCH)
        batches.push(ids.slice(i, i + ACCOUNT_BATCH));
    const read = await inLanes(batches, ACCOUNT_LANES, async (objectIds) => {
        const { objects } = await client.core.getObjects({ objectIds, include: { content: true } });
        return objects.flatMap((o) => {
            if (o instanceof Error) return [];
            try {
                return [parseAccount(o.content)];
            } catch {
                return [];
            }
        });
    });
    return read.flat();
}

/** One load: the table id, the records up to the cap, every Account behind them. */
export async function readLeaderAccounts(
    client: LeaderboardClient,
    registry: string,
    cap = REGISTRY_CAP,
): Promise<{ accounts: LeaderAccount[]; capped: boolean; requests: number }> {
    const table = await accountsTable(client, registry);
    const { entries, capped, pages } = await readRegistry(client, table, cap);
    const accounts = await readAccounts(
        client,
        entries.map((e) => e.accountId),
    );
    return {
        accounts,
        capped,
        requests: 1 + pages + Math.ceil(entries.length / ACCOUNT_BATCH),
    };
}
