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
import { decodeTiles, gridSize, MapPresetBcs, winnerOf } from "./bcs.ts";
import { referencePolicy, type Policy } from "./bot.ts";
import {
    LOBBY_LIFETIME_MS,
    MAX_LOBBY_SIZE,
    MIN_LOBBY_SIZE,
    protectedKey,
    type InviteLobbyView,
    type LobbyView,
    type SearchRole,
} from "./lobby.ts";
import { BLACK_RAIN, BLACK_RAIN_POSITIONS } from "./maps.ts";
import {
    applyDeterministic,
    blastUnits,
    coverBonus,
    DEPLOY_LIMIT_MS,
    deployLimit,
    effectiveStats,
    FREE_RECRUITS,
    GRENADE_DAMAGE,
    GRENADE_RADIUS,
    hitChance,
    legalActions,
    manhattan,
    MAX_MISSED_TURNS,
    MAX_TURNS,
    parseAction,
    passTurn,
    spendUse,
    SUSPENSION_MS,
    throwEffect,
    turnLimitMs,
    unitAt,
    type EffectThrowAction,
} from "./rules.ts";
import {
    ActionError,
    type AccountView,
    type Action,
    type Ending,
    type GameMode,
    type GameRecord,
    type GameState,
    type Stats,
    type Tile,
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
    /**
     * Friendly lobbies. The scripted opponent hosts a listed lobby of size 3 and an invite-only
     * one (`SANDBOX_INVITE`); if you join its listed lobby it starts the game on the next read of
     * your account once `peerAnswersMs` has passed, or, with `peerKicks`, kicks you instead. With `guest` it takes the slot of
     * any lobby you open, and joins any invite you open at once.
     */
    guest?: boolean;
    peerKicks?: boolean;
    /** How long the scripted host takes to answer a guest, by the `now` clock. Default 5 seconds. */
    peerAnswersMs?: number;
    /** Time source, so tests can run the clock past a deadline. */
    now?: () => number;
    startingBalanceMist?: bigint;
    /**
     * Both squads by side, in place of your recruits and the made-up opponent: each unit as
     * `unit::from_recruit` would make it. A side fields as many as it has spawn positions.
     */
    squads?: [SquadUnit[], SquadUnit[]];
    /** Spawn positions in place of `map::black_rain_positions`: the first half is the first player's. */
    positions?: [number, number][];
    /** A grid in place of Black Rain's, for experiments: rows of tiles, every row as long as the first. */
    tiles?: Tile[][];
    /**
     * Experiments: what a `grenade` throw does in place of the frag's blast, once its AP and
     * use are spent. Return the records, or null to blast as usual.
     */
    throwEffect?: (state: GameState, unit: Unit, tx: number, ty: number) => GameRecord[] | null;
    /** Experiments: the hit chance of a shot as the rules give it, adjusted (an aim debuff, say). */
    adjustHitChance?: (
        state: GameState,
        unit: Unit,
        tx: number,
        ty: number,
        chance: number,
    ) => number;
    /** Experiments: called once `next_turn` has passed the turn and reset the AP. */
    afterNextTurn?: (state: GameState) => void;
}

/** A unit a side deploys with `SandboxOptions.squads`: its stats and the actions it carries. */
export interface SquadUnit {
    stats: Stats;
    actions: UnitActionEntry[];
}

/** The host the scripted opponent plays in the sandbox's lobbies, and the invite of its invite-only one. */
export const SANDBOX_PEER_HOST = "0x0000000000000000000000000000000000000000000000000000000000000b02";
export const SANDBOX_INVITE = {
    host: SANDBOX_PEER_HOST,
    code: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
} as const;

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

/** `items::flashbang`: a `Flashbang` action usable once per match. */
export const flashbangUtility = (): Utility => ({ actions: [entry("flashbang", 1)] });

/** `items::smoke_grenade`: a `SmokeGrenade` action usable once per match. */
export const smokeGrenadeUtility = (): Utility => ({ actions: [entry("smoke_grenade", 1)] });

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
    /** The waiting player goes first; the one who finds them plays second. A lobby host goes first. */
    let yourSide = options.seated ? 0 : 1;
    /** My lobby, as a host: `open` is listed, `invite` is keyed by the code. */
    let mine: { kind: "open" | "invite"; size: number; guest: string | null; kicked: string[]; sinceMs: number; key: string } | null = null;
    /** The listed lobby of the scripted opponent, while I am its guest. */
    let guestOf: { kicked: boolean; since: number } | null = null;
    /** What a recruit was, for when it comes home from a friendly game. */
    const deployed = new Map<string, Recruit>();
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
    function freshGame(waiting: string, finder: string, mode: GameMode = { kind: "rated" }): GameState {
        const map = MapPresetBcs.parse(Uint8Array.from(Buffer.from(BLACK_RAIN, "hex")));
        const spawns = options.positions ?? BLACK_RAIN_POSITIONS;
        const half = spawns.length / 2;
        return {
            id: hexId("9", ++games),
            version: String(++version),
            ...(options.tiles
                ? { rows: options.tiles.length, cols: options.tiles[0].length }
                : gridSize(map)),
            turn: 0,
            active: 0,
            players: [waiting, finder],
            squads: [[], []],
            fallen: [],
            positions: [spawns.slice(0, half), spawns.slice(half)],
            history: [],
            missed: [0, 0],
            abandonedBy: null,
            deadlineMs: now() + DEPLOY_LIMIT_MS,
            status: { kind: "deploying" },
            mode,
            tiles: options.tiles ? structuredClone(options.tiles) : decodeTiles(map),
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
            state.deadlineMs = now() + turnLimitMs(state.turn);
        }
    }

    /** `deploy_squad`: as many recruits as the side has spawn positions, used from the back. */
    function deploy(state: GameState, side: number): GameRecord[] {
        const records: GameRecord[] = [];
        const open = deployLimit(state, side);
        // our recruits come from the account, armed ones first; the opponent's are made up
        const fielded = options.squads?.[side].slice(0, open);
        const squad: Recruit[] = fielded
            ? fielded.map(() => hire(true))
            : side === yourSide
              ? [...home].sort((a, b) => Number(b.armed) - Number(a.armed)).slice(0, open)
              : Array.from({ length: open }, () => hire(true, [fragGrenade()]));
        for (const [i, recruit] of squad.entries()) {
            const [x, y] = state.positions[side].pop()!;
            const given = fielded?.[i];
            const stats = given ? given.stats : recruit.armed ? ARMED : UNARMED;
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
                effects: [],
                actions: given
                    ? structuredClone(given.actions)
                    : [
                          ...(recruit.armed ? ARMED_ACTIONS() : UNARMED_ACTIONS()),
                          ...recruit.utilities.flatMap((utility) => structuredClone(utility.actions)),
                      ],
            });
            carried.set(recruit.id, recruit.utilities);
            if (side === yourSide) deployed.set(recruit.id, recruit);
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
        const stats = effectiveStats(unit);
        const records: GameRecord[] = [{ kind: "attack", from: [x, y], to: [tx, ty] }];
        const range = manhattan(x, y, tx, ty);
        const target = unitAt(state, tx, ty);
        const defense =
            stats.areaSize > 0
                ? 0
                : Math.min(
                      100,
                      (range > 0 ? coverBonus(state, x, y, tx, ty) : 0) +
                          effectiveStats(target!).defense,
                  );
        const base = hitChance(stats, range, defense);
        const chance = options.adjustHitChance
            ? options.adjustHitChance(state, unit, tx, ty, base)
            : base;

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
        // a friendly game keeps its fallen until `complete`
        if (state.mode.kind === "rated") state.fallen = [];
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

        // at `MAX_TURNS` the chain ends the game before the walk of the units
        const ended = passTurn(state, state.turn + 1 >= MAX_TURNS);
        options.afterNextTurn?.(state);
        const records: GameRecord[] = [{ kind: "next_turn", turn: state.turn }, ...ended];
        if (state.turn >= MAX_TURNS) over(state, { kind: "stalemate", by: null });
        else state.deadlineMs = now() + turnLimitMs(state.turn);
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
        if (state.mode.kind === "friendly") {
            // `complete_game`: nothing moves but the recruits, every one of them home, the fallen too
            for (const recruit of deployed.values()) home.push(recruit);
            deployed.clear();
            me.recruits = home.length;
            me.search = { kind: "idle" };
            current = null;
            return;
        }
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
        deployed.clear();
    }

    /** The checks `find_game`, `open_lobby` and the joins share: free to play. */
    function checkFree(): AccountView {
        const me = requireAccount();
        if (me.search.kind !== "idle") {
            throw new ActionError("rejected", "This account is already searching or playing.");
        }
        if (now() < me.suspendedUntilMs) {
            throw new ActionError("rejected", "This account is suspended: it left a game behind.");
        }
        if (me.recruits === 0) {
            throw new ActionError("rejected", "This account has no recruits to play with.");
        }
        return me;
    }

    /** `start_friendly_game`: the host goes first; the other side deploys at once. */
    function startFriendlyGame(host: string, guest: string, size: number): GameRecord[] {
        yourSide = host === ACCOUNT ? 0 : 1;
        current = freshGame(host, guest, { kind: "friendly", size });
        requireAccount().search = { kind: "playing", game: current.id };
        mine = null;
        guestOf = null;
        return apply(current, theirSide(), { kind: "deploy" });
    }

    const refuse = (message: string) => new ActionError("rejected", message);
    const peerOpen = () => !guestOf?.kicked;
    const myView = (): LobbyView | null =>
        mine?.kind === "open"
            ? { host: ACCOUNT, size: mine.size, guest: mine.guest, kicked: [...mine.kicked], field: "sandbox-open-me" }
            : null;
    const peerView = (): LobbyView => ({
        host: SANDBOX_PEER_HOST,
        size: MIN_LOBBY_SIZE,
        guest: guestOf && !guestOf.kicked ? ACCOUNT : null,
        kicked: guestOf?.kicked ? [ACCOUNT] : [],
        field: "sandbox-open-peer",
    });
    const sameCode = (code: Uint8Array) =>
        code.length === 8 && code.every((byte, i) => byte === SANDBOX_INVITE.code[i]);

    function apply(state: GameState, side: number, action: Action): GameRecord[] {
        let records: GameRecord[] = [];
        // `begin_turn_action`: acting at all clears the missed turns.
        const acts = ["move", "reload", "attack", "grenade", "flashbang", "smoke_grenade"];
        if (acts.includes(action.kind)) state.missed[side] = 0;
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
                unit.ap -= 1;
                spendUse(unit, "grenade");
                const custom = options.throwEffect?.(state, unit, action.tx, action.ty) ?? null;
                records = custom ?? [
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
            case "flashbang":
            case "smoke_grenade":
                records = throwEffect(state, action as EffectThrowAction);
                break;
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
        requestFaucet: async () => {
            throw new ActionError("rejected", "The faucet is testnet only; this is the sandbox.");
        },
        name: async () => name,
        playerName: async (id) => (id === ACCOUNT ? name : OPPONENT_NAME),

        async accountById(id) {
            if (id === ACCOUNT) return account ? structuredClone(account) : null;
            if (id !== SANDBOX_PEER_HOST) return null;
            return {
                id,
                owner: "0x0000000000000000000000000000000000000000000000000000000000000b01",
                rating: 1500,
                deviation: 350,
                score: { wins: 0, losses: 0, draws: 0 },
                recruits: 4,
                search: { kind: "searching", order: id, sinceMs: now() },
                suspendedUntilMs: 0,
                recovery: null,
            };
        },

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

        async account() {
            // the scripted host answers a guest between two reads
            if (
                guestOf &&
                account?.search.kind === "searching" &&
                !guestOf.kicked &&
                now() - guestOf.since >= (options.peerAnswersMs ?? 5_000)
            ) {
                if (options.peerKicks) {
                    guestOf.kicked = true;
                    account.search = { kind: "idle" };
                } else {
                    startFriendlyGame(SANDBOX_PEER_HOST, ACCOUNT, MIN_LOBBY_SIZE);
                }
            }
            return account ? structuredClone(account) : null;
        },
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
            // `hire_recruits`: a Standard Rifle each, so `Attack` and `Reload` but no `Grenade`
            while (home.length < FREE_RECRUITS) home.push(hire(true));
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
            const me = checkFree();
            yourSide = options.seated ? 0 : 1;
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

        async openLobby(size, code) {
            const me = checkFree();
            if (!Number.isInteger(size) || size < MIN_LOBBY_SIZE || size > MAX_LOBBY_SIZE) {
                throw refuse("A lobby has 3 or 4 recruits a side.");
            }
            const key = code ? protectedKey(code) : ACCOUNT;
            me.search = { kind: "searching", order: key, sinceMs: now() };
            mine = { kind: code ? "invite" : "open", size, guest: null, kicked: [], sinceMs: now(), key };
            if (options.guest && code) return receipt(startFriendlyGame(ACCOUNT, OPPONENT_ACCOUNT, size));
            if (options.guest) mine.guest = OPPONENT_ACCOUNT;
            return receipt([]);
        },

        async joinLobby(host, code) {
            const me = checkFree();
            if (!sameCode(code)) throw refuse("There is no such lobby: check the code and the host.");
            if (host !== SANDBOX_PEER_HOST) throw refuse("That account does not host the lobby the code opens.");
            void me;
            return receipt(startFriendlyGame(SANDBOX_PEER_HOST, ACCOUNT, MIN_LOBBY_SIZE));
        },

        async joinOpen(host) {
            const me = checkFree();
            if (host !== SANDBOX_PEER_HOST) throw refuse("There is no such lobby: check the code and the host.");
            if (!peerOpen()) throw refuse("The host kicked this account out of that lobby.");
            me.search = { kind: "searching", order: SANDBOX_PEER_HOST, sinceMs: now() };
            guestOf = { kicked: false, since: now() };
            return receipt([]);
        },

        async leaveLobby() {
            const me = requireAccount();
            if (!guestOf || me.search.kind !== "searching") {
                throw refuse("There is no such lobby: check the code and the host.");
            }
            guestOf = null;
            me.search = { kind: "idle" };
            return receipt([]);
        },

        async kickGuest() {
            if (!mine?.guest) throw new ActionError("no_lobby", "Your lobby has no guest.");
            mine.kicked.push(mine.guest);
            mine.guest = null;
            return receipt([]);
        },

        async startFriendly() {
            if (!mine?.guest) throw new ActionError("no_lobby", "Your lobby has no guest to start with.");
            if (now() - mine.sinceMs > LOBBY_LIFETIME_MS) throw refuse("That lobby has expired.");
            return receipt(startFriendlyGame(ACCOUNT, mine.guest, mine.size));
        },

        async closeLobby() {
            const me = requireAccount();
            if (!mine) throw new ActionError("no_lobby", "This account does not host a lobby.");
            mine = null;
            me.search = { kind: "idle" };
            return receipt([]);
        },

        async cleanUpLobby(host) {
            if (host !== ACCOUNT || !mine) throw new ActionError("no_lobby", "That lobby is already gone.");
            if (now() - mine.sinceMs <= LOBBY_LIFETIME_MS) {
                throw refuse("Only the host can do that until the lobby has expired.");
            }
            mine = null;
            requireAccount().search = { kind: "idle" };
            return receipt([]);
        },

        async lobby(host) {
            if (host === ACCOUNT) return myView();
            return host === SANDBOX_PEER_HOST ? peerView() : null;
        },

        async inviteLobby(code) {
            if (sameCode(code)) {
                return { size: MIN_LOBBY_SIZE, field: "sandbox-invite", key: protectedKey(code) } satisfies InviteLobbyView;
            }
            return mine?.kind === "invite" && mine.key === protectedKey(code)
                ? { size: mine.size, field: "sandbox-invite-me", key: mine.key }
                : null;
        },

        async listLobbies() {
            const listed = [myView(), peerOpen() ? peerView() : null];
            return listed.filter((lobby): lobby is LobbyView => lobby !== null);
        },

        async searchRole(): Promise<SearchRole | null> {
            const me = requireAccount();
            if (me.search.kind !== "searching") return null;
            if (mine) return { kind: mine.kind === "open" ? "hosting_open" : "hosting_invite" };
            if (guestOf) return { kind: "guest", host: SANDBOX_PEER_HOST };
            return { kind: seated ? "seat_waiting" : "queued" };
        },

        async cancelSearch() {
            const me = requireAccount();
            if (me.search.kind !== "searching") {
                throw new ActionError("rejected", "This account is not searching.");
            }
            if (mine || guestOf) {
                throw new ActionError("rejected", "This account is not in the queue: leave or close the lobby.");
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
