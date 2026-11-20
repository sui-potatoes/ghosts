// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked games on chain, the pure part: a squad as the bytes `find_ranked` and
 * `reveal_squad` take, the commitment a waiting search queues with, the salt kept
 * for its reveal, the `Rules` arithmetic the contract does (tier, budget, the
 * squad check, in its order), where a `Searching` account waits, and the
 * contract's refusals as plain lines. No React, no network, no constants: ids
 * come in as arguments. Tested in `tests/ranked-chain.test.ts`.
 *
 * A squad is three bytes a unit: the rifle tier (1 to 3), the armor tier (1 to
 * 3) and the utility kind (0 frag, 1 flashbang, 2 smoke, `NO_UTILITY` for none),
 * in the order of the squad; unit `i` stands on the side's spawn popped from the
 * back. The commitment is `blake2b256(squad ‖ salt)` with a fresh 32-byte salt:
 * squads are few, so a short salt could be guessed within the reveal limit.
 */

import { fromHex, normalizeSuiAddress, toHex } from "@mysten/sui/utils";

import type { ChainRules } from "./bcs.ts";
import { abortOf, blake2b256, type Abort } from "./lobby-core.ts";

// === Squad bytes ============================================================

/** The utility byte of a unit that carries none: `rules::NO_UTILITY`. */
export const NO_UTILITY = 0xff;
/** The salt a client draws for every waiting search. */
export const SALT_BYTES = 32;

/** The catalog ids (`packages/catalog/items.json`) behind each byte, by slot. */
export const RIFLES = ["rifle-1", "rifle-2", "rifle-3"] as const;
export const ARMORS = ["armor-1", "armor-2", "armor-3"] as const;
export const UTILITIES = ["frag-grenade", "flashbang", "smoke-grenade"] as const;

/** One unit as the bytes name it: catalog ids, the utility null for none. */
export type UnitGear = { weapon: string; armor: string; utility: string | null };

/** The bytes of a squad; throws on an item the contract has no byte for. */
export function encodeSquad(units: readonly UnitGear[]): Uint8Array {
    const bytes = new Uint8Array(units.length * 3);
    units.forEach((unit, i) => {
        const rifle = RIFLES.indexOf(unit.weapon as never);
        const armor = ARMORS.indexOf(unit.armor as never);
        const utility =
            unit.utility === null ? NO_UTILITY : UTILITIES.indexOf(unit.utility as never);
        if (rifle < 0 || armor < 0 || utility < 0)
            throw new Error(`Not a ranked loadout: ${JSON.stringify(unit)}`);
        bytes.set([rifle + 1, armor + 1, utility], i * 3);
    });
    return bytes;
}

/** A squad's units from its bytes; null when the bytes are not a squad. */
export function decodeSquad(bytes: Uint8Array): UnitGear[] | null {
    if (bytes.length % 3 !== 0) return null;
    const units: UnitGear[] = [];
    for (let i = 0; i < bytes.length; i += 3) {
        const [rifle, armor, utility] = bytes.subarray(i, i + 3);
        const weapon = RIFLES[rifle - 1];
        const shell = ARMORS[armor - 1];
        const kit = utility === NO_UTILITY ? null : UTILITIES[utility];
        if (!weapon || !shell || kit === undefined) return null;
        units.push({ weapon, armor: shell, utility: kit });
    }
    return units;
}

/** `blake2b256(squad ‖ salt)` as the address `find_ranked` takes. */
export function commitmentOf(squad: Uint8Array, salt: Uint8Array): string {
    const preimage = new Uint8Array(squad.length + salt.length);
    preimage.set(squad);
    preimage.set(salt, squad.length);
    return `0x${toHex(blake2b256(preimage))}`;
}

/** 32 fresh random bytes from the browser's generator. */
export function newSalt(): Uint8Array {
    const salt = new Uint8Array(SALT_BYTES);
    crypto.getRandomValues(salt);
    return salt;
}

// === The rules ==============================================================

/** `rules::tier_of`: the highest tier the rating reaches, no lower than the placement tier while placing. */
export function tierIndex(rules: ChainRules, rating: number, games: number): number {
    let tier = 0;
    rules.tiers.forEach((t, i) => {
        if (Number(t.minRating) <= rating) tier = i;
    });
    if (games < rules.placementGames) tier = Math.max(tier, rules.placementTier);
    return tier;
}

/** Where `units` sits in `Rules.sizes`, or -1. */
const sizeIndex = (rules: ChainRules, units: number) =>
    rules.sizes.findIndex((s) => s.units === units);

/** `rules::budget`: the credits a squad of `units` gets at `tier`; null for a size the rules lack. */
export function budgetAt(rules: ChainRules, tier: number, units: number): number | null {
    const j = sizeIndex(rules, units);
    const budget = rules.tiers[tier]?.budgets[j];
    return j < 0 || budget === undefined ? null : budget;
}

/** The ranked queue of a size, or null. */
export const queueOf = (rules: ChainRules, units: number): string | null =>
    rules.sizes[sizeIndex(rules, units)]?.queue ?? null;

/** The level a size plays on: null while it has none, and cannot be queued for. */
export const levelOf = (rules: ChainRules, units: number): string | null =>
    rules.sizes[sizeIndex(rules, units)]?.level ?? null;

/** The size whose ranked queue is `queue`, or null. */
export function sizeOfQueue(rules: ChainRules, queue: string): number | null {
    const id = normalizeSuiAddress(queue);
    return rules.sizes.find((s) => normalizeSuiAddress(s.queue) === id)?.units ?? null;
}

/** A refusal of `rules::check_squad`, by its abort code in `ghosts::rules`. */
export type SquadCheck =
    | { ok: true; cost: number; budget: number }
    | { ok: false; code: 0 | 1 | 2 | 3 | 7; unit?: number };

/**
 * `rules::check_squad` as the contract runs it, in its order: the size, then unit
 * by unit the rifle, the armor and the utility (unknown, then locked), then the budget.
 */
export function checkSquad(
    rules: ChainRules,
    units: number,
    tier: number,
    squad: Uint8Array,
): SquadCheck {
    const budget = budgetAt(rules, tier, units);
    if (budget === null) return { ok: false, code: 7 };
    if (squad.length !== 3 * units) return { ok: false, code: 0 };
    let cost = 0;
    for (let i = 0; i < units; i++) {
        const slots: [readonly { price: number; minTier: number }[], number, number][] = [
            [rules.weapons, squad[3 * i], 1],
            [rules.armor, squad[3 * i + 1], 1],
        ];
        if (squad[3 * i + 2] !== NO_UTILITY) slots.push([rules.utilities, squad[3 * i + 2], 0]);
        for (const [items, byte, first] of slots) {
            const item = byte >= first ? items[byte - first] : undefined;
            if (!item) return { ok: false, code: 1, unit: i };
            if (item.minTier > tier) return { ok: false, code: 2, unit: i };
            cost += item.price;
        }
    }
    return cost <= budget ? { ok: true, cost, budget } : { ok: false, code: 3 };
}

/** How long a revealed search may wait for its reveal, and how long a reset cools down. */
export const revealLimitMs = (rules: ChainRules) => Number(rules.revealLimitMs);
export const resetCooldownMs = (rules: ChainRules) => Number(rules.resetCooldownMs);

// === Where an account waits ================================================

/** The ids a search's `queue` is compared with. */
export type Queues = { stakes: string; lobbies: string; rules: ChainRules | null };

/** What a `Searching` account waits in. */
export type SearchKind =
    | { kind: "ranked"; size: number }
    | { kind: "stakes" }
    | { kind: "lobby" }
    /** A queue this build does not know (the rules not read yet, or an older package). */
    | { kind: "unknown" };

export function searchKind(queue: string, queues: Queues): SearchKind {
    const id = normalizeSuiAddress(queue);
    if (queues.lobbies && id === normalizeSuiAddress(queues.lobbies)) return { kind: "lobby" };
    if (queues.stakes && id === normalizeSuiAddress(queues.stakes)) return { kind: "stakes" };
    const size = queues.rules ? sizeOfQueue(queues.rules, id) : null;
    return size === null ? { kind: "unknown" } : { kind: "ranked", size };
}

/** A `Seat` the account holds: a place in a game, or a notice that the queue dropped the search. */
export type SeatKind = "game" | "notice";
export const seatKind = (game: string | null | undefined): SeatKind => (game ? "game" : "notice");

// === The salt on this device ===============================================

/**
 * What a waiting search keeps for its reveal: the squad, the salt, and the names
 * the builder gave its units. Filed under the commitment, which the `Account`
 * holds beside the order: it is known before the search is sent, so a tab that
 * dies between the send and the answer can still reveal.
 */
export type KeptSquad = {
    /** The `Account` searching. */
    account: string;
    /** The squad bytes, hex. */
    squad: string;
    /** The salt, hex. Never logged, never in a URL. */
    salt: string;
    size: number;
    labels: string[];
    /** When it was kept, ms. */
    at: number;
};

/** One storage, as both `sessionStorage` and `localStorage` are. */
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & {
    readonly length: number;
};

export const SALT_KEY = "ghosts:ranked-salt:";
/** Past this, a kept squad is for a search long over: dropped on the next sweep. */
export const KEPT_MAX_MS = 60 * 60_000;

const keyOf = (commitment: string) => SALT_KEY + normalizeSuiAddress(commitment);

function parseKept(raw: string | null): KeptSquad | null {
    if (!raw) return null;
    try {
        const k = JSON.parse(raw) as Partial<KeptSquad>;
        if (
            typeof k.account !== "string" ||
            typeof k.squad !== "string" ||
            typeof k.salt !== "string" ||
            typeof k.size !== "number" ||
            typeof k.at !== "number"
        )
            return null;
        return {
            account: k.account,
            squad: k.squad,
            salt: k.salt,
            size: k.size,
            labels: Array.isArray(k.labels) ? k.labels.filter((l) => typeof l === "string") : [],
            at: k.at,
        };
    } catch {
        return null;
    }
}

/** Write to every store that takes it; one that throws (private mode, full) is skipped. */
export function keepSquad(stores: KeyStore[], commitment: string, kept: KeptSquad) {
    const text = JSON.stringify(kept);
    for (const store of stores)
        try {
            store.setItem(keyOf(commitment), text);
        } catch {
            // the other store may still hold it
        }
}

/** The squad kept for a commitment, from whichever store still has it. */
export function keptSquad(stores: KeyStore[], commitment: string): KeptSquad | null {
    for (const store of stores) {
        try {
            const kept = parseKept(store.getItem(keyOf(commitment)));
            if (kept) return kept;
        } catch {
            // try the next store
        }
    }
    return null;
}

export function forgetSquad(stores: KeyStore[], commitment: string) {
    for (const store of stores)
        try {
            store.removeItem(keyOf(commitment));
        } catch {
            // nothing to do
        }
}

/** A squad kept this recently may be for a search still on its way out: never swept. */
export const KEPT_GRACE_MS = 120_000;

/**
 * Drop what no search needs any more: the account's kept squads but the one of its
 * search now (`keep`, its commitment) and any kept in the last `KEPT_GRACE_MS`, and
 * anyone's older than `KEPT_MAX_MS`.
 */
export function sweepSquads(
    stores: KeyStore[],
    account: string,
    keep: string | null,
    now = Date.now(),
) {
    const mine = normalizeSuiAddress(account);
    const keepKey = keep ? keyOf(keep) : null;
    for (const store of stores) {
        try {
            const keys: string[] = [];
            for (let i = 0; i < store.length; i++) {
                const key = store.key(i);
                if (key?.startsWith(SALT_KEY)) keys.push(key);
            }
            for (const key of keys) {
                if (key === keepKey) continue;
                const kept = parseKept(store.getItem(key));
                const old = !kept || now - kept.at > KEPT_MAX_MS;
                const settled =
                    !!kept &&
                    normalizeSuiAddress(kept.account) === mine &&
                    now - kept.at > KEPT_GRACE_MS;
                if (old || settled) store.removeItem(key);
            }
        } catch {
            // a store that cannot be read is left alone
        }
    }
}

export const hexOf = (bytes: Uint8Array): string => toHex(bytes);
export const bytesOf = (hex: string): Uint8Array => fromHex(hex);

// === Refusals ===============================================================

/** `ghosts::ghosts` codes a match, a reveal or a queue answers with. */
const GHOSTS_LINES: Record<number, string> = {
    6: "You are already searching or in a match",
    7: "This search is over",
    9: "Suspended",
    15: "The time to show the squad is over",
    22: "Hire a squad first",
    25: "A match was just found",
    29: "This match is no longer waiting",
    31: "This squad can no longer be shown",
    32: "Someone just took the waiting place: searching again",
    34: "The level changed: try again",
};

/** `ghosts::rules` codes: the squad check, the queue and the size. */
const RULES_LINES: Record<number, string> = {
    0: "The squad does not have the size of the match",
    1: "The squad carries an item that is not offered",
    2: "The squad carries an item your rank has not unlocked",
    3: "The squad costs more than your budget",
    4: "This queue is not open",
    5: "No level for this size yet",
    6: "That rank does not exist",
    7: "This size is not offered",
};

/** `ghosts::account` codes of a rating reset. */
const ACCOUNT_LINES: Record<number, string> = {
    1: "Only the owner can do this",
    10: "Only a rating above 1500 can be reset",
    11: "Not during a match or a search",
    12: "The rating was reset recently",
};

/** A refusal of a ranked call, a queue or a reset in the player's words; null for anything else. */
export function rankedRefusal(message: string): string | null {
    const abort = abortOf(message);
    return abort ? refusalOf(abort) : null;
}

export function refusalOf(abort: Abort): string | null {
    if (abort.module === "rules") return RULES_LINES[abort.code] ?? null;
    if (abort.module === "account") return ACCOUNT_LINES[abort.code] ?? null;
    if (abort.module === "ghosts") return GHOSTS_LINES[abort.code] ?? null;
    return null;
}

/** The branch a dry run of the empty search points to. */
export type Branch =
    | { kind: "wait" }
    /** Somebody compatible waits: send the squad in the clear. */
    | { kind: "match" }
    /** The search would be refused: the line to show, the abort behind it. */
    | { kind: "refused"; abort: Abort | null; line: string };

/**
 * What the dry run of `find_ranked` with an empty squad says: it passes (nobody is
 * waiting, the search will wait), it aborts with `rules::ESquadSize` (somebody is
 * waiting: show the squad), or any other abort, which the real call would hit too.
 */
export function branchOf(abort: Abort | null, message = ""): Branch {
    if (!abort) return { kind: "wait" };
    if (abort.module === "rules" && abort.code === 0) return { kind: "match" };
    return { kind: "refused", abort, line: refusalOf(abort) ?? (message || "Try again") };
}

/** Whether a failed send lost a race the other branch wins: `ESquadShown` or `rules::ESquadSize`. */
export function raceLost(message: string): "wait" | "match" | null {
    const abort = abortOf(message);
    if (abort?.module === "ghosts" && abort.code === 32) return "wait";
    if (abort?.module === "rules" && abort.code === 0) return "match";
    return null;
}

// === Rating reset ===========================================================

/** `glicko::default()`: where a reset puts the rating. */
export const DEFAULT_RATING = 1500;

const DAY_MS = 86_400_000;

/** `Available in 3 days`, `Available in 5 hours`, `Available in 20 min`. */
export function availableIn(ms: number): string {
    if (ms >= DAY_MS) {
        const days = Math.ceil(ms / DAY_MS);
        return `Available in ${days} ${days === 1 ? "day" : "days"}`;
    }
    if (ms >= 3_600_000) {
        const hours = Math.ceil(ms / 3_600_000);
        return `Available in ${hours} ${hours === 1 ? "hour" : "hours"}`;
    }
    return `Available in ${Math.max(1, Math.ceil(ms / 60_000))} min`;
}

/**
 * Why the reset is inactive, in `account::reset_rating`'s own order after the
 * owner: at or below the default, not idle (a match, a search, a lobby), inside the
 * cooldown of the rules. `undefined` when it can be sent.
 */
export function resetDeny(input: {
    rating: number;
    /** In a match, a search or a lobby. */
    busy: "match" | "search" | null;
    resets: number;
    lastResetMs: number;
    cooldownMs: number;
    now: number;
}): string | undefined {
    if (input.rating <= DEFAULT_RATING) return `Only a rating above ${DEFAULT_RATING} can be reset`;
    if (input.busy === "match") return "Not during a match";
    if (input.busy === "search") return "Not during a search";
    const left = input.lastResetMs + input.cooldownMs - input.now;
    if (input.resets > 0 && left > 0) return availableIn(left);
    return undefined;
}
