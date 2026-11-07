// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * An in-memory `Backend`: a game on the match preset against a scripted opponent,
 * no key or gas needed. It follows `ghosts::ghosts` for the loop (the waiting
 * player goes first, the turn clock only passes a turn, `complete` sends everyone
 * home) and `unit::perform_attack`, `apply_damage` and `map::explode` for the dice,
 * so odds match the chain. You always find the opponent here, so you play second.
 */

import type { Backend } from "./backend.ts";
import { decodeTiles, gridSize, MapBcs } from "./bcs.ts";
import { referencePolicy, type Policy } from "./bot.ts";
import { BLACK_RAIN, BLACK_RAIN_POSITIONS } from "./maps.ts";
import {
    applyDeterministic,
    blastUnits,
    coverBonus,
    DEPLOY_LIMIT_MS,
    GRENADE_DAMAGE,
    GRENADE_RADIUS,
    hitChance,
    legalActions,
    manhattan,
    MAX_MISSED_TURNS,
    MAX_TURNS,
    parseAction,
    SUSPENSION_MS,
    TURN_LIMIT_MS,
    unitAt,
} from "./rules.ts";
import {
    ActionError,
    type AccountView,
    type Action,
    type GameRecord,
    type GameState,
    type Stats,
    type Unit,
} from "./types.ts";

export interface SandboxOptions {
    seed?: number;
    /** The opponent's policy; `null` leaves it silent, to exercise the turn clock. */
    opponent?: Policy | null;
    /** Nobody is ever waiting, so a search only times out. */
    empty?: boolean;
    /** The opponent found is already gone, so the game can't start. */
    ghosted?: boolean;
    /** Time source, so tests can run the clock past a deadline. */
    now?: () => number;
    startingBalanceMist?: bigint;
}

const YOU = "0x0000000000000000000000000000000000000000000000000000000000000a01";
const THEM = "0x0000000000000000000000000000000000000000000000000000000000000b01";
const ACCOUNT = "0x0000000000000000000000000000000000000000000000000000000000000a02";
const OPPONENT_ACCOUNT = "0x0000000000000000000000000000000000000000000000000000000000000b02";

/** The waiting player goes first, and in the sandbox that is always the opponent. */
const THEIR_SIDE = 0;
const YOUR_SIDE = 1;

/** The scripted opponent picked its own name too. */
const OPPONENT_NAME = "sparring-partner";

const FREE_RECRUITS = 4;
const ACTION_GAS_MIST = 500_000n;
const MAX_OPPONENT_ACTIONS = 32;

/** `stats::default()` plus `stats::default_weapon()`. */
const OPERATIVE: Stats = {
    mobility: 7,
    aim: 65,
    health: 10,
    armor: 0,
    dodge: 0,
    defense: 0,
    damage: 4,
    spread: 2,
    plusOne: 0,
    critChance: 0,
    canBeDodged: 1,
    areaSize: 0,
    envDamage: 0,
    range: 4,
    ammo: 3,
};

/** mulberry32: small, seedable, good enough for dice in a sandbox. */
function dice(seed: number) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { inRange: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)) };
}

function hexId(prefix: string, n: number): string {
    return `0x${prefix}${n.toString(16).padStart(64 - prefix.length, "0")}`;
}

export function createSandbox(options: SandboxOptions = {}): Backend {
    const rng = dice(options.seed ?? 1);
    const now = options.now ?? Date.now;
    const opponent = options.opponent === undefined ? referencePolicy : options.opponent;

    let balance = options.startingBalanceMist ?? 10_000_000_000n;
    let name: string | null = null;
    let account: AccountView | null = null;
    let current: GameState | null = null;
    let [digests, games, version] = [0, 0, 0];

    function receipt(records: GameRecord[], gas = ACTION_GAS_MIST) {
        balance -= gas;
        return { digest: `sandbox-${++digests}`, gasMist: gas.toString(), records };
    }

    function requireAccount(): AccountView {
        if (!account) throw new ActionError("no_account", "This agent has no account yet.");
        return account;
    }

    /** `start_game`: the first half of the spawn positions goes to the first player. */
    function freshGame(): GameState {
        const map = MapBcs.parse(Uint8Array.from(Buffer.from(BLACK_RAIN, "hex")));
        const half = BLACK_RAIN_POSITIONS.length / 2;
        return {
            id: hexId("9", ++games),
            version: String(++version),
            ...gridSize(map),
            turn: 0,
            active: 0,
            players: [OPPONENT_ACCOUNT, ACCOUNT],
            squads: [[], []],
            fallen: [0, 0],
            positions: [BLACK_RAIN_POSITIONS.slice(0, half), BLACK_RAIN_POSITIONS.slice(half)],
            history: [],
            missed: [0, 0],
            abandonedBy: null,
            deadlineMs: now() + DEPLOY_LIMIT_MS,
            status: { kind: "deploying" },
            tiles: decodeTiles(map),
            units: [],
        };
    }

    /** `is_over` and `winner`, once deployment is over. */
    function checkFinished(state: GameState): void {
        if (state.status.kind !== "active") return;
        const [firstOut, secondOut] = state.squads.map((squad) => squad.length === 0);
        if (!firstOut && !secondOut && state.turn < MAX_TURNS) return;
        const winner = firstOut === secondOut ? null : state.players[secondOut ? 0 : 1];
        state.status = { kind: "finished", winner };
    }

    /** `abandoned_by`: whoever gave up or missed too many turns loses. */
    function abandonedBy(state: GameState, side: number): void {
        state.abandonedBy = state.players[side];
        state.status = { kind: "finished", winner: state.players[1 - side] };
    }

    /** `begin_match`: the first turn starts now. */
    function beginMatch(state: GameState): void {
        state.status = { kind: "active" };
        state.deadlineMs = now() + TURN_LIMIT_MS;
        checkFinished(state);
    }

    /** `deploy_squad`: as many recruits as the side has spawn positions, used from the back. */
    function deploy(state: GameState, side: number): GameRecord[] {
        const records: GameRecord[] = [];
        const open = state.positions[side].length;
        const size = side === YOUR_SIDE ? Math.min(open, requireAccount().recruits) : open;
        for (let i = 0; i < size; i++) {
            const [x, y] = state.positions[side].pop()!;
            const recruit = hexId(`${side + 1}`, games * 100 + i);
            state.squads[side].push(recruit);
            state.units.push({
                recruit,
                side,
                x,
                y,
                ap: 2,
                apMax: 2,
                hp: OPERATIVE.health,
                hpMax: OPERATIVE.health,
                ammo: OPERATIVE.ammo,
                ammoMax: OPERATIVE.ammo,
                grenadeUsed: false,
                stats: OPERATIVE,
            });
            records.push({ kind: "placed", x, y });
        }
        if (side === YOUR_SIDE) requireAccount().recruits -= size;
        if (state.squads.every((squad) => squad.length > 0)) beginMatch(state);
        return records;
    }

    /** `unit::apply_damage`, then `bury_fallen` on a kill. */
    function damage(state: GameState, unit: Unit, amount: number, canDodge: boolean): GameRecord[] {
        const dealt = unit.stats.armor >= amount ? 1 : amount - unit.stats.armor;
        if (canDodge && rng.inRange(0, 99) < unit.stats.dodge) {
            return [{ kind: "dodged" }, { kind: "damage", amount: 0 }];
        }
        unit.hp = Math.max(0, unit.hp - dealt);
        const records: GameRecord[] = [{ kind: "damage", amount: dealt }];
        if (unit.hp === 0) {
            state.units = state.units.filter((other) => other !== unit);
            state.squads[unit.side] = state.squads[unit.side].filter((id) => id !== unit.recruit);
            state.fallen[unit.side] += 1;
            records.push({ kind: "kia", recruit: unit.recruit });
        }
        return records;
    }

    /** `map::explode`. */
    function explode(
        state: GameState,
        x: number,
        y: number,
        radius: number,
        amount: number,
        envDamage: boolean,
        canDodge: boolean,
    ): GameRecord[] {
        const records: GameRecord[] = [{ kind: "explosion", x, y, radius }];
        for (const unit of blastUnits(state, x, y, radius)) {
            records.push(...damage(state, unit, amount, canDodge));
        }
        if (envDamage) {
            state.tiles.forEach((row, tx) =>
                row.forEach((tile, ty) => {
                    if (tile.kind === "cover" && manhattan(tx, ty, x, y) <= radius) {
                        state.tiles[tx][ty] = { kind: "empty" };
                    }
                }),
            );
        }
        return records;
    }

    /** `map::perform_attack` with `unit::perform_attack`. */
    function attack(state: GameState, action: Extract<Action, { kind: "attack" }>): GameRecord[] {
        const { x, y, tx, ty } = action;
        const unit = unitAt(state, x, y)!;
        const { stats } = unit;
        const records: GameRecord[] = [{ kind: "attack", from: [x, y], to: [tx, ty] }];
        const range = manhattan(x, y, tx, ty);
        const target = unitAt(state, tx, ty);
        const defense =
            stats.areaSize > 0
                ? 0
                : Math.min(
                      100,
                      (range > 0 ? coverBonus(state, x, y, tx, ty) : 0) + target!.stats.defense,
                  );
        const chance = hitChance(stats, range, defense);

        unit.ap = 0;
        unit.ammo -= 1;
        if (rng.inRange(0, 99) >= chance) return [...records, { kind: "miss" }];

        const crit = rng.inRange(0, 99) < stats.critChance;
        let amount =
            rng.inRange(0, 1) === 1
                ? stats.damage + rng.inRange(0, stats.spread)
                : stats.damage - rng.inRange(0, Math.min(stats.spread, stats.damage));
        if (rng.inRange(0, 99) < stats.plusOne) amount += 1;
        if (crit) amount += Math.floor(stats.damage / 2);
        amount = Math.min(amount, 255);

        if (stats.areaSize > 0) {
            const blast = explode(
                state,
                tx,
                ty,
                stats.areaSize,
                amount,
                stats.envDamage !== 0,
                stats.canBeDodged !== 0,
            );
            return [...records, ...blast];
        }
        const applied = damage(state, target!, amount, stats.canBeDodged !== 0);
        if (crit) {
            return [
                ...records,
                ...applied.map((r) =>
                    r.kind === "damage" ? { kind: "critical_hit" as const, amount: r.amount } : r,
                ),
            ];
        }
        return [...records, ...applied];
    }

    /** `next_turn`: past the time to deploy it ends deployment instead. */
    function nextTurn(state: GameState, side: number): GameRecord[] {
        if (state.status.kind === "deploying") {
            beginMatch(state);
            return [];
        }
        const { active } = state;
        if (side === active) {
            state.missed[active] = 0;
        } else {
            state.missed[active] += 1;
            if (state.missed[active] === MAX_MISSED_TURNS) {
                abandonedBy(state, active);
                return [];
            }
        }
        const ended = applyDeterministic(state, { kind: "next_turn" });
        state.turn = ended.turn;
        state.active = ended.active;
        state.units = ended.units;
        state.deadlineMs = now() + TURN_LIMIT_MS;
        return [{ kind: "next_turn", turn: state.turn }];
    }

    /** `complete_game`: the survivors go home, the result goes on the score, and `Idle` again. */
    function complete(state: GameState): void {
        const me = requireAccount();
        const { status } = state;
        const winner = status.kind === "finished" ? status.winner : null;
        if (winner === null) me.score.draws += 1;
        else if (winner === me.id) me.score.wins += 1;
        else me.score.losses += 1;

        // `misbehaved`: it gave up, or deployment ended with nobody to show, fallen or alive.
        const absent = state.squads[YOUR_SIDE].length === 0 && state.fallen[YOUR_SIDE] === 0;
        if (state.abandonedBy === me.id || absent) me.suspendedUntilMs = now() + SUSPENSION_MS;

        me.recruits += state.squads[YOUR_SIDE].length;
        me.search = { kind: "idle" };
        current = null;
    }

    function apply(state: GameState, side: number, action: Action): GameRecord[] {
        let records: GameRecord[] = [];
        // `begin_turn_action`: acting at all clears the missed turns.
        if (["move", "reload", "attack", "grenade"].includes(action.kind)) state.missed[side] = 0;
        switch (action.kind) {
            case "deploy":
                records = deploy(state, side);
                break;
            case "attack":
                records = attack(state, action);
                break;
            case "grenade": {
                const unit = unitAt(state, action.x, action.y)!;
                unit.ap -= 1;
                unit.grenadeUsed = true;
                records = [
                    { kind: "grenade", from: [action.x, action.y], to: [action.tx, action.ty] },
                    ...explode(
                        state,
                        action.tx,
                        action.ty,
                        GRENADE_RADIUS,
                        GRENADE_DAMAGE,
                        true,
                        false,
                    ),
                ];
                break;
            }
            case "move":
                state.units = applyDeterministic(state, action).units;
                records = [{ kind: "move", path: [action.x, action.y, ...action.path] }];
                break;
            case "reload":
                state.units = applyDeterministic(state, action).units;
                records = [{ kind: "reload", x: action.x, y: action.y }];
                break;
            case "next_turn":
                records = nextTurn(state, side);
                break;
            case "abandon":
                abandonedBy(state, side);
                complete(state);
                break;
            case "complete":
                complete(state);
                break;
        }
        state.history.push(...records);
        checkFinished(state);
        return records;
    }

    async function opponentTurn(state: GameState): Promise<void> {
        if (!opponent) return;
        for (let i = 0; i < MAX_OPPONENT_ACTIONS; i++) {
            if (state.status.kind !== "active" || state.active !== THEIR_SIDE) return;
            const legal = legalActions(state, THEIR_SIDE, now());
            const ids = await opponent({ state, side: THEIR_SIDE, legal, nowMs: now() });
            for (const id of ids) apply(state, THEIR_SIDE, parseAction(id));
        }
        // A policy that never ends its turn must not hang the sandbox.
        if (state.status.kind === "active" && state.active === THEIR_SIDE) {
            apply(state, THEIR_SIDE, { kind: "next_turn" });
        }
    }

    return {
        network: "sandbox",
        address: YOU,
        signer: YOU,

        balanceMist: async () => balance,
        name: async () => name,
        playerName: async (id) => (id === ACCOUNT ? name : OPPONENT_NAME),

        async setRecovery(wallet) {
            const me = requireAccount();
            if (me.recovery) {
                throw new ActionError(
                    "rejected",
                    "This account already has a recovery wallet. Only that wallet can change it.",
                );
            }
            me.recovery = wallet;
            return receipt([]);
        },

        async setName(next) {
            if (next === OPPONENT_NAME) {
                throw new ActionError("name_taken", "That name is taken: pick another.");
            }
            name = next;
            return receipt([]);
        },

        account: async () => (account ? structuredClone(account) : null),
        game: async (id) => (current?.id === id ? structuredClone(current) : null),

        async createAccount() {
            if (account) throw new ActionError("rejected", "This address already has an account.");
            account = {
                id: ACCOUNT,
                owner: YOU,
                rating: 1500,
                deviation: 350,
                score: { wins: 0, losses: 0, draws: 0 },
                recruits: 0,
                search: { kind: "idle" },
                suspendedUntilMs: 0,
                recovery: null,
            };
            return receipt([]);
        },

        async hireSquad() {
            const me = requireAccount();
            if (me.search.kind === "playing") {
                throw new ActionError("rejected", "The squad is in a game.");
            }
            if (me.recruits >= FREE_RECRUITS) {
                throw new ActionError("rejected", "The squad is already full.");
            }
            me.recruits = FREE_RECRUITS;
            return receipt([]);
        },

        async findGame() {
            const me = requireAccount();
            if (me.search.kind !== "idle") {
                throw new ActionError("rejected", "This account is already searching or playing.");
            }
            if (now() < me.suspendedUntilMs) {
                throw new ActionError(
                    "rejected",
                    "This account is suspended: it left a game behind.",
                );
            }
            if (me.recruits === 0) {
                throw new ActionError("rejected", "This account has no recruits to play with.");
            }
            const order = hexId("7", digests + 1);
            me.search = options.empty
                ? { kind: "searching", order, sinceMs: now() }
                : { kind: "found", order, opponent: THEM };
            return receipt([]);
        },

        async cancelSearch() {
            const me = requireAccount();
            if (me.search.kind === "idle" || me.search.kind === "playing") {
                throw new ActionError("rejected", "This account is not searching.");
            }
            // Walking away from a found game leaves the other player with nothing.
            if (me.search.kind === "found") me.suspendedUntilMs = now() + SUSPENSION_MS;
            me.search = { kind: "idle" };
            return receipt([]);
        },

        async releaseGame() {
            const me = requireAccount();
            if (me.search.kind !== "found") {
                throw new ActionError("rejected", "This account has not found a game.");
            }
            if (!options.ghosted) {
                throw new ActionError("rejected", "The opponent is still waiting on this game.");
            }
            me.search = { kind: "idle" };
            return receipt([]);
        },

        async startGame() {
            const me = requireAccount();
            if (me.search.kind !== "found") {
                throw new ActionError("rejected", "This account has not found a game.");
            }
            if (options.ghosted) {
                throw new ActionError(
                    "rejected",
                    "The opponent is no longer waiting on this game.",
                );
            }
            current = freshGame();
            me.search = { kind: "playing", game: current.id };
            return receipt(apply(current, THEIR_SIDE, { kind: "deploy" }));
        },

        async submit(game, actions) {
            if (!current || current.id !== game.id) {
                throw new ActionError("no_game", "That game is not running.");
            }
            const state = current;
            const records = actions.flatMap((action) => apply(state, YOUR_SIDE, action));
            if (current) {
                await opponentTurn(state);
                state.version = String(++version);
            }
            return receipt(records);
        },
    };
}
