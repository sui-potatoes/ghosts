// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The leaderboard: the registry records and `Account`s from bytes laid out as
 * the Move structs are (`ghosts::account`), the capped read, the order and its
 * ties, the displayed tier with the placement floor (`rules::tier_of`), the
 * distribution, the own row and the cursor's order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { inlineConfirm } from "../src/ui/focus-store.ts";

import {
    parseAccount,
    parseRegistryEntry,
    readAccounts,
    readLeaderAccounts,
    readRegistry,
    REGISTRY_PAGE,
    type LeaderboardClient,
} from "../src/chain/leaderboard.ts";
import { tierIndex } from "../src/chain/ranked-core.ts";
import type { ChainRules } from "../src/chain/bcs.ts";
import {
    barShare,
    compareRows,
    displayedTier,
    distribution,
    EMPTY_ID,
    focusOrder,
    OWN_ID,
    ownLine,
    rankRows,
    rowCommands,
    recordText,
    REFRESH_ID,
    rowHint,
    rowId,
    startTarget,
    type NamedAccount,
} from "../src/features/leaderboard/model.ts";

// === Bytes as the Move layout has them =====================================

const addr = (byte: number) => new Uint8Array(32).fill(byte);
const hex = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;

function u64(n: number | bigint): Uint8Array {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
    return out;
}
function u16(n: number): Uint8Array {
    return new Uint8Array([n & 0xff, n >> 8]);
}
const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};

/**
 * `Account { id, owner, state, recruits, rating: Rating { rating, deviation, games,
 * last_played_ms }, score: Score { wins, losses, draws }, suspended_until, resets,
 * last_reset_ms }`, `state` Idle (tag 0) or `Playing(ID)` (tag 2).
 */
function accountBytes(o: {
    id: number;
    owner: number;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    playing?: number;
}): Uint8Array {
    const state =
        o.playing === undefined ? new Uint8Array([0]) : cat(new Uint8Array([2]), addr(o.playing));
    return cat(
        addr(o.id),
        addr(o.owner),
        state,
        u64(3),
        u64(o.rating),
        u64(120),
        u64(o.wins + o.losses + o.draws),
        u64(1_700_000_000_000),
        u64(o.wins),
        u64(o.losses),
        u64(o.draws),
        u64(0),
        u16(1),
        u64(0),
    );
}

test("a registry record is the owner (name) and the Account ID (value)", () => {
    assert.deepEqual(parseRegistryEntry(addr(0xa1), addr(0xb2)), {
        owner: hex(0xa1),
        accountId: hex(0xb2),
    });
    assert.equal(parseRegistryEntry(addr(1).subarray(0, 31), addr(2)), null);
    assert.equal(parseRegistryEntry(addr(1), new Uint8Array(0)), null);
});

test("an Account decodes from its Move layout, idle or in a game", () => {
    const idle = parseAccount(
        accountBytes({ id: 7, owner: 8, rating: 1522, wins: 2, losses: 2, draws: 1 }),
    );
    assert.deepEqual(idle, {
        accountId: hex(7),
        owner: hex(8),
        rating: 1522,
        wins: 2,
        losses: 2,
        draws: 1,
        games: 5,
    });
    const playing = parseAccount(
        accountBytes({
            id: 9,
            owner: 10,
            rating: 1300,
            wins: 0,
            losses: 1,
            draws: 0,
            playing: 0x33,
        }),
    );
    assert.equal(playing.rating, 1300);
    assert.equal(playing.games, 1);
});

// === The capped read =======================================================

/** A registry of `count` records, `limit` a page, served like `ListDynamicFields`. */
function fakeClient(count: number, accounts: Map<string, Uint8Array> = new Map()) {
    const calls = { pages: [] as number[], batches: [] as number[], objects: 0 };
    const client: LeaderboardClient = {
        async listDynamicFields({ limit = 50, cursor }) {
            const from = cursor ? Number(cursor) : 0;
            const size = Math.min(limit, REGISTRY_PAGE);
            calls.pages.push(size);
            const to = Math.min(count, from + size);
            const dynamicFields = [];
            for (let i = from; i < to; i++)
                dynamicFields.push({
                    name: { bcs: addr(i % 256) },
                    value: { bcs: addr((i + 1) % 256) },
                });
            const more = to < count;
            return { dynamicFields, cursor: more ? String(to) : null, hasNextPage: more };
        },
        core: {
            async getObject() {
                calls.objects++;
                // `Registry { id, accounts: Table { id, size }, visual_presets: [] }`
                return {
                    object: {
                        content: cat(addr(0xee), addr(0xdd), u64(count), new Uint8Array([0])),
                    },
                };
            },
            async getObjects({ objectIds }) {
                calls.batches.push(objectIds.length);
                return {
                    objects: objectIds
                        .map((id) => accounts.get(id) ?? new Error("not found"))
                        .map((c) => (c instanceof Error ? c : { content: c })),
                };
            },
        },
    };
    return { client, calls };
}

test("the registry is paged to the end when it is under the cap", async () => {
    const { client, calls } = fakeClient(2500);
    const read = await readRegistry(client, "0xtable", 10_000);
    assert.equal(read.entries.length, 2500);
    assert.equal(read.capped, false);
    assert.deepEqual(calls.pages, [1000, 1000, 1000]);
});

test("the read stops at the cap and says records were left", async () => {
    const { client, calls } = fakeClient(10_000);
    const read = await readRegistry(client, "0xtable", 3000);
    assert.equal(read.entries.length, 3000);
    assert.equal(read.capped, true);
    assert.deepEqual(calls.pages, [1000, 1000, 1000]);
    // A cap that is not a page multiple asks only for what is left.
    const { client: c2, calls: k2 } = fakeClient(10_000);
    const part = await readRegistry(c2, "0xtable", 1500);
    assert.equal(part.entries.length, 1500);
    assert.deepEqual(k2.pages, [1000, 500]);
    // Exactly the cap and nothing more: not capped.
    const exact = await readRegistry(fakeClient(3000).client, "0xtable", 3000);
    assert.equal(exact.capped, false);
});

test("Accounts are read in batches of 50; one that does not read is left out", async () => {
    const accounts = new Map<string, Uint8Array>();
    for (let i = 1; i <= 120; i++)
        if (i !== 5)
            accounts.set(
                hex(i),
                accountBytes({ id: i, owner: i, rating: 1500, wins: 1, losses: 0, draws: 0 }),
            );
    const { client, calls } = fakeClient(0, accounts);
    const read = await readAccounts(
        client,
        Array.from({ length: 120 }, (_, i) => hex(i + 1)),
    );
    assert.equal(read.length, 119);
    assert.deepEqual(calls.batches, [50, 50, 20]);
    assert.ok(!read.some((a) => a.accountId === hex(5)));
});

test("one load: registry, its records, the Accounts behind them", async () => {
    const accounts = new Map<string, Uint8Array>();
    for (let i = 1; i <= 3; i++)
        accounts.set(
            hex(i),
            accountBytes({ id: i, owner: i - 1, rating: 1400 + i, wins: i, losses: 0, draws: 0 }),
        );
    const { client } = fakeClient(3, accounts);
    const load = await readLeaderAccounts(client, "0xregistry");
    assert.equal(load.accounts.length, 3);
    assert.equal(load.capped, false);
    assert.equal(load.requests, 3);
});

// === Tiers =================================================================

const TIERS = [
    { name: "Rookie", min: 0 },
    { name: "Contractor", min: 1400 },
    { name: "Operative", min: 1650 },
    { name: "Elite", min: 1900 },
];
const PLACEMENT = { games: 5, tier: 1 };

test("the displayed tier is rules::tier_of, the placement floor included", () => {
    assert.equal(displayedTier(TIERS, PLACEMENT, 1332, 3), 1, "placing: lifted to Contractor");
    assert.equal(displayedTier(TIERS, PLACEMENT, 1332, 5), 0, "placed: Rookie by rating");
    assert.equal(
        displayedTier(TIERS, PLACEMENT, 1867, 3),
        2,
        "placing above the floor keeps the rating's tier",
    );
    assert.equal(displayedTier(TIERS, PLACEMENT, 1900, 40), 3);
    assert.equal(displayedTier(TIERS, PLACEMENT, 1899, 40), 2);
    // Same as the contract's arithmetic the match screen uses.
    const rules = {
        tiers: TIERS.map((t) => ({ minRating: String(t.min), budgets: [] })),
        placementGames: 5,
        placementTier: 1,
    } as unknown as ChainRules;
    for (const [rating, games] of [
        [0, 0],
        [1399, 4],
        [1399, 5],
        [1650, 1],
        [2400, 9],
    ])
        assert.equal(
            displayedTier(TIERS, PLACEMENT, rating, games),
            tierIndex(rules, rating, games),
        );
});

// === The table =============================================================

const acc = (
    id: number,
    name: string,
    rating: number,
    w: number,
    l: number,
    d = 0,
): NamedAccount => ({
    accountId: hex(id),
    owner: hex(id + 100),
    name,
    rating,
    wins: w,
    losses: l,
    draws: d,
    games: w + l + d,
});

test("ordered by rating, ties by fewer games, then name; unranked accounts left out", () => {
    const rows = rankRows(
        [
            acc(1, "ai-pia", 1413, 1, 2),
            acc(2, "ai-yak", 1867, 3, 0),
            acc(3, "zed", 1500, 2, 2),
            acc(4, "amy", 1500, 2, 2),
            acc(5, "bo", 1500, 1, 1),
            acc(6, "ghoul", 1500, 0, 0),
        ],
        TIERS,
        PLACEMENT,
        null,
    );
    assert.deepEqual(
        rows.map((r) => [r.rank, r.name]),
        [
            [1, "ai-yak"],
            [2, "bo"],
            [3, "amy"],
            [4, "zed"],
            [5, "ai-pia"],
        ],
    );
    assert.ok(!rows.some((r) => r.name === "ghoul"), "no finished ranked match: not on the table");
    assert.equal(
        compareRows(acc(1, "a", 1500, 1, 0), acc(2, "a", 1500, 1, 0)) < 0,
        true,
        "last tie: the id",
    );
});

test("the distribution counts the displayed tiers; games are half the games", () => {
    // The testnet table as read: five placing players under 1650, one at 1867.
    const rows = rankRows(
        [
            acc(1, "ai-ridge", 1522, 2, 2),
            acc(2, "ai-wanda", 1421, 2, 3),
            acc(3, "ai-pia", 1413, 1, 2),
            acc(4, "ai-screw", 1433, 2, 2),
            acc(5, "ai-turtle", 1332, 1, 2),
            acc(6, "ai-yak", 1867, 3, 0),
        ],
        TIERS,
        PLACEMENT,
        null,
    );
    const d = distribution(rows, TIERS);
    assert.deepEqual(
        d.tiers.map((t) => t.players),
        [0, 5, 1, 0],
        "ai-turtle at 1332 with 3 matches is matched as a Contractor",
    );
    assert.equal(d.ranked, 6);
    assert.equal(d.matches, 11);
    assert.equal(barShare(5, d), 1);
    assert.equal(barShare(1, d), 0.2);
    assert.equal(barShare(0, distribution([], TIERS)), 0);
    // Placed for good: the same rating falls to Rookie.
    const placed = rankRows([acc(5, "ai-turtle", 1332, 3, 3)], TIERS, PLACEMENT, null);
    assert.deepEqual(
        distribution(placed, TIERS).tiers.map((t) => t.players),
        [1, 0, 0, 0],
    );
});

test("the signed-in player's row is marked, and the line above leads to it", () => {
    const accounts = [acc(1, "a", 1600, 3, 1), acc(2, "b", 1500, 1, 1), acc(3, "c", 1500, 0, 0)];
    const mine = rankRows(accounts, TIERS, PLACEMENT, hex(2));
    assert.deepEqual(
        mine.map((r) => r.own),
        [false, true],
    );
    assert.deepEqual(ownLine(true, mine), { kind: "ranked", rank: 2, rowId: rowId(mine[1]) });
    // Signed in with an Account that has no ranked match: not ranked yet.
    const unranked = rankRows(accounts, TIERS, PLACEMENT, hex(3));
    assert.ok(unranked.every((r) => !r.own));
    assert.deepEqual(ownLine(true, unranked), { kind: "unranked" });
    // Signed in before the Account is known, or signed out.
    assert.deepEqual(ownLine(true, rankRows(accounts, TIERS, PLACEMENT, null)), {
        kind: "unranked",
    });
    assert.deepEqual(ownLine(false, mine), { kind: "signed-out" });
});

test("row texts: the record and the bar's line name every number", () => {
    assert.equal(recordText({ wins: 3, losses: 1, draws: 0 }), "3 won · 1 lost · 0 drawn");
    const [row] = rankRows([acc(1, "ai-yak", 1867, 3, 0)], TIERS, PLACEMENT, null);
    assert.equal(rowHint(row, TIERS), "Rank 1 · Operative · Rating 1867 · 3 ranked matches");
    const [one] = rankRows([acc(1, "x", 1500, 1, 0)], TIERS, PLACEMENT, null);
    assert.match(rowHint(one, TIERS), /1 ranked match$/);
});

test("the cursor's order: own line, rows, Refresh; it starts on the first row", () => {
    const rows = rankRows(
        [acc(1, "a", 1600, 1, 0), acc(2, "b", 1500, 1, 0)],
        TIERS,
        PLACEMENT,
        hex(2),
    );
    assert.deepEqual(focusOrder(ownLine(true, rows), rows), [
        OWN_ID,
        rowId(rows[0]),
        rowId(rows[1]),
        REFRESH_ID,
    ]);
    assert.deepEqual(focusOrder(null, rows), [rowId(rows[0]), rowId(rows[1]), REFRESH_ID]);
    assert.deepEqual(focusOrder(null, []), [EMPTY_ID, REFRESH_ID]);
    assert.equal(startTarget(rows), rowId(rows[0]));
    assert.equal(startTarget([]), EMPTY_ID);
    assert.equal(new Set(rows.map(rowId)).size, rows.length);
});

test("a table row carries only its own primary inline; Refresh stays a bar command", () => {
    const refresh = { action: "reset" as const, label: "Refresh" };
    const commands = rowCommands(() => {}, refresh);
    assert.ok(commands.includes(refresh), "the bar still lists Refresh");
    assert.equal(inlineConfirm(commands, { armed: false, offered: false }), undefined);
    const armed = inlineConfirm(commands, { armed: true, offered: false });
    assert.equal(armed?.label, "View on explorer");
});
