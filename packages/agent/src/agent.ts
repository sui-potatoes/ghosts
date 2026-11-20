// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `GhostsAgent`: the one surface a player needs. `situation` says what to do
 * next, `wait` sleeps until that is the agent's call, `observe` and `legal`
 * describe the game, `act` does it. The MCP server is a thin skin over this and
 * `playGames` is the same loop for scripted bots.
 */

import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";

import type { Backend } from "./backend.ts";
import type { Policy } from "./bot.ts";
import {
    encodeCode,
    formatCode,
    formatInvite,
    lobbyExpired,
    lobbyExpiresAtMs,
    MAX_LOBBY_SIZE,
    MIN_LOBBY_SIZE,
    newInviteCode,
    parseCode,
    parseInvite,
    type LobbyView,
    type SearchRole,
} from "./lobby.ts";
import { FaucetError } from "./faucet.ts";
import { ensureFunds, GAS_FLOOR, TRIGGER_BALANCE, type FundsOutcome } from "./funds.ts";
import { nameProblem, normalizeName } from "./names.ts";
import {
    effectiveStats,
    FREE_RECRUITS,
    legalActions,
    SEARCH_TIMEOUT_MS,
    hasUsesLeft,
    validateBatch,
    type LegalAction,
} from "./rules.ts";
import {
    ActionError,
    type AccountView,
    type Ending,
    type GameMode,
    type GameRecord,
    type GameState,
    type Receipt,
    type UnitActionEntry,
    type UnitEffect,
} from "./types.ts";
import { pollingWake, type Wake } from "./wake.ts";

export type Phase =
    | "no_name"
    | "no_account"
    | "no_squad"
    | "suspended"
    | "idle"
    | "searching"
    /** Hosting a friendly lobby: `lobby` says who is in it. Actionable once a guest waits or it expired. */
    | "lobby_hosting"
    /** Waiting in the listed lobby of another host, until it starts the game or kicks you. */
    | "lobby_guest"
    | "deploy"
    | "deployment_over"
    | "your_turn"
    | "opponent_turn"
    | "opponent_timed_out"
    | "game_over";

export interface Situation {
    phase: Phase;
    /** Whether the agent has something to do; otherwise it should `wait`. */
    actionable: boolean;
    /** The next step in plain words. */
    next: string;
    game?: string;
    /** Set in the lobby phases. */
    lobby?: LobbySituation;
    turn?: number;
    /** Time left to deploy or on the current turn. Past zero, only `next_turn` is open. */
    turnMsLeft?: number;
    /** Set in `game_over`: "won", "lost" or "draw". */
    result?: "won" | "lost" | "draw";
    /** Set in `game_over`: how the game ended, as the contract names it. */
    ending?: Ending["kind"];
}

/** What the lobby this agent is in looks like. */
export interface LobbySituation {
    role: "hosting_open" | "hosting_invite" | "guest";
    /** The host's `Account` ID: this agent's own when hosting. */
    host: string;
    /** Recruits a side deploys; known for a listed lobby. */
    size?: number;
    /** The `Account` in the guest slot of a listed lobby. */
    guest?: string | null;
    /** Time left before anyone can close it; 0 once it expired. */
    expiresInMs: number;
}

/** A listed lobby, as `lobbies` shows it. */
export interface OpenLobby {
    /** The host's `Account` ID: what `joinOpen` takes. */
    host: string;
    hostName: string | null;
    size: number;
    full: boolean;
    /** Time left before it expires and can be closed by anyone; 0 if it already has. */
    expiresInMs: number;
}

/** What hosting an invite-only lobby hands to its host to share. */
export interface Invite {
    /** The code, `XXXX-XXXX-XXXXX`. */
    code: string;
    /** The host's `Account` ID, which `join_lobby` needs besides the code. */
    host: string;
    /** `host:code`, what `joinInvite` takes as one string. */
    text: string;
}

export interface ObservedUnit {
    /** Letter on `map`: uppercase is yours, lowercase the enemy's. */
    mark: string;
    mine: boolean;
    x: number;
    y: number;
    hp: string;
    ap: number;
    ammo: string;
    grenade: boolean;
    /** Whether the unit has a flashbang or a smoke grenade left to throw. */
    flashbang: boolean;
    smokeGrenade: boolean;
    /** Status effects on the unit, with the turn changes each has left. */
    effects: UnitEffect[];
    /** Every action the unit has, with the uses it has left (`null`: unlimited). */
    actions: UnitActionEntry[];
    mobility: number;
    /** Aim and defense as they count in a shot, effects included. */
    aim: number;
    range: number;
    damage: string;
    armor: number;
    dodge: number;
    defense: number;
}

export interface Observation {
    game: string;
    version: string;
    you: string | null;
    opponent: string | null;
    turn: number;
    yourTurn: boolean;
    status: GameState["status"]["kind"];
    /** How the game is played: a friendly one deploys up to `size` recruits and moves no rating. */
    mode: GameMode;
    turnMsLeft: number;
    /** One string per row. `x` is the row index and `y` the column. */
    map: string[];
    legend: string;
    units: ObservedUnit[];
    /** What happened over the last two turns, oldest first: this is how you see the opponent. */
    recent: GameRecord[];
}

export interface LegalFilter {
    /** Only this unit's orders, as `[x, y]`. */
    unit?: [number, number];
    kind?: LegalAction["kind"];
    /** Keep the best N per unit and kind. */
    limit?: number;
}

export interface ActResult {
    receipt: Receipt;
    situation: Situation;
}

export interface AgentOptions {
    wake?: Wake;
    now?: () => number;
    /** Below this balance `status` asks for a top-up. */
    lowBalanceMist?: bigint;
    /**
     * The wallet that can take this agent's `Account` over, named during setup.
     * This is spawn config on purpose: no tool sets it, so nothing a model reads
     * can hand the account to someone else.
     */
    recovery?: string;
}

const LEGEND =
    ". empty, + low cover, = high cover, ~ unwalkable, # wall, A-D your units, w-z enemy units";
const DEFAULT_LOW_BALANCE_MIST = 100_000_000n;

export class GhostsAgent {
    backend: Backend;
    wake: Wake;
    now: () => number;
    lowBalanceMist: bigint;
    recovery: string | null;
    /** Names read once: `situation` runs on every poll and names rarely change. */
    private ownName: string | null = null;
    private names = new Map<string, string | null>();

    constructor(backend: Backend, options: AgentOptions = {}) {
        this.backend = backend;
        this.wake = options.wake ?? pollingWake();
        this.now = options.now ?? Date.now;
        this.lowBalanceMist = options.lowBalanceMist ?? DEFAULT_LOW_BALANCE_MIST;
        this.recovery = options.recovery ? normalizeSuiAddress(options.recovery) : null;
        if (this.recovery && !isValidSuiAddress(this.recovery)) {
            throw new Error(`Not a recovery address: ${options.recovery}`);
        }
    }

    /** Who this agent is, what it has and what it should do. Never includes key material. */
    async status() {
        const [balance, account, situation, name] = await Promise.all([
            this.backend.balanceMist(),
            this.backend.account(),
            this.situation(),
            this.backend.name(),
        ]);
        return {
            network: this.backend.network,
            address: this.backend.address,
            signer: this.backend.signer,
            name,
            balanceMist: balance.toString(),
            needsTopUp: balance < this.lowBalanceMist,
            account: account && {
                id: account.id,
                rating: account.rating,
                score: account.score,
                recruits: account.recruits,
                recovery: account.recovery,
            },
            situation,
        };
    }

    async situation(role?: SearchRole | null): Promise<Situation> {
        const account = await this.backend.account();
        if (account?.search.kind === "playing") {
            const game = await this.backend.game(account.search.game);
            if (game) return this.inGame(account, game);
        }
        this.ownName ??= await this.backend.name();
        if (!this.ownName) {
            return todo("no_name", "Pick your name: it is what every opponent will see.");
        }
        if (!account) return todo("no_account", "Run setup to open an account and hire a squad.");
        if (account.recruits === 0) return todo("no_squad", "Run setup to hire a squad.");
        if (account.search.kind === "searching" && role === undefined) {
            role = await this.backend.searchRole();
        }
        if (account.search.kind === "searching") return this.searching(account, role ?? null);
        if (this.now() < account.suspendedUntilMs) {
            return {
                phase: "suspended",
                actionable: false,
                next: "Wait: this account left a game behind and can't search yet.",
            };
        }
        const short = account.recruits < FREE_RECRUITS;
        return todo(
            "idle",
            short
                ? "Run setup to replace the fallen, then find a game."
                : "Find a game, or host or join a friendly lobby.",
        );
    }

    /** A search that is the queue (or a seat waiting), or a place in a friendly lobby. */
    private async searching(account: AccountView, role: SearchRole | null): Promise<Situation> {
        if (account.search.kind !== "searching") return todo("idle", "Find a game.");
        const sinceMs = account.search.sinceMs;
        const expiresInMs = Math.max(0, lobbyExpiresAtMs(sinceMs) - this.now());
        if (role?.kind === "hosting_invite") {
            const lobby: LobbySituation = { role: role.kind, host: account.id, expiresInMs };
            if (lobbyExpired(sinceMs, this.now())) {
                return {
                    phase: "lobby_hosting",
                    actionable: true,
                    lobby,
                    next: "Your lobby expired: close it. Nobody can join it any more.",
                };
            }
            return {
                phase: "lobby_hosting",
                actionable: false,
                lobby,
                next: "Wait for your guest to join with the invite: the game starts when they do.",
            };
        }
        if (role?.kind === "hosting_open") {
            const found = await this.backend.lobby(account.id);
            const lobby: LobbySituation = {
                role: role.kind,
                host: account.id,
                size: found?.size,
                guest: found?.guest ?? null,
                expiresInMs,
            };
            if (lobbyExpired(sinceMs, this.now())) {
                return {
                    phase: "lobby_hosting",
                    actionable: true,
                    lobby,
                    next: "Your lobby expired: close it. Nobody can join or start it any more.",
                };
            }
            if (lobby.guest) {
                return {
                    phase: "lobby_hosting",
                    actionable: true,
                    lobby,
                    next: "A guest waits in your lobby: start the game, or kick them.",
                };
            }
            return {
                phase: "lobby_hosting",
                actionable: false,
                lobby,
                next: "Wait for a guest to take the slot of your lobby.",
            };
        }
        if (role?.kind === "guest") {
            // The lifetime runs from the host's opening, not from this guest's joining.
            const host = await this.backend.accountById(role.host);
            const hostSince = host?.search.kind === "searching" ? host.search.sinceMs : sinceMs;
            const lobby: LobbySituation = {
                role: role.kind,
                host: role.host,
                expiresInMs: Math.max(0, lobbyExpiresAtMs(hostSince) - this.now()),
            };
            return {
                phase: "lobby_guest",
                actionable: false,
                lobby,
                next: "Wait for the host to start the game, or leave the lobby.",
            };
        }
        return { phase: "searching", actionable: false, next: "Wait for an opponent." };
    }

    private inGame(account: AccountView, game: GameState): Situation {
        const side = game.players.indexOf(account.id);
        const shared = {
            game: game.id,
            turn: game.turn,
            turnMsLeft: Math.max(0, game.deadlineMs - this.now()),
        };
        if (game.status.kind === "finished") {
            const { winner } = game.status;
            const result = winner === null ? "draw" : winner === account.id ? "won" : "lost";
            return {
                ...shared,
                ...todo("game_over", "Send the complete action to bring your squad home."),
                result,
                ending: game.status.ending.kind,
            };
        }
        if (game.status.kind === "deploying") {
            if (this.now() > game.deadlineMs) {
                return {
                    ...shared,
                    ...todo("deployment_over", "Send next_turn: the time to deploy is over."),
                };
            }
            if (game.squads[side]?.length) {
                return {
                    ...shared,
                    phase: "opponent_turn",
                    actionable: false,
                    next: "Wait for the opponent to deploy.",
                };
            }
            return { ...shared, ...todo("deploy", "Send the deploy action.") };
        }
        if (game.active === side) {
            return {
                ...shared,
                ...todo(
                    "your_turn",
                    this.now() > game.deadlineMs
                        ? "Your turn ran out of time: send next_turn."
                        : "Observe, list legal actions, then act. Send next_turn when done.",
                ),
            };
        }
        if (this.now() > game.deadlineMs) {
            return {
                ...shared,
                ...todo(
                    "opponent_timed_out",
                    "The opponent ran out of time: send next_turn. Three misses in a row lose them the game.",
                ),
            };
        }
        return {
            ...shared,
            phase: "opponent_turn",
            actionable: false,
            next: "Wait for the opponent.",
        };
    }

    /**
     * Sleep until the agent has something to do, or `timeoutMs` passes. The seat a
     * match sends while the agent waits is accepted on the way, so an agent never
     * has to know that step.
     */
    async wait(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Situation> {
        // Real time, not `now`: that clock says what turn deadlines read, not how long to sleep.
        const deadline = Date.now() + (options.timeoutMs ?? 30_000);
        for (;;) {
            const situation = await this.advance();
            const expired = Date.now() >= deadline || options.signal?.aborted;
            if (situation.actionable || expired) return situation;

            const rest = new AbortController();
            const timer = setTimeout(() => rest.abort(), Math.max(0, deadline - Date.now()));
            const stop = () => rest.abort();
            options.signal?.addEventListener("abort", stop, { once: true });
            await this.wake.next(rest.signal);
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", stop);
        }
    }

    /**
     * The situation, after taking the seat a match sent this account. Whoever finds a
     * waiting player starts the game and is in it at once; the player who waited stays
     * on their search until their `Seat` is accepted, which anyone can do.
     */
    private async advance(): Promise<Situation> {
        let account = await this.backend.account();
        let role: SearchRole | null | undefined;
        if (account?.search.kind === "searching") {
            role = await this.backend.searchRole();
            // a lobby is no queue ticket: nothing to accept, and a lobby lives its own lifetime
            const queue = !role || role.kind === "queued" || role.kind === "seat_waiting";
            if (queue && (await this.backend.acceptSeat())) {
                account = await this.backend.account();
                role = undefined;
            }
        }
        if (
            account?.search.kind === "searching" &&
            (role === undefined || role?.kind === "queued") &&
            this.now() - account.search.sinceMs > SEARCH_TIMEOUT_MS
        ) {
            // Nobody has answered in a while: leave the queue, so a stale ticket doesn't
            // pair this account with someone who has long moved on.
            try {
                await this.backend.cancelSearch();
            } catch (error) {
                // A match answered it a moment ago: its seat is taken on the next poll.
                if (!(error instanceof ActionError) || error.code !== "rejected") throw error;
            }
        }
        return this.situation(role);
    }

    /**
     * Take a name. It is the agent's own to pick, with no prefix or mark, and
     * can be changed later. Taken names refuse with `name_taken`: pick another.
     */
    async setName(input: string): Promise<Situation> {
        const name = normalizeName(input);
        const problem = nameProblem(name);
        if (problem) throw new ActionError("bad_name", problem);
        await this.backend.setName(name);
        this.ownName = name;
        return this.situation();
    }

    /** Open the account, fill the squad and arm it, whichever of those is still missing. */
    async setup(): Promise<Situation> {
        await this.funded();
        if (!(await this.backend.account())) await this.backend.createAccount();
        const account = await this.backend.account();
        if (account && this.recovery && !account.recovery) {
            await this.backend.setRecovery(this.recovery);
        }
        if (account && account.recruits < FREE_RECRUITS && account.search.kind === "idle") {
            await this.backend.hireSquad();
        }
        // A hire carries a Standard Rifle but no grenade; a recruit whose rifle was taken off
        // can't attack or reload on the map.
        if (account && account.search.kind !== "playing") await this.backend.armSquad();
        return this.situation();
    }

    async findGame(): Promise<Situation> {
        this.ownName ??= await this.backend.name();
        if (!this.ownName) {
            throw new ActionError("no_name", "Pick your name before your first game.");
        }
        await this.funded();
        await this.backend.findGame();
        return this.advance();
    }

    async cancelSearch(): Promise<Situation> {
        await this.backend.cancelSearch();
        return this.situation();
    }

    // === Friendly lobbies ===

    /**
     * Host a friendly lobby of `size` (3 or 4 recruits a side, default 3). Listed unless `invite`:
     * an invite-only lobby is opened with a fresh code, which comes back once for the host to share.
     * Then `wait`. A friendly game moves no rating and costs no recruit.
     */
    async hostLobby(
        options: { size?: number; invite?: boolean } = {},
    ): Promise<{ situation: Situation; invite?: Invite }> {
        const size = options.size ?? MIN_LOBBY_SIZE;
        if (!Number.isInteger(size) || size < MIN_LOBBY_SIZE || size > MAX_LOBBY_SIZE) {
            throw new ActionError(
                "bad_action",
                `A lobby has ${MIN_LOBBY_SIZE} or ${MAX_LOBBY_SIZE} recruits a side.`,
            );
        }
        await this.named();
        await this.funded();
        const code = options.invite ? newInviteCode() : undefined;
        await this.backend.openLobby(size, code);
        const situation = await this.situation();
        if (!code) return { situation };
        const account = await this.backend.account();
        const host = account!.id;
        return {
            situation,
            invite: { code: formatCode(encodeCode(code)), host, text: formatInvite(host, code) },
        };
    }

    /**
     * Join the invite-only lobby of `host` (its `Account` ID) with its code, `XXXX-XXXX-XXXXX` in
     * any case and separators; the game starts at once. Or pass one string, `host:code`.
     */
    async joinInvite(host: string, code?: string): Promise<Situation> {
        let account = host;
        let text = code;
        if (text === undefined) {
            const invite = parseInvite(host);
            if (!invite) {
                throw new ActionError("bad_action", "That is not an invite: it is host:code.");
            }
            account = invite.host;
            text = formatCode(encodeCode(invite.code));
        }
        const parsed = parseCode(text);
        if (!parsed.ok) throw new ActionError("bad_action", parsed.message);
        if (!isValidSuiAddress(normalizeSuiAddress(account))) {
            throw new ActionError("bad_action", "The host is an Account ID, 0x and 64 hex digits.");
        }
        await this.named();
        await this.funded();
        await this.backend.joinLobby(normalizeSuiAddress(account), parsed.code);
        return this.advance();
    }

    /** The listed lobbies, soonest to expire first, full ones included (they can't be joined). */
    async lobbies(): Promise<OpenLobby[]> {
        const listed = await this.backend.listLobbies();
        const open = await Promise.all(
            listed.map(async (lobby): Promise<OpenLobby> => {
                const host = await this.backend.accountById(lobby.host);
                const since = host?.search.kind === "searching" ? host.search.sinceMs : null;
                if (!this.names.has(lobby.host) && host) {
                    this.names.set(lobby.host, await this.backend.playerName(lobby.host));
                }
                return {
                    host: lobby.host,
                    hostName: this.names.get(lobby.host) ?? null,
                    size: lobby.size,
                    full: lobby.guest !== null,
                    expiresInMs:
                        since === null ? 0 : Math.max(0, lobbyExpiresAtMs(since) - this.now()),
                };
            }),
        );
        return open.sort((a, b) => a.expiresInMs - b.expiresInMs);
    }

    /** Take the guest slot of the listed lobby of `host`: then `wait` for its host to start. */
    async joinOpen(host: string): Promise<Situation> {
        if (!isValidSuiAddress(normalizeSuiAddress(host))) {
            throw new ActionError("bad_action", "The host is an Account ID, 0x and 64 hex digits.");
        }
        await this.named();
        await this.funded();
        await this.backend.joinOpen(normalizeSuiAddress(host));
        return this.advance();
    }

    /** Leave the listed lobby this agent waits in. */
    async leaveLobby(): Promise<Situation> {
        await this.backend.leaveLobby();
        return this.situation();
    }

    /** Kick the guest out of this agent's listed lobby: they cannot join it again. */
    async kickGuest(): Promise<Situation> {
        await this.backend.kickGuest();
        return this.situation();
    }

    /** Start the friendly game of this agent's listed lobby with its guest. */
    async startFriendly(): Promise<Situation> {
        await this.backend.startFriendly();
        return this.advance();
    }

    /** Close this agent's lobby, of either kind. A guest is kicked first. */
    async closeLobby(): Promise<Situation> {
        await this.backend.closeLobby();
        return this.situation();
    }

    /** Close the expired lobby of `host` for them, kicking its guest: anyone can, once it is out. */
    async cleanUpLobby(host: string): Promise<Situation> {
        await this.backend.cleanUpLobby(normalizeSuiAddress(host));
        return this.situation();
    }

    /** The listed lobby of `host`, if it exists. */
    async lobby(host: string): Promise<LobbyView | null> {
        return this.backend.lobby(normalizeSuiAddress(host));
    }

    /** The balance in MIST and whether it is under the top-up trigger. */
    async balance(): Promise<{ network: string; address: string; balanceMist: string; balanceSui: number; belowTrigger: boolean }> {
        const balance = await this.backend.balanceMist();
        return {
            network: this.backend.network,
            address: this.backend.address,
            balanceMist: balance.toString(),
            balanceSui: Number(balance) / 1e9,
            belowTrigger: balance < TRIGGER_BALANCE,
        };
    }

    /**
     * Ask the testnet faucet for SUI under the top-up rule: nothing happens at or above 1 SUI,
     * otherwise requests go on until the balance is 2 SUI (at most three). Testnet only. A refusal
     * or a rate limit comes back as `error` with the faucet's `retryAfterSeconds`, never as a throw.
     */
    async requestFunds() {
        const { balance, requests, error } = await this.topUp();
        return {
            network: this.backend.network,
            address: this.backend.address,
            requested: requests > 0,
            requests,
            balanceMist: balance === null ? null : balance.toString(),
            balanceSui: balance === null ? null : Number(balance) / 1e9,
            error: error ? error.message : null,
            kind: error instanceof FaucetError ? error.kind : null,
            retryAfterSeconds: error instanceof FaucetError ? (error.retryAfterSeconds ?? null) : null,
        };
    }

    private async topUp(): Promise<FundsOutcome> {
        if (this.backend.network !== "testnet") {
            throw new ActionError(
                "rejected",
                `The faucet is testnet only; this agent is on ${this.backend.network}.`,
            );
        }
        return ensureFunds({
            balance: () => this.backend.balanceMist(),
            request: () => this.backend.requestFaucet(),
        });
    }

    /**
     * Before an Account is made or a game starts: on testnet, top the balance up when it is under
     * the trigger. A failed request stops nothing while the balance can still pay for gas.
     */
    private async funded(): Promise<void> {
        if (this.backend.network !== "testnet") return;
        const { balance, error } = await this.topUp();
        if (error && (balance === null || balance < GAS_FLOOR)) {
            throw new ActionError(
                "low_balance",
                `Not enough SUI for gas and the faucet did not help: ${error.message}`,
                true,
            );
        }
    }

    private async named(): Promise<void> {
        this.ownName ??= await this.backend.name();
        if (!this.ownName) {
            throw new ActionError("no_name", "Pick your name before your first game.");
        }
    }

    /** The current game and this agent's side in it. */
    async current(): Promise<{ state: GameState; side: number }> {
        const account = await this.backend.account();
        if (!account) throw new ActionError("no_account", "This agent has no account yet.");
        if (account.search.kind !== "playing") {
            throw new ActionError("no_game", "This agent is not in a game.");
        }
        const state = await this.backend.game(account.search.game);
        if (!state) throw new ActionError("no_game", "The game has already been completed.");
        return { state, side: state.players.indexOf(account.id) };
    }

    /**
     * The game as an agent reads it: a text map and a unit table. The only text
     * players author is their names, which SuiNS label rules keep to `[a-z0-9-]`.
     */
    async observe(): Promise<Observation> {
        const { state, side } = await this.current();
        const opponentId = state.players[1 - side];
        if (!this.names.has(opponentId)) {
            this.names.set(opponentId, await this.backend.playerName(opponentId));
        }
        const marks = new Map<string, string>();
        const units: ObservedUnit[] = [];
        for (const owner of [side, 1 - side]) {
            const alphabet = owner === side ? "ABCD" : "wxyz";
            state.units
                .filter((unit) => unit.side === owner)
                .forEach((unit, i) => {
                    const mark = alphabet[i] ?? "?";
                    const stats = effectiveStats(unit);
                    marks.set(`${unit.x},${unit.y}`, mark);
                    units.push({
                        mark,
                        mine: owner === side,
                        x: unit.x,
                        y: unit.y,
                        hp: `${unit.hp}/${unit.hpMax}`,
                        ap: unit.ap,
                        ammo: `${unit.ammo}/${unit.ammoMax}`,
                        grenade: hasUsesLeft(unit, "grenade"),
                        flashbang: hasUsesLeft(unit, "flashbang"),
                        smokeGrenade: hasUsesLeft(unit, "smoke_grenade"),
                        effects: unit.effects,
                        actions: unit.actions,
                        mobility: stats.mobility,
                        aim: stats.aim,
                        range: stats.range,
                        damage: `${stats.damage}±${stats.spread}`,
                        armor: stats.armor,
                        dodge: stats.dodge,
                        defense: stats.defense,
                    });
                });
        }
        const map = state.tiles.map((row, x) =>
            row
                .map((tile, y) => {
                    const mark = marks.get(`${x},${y}`);
                    if (mark) return mark;
                    if (tile.kind === "wall") return "#";
                    if (tile.kind === "unwalkable") return "~";
                    if (tile.kind !== "cover") return ".";
                    const high = [tile.left, tile.top, tile.right, tile.bottom].includes(2);
                    return high ? "=" : "+";
                })
                .join(""),
        );
        return {
            game: state.id,
            version: state.version,
            you: this.ownName,
            opponent: this.names.get(opponentId) ?? null,
            turn: state.turn,
            yourTurn: state.status.kind === "active" && state.active === side,
            status: state.status.kind,
            mode: state.mode,
            turnMsLeft: Math.max(0, state.deadlineMs - this.now()),
            map,
            legend: LEGEND,
            units,
            recent: lastTwoTurns(state.history),
        };
    }

    /** The orders open now. Each kind is sorted best first, so `limit` keeps the best ones. */
    async legal(filter: LegalFilter = {}): Promise<{ actions: LegalAction[]; omitted: number }> {
        const { state, side } = await this.current();
        let all = legalActions(state, side, this.now());
        if (filter.unit) {
            const [x, y] = filter.unit;
            all = all.filter((a) => a.unit?.[0] === x && a.unit?.[1] === y);
        }
        if (filter.kind) all = all.filter((a) => a.kind === filter.kind);
        if (filter.limit === undefined) return { actions: all, omitted: 0 };

        const seen = new Map<string, number>();
        const actions = all.filter((a) => {
            const key = `${a.unit?.join(",")}:${a.kind}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
            return seen.get(key)! <= filter.limit!;
        });
        return { actions, omitted: all.length - actions.length };
    }

    /**
     * Send orders as one transaction, checked against a fresh read first. An
     * order can't be spent twice: a repeat fails the check, since the AP is gone.
     */
    async act(ids: string[]): Promise<ActResult> {
        const { state, side } = await this.current();
        const actions = validateBatch(state, side, ids, this.now());
        const receipt = await this.backend.submit(state, actions);
        return { receipt, situation: await this.situation() };
    }
}

function todo(phase: Phase, next: string): Pick<Situation, "phase" | "actionable" | "next"> {
    return { phase, actionable: true, next };
}

/** The records since the start of the previous turn. */
function lastTwoTurns(history: GameRecord[]): GameRecord[] {
    let turns = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].kind === "next_turn" && ++turns === 2) return history.slice(i + 1);
    }
    return history;
}

export interface PlayOptions {
    games?: number;
    /** The name to take if this agent has none. Without one, an unnamed agent stops and says so. */
    name?: string;
    signal?: AbortSignal;
    onEvent?: (event: { situation: Situation; receipt?: Receipt }) => void;
}

/**
 * The autonomous loop: sleep until there is something to do, ask the policy only
 * then, act. The policy runs once per decision and never while waiting, which is
 * what makes LLM-driven fleets affordable.
 */
export async function playGames(
    agent: GhostsAgent,
    policy: Policy,
    options: PlayOptions = {},
): Promise<{ played: number; results: Situation["result"][] }> {
    const games = options.games ?? 1;
    const results: Situation["result"][] = [];
    const counted = new Set<string>();

    while (!options.signal?.aborted) {
        // An in-memory backend resolves everything at once: yield, or timers never fire.
        await new Promise((resolve) => setImmediate(resolve));
        const situation = await agent.wait({ timeoutMs: 60_000, signal: options.signal });
        options.onEvent?.({ situation });

        switch (situation.phase) {
            case "no_name":
                if (!options.name) {
                    throw new ActionError("no_name", "Pick a name: pass the name option.");
                }
                await agent.setName(options.name);
                break;
            case "no_account":
            case "no_squad":
                await agent.setup();
                break;
            case "idle":
                if (results.length >= games) return { played: results.length, results };
                await agent.setup(); // hires are free: replace the fallen before queueing
                await agent.findGame();
                break;
            case "game_over":
                if (!counted.has(situation.game!)) {
                    counted.add(situation.game!);
                    results.push(situation.result);
                }
                try {
                    const { receipt } = await agent.act(["complete"]);
                    options.onEvent?.({ situation, receipt });
                } catch (error) {
                    // Anyone can complete a game, so the opponent may already have.
                    if (!(error instanceof ActionError)) throw error;
                }
                break;
            case "deploy":
            case "deployment_over":
            case "your_turn":
            case "opponent_timed_out": {
                const { state, side } = await agent.current();
                const nowMs = agent.now();
                const legal = legalActions(state, side, nowMs);
                const ids = await policy({ state, side, legal, nowMs });
                const { receipt } = await agent.act(ids);
                options.onEvent?.({ situation, receipt });
                break;
            }
            default:
                break;
        }
    }
    return { played: results.length, results };
}
