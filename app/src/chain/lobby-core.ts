// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly lobbies (`ghosts::lobby`), the pure part: the invite code and its text,
 * the keys a lobby is filed under on `Lobbies`, where an `Account` that is
 * `Searching` stands (a lobby or the queue), the lifetime, and the contract's
 * refusals as plain lines. No React, no network, no constants: the package and
 * `Lobbies` ids come in as arguments. Tested in `tests/lobby-chain.test.ts`.
 *
 * The invite code is 8 random bytes. The host sends `blake2b256(code)` to
 * `open_lobby` as an `Option<address>`; the contract files the lobby under
 * `Protected(blake2b256(blake2b256(code)))`, and the host's `Account` is
 * `Searching` with that key as its order. Whoever brings the 8 bytes to
 * `join_lobby` starts the game.
 *
 * Its text is the 8 bytes read as one big-endian 64-bit number, written in
 * base 31 over `CODE_ALPHABET` (no 0, O, 1, I or L), most significant digit
 * first, 13 digits padded with the alphabet's first character: shown grouped
 * `XXXX-XXXX-XXXXX`, read back tolerant of case, spaces and dashes.
 */

import { fromHex, normalizeStructTag, normalizeSuiAddress, toHex } from "@mysten/sui/utils";
import { deriveDynamicFieldID } from "@mysten/sui/utils";

// === Blake2b-256 ============================================================

const MASK = (1n << 64n) - 1n;
const IV = [
    0x6a09e667f3bcc908n,
    0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn,
    0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n,
    0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn,
    0x5be0cd19137e2179n,
];
// prettier-ignore
const SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & MASK;

/**
 * Plain Blake2b with a 32-byte digest, no key and no personalisation: Sui's
 * `hash::blake2b256`. RFC 7693, on BigInt words; the inputs here are a block or two.
 */
export function blake2b256(input: Uint8Array): Uint8Array {
    const h = [...IV];
    h[0] ^= 0x01010020n;
    const blocks = Math.max(1, Math.ceil(input.length / 128));
    for (let b = 0; b < blocks; b++) {
        const block = new Uint8Array(128);
        block.set(input.subarray(b * 128, (b + 1) * 128));
        const m: bigint[] = [];
        for (let i = 0; i < 16; i++) {
            let w = 0n;
            for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(block[i * 8 + j]);
            m.push(w);
        }
        const last = b === blocks - 1;
        const t = BigInt(last ? input.length : (b + 1) * 128);
        const v = [...h, ...IV];
        v[12] ^= t & MASK;
        v[13] ^= t >> 64n;
        if (last) v[14] ^= MASK;
        const g = (a: number, bb: number, c: number, d: number, x: bigint, y: bigint) => {
            v[a] = (v[a] + v[bb] + x) & MASK;
            v[d] = rotr(v[d] ^ v[a], 32n);
            v[c] = (v[c] + v[d]) & MASK;
            v[bb] = rotr(v[bb] ^ v[c], 24n);
            v[a] = (v[a] + v[bb] + y) & MASK;
            v[d] = rotr(v[d] ^ v[a], 16n);
            v[c] = (v[c] + v[d]) & MASK;
            v[bb] = rotr(v[bb] ^ v[c], 63n);
        };
        for (let r = 0; r < 12; r++) {
            const s = SIGMA[r % 10];
            g(0, 4, 8, 12, m[s[0]], m[s[1]]);
            g(1, 5, 9, 13, m[s[2]], m[s[3]]);
            g(2, 6, 10, 14, m[s[4]], m[s[5]]);
            g(3, 7, 11, 15, m[s[6]], m[s[7]]);
            g(0, 5, 10, 15, m[s[8]], m[s[9]]);
            g(1, 6, 11, 12, m[s[10]], m[s[11]]);
            g(2, 7, 8, 13, m[s[12]], m[s[13]]);
            g(3, 4, 9, 14, m[s[14]], m[s[15]]);
        }
        for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++)
        for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((h[i] >> BigInt(8 * j)) & 0xffn);
    return out;
}

// === The invite code ========================================================

/** No 0, O, 1, I or L: read aloud and typed without a second guess. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** The code's bytes, as `join_lobby` takes them. */
export const CODE_BYTES = 8;
/** Its text: 31^13 is the least power of 31 past 2^64. */
export const CODE_LENGTH = 13;

const BASE = BigInt(CODE_ALPHABET.length);

/** 8 fresh random bytes from the browser's generator. */
export function randomCode(): Uint8Array {
    const bytes = new Uint8Array(CODE_BYTES);
    crypto.getRandomValues(bytes);
    return bytes;
}

/** The code's 13 characters, ungrouped. */
export function codeText(code: Uint8Array): string {
    if (code.length !== CODE_BYTES) throw new Error("A code is 8 bytes");
    let n = 0n;
    for (const byte of code) n = (n << 8n) | BigInt(byte);
    let text = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
        text = CODE_ALPHABET[Number(n % BASE)] + text;
        n /= BASE;
    }
    return text;
}

/** `XXXX-XXXX-XXXXX`, also for a code still being typed. */
export function formatCode(code: string): string {
    const raw = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const groups = [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8)].filter(Boolean);
    return groups.join("-");
}

export type CodeProblem = "empty" | "chars" | "short" | "long" | "range";
export type ParsedCode =
    | { ok: true; text: string; bytes: Uint8Array }
    | { ok: false; problem: CodeProblem; message: string };

const PROBLEMS: Record<CodeProblem, string> = {
    empty: "Enter the code",
    chars: "Codes use letters and digits, never 0, O, 1, I or L",
    short: `A code has ${CODE_LENGTH} characters`,
    long: `A code has ${CODE_LENGTH} characters`,
    range: "No match with this code",
};

const refuse = (problem: CodeProblem): ParsedCode => ({
    ok: false,
    problem,
    message: PROBLEMS[problem],
});

/**
 * The code inside a pasted share link, or inside an invite written as
 * `<host Account ID>:<code>` (as the agent tools share one), or the text itself.
 */
function stripLink(input: string): string {
    const invite = /^\s*0x[0-9a-f]{1,64}\s*[:/ ]\s*(\S+)\s*$/i.exec(input);
    if (invite) return invite[1];
    const found = /[?&#]code=([^&#\s]+)/i.exec(input);
    if (!found) return input;
    try {
        return decodeURIComponent(found[1]);
    } catch {
        return found[1];
    }
}

/** Tolerant of case, spaces, dashes and a whole pasted link; strict on the rest. */
export function parseCode(input: string): ParsedCode {
    const raw = stripLink(input)
        .toUpperCase()
        .replace(/[\s\-_.·]/g, "");
    if (!raw) return refuse("empty");
    for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return refuse("chars");
    if (raw.length < CODE_LENGTH) return refuse("short");
    if (raw.length > CODE_LENGTH) return refuse("long");
    let n = 0n;
    for (const ch of raw) n = n * BASE + BigInt(CODE_ALPHABET.indexOf(ch));
    // 31^13 reaches past 2^64: the top of the range is no code at all.
    if (n >> 64n) return refuse("range");
    const bytes = new Uint8Array(CODE_BYTES);
    for (let i = CODE_BYTES - 1; i >= 0; i--) {
        bytes[i] = Number(n & 0xffn);
        n >>= 8n;
    }
    return { ok: true, text: raw, bytes };
}

/** What the field says while the player types: nothing until there is something to refuse. */
export function typingProblem(input: string): string | null {
    const parsed = parseCode(input);
    if (parsed.ok || parsed.problem === "empty" || parsed.problem === "short") return null;
    return parsed.message;
}

// === Keys ===================================================================

/** What the host sends to `open_lobby`: `blake2b256(code)`, as an address. */
export const codeHash = (code: Uint8Array): string => `0x${toHex(blake2b256(code))}`;

/** The lobby's key, `blake2b256(blake2b256(code))`: also the host's search order. */
export const protectedKey = (code: Uint8Array): string =>
    `0x${toHex(blake2b256(blake2b256(code)))}`;

export type KeyKind = "Open" | "Protected";

/** The type tag of a key: `PKG::lobby::Open` or `PKG::lobby::Protected`. */
export const keyType = (pkg: string, kind: KeyKind): string =>
    normalizeStructTag(`${pkg}::lobby::${kind}`);

/**
 * Where a lobby is filed on `Lobbies`: the dynamic field of the key, a host's
 * `Account` ID for `Open`, the double hash for `Protected` (both 32 bytes of BCS).
 */
export function lobbyFieldId(lobbies: string, pkg: string, kind: KeyKind, key: string): string {
    return deriveDynamicFieldID(lobbies, keyType(pkg, kind), fromHex(normalizeSuiAddress(key)));
}

// === Where a searching Account stands =======================================

export type LobbyRead = { size: number; guest: string | null; kicked: string[] };

/**
 * Where an `Account` that is `Searching { order }` stands, from the two lobby
 * fields its order could name (null where there is none), in the contract's order:
 * hosting a listed lobby, the guest in one, hosting an invite-only one, else the
 * queue (queued, or a seat waiting). Queue orders are fresh object addresses and
 * protected keys are hash outputs, so none of them can be an `Account` ID.
 */
export type Place =
    | { kind: "host-open"; size: number; guest: string | null }
    | { kind: "guest"; host: string; size: number }
    | { kind: "host-invite"; size: number; key: string }
    | { kind: "queue" };

export function placeOf(
    own: string,
    order: string,
    open: LobbyRead | null,
    invite: LobbyRead | null,
): Place {
    const me = normalizeSuiAddress(own);
    const key = normalizeSuiAddress(order);
    if (open && key === me) return { kind: "host-open", size: open.size, guest: open.guest };
    if (open && open.guest !== null && normalizeSuiAddress(open.guest) === me)
        return { kind: "guest", host: key, size: open.size };
    if (invite) return { kind: "host-invite", size: invite.size, key };
    return { kind: "queue" };
}

/** `LOBBY_LIFETIME_MS` in `ghosts::lobby`: from the host's opening it. */
export const LOBBY_LIFETIME_MS = 600_000;

/** The last moment a lobby can be joined or started (inclusive). */
export const expiresAt = (hostSinceMs: number): number => hostSinceMs + LOBBY_LIFETIME_MS;

/** Past its lifetime: nobody can join or start it, and anyone can close it. */
export const isExpired = (hostSinceMs: number, now: number): boolean =>
    now - hostSinceMs > LOBBY_LIFETIME_MS;

/** `m:ss` left of a lobby, `0:00` once it is out. */
export function timeLeft(hostSinceMs: number, now: number): string {
    const ms = Math.max(0, expiresAt(hostSinceMs) - now);
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Why a guest is back out of a listed lobby without having left it. */
export type Dropped = "kicked" | "expired" | "closed";

/**
 * A guest found `Idle` that did not leave: kicked by the host (the lobby still
 * lists them as kicked), cleaned up past the lifetime, or the host closed it
 * (a kick and a close in one transaction, so the record went with the lobby).
 */
export function droppedWhy(
    own: string,
    lobby: LobbyRead | null,
    hostSinceMs: number | null,
    now: number,
): Dropped {
    const me = normalizeSuiAddress(own);
    if (lobby?.kicked.some((id) => normalizeSuiAddress(id) === me)) return "kicked";
    if (hostSinceMs !== null && isExpired(hostSinceMs, now)) return "expired";
    return "closed";
}

export const DROPPED_LINES: Record<Dropped, string> = {
    kicked: "The host removed you from this match",
    expired: "This match has expired",
    closed: "The host closed this match",
};

// === The contract's refusals ================================================

/** An abort as a failed transaction reports it: the module, the function, the code. */
export type Abort = { module: string; fn: string | null; code: number };

/**
 * The abort in an execution error, in either form the network words it:
 * `MoveAbort(MoveLocation { module: ModuleId { …, name: Identifier("lobby") }, …,
 * function_name: Some("join_open") }, 5)` or `abort code: 5, in '0x…::lobby::join_open'`.
 */
export function abortOf(message: string): Abort | null {
    const long =
        /Identifier\("(\w+)"\)[\s\S]*?function_name: (?:Some\("(\w+)"\)|None)[\s\S]*?\}\s*,\s*(\d+)\)/.exec(
            message,
        );
    if (long) return { module: long[1], fn: long[2] ?? null, code: Number(long[3]) };
    const short = /abort code:?\s*(\d+)[\s\S]*?::(\w+)::(\w+)/.exec(message);
    if (short) return { module: short[2], fn: short[3], code: Number(short[1]) };
    return null;
}

const LOBBY_LINES: Record<number, string> = {
    0: "This size is not offered",
    1: "Try again",
    3: "No match with this code",
    4: "This match has expired",
    5: "This match is full",
    6: "The host removed you from this match",
    7: "Nobody has joined yet",
    8: "That player has left",
    9: "Only the host can do this",
    10: "Remove the guest first",
};

const GHOSTS_LINES: Record<number, string> = {
    6: "You are already in a match or the queue",
    9: "Suspended",
    22: "Hire a squad first",
    28: "Too many recruits for this match",
};

/** A refusal from a lobby call in the player's words; null for anything else. */
export function lobbyRefusal(message: string): string | null {
    const abort = abortOf(message);
    if (!abort) return null;
    if (abort.module === "lobby") {
        if (abort.code === 2)
            return abort.fn === "join_protected"
                ? "No match with this code"
                : "This match is closed";
        return LOBBY_LINES[abort.code] ?? null;
    }
    // `check_free` holds the checks every way into a game shares (the queue too).
    const freeCheck = /check_free|lobby|join_open|friendly/.test(abort.fn ?? "");
    if (abort.module === "ghosts" && (freeCheck || abort.code === 28))
        return GHOSTS_LINES[abort.code] ?? null;
    return null;
}
