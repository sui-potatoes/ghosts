// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * An in-memory `Backend`: a game on the match preset against a scripted opponent,
 * no key or gas needed. It follows `ghosts::ghosts` for the loop (a match starts the
 * game for the player who finds it, the waiting one is seated and goes first, the
 * turn clock only passes a turn, kills wait for `bury_fallen`, `complete` sends
 * everyone home) and `unit::perform_attack`, `apply_damage` and `map::explode` for the
 * dice, so odds match the chain. By default you find the opponent, so you play second;
 * with `seated` you wait and the opponent finds you.
 */

import type { Backend } from "./backend.ts";
import { decodeTiles, gridSize, MapBcs, winnerOf } from "./bcs.ts";
import { referencePolicy, type Policy } from "./bot.ts";
import { BLACK_RAIN, BLACK_RAIN_POSITIONS } from "./maps.ts";
import {
    applyDeterministic,
    blastUnits,
    coverBonus,
    DEPLOY_LIMIT_MS,
    FREE_RECRUITS,
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
    type Ending,
    type GameRecord,
    type GameState,
    type Stats,
    type Unit,
    type UnitActionEntry,
} from "./types.ts";

export interface SandboxOptions {
    seed?: number;
    /** The opponent's policy; `null` leaves it silent, to exercise the turn clock. */
    opponent?: Policy | null;
    /** Nobody is ever waiting, so a search only times out. */
    empty?: boolean;
    /**
     * You wait in the queue and the opponent finds you: the game starts with a `Seat`
     * for you to accept, and you go first.
     */
    seated?: boolean;
    /** Time source, so tests can run the clock past a deadline. */
    now?: () => number;
    startingBalanceMist?: bigint;
}

const YOU = "0x0000000000000000000000000000000000000000000000000000000000000a01";
const ACCOUNT = "0x0000000000000000000000000000000000000000000000000000000000000a02";
const OPPONENT_ACCOUNT = "0x0000000000000000000000000000000000000000000000000000000000000b02";

/** The scripted opponent picked its own name too. */
const OPPONENT_NAME = "sparring-partner";

const ACTION_GAS_MIST = 500_000n;
const MAX_OPPONENT_ACTIONS = 32;

/** `stats::default()` plus `stats::default_weapon()`: a recruit with no weapon. */
const UNARMED: Stats = {
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

/** The same with a standard rifle (`items::rifle`, tier 1): +10% plus-one and crit. */
const ARMED: Stats = { ...UNARMED, plusOne: 10, critChance: 10 };

/**
 * `unit::from_recruit`: `Move` for all, the weapon adds `Attack` and `Reload`, then each
 * utility adds its own actions (`Grenade` for the frag grenade).
 */
const entry = (kind: UnitActionEntry["kind"], uses: number | null = null): UnitActionEntry => ({
    kind,
    uses,
});
const UNARMED_ACTIONS = (): UnitActionEntry[] => [entry("move")];
const ARMED_ACTIONS = (): UnitActionEntry[] => [entry("move"), entry("attack"), entry("reload")];

/** `recruit::MAX_UTILITIES`: the utility slots of a recruit. */
const MAX_UTILITIES = 1;

/**
 * A utility as it is carried: the actions it grants, with their uses. Its stats are a modifier
 * for the carrier, zero for the frag grenade, so the sandbox keeps none.
 */
interface Utility {
    actions: UnitActionEntry[];
}

/** `items::frag_grenade`: a `Grenade` action usable once per match. */
const fragGrenade = (): Utility => ({ actions: [entry("grenade", 1)] });

/** A recruit at home in the `Account`. */
interface Recruit {
    id: string;
    armed: boolean;
    utilities: Utility[];
}

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
    let home: Recruit[] = [];
    /** What each recruit on the map carries, for when it goes home. */
    const carried = new Map<string, Utility[]>();
    let current: GameState | null = null;
    /** The game a match started for this account while it waited: the seat's game. */
    let seated: GameState | null = null;
    /** The waiting player goes first; the one who finds them plays second. */
    const yourSide = options.seated ? 0 : 1;
    let [digests, games, version, recruits] = [0, 0, 0, 0];

    const theirSide = () => 1 - yourSide;

    function receipt(records: GameRecord[], gas = ACTION_GAS_MIST) {
        balance -= gas;
        return { digest: `sandbox-${++digests}`, gasMist: gas.toString(), records };
    }

    function requireAccount(): AccountView {
        if (!account) throw new ActionError("no_account", "This agent has no account yet.");
        return account;
    }

    function hire(armed: boolean, utilities: Utility[] = []): Recruit {
        return { id: hexId("5", ++recruits), armed, utilities };
    }

    /** `new_game`: the first half of the spawn positions goes to the first player. */
    function freshGame(waiting: string, finder: string): GameState {
        const map = MapBcs.parse(Uint8Array.from(Buffer.from(BLACK_RAIN, "hex")));
        const half = BLACK_RAIN_POSITIONS.length / 2;
        return {
            id: hexId("9", ++games),
            version: String(++version),
            ...gridSize(map),
            turn: 0,
            active: 0,
            players: [waiting, finder],
            squads: [[], []],
            fallen: [],
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

    /** A side's recruits are its units on the map. */
    function refreshSquads(state: GameState): void {
        state.squads = state.players.map((player) =>
            state.units.filter((unit) => unit.owner === player).map((unit) => unit.recruit),
        );
    }

    /** `State::Over`: the game waits for `complete_game`. */
    function over(state: GameState, ending: Ending): void {
        state.status = { kind: "finished", winner: winnerOf(ending, state.players), ending };
        state.abandonedBy = ["abandoned", "forfeited", "no_show"].includes(ending.kind)
            ? ending.by
            : null;
        state.deadlineMs = 0;
    }

    /** `count_losses`: a kill that leaves a side with nobody on the map ends the game. */
    function countLosses(state: GameState, records: GameRecord[]): void {
        if (!records.some((record) => record.kind === "kia")) return;
        const [first, second] = state.squads.map((squad) => squad.length > 0);
        if (!first && !second) over(state, { kind: "draw", by: null });
        else if (!first) over(state, { kind: "won", by: state.players[1] });
        else if (!second) over(state, { kind: "won", by: state.players[0] });
    }

    /** `begin_match`: the first turn starts now, unless a side has nobody to show. */
    function beginMatch(state: GameState): void {
        const [first, second] = state.squads.map((squad) => squad.length > 0);
        if (!first && !second) over(state, { kind: "nobody_showed", by: null });
        else if (!first) over(state, { kind: "no_show", by: state.players[0] });
        else if (!second) over(state, { kind: "no_show", by: state.players[1] });
        else {
            state.status = { kind: "active" };
            state.missed = [0, 0];
            state.deadlineMs = now() + TURN_LIMIT_MS;
        }
    }

    /** `deploy_squad`: as many recruits as the side has spawn positions, used from the back. */
    function deploy(state: GameState, side: number): GameRecord[] {
        const records: GameRecord[] = [];
        const open = state.positions[side].length;
        // our recruits come from the account, armed ones first; the opponent's are made up
        const squad: Recruit[] =
            side === yourSide
                ? [...home].sort((a, b) => Number(b.armed) - Number(a.armed)).slice(0, open)
                : Array.from({ length: open }, () => hire(true, [fragGrenade()]));
        for (const recruit of squad) {
            const [x, y] = state.positions[side].pop()!;
            const stats = recruit.armed ? ARMED : UNARMED;
            state.units.push({
                recruit: recruit.id,
                owner: state.players[side],
                side,
                x,
                y,
                ap: 2,
                apMax: 2,
                hp: stats.health,
                hpMax: stats.health,
                ammo: stats.ammo,
                ammoMax: stats.ammo,
                stats,
                // `from_recruit`: base, weapon, then each utility's actions, none merged
                actions: [
                    ...(recruit.armed ? ARMED_ACTIONS() : UNARMED_ACTIONS()),
                    ...recruit.utilities.flatMap((utility) => structuredClone(utility.actions)),
                ],
            });
            carried.set(recruit.id, recruit.utilities);
            records.push({ kind: "placed", x, y });
        }
        if (side === yourSide) {
            home = home.filter((recruit) => !squad.includes(recruit));
            requireAccount().recruits = home.length;
        }
        refreshSquads(state);
        if (state.squads.every((squad) => squad.length > 0)) beginMatch(state);
        return records;
    }

    /** `unit::apply_damage`: a kill takes the unit off its tile, into `fallen` until `bury`. */
    function damage(state: GameState, unit: Unit, amount: number, canDodge: boolean): GameRecord[] {
        const dealt = unit.stats.armor >= amount ? 1 : amount - unit.stats.armor;
        if (canDodge && rng.inRange(0, 99) < unit.stats.dodge) {
            return [{ kind: "dodged" }];
        }
        unit.hp = Math.max(0, unit.hp - dealt);
        const records: GameRecord[] = [{ kind: "damage", amount: dealt }];
        if (unit.hp === 0) {
            state.units = state.units.filter((other) => other !== unit);
            state.fallen.push(unit.recruit);
            records.push({ kind: "kia", recruit: unit.recruit, x: unit.x, y: unit.y });
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

    /**
     * `next_turn`: the fallen are buried first. Past the time to deploy it ends deployment
     * instead; otherwise the turn passes, a miss counts against a side that let it run out,
     * and the side whose turn begins gets its AP back.
     */
    function nextTurn(state: GameState, side: number): GameRecord[] {
        state.fallen = [];
        if (state.status.kind === "deploying") {
            beginMatch(state);
            return [];
        }
        const { active } = state;
        if (side === active) state.missed[active] = 0;
        else state.missed[active] += 1;
        if (state.missed[active] === MAX_MISSED_TURNS) {
            over(state, { kind: "forfeited", by: state.players[active] });
            return [];
        }

        const ended = applyDeterministic(state, { kind: "next_turn" });
        state.turn = ended.turn;
        state.active = ended.active;
        state.units = ended.units;
        const records: GameRecord[] = [{ kind: "next_turn", turn: state.turn }];
        if (state.turn >= MAX_TURNS) over(state, { kind: "stalemate", by: null });
        else state.deadlineMs = now() + TURN_LIMIT_MS;
        return records;
    }

    /**
     * `complete_game`: the survivors go home, the result goes on the score, `Idle` again,
     * and whoever is to blame for how it ended is suspended.
     */
    function complete(state: GameState): void {
        const me = requireAccount();
        if (state.status.kind !== "finished") return;
        const { winner, ending } = state.status;
        // nobody showing up isn't a game: it goes on no score
        if (ending.kind !== "nobody_showed") {
            if (winner === null) me.score.draws += 1;
            else if (winner === me.id) me.score.wins += 1;
            else me.score.losses += 1;
        }
        // `misbehaved`
        if (state.abandonedBy === me.id || ending.kind === "nobody_showed") {
            me.suspendedUntilMs = now() + SUSPENSION_MS;
        }

        for (const unit of state.units.filter((unit) => unit.owner === me.id)) {
            home.push({
                id: unit.recruit,
                armed: unit.actions.some((action) => action.kind === "attack"),
                // the match spent no item: the same utilities, their uses full again
                utilities: carried.get(unit.recruit) ?? [],
            });
        }
        me.recruits = home.length;
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
                // `perform_grenade`: a use of the first grenade action that has one left
                const unit = unitAt(state, action.x, action.y)!;
                const spent = unit.actions.find(
                    (a) => a.kind === "grenade" && (a.uses === null || a.uses > 0),
                )!;
                unit.ap -= 1;
                if (spent.uses !== null) spent.uses -= 1;
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
                over(state, { kind: "abandoned", by: state.players[side] });
                complete(state);
                break;
            case "complete":
                complete(state);
                break;
        }
        state.history.push(...records);
        refreshSquads(state);
        countLosses(state, records);
        return records;
    }

    async function opponentTurn(state: GameState): Promise<void> {
        if (!opponent) return;
        const side = theirSide();
        for (let i = 0; i < MAX_OPPONENT_ACTIONS; i++) {
            if (state.status.kind !== "active" || state.active !== side) return;
            const legal = legalActions(state, side, now());
            const ids = await opponent({ state, side, legal, nowMs: now() });
            for (const id of ids) apply(state, side, parseAction(id));
        }
        // A policy that never ends its turn must not hang the sandbox.
        if (state.status.kind === "active" && state.active === side) {
            apply(state, side, { kind: "next_turn" });
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
            if (home.length >= FREE_RECRUITS) {
                throw new ActionError("rejected", "The squad is already full.");
            }
            // `hire_recruits`: no gear yet, so no `Attack`, `Reload` or `Grenade` on the map
            while (home.length < FREE_RECRUITS) home.push(hire(false));
            me.recruits = home.length;
            return receipt([]);
        },

        async armSquad() {
            requireAccount();
            const bare = home.filter(
                (recruit) => !recruit.armed || recruit.utilities.length < MAX_UTILITIES,
            );
            if (bare.length === 0) return null;
            for (const recruit of bare) {
                recruit.armed = true;
                // `requisition_utility` and `equip_utility`: a frag grenade into the free slot
                if (recruit.utilities.length < MAX_UTILITIES) recruit.utilities.push(fragGrenade());
            }
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
            if (options.empty) {
                me.search = { kind: "searching", order, sinceMs: now() };
                return receipt([]);
            }
            if (options.seated) {
                // the opponent found us later: it started the game and has deployed
                seated = freshGame(ACCOUNT, OPPONENT_ACCOUNT);
                apply(seated, theirSide(), { kind: "deploy" });
                me.search = { kind: "searching", order, sinceMs: now() };
                return receipt([]);
            }
            // someone was waiting: the game starts in this call, and they are seated
            current = freshGame(OPPONENT_ACCOUNT, ACCOUNT);
            me.search = { kind: "playing", game: current.id };
            return receipt(apply(current, theirSide(), { kind: "deploy" }));
        },

        async cancelSearch() {
            const me = requireAccount();
            if (me.search.kind !== "searching") {
                throw new ActionError("rejected", "This account is not searching.");
            }
            if (seated) {
                throw new ActionError(
                    "rejected",
                    "A match found this search: accept its seat first.",
                );
            }
            me.search = { kind: "idle" };
            return receipt([]);
        },

        async acceptSeat() {
            const me = requireAccount();
            if (!seated || me.search.kind !== "searching") return null;
            current = seated;
            seated = null;
            me.search = { kind: "playing", game: current.id };
            return receipt([]);
        },

        async submit(game, actions) {
            if (!current || current.id !== game.id) {
                throw new ActionError("no_game", "That game is not running.");
            }
            const state = current;
            const records = actions.flatMap((action) => apply(state, yourSide, action));
            if (current) {
                await opponentTurn(state);
                state.version = String(++version);
            }
            return receipt(records);
        },
    };
}
