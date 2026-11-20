// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly lobbies on chain: the reads (where the player's `Account` stands,
 * the listed lobbies, the host behind an invite code, the level's spawn count)
 * and the seven calls of `ghosts::ghosts`' `// === Friendly ===` section, sent
 * like every other game write (`useGhostsAction`: the fast lane, gas from the
 * balance, the funds top-up first). The pure rules are `lobby-core.ts`.
 *
 * A lobby lives as a dynamic field on the shared `Lobbies`; the `Account` that
 * hosts or waits in one is `Searching` with the lobby's key as its order, so the
 * `Account` alone says where a player is after a reload. Only an invite code's
 * text is kept on the host's device (`sessionStorage`), never in a URL.
 */

import { useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import { useQuery } from "@tanstack/react-query";

import { GHOSTS } from "../constants";
import { Account, LobbyField, Preset } from "./bcs";
import type { ChainAccount } from "./ghosts";
import {
    isExpired,
    lobbyFieldId,
    keyType,
    placeOf,
    protectedKey,
    type LobbyRead,
    type Place,
} from "./lobby-core";

type Client = ReturnType<typeof useCurrentClient>;

/** How often a host re-reads its lobby for a guest arriving or leaving. */
const LOBBY_POLL_MS = 2_000;
/** How often the open list is re-read while it is on screen. */
const LIST_POLL_MS = 5_000;

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** Whether this build knows where the lobbies are. */
export const lobbiesEnabled = !!GHOSTS.lobbies;

const fieldId = (kind: "Open" | "Protected", key: string) =>
    lobbyFieldId(GHOSTS.lobbies, GHOSTS.package, kind, key);

const toRead = (value: ReturnType<typeof LobbyField.parse>["value"]): LobbyRead => ({
    size: value.size,
    guest: value.guest ?? null,
    kicked: value.kicked,
});

// === Reads ==================================================================

/** The lobby under a key, or null where there is none. */
export async function fetchLobby(
    client: Client,
    kind: "Open" | "Protected",
    key: string,
): Promise<LobbyRead | null> {
    const { objects } = await client.core.getObjects({
        objectIds: [fieldId(kind, key)],
        include: { content: true },
    });
    const object = objects[0];
    if (!object || object instanceof Error) return null;
    return toRead(LobbyField.parse(object.content).value);
}

/** Where an `Account` that is `Searching { order }` stands: both lobby fields its order could name, read at once. */
async function fetchPlace(client: Client, accountId: string, order: string): Promise<Place> {
    const { objects } = await client.core.getObjects({
        objectIds: [fieldId("Open", order), fieldId("Protected", order)],
        include: { content: true },
    });
    const [open, invite] = objects.map((o) =>
        !o || o instanceof Error ? null : toRead(LobbyField.parse(o.content).value),
    );
    return placeOf(accountId, order, open, invite);
}

/**
 * Where the player stands while their `Account` is `Searching`: a lobby (host
 * or guest) or the queue. Re-read while it is a lobby the player hosts, so the
 * guest shows up; undefined while it is read, null while not `Searching`.
 */
export function useLobbyPlace(accountId?: string | null, account?: ChainAccount) {
    const client = useCurrentClient();
    const order = account?.state.$kind === "Searching" ? account.state.Searching.order : null;
    const query = useQuery({
        queryKey: ["ghosts", "lobby-place", accountId, order],
        enabled: lobbiesEnabled && !!accountId && !!order,
        refetchInterval: (q) => (q.state.data?.kind === "host-open" ? LOBBY_POLL_MS : false),
        refetchIntervalInBackground: true,
        queryFn: () => fetchPlace(client, accountId!, order!),
    });
    if (!order) return null;
    return query.data;
}

/** A listed lobby as the open list shows it. */
export type OpenLobby = {
    /** The host's `Account` ID: the lobby's key. */
    hostId: string;
    /** The host's address, for their name. */
    owner: string;
    rating: number;
    size: number;
    /** The guest slot is taken. */
    full: boolean;
    /** When the host opened it: the lifetime runs from here. */
    sinceMs: number;
};

/** Every field of `Lobbies` whose key is `Open`: paged through, keys only. */
async function listOpenKeys(client: Client): Promise<{ fieldId: string; hostId: string }[]> {
    const open = keyType(GHOSTS.package, "Open");
    const found: { fieldId: string; hostId: string }[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.core.listDynamicFields({ parentId: GHOSTS.lobbies, cursor });
        for (const field of page.dynamicFields) {
            if (normalizeStructTag(field.name.type) !== open) continue;
            found.push({
                fieldId: field.fieldId,
                hostId: normalizeSuiAddress(`0x${toHexBytes(field.name.bcs)}`),
            });
        }
        cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);
    return found;
}

const toHexBytes = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** `getObjects` in slices the node accepts. */
async function getMany(client: Client, ids: string[]) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const { objects } = await client.core.getObjects({
            objectIds: ids.slice(i, i + 50),
            include: { content: true },
        });
        out.push(...objects);
    }
    return out;
}

/**
 * The listed lobbies still open: each lobby and its host's `Account` (rating, and
 * since when it waits, which the lifetime runs from). Expired lobbies and any
 * whose host is no longer in them are left out; oldest first.
 */
export async function fetchOpenLobbies(client: Client, now = Date.now()): Promise<OpenLobby[]> {
    const keys = await listOpenKeys(client);
    if (!keys.length) return [];
    const [fields, hosts] = await Promise.all([
        getMany(
            client,
            keys.map((k) => k.fieldId),
        ),
        getMany(
            client,
            keys.map((k) => k.hostId),
        ),
    ]);
    const lobbies: OpenLobby[] = [];
    keys.forEach(({ hostId }, i) => {
        const field = fields[i];
        const host = hosts[i];
        if (!field || field instanceof Error || !host || host instanceof Error) return;
        const lobby = LobbyField.parse(field.content).value;
        const account = Account.parse(host.content);
        if (account.state.$kind !== "Searching") return;
        if (normalizeSuiAddress(account.state.Searching.order) !== hostId) return;
        const sinceMs = Number(account.state.Searching.sinceMs);
        if (isExpired(sinceMs, now)) return;
        lobbies.push({
            hostId,
            owner: account.owner,
            rating: Number(account.rating.rating),
            size: lobby.size,
            full: lobby.guest !== null && lobby.guest !== undefined,
            sinceMs,
        });
    });
    return lobbies.sort((a, b) => a.sinceMs - b.sinceMs);
}

/** The open list, re-read every few seconds while `on`, and when the window regains focus. */
export function useOpenLobbies(on: boolean) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["ghosts", "open-lobbies"],
        enabled: lobbiesEnabled && on,
        refetchInterval: on ? LIST_POLL_MS : false,
        refetchOnWindowFocus: true,
        placeholderData: (previous) => previous,
        queryFn: () => fetchOpenLobbies(client),
    });
}

/** What a code leads to: the host's `Account` and since when it waits, or why it leads nowhere. */
export type InviteHost =
    | { ok: true; hostId: string; sinceMs: number; size: number; own: boolean }
    | { ok: false; message: string };

/**
 * The host behind an invite code. A protected lobby holds only its size, and the
 * key is a hash: the way to its host is the transaction that filed it. A
 * protected field is written once, by `open_lobby`, and only removed after, so
 * the field's previous transaction is that call, and the `Account` it wrote
 * whose search order is the key is the host. Three reads: the field, the
 * transaction's effects with object types, the `Account`s it wrote.
 */
export async function findInviteHost(
    client: Client,
    code: Uint8Array,
    ownAccountId: string | null,
    now = Date.now(),
): Promise<InviteHost> {
    const none = { ok: false, message: "No game with this code" } as const;
    const key = protectedKey(code);
    const { objects } = await client.core.getObjects({
        objectIds: [fieldId("Protected", key)],
        include: { content: true, previousTransaction: true },
    });
    const field = objects[0];
    if (!field || field instanceof Error || !field.previousTransaction) return none;
    const size = LobbyField.parse(field.content).value.size;

    const opened = await client.core.getTransaction({
        digest: field.previousTransaction,
        include: { effects: true, objectTypes: true },
    });
    const tx = opened.Transaction ?? opened.FailedTransaction;
    const accountType = normalizeStructTag(`${GHOSTS.package}::account::Account`);
    const written = (tx?.effects?.changedObjects ?? [])
        .filter((c) => c.outputState === "ObjectWrite")
        .map((c) => c.objectId)
        .filter((id) => {
            const type = tx?.objectTypes?.[id];
            return type !== undefined && normalizeStructTag(type) === accountType;
        });
    if (!written.length) return none;

    const accounts = await getMany(client, written);
    for (const object of accounts) {
        if (!object || object instanceof Error) continue;
        const account = Account.parse(object.content);
        if (account.state.$kind !== "Searching") continue;
        if (normalizeSuiAddress(account.state.Searching.order) !== normalizeSuiAddress(key))
            continue;
        const sinceMs = Number(account.state.Searching.sinceMs);
        if (isExpired(sinceMs, now)) return { ok: false, message: "This game has expired" };
        const hostId = normalizeSuiAddress(account.id);
        const own = !!ownAccountId && normalizeSuiAddress(ownAccountId) === hostId;
        return { ok: true, hostId, sinceMs, size, own };
    }
    return none;
}

/** How many spawn positions a side has on the level games start on: the most a side can deploy. */
export function usePresetSide() {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["ghosts", "preset-side", GHOSTS.preset],
        enabled: !!GHOSTS.preset,
        staleTime: Infinity,
        queryFn: async () => {
            const { object } = await client.core.getObject({
                objectId: GHOSTS.preset,
                include: { content: true },
            });
            return Math.floor(Preset.parse(object.content).positions.length / 2);
        },
    });
}

// === Code on this device ====================================================

const CODE_KEY = "ghosts:lobby-code:";

/** Keep the code text of the lobby this device opened, under its key, for this session. */
export function keepCode(key: string, text: string) {
    try {
        window.sessionStorage.setItem(CODE_KEY + normalizeSuiAddress(key), text);
    } catch {
        // Storage may be unavailable: the code is then shown only until a reload.
    }
}

/** The code text this device opened the lobby under `key` with, or null. */
export function keptCode(key: string): string | null {
    try {
        return window.sessionStorage.getItem(CODE_KEY + normalizeSuiAddress(key));
    } catch {
        return null;
    }
}

// === Writes =================================================================

/** Open a lobby: listed without a code hash, invite-only with one. */
export function openLobbyTx(accountId: string, size: number, hash: string | null): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("open_lobby"),
        arguments: [
            tx.object(GHOSTS.lobbies),
            tx.object(accountId),
            tx.object.clock(),
            tx.pure.u8(size),
            tx.pure.option("address", hash),
        ],
    });
    return tx;
}

/** Bring the code to the host's invite-only lobby: the game starts there and then. */
export function joinLobbyTx(hostId: string, accountId: string, code: Uint8Array): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("join_lobby"),
        arguments: [
            tx.object(GHOSTS.lobbies),
            tx.object(GHOSTS.preset),
            tx.object(hostId),
            tx.object(accountId),
            tx.object.clock(),
            tx.pure.vector("u8", Array.from(code)),
        ],
    });
    return tx;
}

/** Take the guest slot of a listed lobby. */
export function joinOpenTx(hostId: string, accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("join_open"),
        arguments: [
            tx.object(GHOSTS.lobbies),
            tx.object(hostId),
            tx.object(accountId),
            tx.object.clock(),
        ],
    });
    return tx;
}

/** The guest leaves the listed lobby it waits in. */
export function leaveLobbyTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("leave_lobby"),
        arguments: [tx.object(GHOSTS.lobbies), tx.object(accountId)],
    });
    return tx;
}

/** The host removes the guest; the guest cannot come back to this lobby. */
export function kickGuestTx(hostId: string, guestId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("kick_guest"),
        arguments: [
            tx.object(GHOSTS.lobbies),
            tx.object(hostId),
            tx.object(guestId),
            tx.object.clock(),
        ],
    });
    return tx;
}

/** The host starts the listed lobby's game with its guest. */
export function startFriendlyTx(hostId: string, guestId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("start_friendly"),
        arguments: [
            tx.object(GHOSTS.lobbies),
            tx.object(GHOSTS.preset),
            tx.object(hostId),
            tx.object(guestId),
            tx.object.clock(),
        ],
    });
    return tx;
}

/** Close the host's lobby, of either kind; a guest in it is removed first, in the same transaction. */
export function closeLobbyTx(hostId: string, guestId: string | null): Transaction {
    const tx = new Transaction();
    if (guestId)
        tx.moveCall({
            target: target("kick_guest"),
            arguments: [
                tx.object(GHOSTS.lobbies),
                tx.object(hostId),
                tx.object(guestId),
                tx.object.clock(),
            ],
        });
    tx.moveCall({
        target: target("close_lobby"),
        arguments: [tx.object(GHOSTS.lobbies), tx.object(hostId), tx.object.clock()],
    });
    return tx;
}
