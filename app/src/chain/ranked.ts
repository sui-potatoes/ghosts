// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked games on chain: the shared `Rules` read live (and handed to the economy,
 * so the builder prices by them), the calls of `ghosts::ghosts`' ranked section,
 * and the search itself. The pure rules are `ranked-core.ts`.
 *
 * A ranked search shows its squad only to a player already waiting. So it starts
 * with a dry run of `find_ranked` with an empty squad: if it passes, nobody
 * compatible is waiting, and the search is sent that way, with the commitment to
 * the squad (the salt kept on this device under the commitment first); if it
 * aborts with `rules::ESquadSize`, somebody is waiting, and the squad is sent in
 * the clear, the match made in that call. Should the queue change between the dry
 * run and the send, the other branch is sent: after `ESquadShown` with a fresh salt.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { GHOSTS } from "../constants";
import { Account, Rules, type ChainRules } from "./bcs";
import { createAccountTx, fetchAccountId, useAccountId, useGhostsAction } from "./ghosts";
import { beforeGame } from "./funds";
import { abortOf, type Abort } from "./lobby-core";
import {
    branchOf,
    checkSquad,
    commitmentOf,
    encodeSquad,
    forgetSquad,
    hexOf,
    keepSquad,
    levelOf,
    newSalt,
    queueOf,
    raceLost,
    rankedRefusal,
    refusalOf,
    tierIndex,
    type KeyStore,
    type UnitGear,
} from "./ranked-core";
import type { ChainSeat } from "./matchmaking";

type Client = ReturnType<typeof useCurrentClient>;

const target = (fn: string) => `${GHOSTS.package}::ghosts::${fn}`;

/** Whether this build knows where the `Rules` are. */
export const rankedEnabled = !!GHOSTS.rules && BigInt(GHOSTS.rules) !== 0n;

/** How long a read of the rules is believed: the admin retunes them rarely. */
const RULES_STALE_MS = 60_000;

// === Reads ==================================================================

export async function fetchRules(client: Client): Promise<ChainRules> {
    const { object } = await client.core.getObject({
        objectId: GHOSTS.rules,
        include: { content: true },
    });
    return Rules.parse(object.content);
}

/**
 * The live `Rules`, re-read now and then and when the window comes back. Undefined
 * while unread, or in a build without them. `RulesPreload`
 * (`features/play/economy/useEconomy.ts`) runs the economy on each read.
 */
export function useRules() {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["ghosts", "rules", GHOSTS.rules],
        enabled: rankedEnabled,
        staleTime: RULES_STALE_MS,
        refetchInterval: RULES_STALE_MS,
        refetchOnWindowFocus: true,
        queryFn: () => fetchRules(client),
    });
}

// === Writes =================================================================

/**
 * Search the ranked queue of a size: `squad` empty and the `commitment` when
 * nobody is waiting, the squad in the clear when somebody is (the commitment is
 * then not read).
 */
export function findRankedTx(
    accountId: string,
    queue: string,
    level: string,
    squad: Uint8Array,
    commitment: string,
): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("find_ranked"),
        arguments: [
            tx.object(queue),
            tx.object(accountId),
            tx.object(GHOSTS.rules),
            tx.object(level),
            tx.object.random(),
            tx.object.clock(),
            tx.pure.vector("u8", Array.from(squad)),
            tx.pure.address(commitment),
        ],
    });
    return tx;
}

/** Show the squad the search committed to and take the seat: the game begins. Owner only. */
export function revealSquadTx(
    gameId: string,
    accountId: string,
    seat: ChainSeat["ref"],
    squad: Uint8Array,
    salt: Uint8Array,
): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("reveal_squad"),
        arguments: [
            tx.object(gameId),
            tx.object(accountId),
            tx.object(GHOSTS.rules),
            tx.receivingRef(seat),
            tx.object.clock(),
            tx.pure.vector("u8", Array.from(squad)),
            tx.pure.vector("u8", Array.from(salt)),
        ],
    });
    return tx;
}

/** Take a ranked seat without a squad: the owner at any time, anyone once the reveal is late. */
export function takeSeat(
    tx: Transaction,
    gameId: string,
    accountId: string,
    seat: ChainSeat["ref"],
) {
    tx.moveCall({
        target: target("take_seat"),
        arguments: [
            tx.object(gameId),
            tx.object(accountId),
            tx.receivingRef(seat),
            tx.object.clock(),
        ],
    });
}

/** Leave the ranked queue the search waits in. */
export function cancelRankedTx(queue: string, accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("cancel_ranked"),
        arguments: [tx.object(queue), tx.object(accountId), tx.object.clock()],
    });
    return tx;
}

/** Clear a search the queue dropped, with its notice: the account is idle again. Anyone can. */
export function dismissSeatTx(accountId: string, seat: ChainSeat["ref"]): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: target("dismiss_seat"),
        arguments: [tx.object(accountId), tx.receivingRef(seat)],
    });
    return tx;
}

/** Reset the rating to 1500 (`account::reset_rating`). */
export function resetRatingTx(accountId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
        target: `${GHOSTS.package}::account::reset_rating`,
        arguments: [tx.object(accountId), tx.object(GHOSTS.rules), tx.object.clock()],
    });
    return tx;
}

// === The squad on this device ===============================================

/** Both stores a salt is kept in: a reload keeps the session's, a closed tab the local one. */
export function saltStores(): KeyStore[] {
    const stores: KeyStore[] = [];
    try {
        stores.push(window.sessionStorage);
    } catch {
        // unavailable
    }
    try {
        stores.push(window.localStorage);
    } catch {
        // unavailable
    }
    return stores;
}

const NAMES_KEY = "ghosts:ranked-names:";

/** The names the builder gave the squad last sent, for the match to call its units by. */
export type SquadNames = { squad: string; labels: string[] };

export function keepNames(accountId: string, names: SquadNames) {
    try {
        window.localStorage.setItem(
            NAMES_KEY + normalizeSuiAddress(accountId),
            JSON.stringify(names),
        );
    } catch {
        // the match then names units by their type
    }
}

export function keptNames(accountId: string): SquadNames | null {
    try {
        const raw = window.localStorage.getItem(NAMES_KEY + normalizeSuiAddress(accountId));
        const parsed = raw ? (JSON.parse(raw) as Partial<SquadNames>) : null;
        if (!parsed || typeof parsed.squad !== "string" || !Array.isArray(parsed.labels))
            return null;
        return { squad: parsed.squad, labels: parsed.labels.map(String) };
    } catch {
        return null;
    }
}

// === The search =============================================================

/** Where a ranked search stands on this screen, before the `Account` says. */
export type RankedPhase =
    | { phase: "idle" }
    /** Reading the rules and the account, dry-running the search. */
    | { phase: "checking" }
    | { phase: "sending"; branch: "wait" | "match" }
    | { phase: "refused"; line: string; abort: Abort | null };

/** A squad to queue: its units' gear, the builder's names for them, and the size. */
export type RankedEntry = { units: UnitGear[]; labels: string[]; size: 3 | 4 };

/** Try the call; for a refusal, its abort and line. */
async function simulate(
    client: Client,
    owner: string,
    tx: Transaction,
): Promise<{ abort: Abort | null; message: string }> {
    tx.setSender(owner);
    const result = await client.core.simulateTransaction({
        transaction: tx,
        checksEnabled: false,
        include: { effects: true },
    });
    const run = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
    const status = run.effects.status;
    if (!status || status.success) return { abort: null, message: "" };
    const error = status.error;
    if (error.$kind === "MoveAbort") {
        const location = error.MoveAbort.location;
        return {
            abort: {
                module: location?.module ?? "",
                fn: location?.functionName ?? null,
                code: Number(error.MoveAbort.abortCode),
            },
            message: error.message,
        };
    }
    return { abort: abortOf(error.message), message: error.message };
}

/**
 * Queue a squad for a ranked match: the account opened on the way for a player
 * without one, the rules and the account read fresh, the squad checked as the
 * contract will, the branch picked by a dry run, the salt kept before a waiting
 * search goes out. The `Account` then says the rest: `Searching`, or `Playing`.
 */
export function useRankedSearch(onRules?: (rules: ChainRules) => void) {
    const owner = useCurrentAccount()?.address;
    const accountId = useAccountId().data;
    const action = useGhostsAction();
    const [state, setState] = useState<RankedPhase>({ phase: "idle" });

    const refuse = (line: string, abort: Abort | null = null) =>
        setState({ phase: "refused", line, abort });

    async function queue(entry: RankedEntry) {
        if (!owner || state.phase === "checking" || state.phase === "sending") return;
        setState({ phase: "checking" });
        try {
            await beforeGame(owner);
            const { client } = action;
            let id = accountId ?? (await fetchAccountId(client, owner));
            if (!id) {
                const opened = await action.attempt([createAccountTx]);
                if (!opened.ok) return refuse(rankedRefusal(opened.message) ?? opened.message);
                id = await fetchAccountId(client, owner, true);
                if (!id) return refuse("Could not open your account. Try again.");
            }
            const [rules, account] = await Promise.all([
                fetchRules(client),
                client.core
                    .getObject({ objectId: id, include: { content: true } })
                    .then(({ object }) => Account.parse(object.content)),
            ]);
            onRules?.(rules);
            const queueId = queueOf(rules, entry.size);
            const level = levelOf(rules, entry.size);
            if (!queueId) return refuse("This size is not offered");
            if (!level) return refuse(`No ${entry.size}x${entry.size} level yet`);
            if (account.state.$kind !== "Idle")
                return refuse("You are already searching or in a match");
            if (Number(account.suspendedUntil) > Date.now())
                return refuse("You are suspended from matchmaking");
            const score = account.score;
            const games = Number(score.wins) + Number(score.losses) + Number(score.draws);
            const tier = tierIndex(rules, Number(account.rating.rating), games);
            const squad = encodeSquad(entry.units);
            const check = checkSquad(rules, entry.size, tier, squad);
            if (!check.ok)
                return refuse(
                    refusalOf({ module: "rules", fn: "check_squad", code: check.code }) ??
                        "This squad cannot be queued",
                );

            let salt = newSalt();
            let commitment = commitmentOf(squad, salt);
            const probe = await simulate(
                client,
                owner,
                findRankedTx(id, queueId, level, new Uint8Array(), commitment),
            );
            let branch = branchOf(probe.abort, probe.message);
            if (branch.kind === "refused") return refuse(branch.line, branch.abort);

            const stores = saltStores();
            keepNames(id, { squad: hexOf(squad), labels: entry.labels });
            for (let attempt = 0; attempt < 3; attempt++) {
                const waiting = branch.kind === "wait";
                setState({ phase: "sending", branch: waiting ? "wait" : "match" });
                if (waiting)
                    keepSquad(stores, commitment, {
                        account: id,
                        squad: hexOf(squad),
                        salt: hexOf(salt),
                        size: entry.size,
                        labels: entry.labels,
                        at: Date.now(),
                    });
                const sent = await action.attempt([
                    () =>
                        findRankedTx(
                            id,
                            queueId,
                            level,
                            waiting ? new Uint8Array() : squad,
                            commitment,
                        ),
                ]);
                if (sent.ok) return setState({ phase: "idle" });
                if (waiting) forgetSquad(stores, commitment);
                const race = raceLost(sent.message);
                if (race === "match") branch = { kind: "match" };
                else if (race === "wait") {
                    // The clear squad went out with the refused call: a new salt for the wait.
                    salt = newSalt();
                    commitment = commitmentOf(squad, salt);
                    branch = { kind: "wait" };
                } else {
                    const abort = abortOf(sent.message);
                    return refuse(rankedRefusal(sent.message) ?? friendly(sent.message), abort);
                }
            }
            return refuse("The queue is busy. Try again.");
        } catch (e) {
            refuse(friendly(e instanceof Error ? e.message : String(e)));
        }
    }

    return {
        state,
        busy: action.busy || state.phase === "checking" || state.phase === "sending",
        queue: (entry: RankedEntry) => void queue(entry),
        clear: () => setState({ phase: "idle" }),
    };
}

/** A failure that is not a refusal of the contract, in the player's words. */
function friendly(message: string): string {
    if (/Failed to fetch|NetworkError|timed? ?out/i.test(message))
        return "Connection lost. Try again.";
    if (/reject|cancel|abort(ed)? by user|NotAllowedError/i.test(message)) return "Cancelled.";
    if (/insufficient|gas/i.test(message))
        return "Not enough SUI for this action. Try again shortly.";
    return "Could not reach the network. Try again.";
}
