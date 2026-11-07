// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { AccountView, Action, GameState, Receipt } from "./types.ts";

/**
 * Where a game is played. `sui.ts` is the chain and `sandbox.ts` is an
 * in-memory game against a scripted opponent; `GhostsAgent` cannot tell them
 * apart, so a bot written against the sandbox plays on chain unchanged.
 */
export interface Backend {
    readonly network: string;
    /** The address the agent acts as: it owns the `Account`, holds the name and pays gas. */
    readonly address: string;
    /** The key that signs: the owner's own, or an alias acting as the owner. */
    readonly signer: string;

    balanceMist(): Promise<bigint>;
    /** The owner's name; null until one is picked. */
    name(): Promise<string | null>;
    /** The name of an `Account`'s owner, which anyone can look up; null if they have none. */
    playerName(accountId: string): Promise<string | null>;
    /** Take a name for the owner, moving it off any earlier one. */
    setName(name: string): Promise<Receipt>;
    /** Name the wallet that can take the `Account` over. The contract allows this once. */
    setRecovery(wallet: string): Promise<Receipt>;
    /** The `Account` this agent plays with; null until one exists. */
    account(): Promise<AccountView | null>;
    /** The game at its latest version; null once it has been completed and deleted. */
    game(id: string): Promise<GameState | null>;

    createAccount(): Promise<Receipt>;
    hireSquad(): Promise<Receipt>;
    findGame(): Promise<Receipt>;
    cancelSearch(): Promise<Receipt>;
    /** Whoever found the opponent opens the game for both players. */
    startGame(opponent: string): Promise<Receipt>;
    /** Let go of a found game the opponent is no longer waiting on, with no penalty. */
    releaseGame(opponent: string): Promise<Receipt>;
    /** Send a validated batch as one transaction. Throws `ActionError` on a refusal. */
    submit(game: GameState, actions: Action[]): Promise<Receipt>;
}
