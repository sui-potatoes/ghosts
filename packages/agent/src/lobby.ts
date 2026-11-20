// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly lobbies, the pure part: invite codes (bytes, hashes, keys and the text form), the
 * dynamic field IDs a lobby lives at, expiry, and telling what an `Account`'s `Searching` means.
 * It mirrors `ghosts::lobby` in the package source. Reads and sends are in `sui.ts` and
 * `contract.ts`.
 */

import { bcs } from "@mysten/sui/bcs";
import { deriveDynamicFieldID, normalizeSuiAddress, toHex } from "@mysten/sui/utils";

import { blake2b256 } from "./blake2b.ts";

/** `lobby::LOBBY_LIFETIME_MS`: how long a lobby lasts, from the host's `since_ms`. */
export const LOBBY_LIFETIME_MS = 600_000;
/** `lobby::MIN_SIZE` and `MAX_SIZE`: the sizes a lobby can have, the most recruits a side deploys. */
export const MIN_LOBBY_SIZE = 3;
export const MAX_LOBBY_SIZE = 4;
/** `lobby::MAX_KICKED`: past it the oldest kick is forgotten. */
export const MAX_KICKED = 16;
/** An invite code is 8 random bytes. */
export const CODE_BYTES = 8;

// === Codes ===

/** 8 random bytes: the invite code of an invite-only lobby. Never leaves the host's client until shared. */
export function newInviteCode(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(CODE_BYTES));
}

function asBytes(code: Uint8Array | string): Uint8Array {
    if (typeof code !== "string") return code;
    const hex = code.startsWith("0x") ? code.slice(2) : code;
    return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

/** `blake2b256(code)`: what `open_lobby` is sent as `Option<address>`, as a `0x` address. */
export function codeHash(code: Uint8Array): string {
    return `0x${toHex(blake2b256(code))}`;
}

/**
 * `blake2b256(codeHash)`: the key of the invite-only lobby, which the contract computes from the
 * hash it is sent, so no host can choose a key that is someone else's `Searching.order`. This is
 * also the `order` of the host's `Searching` state.
 */
export function protectedKeyOf(hash: Uint8Array | string): string {
    return `0x${toHex(blake2b256(asBytes(hash)))}`;
}

/** The key of the lobby an invite code opens: the code hashed twice. */
export function protectedKey(code: Uint8Array): string {
    return protectedKeyOf(blake2b256(code));
}

/**
 * The text form of a code: its 8 bytes as one big-endian number in base 31, 13 characters from the
 * alphabet the app uses (no 0, O, 1, I or L). 31^13 is above 2^64, so every code has 13
 * characters, the first one at most `S`. There is no check character: a typo is another valid
 * code, and the chain answers it with `ENoLobby`.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 13;

export function encodeCode(code: Uint8Array): string {
    if (code.length !== CODE_BYTES) throw new Error(`A code is ${CODE_BYTES} bytes.`);
    let n = 0n;
    for (const byte of code) n = (n << 8n) | BigInt(byte);
    let text = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
        text = CODE_ALPHABET[Number(n % 31n)] + text;
        n /= 31n;
    }
    return text;
}

/** `XXXX-XXXX-XXXXX`, also for a partial code while it is typed. */
export function formatCode(text: string): string {
    const raw = text.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8)].filter(Boolean).join("-");
}

export type CodeProblem = "empty" | "chars" | "short" | "long" | "range";

/**
 * Tolerant of case, spaces, dashes, dots and underscores; strict on the rest. The 8 bytes, or
 * the problem.
 */
export function parseCode(
    input: string,
): { ok: true; code: Uint8Array } | { ok: false; problem: CodeProblem; message: string } {
    const fail = (problem: CodeProblem, message: string) => ({ ok: false as const, problem, message });
    const raw = input.toUpperCase().replace(/[\s\-_.·]/g, "");
    if (!raw) return fail("empty", "Enter the code.");
    for (const ch of raw) {
        if (!CODE_ALPHABET.includes(ch)) {
            return fail("chars", "Codes use letters and digits, never 0, O, 1, I or L.");
        }
    }
    if (raw.length < CODE_LENGTH) return fail("short", `A code has ${CODE_LENGTH} characters.`);
    if (raw.length > CODE_LENGTH) return fail("long", `A code has ${CODE_LENGTH} characters.`);
    let n = 0n;
    for (const ch of raw) n = n * 31n + BigInt(CODE_ALPHABET.indexOf(ch));
    if (n >= 1n << 64n) return fail("range", "That is not a code: it is too large.");
    const code = new Uint8Array(CODE_BYTES);
    for (let i = CODE_BYTES - 1; i >= 0; i--, n >>= 8n) code[i] = Number(n & 0xffn);
    return { ok: true, code };
}

/**
 * An invite as a host shares it: the host's `Account` ID and the code. `join_lobby` takes the
 * host's `Account` too, and nothing on chain maps a code to its host, so the code alone does not
 * say where to join.
 */
export function formatInvite(host: string, code: Uint8Array): string {
    return `${normalizeSuiAddress(host)}:${formatCode(encodeCode(code))}`;
}

/** `formatInvite` read back, tolerant as `parseCode`; null when it is neither part. */
export function parseInvite(input: string): { host: string; code: Uint8Array } | null {
    const found = /(0x[0-9a-fA-F]{1,64})\s*[:/ ]\s*(\S+)/.exec(input.trim());
    if (!found) return null;
    const code = parseCode(found[2]);
    return code.ok ? { host: normalizeSuiAddress(found[1]), code: code.code } : null;
}

// === Where a lobby lives ===

/** The package and the shared `Lobbies` object of a deployment. */
export interface LobbyHome {
    package: string;
    lobbies: string;
}

const addressBytes = (address: string) => bcs.Address.serialize(address).toBytes();

/** The dynamic field ID of the listed lobby of `host` (an `Account` ID): `Field<Open, Lobby>`. */
export function openLobbyId(home: LobbyHome, host: string): string {
    return deriveDynamicFieldID(
        home.lobbies,
        `${normalizeSuiAddress(home.package)}::lobby::Open`,
        addressBytes(host),
    );
}

/** The dynamic field ID of the lobby at a `Protected` key (see `protectedKey`). */
export function protectedLobbyId(home: LobbyHome, key: string): string {
    return deriveDynamicFieldID(
        home.lobbies,
        `${normalizeSuiAddress(home.package)}::lobby::Protected`,
        addressBytes(key),
    );
}

// === Reading ===

/** A listed lobby: the host's `Account` ID is its key. */
export interface LobbyView {
    /** The host's `Account` ID. */
    host: string;
    size: number;
    /** The `Account` waiting in the slot; a lobby with a guest is full. */
    guest: string | null;
    /** The `Account`s the host kicked out, oldest first. */
    kicked: string[];
    /** The field's object ID. */
    field: string;
}

/** An invite-only lobby, read by its code: it only ever holds its size. */
export interface InviteLobbyView {
    size: number;
    field: string;
    key: string;
}

/** `now - since > LOBBY_LIFETIME_MS`, strictly: a lobby can be joined and started up to `since + 600_000`. */
export function lobbyExpired(sinceMs: number, nowMs: number): boolean {
    return nowMs - sinceMs > LOBBY_LIFETIME_MS;
}

/** When a lobby opened at `sinceMs` is out: strangers can close it from this moment on. */
export function lobbyExpiresAtMs(sinceMs: number): number {
    return sinceMs + LOBBY_LIFETIME_MS + 1;
}

/**
 * What an `Account`'s `Searching { order }` means, which only lookups tell: lobby keys and queue
 * tickets share the field.
 * - `hosting_open`: `order` is the `Account`'s own ID and its listed lobby exists;
 * - `guest`: a listed lobby at `Open(order)` has this `Account` as its guest;
 * - `hosting_invite`: an invite-only lobby exists at `Protected(order)`;
 * - otherwise it is the queue: `queued`, or `seat_waiting` once a match found it (a `Seat` is
 *   sent to its `Account`, which then stays on its search until it is accepted).
 */
export type SearchRole =
    | { kind: "hosting_open" }
    | { kind: "guest"; host: string }
    | { kind: "hosting_invite" }
    | { kind: "queued" }
    | { kind: "seat_waiting" };

/** The checks `classifySearch` needs, each only run when an earlier one did not settle it. */
export interface SearchLookups {
    /** The listed lobby at `Open(order)`, if any. */
    open(order: string): Promise<{ guest: string | null } | null>;
    /** Whether a lobby exists at `Protected(order)`. */
    protectedExists(order: string): Promise<boolean>;
    /** Whether a `Seat` waits on the `Account`. */
    seatWaiting(): Promise<boolean>;
}

export async function classifySearch(
    account: string,
    order: string,
    lookups: SearchLookups,
): Promise<SearchRole> {
    const own = normalizeSuiAddress(account);
    const open = await lookups.open(order);
    if (open) {
        if (normalizeSuiAddress(order) === own) return { kind: "hosting_open" };
        if (open.guest && normalizeSuiAddress(open.guest) === own) {
            return { kind: "guest", host: normalizeSuiAddress(order) };
        }
    }
    if (await lookups.protectedExists(order)) return { kind: "hosting_invite" };
    return (await lookups.seatWaiting()) ? { kind: "seat_waiting" } : { kind: "queued" };
}
