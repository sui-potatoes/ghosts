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
import { nameProblem, normalizeName } from "./names.ts";
import { legalActions, SEARCH_TIMEOUT_MS, validateBatch, type LegalAction } from "./rules.ts";
import {
    ActionError,
    type AccountView,
    type GameRecord,
    type GameState,
    type Receipt,
} from "./types.ts";
import { pollingWake, type Wake } from "./wake.ts";

export type Phase =
    | "no_name"
    | "no_account"
    | "no_squad"
    | "suspended"
    | "idle"
    | "searching"
    | "game_found"
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
    turn?: number;
    /** Time left to deploy or on the current turn. Past zero, only `next_turn` is open. */
    turnMsLeft?: number;
    /** Set in `game_over`: "won", "lost" or "draw". */
    result?: "won" | "lost" | "draw";
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
    mobility: number;
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

    async situation(): Promise<Situation> {
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
        if (account.search.kind === "searching") {
            return { phase: "searching", actionable: false, next: "Wait for an opponent." };
        }
        if (account.search.kind === "found") {
            return { phase: "game_found", actionable: false, next: "Wait: the game is starting." };
        }
        if (this.now() < account.suspendedUntilMs) {
            return {
                phase: "suspended",
                actionable: false,
                next: "Wait: this account left a game behind and can't search yet.",
            };
        }
        const short = account.recruits < 4;
        return todo(
            "idle",
            short ? "Run setup to replace the fallen, then find a game." : "Find a game.",
        );
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
     * Sleep until the agent has something to do, or `timeoutMs` passes. A found
     * game is started on the way, so an agent never has to know that step.
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

    /** The situation, after starting the game this account found an opponent for. */
    private async advance(): Promise<Situation> {
        const account = await this.backend.account();
        if (account?.search.kind === "found") {
            try {
                await this.backend.startGame(account.search.opponent);
            } catch (error) {
                // The opponent moved on, which leaves this account holding nothing: let go.
                // Not `cancelSearch`: that costs a suspension on a found game.
                if (!(error instanceof ActionError) || error.code !== "rejected") throw error;
                await this.backend.releaseGame(account.search.opponent);
            }
        }
        if (
            account?.search.kind === "searching" &&
            this.now() - account.search.sinceMs > SEARCH_TIMEOUT_MS
        ) {
            // The ticket has expired, so nobody can find this account until it searches again.
            await this.backend.cancelSearch();
        }
        return this.situation();
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

    /** Open the account and fill the squad, whichever of those is still missing. */
    async setup(): Promise<Situation> {
        if (!(await this.backend.account())) await this.backend.createAccount();
        const account = await this.backend.account();
        if (account && this.recovery && !account.recovery) {
            await this.backend.setRecovery(this.recovery);
        }
        if (account && account.recruits < 4 && account.search.kind === "idle") {
            await this.backend.hireSquad();
        }
        return this.situation();
    }

    async findGame(): Promise<Situation> {
        this.ownName ??= await this.backend.name();
        if (!this.ownName) {
            throw new ActionError("no_name", "Pick your name before your first game.");
        }
        await this.backend.findGame();
        return this.advance();
    }

    async cancelSearch(): Promise<Situation> {
        await this.backend.cancelSearch();
        return this.situation();
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
                    marks.set(`${unit.x},${unit.y}`, mark);
                    units.push({
                        mark,
                        mine: owner === side,
                        x: unit.x,
                        y: unit.y,
                        hp: `${unit.hp}/${unit.hpMax}`,
                        ap: unit.ap,
                        ammo: `${unit.ammo}/${unit.ammoMax}`,
                        grenade: !unit.grenadeUsed,
                        mobility: unit.stats.mobility,
                        aim: unit.stats.aim,
                        range: unit.stats.range,
                        damage: `${unit.stats.damage}±${unit.stats.spread}`,
                        armor: unit.stats.armor,
                        dodge: unit.stats.dodge,
                        defense: unit.stats.defense,
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
