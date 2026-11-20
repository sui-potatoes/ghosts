// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { FaucetResult } from "./faucet.ts";
import type { InviteLobbyView, LobbyView, SearchRole } from "./lobby.ts";
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
    /**
     * One request to the testnet faucet for this address, resolved once the balance shows the
     * funds. Testnet only: any other backend throws. Callers go through `GhostsAgent.requestFunds`,
     * which applies the top-up rule.
     */
    requestFaucet(): Promise<FaucetResult>;
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
    /** Any `Account` by ID; null if it does not exist. */
    accountById(id: string): Promise<AccountView | null>;
    /** The game at its latest version; null once it has been completed and deleted. */
    game(id: string): Promise<GameState | null>;

    createAccount(): Promise<Receipt>;
    /** Hire the free squad: tops the account up to its free recruits, each armed with a rifle. */
    hireSquad(): Promise<Receipt>;
    /**
     * Arm the recruits at home who carry no weapon, and give those with a free utility slot
     * a frag grenade, so they can shoot and throw once on the map.
     * Null when everyone at home is fitted already: no transaction is sent.
     */
    armSquad(): Promise<Receipt | null>;
    /**
     * Find a game. A waiting player makes it start at once with this account in it,
     * playing second; otherwise the account is left on a search.
     */
    findGame(): Promise<Receipt>;
    /** Leave the queue. A search a match answered is left through its game instead. */
    cancelSearch(): Promise<Receipt>;

    // === Friendly lobbies ===

    /**
     * Open a lobby of `size` (3 or 4 recruits a side): listed without a `code`, invite-only with
     * the 8-byte invite code. This account is on its search in it until the game starts or it closes.
     */
    openLobby(size: number, code?: Uint8Array): Promise<Receipt>;
    /** Join the invite-only lobby of `host` (its `Account` ID) with the code: the game starts at once. */
    joinLobby(host: string, code: Uint8Array): Promise<Receipt>;
    /** Take the guest slot of the listed lobby of `host`, until its host starts the game or kicks you. */
    joinOpen(host: string): Promise<Receipt>;
    /** Leave the listed lobby this account waits in. */
    leaveLobby(): Promise<Receipt>;
    /** The host kicks the guest of its listed lobby, who cannot join it again. */
    kickGuest(): Promise<Receipt>;
    /** The host starts the game of its listed lobby with the guest in it. */
    startFriendly(): Promise<Receipt>;
    /** The host closes its lobby, of either kind; a guest is kicked first, in the same transaction. */
    closeLobby(): Promise<Receipt>;
    /**
     * Anyone closes an expired lobby of `host`, kicking its guest if there is one, in one
     * transaction. Refused until the lobby's lifetime is out.
     */
    cleanUpLobby(host: string): Promise<Receipt>;
    /** The listed lobby of `host` (an `Account` ID); null if there is none. */
    lobby(host: string): Promise<LobbyView | null>;
    /** The invite-only lobby a code opens; null if there is none. It holds its size and nothing else. */
    inviteLobby(code: Uint8Array): Promise<InviteLobbyView | null>;
    /**
     * The host `Account` of the invite-only lobby a code opens, read from the transaction that
     * opened it; null if there is none or the lookup finds nothing.
     */
    inviteHost(code: Uint8Array): Promise<string | null>;
    /** Every listed lobby, all pages. */
    listLobbies(): Promise<LobbyView[]>;
    /** What this account's search is (hosting, a guest, queued, a seat waiting); null if it is not searching. */
    searchRole(): Promise<SearchRole | null>;

    /**
     * Accept the `Seat` a match sent to this account while it was searching, which puts
     * it into the game. Null when there is none (yet): no transaction is sent.
     */
    acceptSeat(): Promise<Receipt | null>;
    /** Send a validated batch as one transaction. Throws `ActionError` on a refusal. */
    submit(game: GameState, actions: Action[]): Promise<Receipt>;
}
