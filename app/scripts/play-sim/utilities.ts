// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Smoke grenade and stun grenade (the flashbang), proposed utilities, against the
 * frag grenade and against no utility. Same sandbox, map and bot as `run.ts`; the
 * new throws are carried as a one-use `grenade` action and resolved by the
 * sandbox's experiment hooks (`throwEffect`, `adjustHitChance`, `afterNextTurn`).
 *
 *   nice node --no-warnings --experimental-strip-types app/scripts/play-sim/utilities.ts [value|smoke|stun|swap|first] [--pairs 400]
 *
 * The decided effects model (`docs/plans/effects.md`): an effect binds to the units
 * in the area at throw time, either side, and lasts `turns` calls of `next_turn`.
 * - Smoke: the unit's shots lose `aim`, shots at it lose `defense`.
 * - Stun: the unit gets no AP while stunned (`apLoss` 2; 1 is the milder variant),
 *   lands unless the unit dodges (`dodge`), and with `zero` empties the AP the unit
 *   has left now; `aim` is the variant that also lowers its aim.
 * A later step, tile-bound smoke (`model: "tile"`), is here for comparison: a cloud
 * on the map that blocks any line of sight entering one of its tiles other than
 * the end tile (at a corner, when both side tiles are smoke).
 */

import { referencePolicy, type Policy } from "../../../packages/agent/src/bot.ts";
import {
    hasUsesLeft,
    legalActions,
    lineOfThrow,
    manhattan,
    parseAction,
    shotChance,
    unitAt,
    type LegalAction,
} from "../../../packages/agent/src/rules.ts";
import { createSandbox } from "../../../packages/agent/src/sandbox.ts";
import type { GameRecord, GameState, Unit } from "../../../packages/agent/src/types.ts";
import { BLACK_RAIN_POSITIONS } from "../../../packages/agent/src/maps.ts";
import type { Loadout } from "../../src/features/play/economy/index.ts";
import { simPolicy, squadUnits } from "./match.ts";
import { pct, rate } from "./stats.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const PAIRS = option("pairs", 400);
const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const log = (line = "") => console.log(line);

type Util = "none" | "frag" | "smoke" | "stun";

interface Config {
    smoke: {
        model: "unit" | "tile";
        radius: number;
        turns: number;
        range: number;
        defense: number;
        aim: number;
        /** AP the throw costs: 1 like the frag, 0 for a free throw */
        ap: number;
        /** the most any shot at a smoked unit can hit with, 100 for no cap */
        cap: number;
    };
    stun: {
        radius: number;
        turns: number;
        range: number;
        apLoss: number;
        aim: number;
        dodge: boolean;
        zero: boolean;
    };
}

const BASE: Config = {
    smoke: { model: "unit", radius: 2, turns: 2, range: 5, defense: 25, aim: 20, ap: 1, cap: 100 },
    stun: { radius: 1, turns: 2, range: 5, apLoss: 2, aim: 0, dodge: true, zero: true },
};

const withSmoke = (s: Partial<Config["smoke"]>): Config => ({
    ...BASE,
    smoke: { ...BASE.smoke, ...s },
});
const withStun = (f: Partial<Config["stun"]>): Config => ({
    ...BASE,
    stun: { ...BASE.stun, ...f },
});

// === Squads ===

const unit = (weapon: string, armor: string, utility: Util): Loadout & { util: Util } => ({
    preset: "sim",
    weapon,
    armor,
    // the new throws ride on the frag's one-use `Grenade` action
    utility: utility === "none" ? null : "frag-grenade",
    util: utility,
});
type SimUnit = ReturnType<typeof unit>;
const recruit = () => unit("rifle-1", "armor-1", "none");
/** The Contractor default: Assault, Sniper, Runner; `u` replaces both frags. */
const contractor = (u: Util): SimUnit[] => [
    unit("rifle-1", "armor-2", u),
    unit("rifle-2", "armor-1", "none"),
    unit("rifle-1", "armor-1", u),
];
const mixed = (): SimUnit[] => [
    unit("rifle-1", "armor-2", "frag"),
    unit("rifle-2", "armor-1", "none"),
    unit("rifle-1", "armor-1", "smoke"),
];

/** The carried utility rides on the unit's stats (an extra field, cloned with them). */
const utilOf = (u: Unit): Util => (u.stats as unknown as { util?: Util }).util ?? "none";

const fielded = (squad: SimUnit[]) =>
    squadUnits(squad).map((s, i) => ({ ...s, stats: { ...s.stats, util: squad[i].util } }));

// === The world the hooks keep ===

interface Cloud {
    x: number;
    y: number;
    r: number;
    turns: number;
}

interface World {
    /** recruit id -> turns left, per effect */
    smoked: Map<string, number>;
    stunned: Map<string, number>;
    /** tile-bound smoke, the later step */
    clouds: Cloud[];
    throws: number;
    stunsLanded: number;
    stunsDodged: number;
    /** the turn each side first smoked, -1 for never */
    firstSmoke: [number, number];
}

const inCloud = (clouds: Cloud[], x: number, y: number) =>
    clouds.some((c) => manhattan(c.x, c.y, x, y) <= c.r);

/** The tiles `trace_line` enters: blocked by one that is smoke and not the end tile. */
function smokeBlocks(clouds: Cloud[], x0: number, y0: number, x1: number, y1: number): boolean {
    if (clouds.length === 0) return false;
    const [dx, dy] = [Math.abs(x0 - x1), Math.abs(y0 - y1)];
    const edges = dx + dy;
    const [down, right] = [x1 > x0, y1 > y0];
    let [x, y, i, j] = [x0, y0, 0, 0];
    const entered = () => !(x === x1 && y === y1) && inCloud(clouds, x, y);
    while (i + j < edges) {
        const [tRow, tCol] = [(2 * i + 1) * dy, (2 * j + 1) * dx];
        const nx = down ? x + 1 : x - 1;
        const ny = right ? y + 1 : y - 1;
        if (tRow < tCol) {
            [x, i] = [nx, i + 1];
            if (entered()) return true;
        } else if (tCol < tRow) {
            [y, j] = [ny, j + 1];
            if (entered()) return true;
        } else {
            if (inCloud(clouds, nx, y) && inCloud(clouds, x, ny)) return true;
            [x, y, i, j] = [nx, ny, i + 1, j + 1];
            if (entered()) return true;
        }
    }
    return false;
}

/**
 * What a shot loses to the effects: the shooter's smoke and daze, the target's smoke.
 * `smoked` may be a hypothetical set, for the bot's look ahead.
 */
function penalty(world: World, cfg: Config, shooter: Unit, target: Unit, smoked = world.smoked) {
    let off = 0;
    if (cfg.smoke.model === "unit" && smoked.has(shooter.recruit)) off += cfg.smoke.aim;
    if (cfg.smoke.model === "unit" && smoked.has(target.recruit)) off += cfg.smoke.defense;
    if (world.stunned.has(shooter.recruit)) off += cfg.stun.aim;
    return off;
}

/** A shot from `(fx, fy)` at `target` on `(tx, ty)` with the effects; null when ruled out. */
function chance(
    state: GameState,
    world: World,
    cfg: Config,
    shooter: Unit,
    fx: number,
    fy: number,
    target: Unit,
    tx: number,
    ty: number,
    look: { clouds?: Cloud[]; smoked?: Map<string, number> } = {},
): number | null {
    const base = shotChance(state, shooter.stats, fx, fy, tx, ty, target.stats.defense);
    if (base === null) return null;
    if (cfg.smoke.model === "tile" && smokeBlocks(look.clouds ?? world.clouds, fx, fy, tx, ty))
        return null;
    const c = Math.max(0, base - penalty(world, cfg, shooter, target, look.smoked));
    return capped(cfg, look.smoked ?? world.smoked, target, c);
}

/** Smoke's cap on shots at a smoked unit. */
const capped = (cfg: Config, smoked: Map<string, number>, target: Unit, c: number) =>
    cfg.smoke.model === "unit" && smoked.has(target.recruit) ? Math.min(c, cfg.smoke.cap) : c;

// === The bot ===

/** What survives one more `next_turn`: the enemy's turn sees these. */
const lastingClouds = (world: World) => world.clouds.filter((c) => c.turns >= 2);
const lastingSmoke = (world: World) => new Map([...world.smoked].filter(([, t]) => t >= 2));

/** The best chance any enemy has of hitting `ally` standing on `(x, y)`. */
function threatOn(
    state: GameState,
    world: World,
    cfg: Config,
    ally: Unit,
    x: number,
    y: number,
    look: { clouds?: Cloud[]; smoked?: Map<string, number> },
) {
    let best = 0;
    for (const enemy of state.units) {
        if (enemy.side === ally.side || world.stunned.has(enemy.recruit)) continue;
        best = Math.max(
            best,
            chance(state, world, cfg, enemy, enemy.x, enemy.y, ally, x, y, look) ?? 0,
        );
    }
    return best;
}

const lookAhead = (world: World) => ({ clouds: lastingClouds(world), smoked: lastingSmoke(world) });

/** The legal actions with shots and move scores under the effects; the new throws removed. */
function patch(
    state: GameState,
    side: number,
    legal: LegalAction[],
    world: World,
    cfg: Config,
): LegalAction[] {
    const live = world.clouds.length > 0 || world.smoked.size > 0 || world.stunned.size > 0;
    const out: LegalAction[] = [];
    for (const a of legal) {
        if (a.kind === "grenade") {
            if (utilOf(unitAt(state, a.unit![0], a.unit![1])!) === "frag") out.push(a);
            continue;
        }
        if (!live || (a.kind !== "attack" && a.kind !== "move")) {
            out.push(a);
            continue;
        }
        const me = unitAt(state, a.unit![0], a.unit![1])!;
        if (a.kind === "attack") {
            const target = unitAt(state, a.to![0], a.to![1])!;
            const c = chance(state, world, cfg, me, me.x, me.y, target, target.x, target.y);
            if (c !== null) out.push({ ...a, hitChance: c });
            continue;
        }
        const [x, y] = a.to!;
        let bestShot = 0;
        if (me.ap > 1 && me.ammo > 0) {
            for (const enemy of state.units) {
                if (enemy.side === side) continue;
                bestShot = Math.max(
                    bestShot,
                    chance(state, world, cfg, me, x, y, enemy, enemy.x, enemy.y) ?? 0,
                );
            }
        }
        // a wounded unit a tile-bound cloud covers weighs danger four times: it stays in it
        const covered =
            cfg.smoke.model === "tile" &&
            me.hp <= 0.6 * me.hpMax &&
            inCloud(lastingClouds(world), me.x, me.y);
        const threat = threatOn(state, world, cfg, me, x, y, lookAhead(world)) * (covered ? 4 : 1);
        out.push({ ...a, bestShot, threat });
    }
    return out;
}

/** Tiles a throw can reach from `(x, y)`: in range, on the map, not a wall, no wall in the way. */
function throwTargets(state: GameState, x: number, y: number, range: number): [number, number][] {
    const out: [number, number][] = [];
    for (let tx = Math.max(0, x - range); tx <= Math.min(state.rows - 1, x + range); tx++)
        for (let ty = Math.max(0, y - range); ty <= Math.min(state.cols - 1, y + range); ty++) {
            if (manhattan(x, y, tx, ty) > range || state.tiles[tx][ty].kind === "wall") continue;
            if (lineOfThrow(state, x, y, tx, ty)) out.push([tx, ty]);
        }
    return out;
}

/**
 * Smoke, thrown by a carrier that acts last: where it cuts the most off the enemy's
 * best shots at the squad over the enemy's next turn, at least 25 points in all.
 * Stun: where it catches no friend that can still act, and two enemies or one that
 * threatens a shot of 35 or more.
 */
function newThrow(
    state: GameState,
    side: number,
    world: World,
    cfg: Config,
    only: Util,
): string | null {
    const mine = state.units.filter((u) => u.side === side);
    const enemies = state.units.filter((u) => u.side !== side);
    for (const me of mine) {
        if (me.ap < 1 || !hasUsesLeft(me, "grenade") || utilOf(me) !== only) continue;
        // the last AP goes to a worthwhile shot rather than a throw
        if (me.ap === 1 && me.ammo > 0) {
            const shot = Math.max(
                0,
                ...enemies.map((e) => chance(state, world, cfg, me, me.x, me.y, e, e.x, e.y) ?? 0),
            );
            if (shot >= 35) continue;
        }
        const id = (at: [number, number]) => `grenade:${me.x},${me.y}:${at[0]},${at[1]}`;
        if (only === "smoke") {
            const now = lookAhead(world);
            const before = mine.map((a) => threatOn(state, world, cfg, a, a.x, a.y, now));
            if (before.every((t) => t === 0)) continue;
            let best: { at: [number, number]; gain: number } | null = null;
            for (const at of throwTargets(state, me.x, me.y, cfg.smoke.range)) {
                const look =
                    cfg.smoke.model === "tile"
                        ? {
                              ...now,
                              clouds: [
                                  ...now.clouds,
                                  {
                                      x: at[0],
                                      y: at[1],
                                      r: cfg.smoke.radius,
                                      turns: cfg.smoke.turns,
                                  },
                              ],
                          }
                        : {
                              ...now,
                              smoked: new Map([
                                  ...now.smoked,
                                  ...state.units
                                      .filter(
                                          (u) =>
                                              manhattan(u.x, u.y, at[0], at[1]) <= cfg.smoke.radius,
                                      )
                                      .map((u) => [u.recruit, cfg.smoke.turns] as [string, number]),
                              ]),
                          };
                let gain = 0;
                mine.forEach(
                    (a, i) => (gain += before[i] - threatOn(state, world, cfg, a, a.x, a.y, look)),
                );
                if (!best || gain > best.gain) best = { at, gain };
            }
            if (best && best.gain >= 25) return id(best.at);
        } else {
            let best: { at: [number, number]; value: number } | null = null;
            for (const at of throwTargets(state, me.x, me.y, cfg.stun.range)) {
                const hit = state.units.filter(
                    (u) => manhattan(u.x, u.y, at[0], at[1]) <= cfg.stun.radius,
                );
                if (hit.some((u) => u.side === side && u.ap > 0)) continue;
                const foes = hit.filter((u) => u.side !== side && !world.stunned.has(u.recruit));
                if (foes.length === 0) continue;
                const threat = Math.max(
                    ...foes.map((f) =>
                        Math.max(
                            0,
                            ...mine.map(
                                (a) => chance(state, world, cfg, f, f.x, f.y, a, a.x, a.y) ?? 0,
                            ),
                        ),
                    ),
                );
                if (foes.length < 2 && threat < 35) continue;
                const value = foes.length * 100 + threat;
                if (!best || value > best.value) best = { at, value };
            }
            if (best) return id(best.at);
        }
    }
    return null;
}

function makePolicy(world: World, cfg: Config): Policy {
    return (input) => {
        const { state, side, legal } = input;
        if (legal.some((a) => a.kind === "deploy" || a.kind === "complete"))
            return referencePolicy(input);
        const stun = newThrow(state, side, world, cfg, "stun");
        if (stun) return [stun];
        const patched = patch(state, side, legal, world, cfg);
        // smoke carriers act last, so the smoke goes where the squad ended up
        const carrier = (a: LegalAction) => {
            const u = a.unit && unitAt(state, a.unit[0], a.unit[1]);
            return !!u && utilOf(u) === "smoke" && hasUsesLeft(u, "grenade");
        };
        if (patched.some(carrier)) {
            const first = simPolicy({ ...input, legal: patched.filter((a) => !carrier(a)) });
            if (first[0] !== "next_turn") return first;
            const smoke = newThrow(state, side, world, cfg, "smoke");
            if (smoke) return [smoke];
        }
        return simPolicy({ ...input, legal: patched });
    };
}

// === One match ===

interface Result {
    winner: number | null;
    turns: number;
    world: World;
}

const MAX_ACTIONS = 32;

/** mulberry32, for the stun's dodge rolls (the sandbox keeps its own dice). */
function dice(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 100);
    };
}

const tick = (m: Map<string, number>) => {
    for (const [id, t] of m) {
        if (t <= 1) m.delete(id);
        else m.set(id, t - 1);
    }
};

async function playMatch(
    squads: [SimUnit[], SimUnit[]],
    seed: number,
    cfg: Config,
): Promise<Result> {
    const world: World = {
        smoked: new Map(),
        stunned: new Map(),
        clouds: [],
        throws: 0,
        stunsLanded: 0,
        stunsDodged: 0,
        firstSmoke: [-1, -1],
    };
    const roll = dice(seed ^ 0x5eed);
    const policy = makePolicy(world, cfg);
    const backend = createSandbox({
        seed,
        seated: true,
        opponent: policy,
        now: () => 0,
        squads: [fielded(squads[0]), fielded(squads[1])],
        positions: BLACK_RAIN_POSITIONS,
        throwEffect(state, thrower, tx, ty): GameRecord[] | null {
            const util = utilOf(thrower);
            if (util !== "smoke" && util !== "stun") return null;
            world.throws += 1;
            if (util === "smoke" && cfg.smoke.ap === 0) thrower.ap += 1;
            const radius = util === "smoke" ? cfg.smoke.radius : cfg.stun.radius;
            if (util === "smoke" && world.firstSmoke[thrower.side] < 0)
                world.firstSmoke[thrower.side] = state.turn;
            if (util === "smoke" && cfg.smoke.model === "tile") {
                world.clouds.push({ x: tx, y: ty, r: radius, turns: cfg.smoke.turns });
            } else {
                for (const u of state.units) {
                    if (manhattan(u.x, u.y, tx, ty) > radius) continue;
                    if (util === "smoke") {
                        // refresh: the larger of the two
                        world.smoked.set(
                            u.recruit,
                            Math.max(world.smoked.get(u.recruit) ?? 0, cfg.smoke.turns),
                        );
                        continue;
                    }
                    if (cfg.stun.dodge && roll() < u.stats.dodge) {
                        world.stunsDodged++;
                        continue;
                    }
                    world.stunsLanded++;
                    world.stunned.set(
                        u.recruit,
                        Math.max(world.stunned.get(u.recruit) ?? 0, cfg.stun.turns),
                    );
                    if (cfg.stun.zero && cfg.stun.apLoss >= 2) u.ap = 0;
                }
            }
            return [{ kind: "grenade", from: [thrower.x, thrower.y], to: [tx, ty] }];
        },
        adjustHitChance(state, shooter, tx, ty, c) {
            if (
                cfg.smoke.model === "tile" &&
                smokeBlocks(world.clouds, shooter.x, shooter.y, tx, ty)
            )
                return 0;
            const target = unitAt(state, tx, ty);
            if (!target) return c;
            return capped(
                cfg,
                world.smoked,
                target,
                Math.max(0, c - penalty(world, cfg, shooter, target)),
            );
        },
        afterNextTurn(state) {
            world.clouds = world.clouds
                .map((c) => ({ ...c, turns: c.turns - 1 }))
                .filter((c) => c.turns > 0);
            tick(world.smoked);
            tick(world.stunned);
            for (const u of state.units) {
                if (u.side === state.active && world.stunned.has(u.recruit))
                    u.ap = Math.max(0, u.ap - cfg.stun.apLoss);
            }
        },
    });
    await backend.createAccount();
    await backend.hireSquad();
    await backend.findGame();
    await backend.acceptSeat();
    const account = (await backend.account())!;
    const id = account.search.kind === "playing" ? account.search.game : "";
    let state = (await backend.game(id))!;
    await backend.submit(state, [{ kind: "deploy" }]);
    let actions = 0;
    for (;;) {
        state = (await backend.game(id))!;
        if (state.status.kind === "finished") break;
        const legal = legalActions(state, 0, 0);
        const ids =
            actions++ >= MAX_ACTIONS
                ? ["next_turn"]
                : await policy({ state, side: 0, legal, nowMs: 0 });
        if (ids[0] === "next_turn") actions = 0;
        await backend.submit(state, ids.map(parseAction));
    }
    const status = state.status as { kind: "finished"; winner: string | null };
    const winner = status.winner === null ? null : state.players.indexOf(status.winner);
    return { winner, turns: state.turn, world };
}

// === Experiments ===

const logit = (p: number) => Math.log(p / (1 - p));
const pts = (w: number | null, side: number) => (w === side ? 1 : w === null ? 0.5 : 0);

interface Tally {
    score: number;
    games: number;
    throws: number;
    turns: number;
    landed: number;
    dodged: number;
}

/** `pairs` seeds, each played with `a` moving first and then `b`. Returns `a`'s tally. */
async function duel(
    a: SimUnit[],
    b: SimUnit[],
    pairs: number,
    seed: number,
    cfg: Config,
): Promise<Tally> {
    const t: Tally = { score: 0, games: 0, throws: 0, turns: 0, landed: 0, dodged: 0 };
    for (let i = 0; i < pairs; i++) {
        const s = seed * 100_003 + i;
        for (const [r, side] of [
            [await playMatch([a, b], s, cfg), 0],
            [await playMatch([b, a], s, cfg), 1],
        ] as [Result, number][]) {
            t.score += pts(r.winner, side);
            t.throws += r.world.throws;
            t.turns += r.turns;
            t.landed += r.world.stunsLanded;
            t.dodged += r.world.stunsDodged;
            t.games += 1;
        }
    }
    return t;
}

const table = (head: string[], rows: (string | number)[][]) => {
    log(`| ${head.join(" | ")} |`);
    log(`|${head.map(() => "---").join("|")}|`);
    for (const row of rows) log(`| ${row.join(" | ")} |`);
    log();
};

const VALUE_SQUAD = (u: Util): [SimUnit[], SimUnit[]] => [
    [unit("rifle-1", "armor-1", u), recruit(), recruit()],
    [recruit(), recruit(), recruit()],
];

/** The frag's log-odds in the value setup, for the credit column. */
let fragLogit = 0;

async function cells(title: string, util: Util, list: [string, Config][]) {
    log(`### ${title}`);
    log();
    const rows: (string | number)[][] = [];
    for (const [name, cfg] of list) {
        const [a, b] = VALUE_SQUAD(util);
        const t = await duel(a, b, PAIRS, 11, cfg);
        const l = logit(t.score / t.games);
        if (util === "frag") fragLogit = l;
        rows.push([
            name,
            t.games,
            rate(t.score, t.games),
            l.toFixed(3),
            fragLogit ? (10 * (l / fragLogit)).toFixed(1) : "-",
            (t.throws / t.games).toFixed(2),
            util === "stun" ? (t.landed / t.games).toFixed(2) : "-",
        ]);
    }
    table(
        [
            "cell",
            "games",
            "win rate [95% CI]",
            "log-odds",
            "credits at the frag's rate",
            "throws a game",
            "stuns landed a game",
        ],
        rows,
    );
}

const value = () =>
    cells("Value: a Recruit carrying it, plus two Recruits, against three Recruits", "frag", [
        ["frag grenade", BASE],
    ]).then(() => undefined);

const smoke = () =>
    cells("Smoke (decided model, unit-bound), same setup", "smoke", [
        ["radius 2, +25 defense, -20 aim (base)", BASE],
        ["radius 1, +25 defense, -20 aim", withSmoke({ radius: 1 })],
        ["radius 2, +25 defense, no aim change", withSmoke({ aim: 0 })],
        ["radius 2, +40 defense, -20 aim", withSmoke({ defense: 40 })],
        ["radius 2, +25 defense, -20 aim, 1 turn", withSmoke({ turns: 1 })],
        ["radius 2, +25 defense, -20 aim, free throw (0 AP)", withSmoke({ ap: 0 })],
        ["radius 2, -20 aim, shots at it capped at 40%", withSmoke({ defense: 0, cap: 40 })],
        [
            "later step: tile-bound, blocks sight, radius 1, 2 turns",
            withSmoke({ model: "tile", radius: 1 }),
        ],
        [
            "later step: tile-bound, blocks sight, radius 2, 2 turns",
            withSmoke({ model: "tile", radius: 2 }),
        ],
    ]);

const stun = () =>
    cells("Stun grenade (flashbang), same setup", "stun", [
        ["radius 1, no AP for a turn, dodge roll (base)", BASE],
        ["radius 2, no AP, dodge roll", withStun({ radius: 2 })],
        ["radius 1, no AP, no dodge roll", withStun({ dodge: false })],
        ["radius 1, milder: -1 AP and -20 aim", withStun({ apLoss: 1, aim: 20, zero: false })],
        ["radius 1, milder: -40 aim only", withStun({ apLoss: 0, aim: 40, zero: false })],
    ]);

/** The Contractor default with its two frags swapped, against the default. */
async function swap() {
    log(
        "### Swap: the Contractor default with its utilities changed, against the default (two frags)",
    );
    log();
    const rows: (string | number)[][] = [];
    const list: [string, SimUnit[]][] = [
        ["no utility", contractor("none")],
        ["two smokes", contractor("smoke")],
        ["two stuns", contractor("stun")],
        ["Assault frag, Runner smoke", mixed()],
        [
            "Assault frag, Runner stun",
            [
                unit("rifle-1", "armor-2", "frag"),
                unit("rifle-2", "armor-1", "none"),
                unit("rifle-1", "armor-1", "stun"),
            ],
        ],
    ];
    for (const [name, squad] of list) {
        const t = await duel(squad, contractor("frag"), PAIRS, 23, BASE);
        rows.push([
            name,
            t.games,
            rate(t.score, t.games),
            logit(t.score / t.games).toFixed(3),
            (t.throws / t.games).toFixed(2),
        ]);
    }
    table(
        ["squad", "games", "win rate vs default [95% CI]", "log-odds", "new throws a game"],
        rows,
    );
}

/** The default (frags) moves first; the second mover's utilities vary. */
async function first() {
    log("### First mover: the default (two frags) moves first, the second mover's utilities vary");
    log();
    const games = 2 * PAIRS;
    const rows: (string | number)[][] = [];
    const list: [string, SimUnit[]][] = [
        ["two frags (mirror)", contractor("frag")],
        ["two smokes", contractor("smoke")],
        ["two stuns", contractor("stun")],
        ["Assault frag, Runner smoke", mixed()],
    ];
    for (const [name, squad] of list) {
        let [firstWins, smoked, onTurnOne] = [0, 0, 0];
        for (let i = 0; i < games; i++) {
            const r = await playMatch([contractor("frag"), squad], 31 * 100_003 + i, BASE);
            firstWins += pts(r.winner, 0);
            if (r.world.firstSmoke[1] >= 0) smoked++;
            if (r.world.firstSmoke[1] === 1) onTurnOne++;
        }
        rows.push([
            name,
            games,
            rate(firstWins, games),
            `${pct(smoked, games).toFixed(0)}%`,
            `${pct(onTurnOne, games).toFixed(0)}%`,
        ]);
    }
    table(
        [
            "second mover carries",
            "games",
            "first mover wins [95% CI]",
            "second mover smoked",
            "smoked on its first turn",
        ],
        rows,
    );
}

/** The two smoke fixes, in the value, swap and first-mover setups. */
async function fixes() {
    const list: [string, Config][] = [
        ["free throw (0 AP)", withSmoke({ ap: 0 })],
        ["capped at 40%", withSmoke({ defense: 0, cap: 40 })],
    ];
    await cells("Smoke fixes, value setup", "smoke", list);
    log("### Smoke fixes: two smokes in the default, against the default; and as second mover");
    log();
    const rows: (string | number)[][] = [];
    for (const [name, cfg] of list) {
        const t = await duel(contractor("smoke"), contractor("frag"), PAIRS, 23, cfg);
        let firstWins = 0;
        for (let i = 0; i < 2 * PAIRS; i++) {
            firstWins += pts(
                (await playMatch([contractor("frag"), contractor("smoke")], 31 * 100_003 + i, cfg))
                    .winner,
                0,
            );
        }
        rows.push([name, t.games, rate(t.score, t.games), rate(firstWins, 2 * PAIRS)]);
    }
    table(
        [
            "smoke",
            "games",
            "two smokes vs default [95% CI]",
            "first mover wins against two smokes [95% CI]",
        ],
        rows,
    );
}

const EXPERIMENTS: Record<string, () => Promise<void>> = { value, smoke, stun, swap, first, fixes };
const started = Date.now();
for (const name of named.length ? named : Object.keys(EXPERIMENTS)) {
    const t0 = Date.now();
    await EXPERIMENTS[name]();
    log(`(${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    log();
}
log(`total ${((Date.now() - started) / 1000).toFixed(0)} s, pairs ${PAIRS}`);
