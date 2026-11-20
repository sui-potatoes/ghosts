// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    actionId,
    blastUnits,
    coverBonus,
    damageRange,
    effectiveStats,
    GRENADE_DAMAGE,
    GRENADE_RADIUS,
    hasAction,
    manhattan,
    reachable,
    shotChance,
    type LegalAction,
} from "./rules.ts";
import type { GameState, Unit, UnitEffect } from "./types.ts";

export interface PolicyInput {
    state: GameState;
    side: number;
    legal: LegalAction[];
    nowMs: number;
}

/** Decides the next batch of action ids. An LLM, a search or a script all fit here. */
export type Policy = (input: PolicyInput) => string[] | Promise<string[]>;

/** Below this chance a shot waits for a better position, unless nothing else is left. */
const WORTHWHILE_SHOT = 35;

/** A shot at least this likely is a threat worth a flashbang. */
const THREATENING_SHOT = 35;
/**
 * A flashbang has to deny at least this much expected damage (hit points) over the enemy's next
 * turn: below it the throw dazes enemies that were not going to hurt anyone.
 */
const FLASH_MIN_DENIED = 1;
/**
 * A flashbang beats the unit's own best shot when the damage it denies is this many times the
 * shot's expected damage: a throw is permanent (one per match), a shot is not, so it has to
 * be clearly better, not just equal.
 */
const FLASH_MARGIN = 1.5;
/** A frag grenade has to be worth at least this many expected hit points: a shot's worth or so. */
const FRAG_MIN_VALUE = 3;
/** A frag grenade beats the unit's own best shot when it is worth this many times the shot. */
const FRAG_MARGIN = 1.25;
/** A kill is worth more than the hit points it takes: the enemy never shoots again. */
const FRAG_KILL_BONUS = 2;

/** The effects on a unit that are still there when the other side moves: two turn changes left. */
const lasting = (unit: Unit, dazed = false): UnitEffect[] => {
    const kept = unit.effects.filter((effect) => effect.turns >= 2);
    return dazed && !kept.some((effect) => effect.kind === "daze")
        ? [...kept, { kind: "daze", turns: 2 }]
        : kept;
};

/** What a shot is worth: its chance times the damage it deals on average, capped by the target's health. */
function shotValue(
    state: GameState,
    shooter: Unit,
    shooterFx: UnitEffect[],
    target: Unit,
    targetFx: UnitEffect[],
): { value: number; chance: number } {
    const none = { value: 0, chance: 0 };
    if (!hasAction(shooter, "attack") || shooter.ammo <= 0) return none;
    const stats = effectiveStats({ stats: shooter.stats, effects: shooterFx });
    const defense = effectiveStats({ stats: target.stats, effects: targetFx }).defense;
    const chance = shotChance(state, stats, shooter.x, shooter.y, target.x, target.y, defense);
    if (!chance) return none;
    const { min, max } = damageRange(stats, target);
    return { value: (chance / 100) * Math.min(target.hp, (min + max) / 2), chance };
}

/** The best shot of `shooter` at any of `targets`, and the best chance among them. */
const bestShot = (
    state: GameState,
    shooter: Unit,
    shooterFx: UnitEffect[],
    targets: Unit[],
    targetFx: (unit: Unit) => UnitEffect[],
) =>
    targets.reduce(
        (top, target) => {
            const shot = shotValue(state, shooter, shooterFx, target, targetFx(target));
            return { value: Math.max(top.value, shot.value), chance: Math.max(top.chance, shot.chance) };
        },
        { value: 0, chance: 0 },
    );

/** What a legal shot is worth, for the unit's own best (chance times average damage). */
function ownShot(legal: LegalAction[], unit: Unit): { value: number; chance: number } {
    return legal
        .filter((a) => a.kind === "attack" && a.unit![0] === unit.x && a.unit![1] === unit.y)
        .reduce(
            (top, a) => {
                const { min, max } = a.damage!;
                const value = (a.hitChance! / 100) * Math.min(a.targetHp!, (min + max) / 2);
                return { value: Math.max(top.value, value), chance: Math.max(top.chance, a.hitChance!) };
            },
            { value: 0, chance: 0 },
        );
}

/** A throw the policy likes, and how much. */
interface Throw {
    id: string;
    score: number;
}

/**
 * A flashbang worth a unit's turn, or undefined. It must hit none of mine. What it denies is
 * the expected damage the dazed enemies would have dealt on their next turn (each shoots its
 * best target once, at its chance times its damage, against the same after the daze). It is
 * thrown when that is at least `FLASH_MIN_DENIED` and either two enemies in the burst are
 * threatening (denying two shots is worth more than taking one), or it beats the thrower's own
 * best shot by `FLASH_MARGIN`, or the thrower has no shot worth taking. A unit with AP for both
 * throws first and takes its shot after: the policy sees the shot next, the throw having cost 1 AP.
 */
function flashbangThrow(state: GameState, side: number, legal: LegalAction[]): Throw | undefined {
    const throws = legal.filter((a) => a.kind === "flashbang" && !a.alliesHit);
    if (throws.length === 0) return undefined;
    const mine = state.units.filter((unit) => unit.side === side);
    const enemies = state.units.filter((unit) => unit.side !== side);
    const fx = new Map(state.units.map((unit) => [unit, lasting(unit)]));
    const on = (unit: Unit) => fx.get(unit)!;

    // per enemy: its best shot on my units next turn, as it stands and dazed
    const before = new Map(enemies.map((e) => [e, bestShot(state, e, on(e), mine, on)]));
    const after = new Map(enemies.map((e) => [e, bestShot(state, e, lasting(e, true), mine, on)]));

    let best: Throw | undefined;
    for (const throwing of throws) {
        const thrower = mine.find((u) => u.x === throwing.unit![0] && u.y === throwing.unit![1])!;
        const burst = blastUnits(state, throwing.to![0], throwing.to![1], GRENADE_RADIUS);
        const hit = burst.filter((unit) => unit.side !== side);
        const denied = hit.reduce((sum, e) => sum + before.get(e)!.value - after.get(e)!.value, 0);
        if (denied < FLASH_MIN_DENIED) continue;
        const likely = hit.filter((e) => before.get(e)!.chance >= THREATENING_SHOT).length;
        const own = ownShot(legal, thrower);
        const better =
            likely >= 2 || denied >= own.value * FLASH_MARGIN || own.chance < WORTHWHILE_SHOT;
        if (better && (!best || denied > best.score)) best = { id: throwing.id, score: denied };
    }
    return best;
}

/**
 * A frag grenade worth a unit's turn, or undefined. It must hit none of mine (the thrower
 * included). It cannot miss or be dodged, so its worth is sure: the damage to every enemy in the
 * blast after armor (a kill counts `FRAG_KILL_BONUS` more), which is the most when enemies
 * cluster, plus the cover it destroys: every cover tile and every obstacle in the blast is gone
 * (an obstacle is low cover to its neighbours), and the shots of my units at the enemies that
 * stood behind it gain what the cover took off them. It is thrown
 * when that is at least `FRAG_MIN_VALUE` and `FRAG_MARGIN` times the thrower's own best shot, or
 * when the thrower has no shot worth taking; with AP for both it throws first and shoots after.
 */
function fragThrow(state: GameState, side: number, legal: LegalAction[]): Throw | undefined {
    const throws = legal.filter((a) => a.kind === "grenade" && !a.alliesHit);
    if (throws.length === 0) return undefined;
    const mine = state.units.filter((unit) => unit.side === side);
    const enemies = state.units.filter((unit) => unit.side !== side);
    // how well my units can shoot an enemy from where they stand, with the cover as it is
    const hitBy = (enemy: Unit) =>
        mine.reduce((sum, m) => sum + shotValue(state, m, m.effects, enemy, enemy.effects).value, 0);
    const covered = new Map(enemies.map((e) => [e, hitBy(e)]));

    let best: Throw | undefined;
    for (const throwing of throws) {
        const [tx, ty] = throwing.to!;
        const thrower = mine.find((u) => u.x === throwing.unit![0] && u.y === throwing.unit![1])!;
        const hit = blastUnits(state, tx, ty, GRENADE_RADIUS).filter((unit) => unit.side !== side);
        const dealtTo = (enemy: Unit) => Math.max(1, GRENADE_DAMAGE - enemy.stats.armor);
        const killed = (enemy: Unit) => hit.includes(enemy) && dealtTo(enemy) >= enemy.hp;
        let value = 0;
        for (const enemy of hit) {
            value += Math.min(dealtTo(enemy), enemy.hp) + (killed(enemy) ? FRAG_KILL_BONUS : 0);
        }

        // the cover tiles and obstacles it takes away, and the enemies they were next to
        const gone: [number, number][] = [];
        for (let x = tx - GRENADE_RADIUS; x <= tx + GRENADE_RADIUS; x++) {
            for (let y = ty - GRENADE_RADIUS; y <= ty + GRENADE_RADIUS; y++) {
                const row = state.tiles[x];
                const kind = row?.[y]?.kind;
                if (
                    (kind === "cover" || kind === "obstacle") &&
                    manhattan(x, y, tx, ty) <= GRENADE_RADIUS
                ) {
                    gone.push([x, y]);
                }
            }
        }
        const behind = enemies.filter(
            (e) => !killed(e) && gone.some(([x, y]) => manhattan(x, y, e.x, e.y) <= 1),
        );
        if (behind.length > 0) {
            const kept = gone.map(([x, y]) => state.tiles[x][y]);
            gone.forEach(([x, y]) => (state.tiles[x][y] = { kind: "empty" }));
            for (const enemy of behind) value += hitBy(enemy) - covered.get(enemy)!;
            gone.forEach(([x, y], i) => (state.tiles[x][y] = kept[i]));
        }

        const own = ownShot(legal, thrower);
        const better = value >= own.value * FRAG_MARGIN || own.chance < WORTHWHILE_SHOT;
        if (value >= FRAG_MIN_VALUE && better && (!best || value > best.score)) {
            best = { id: throwing.id, score: value };
        }
    }
    return best;
}

// === Cover ===

/**
 * What a hit point the unit may lose on the enemy's next turn weighs against one it deals this
 * turn. Under 1, so a unit still trades shots when the trade is even: at 1 the bot turns cautious
 * and loses more often than it wins against the plain shooter it replaced.
 */
const EXPOSURE_WEIGHT = 0.75;
/**
 * The share of an enemy's best shot after a move (from any tile it can reach) that counts in the
 * exposure, next to its shot from where it stands: it may well move, but it has targets of its own
 * and a tile of its own to care about.
 */
const ENEMY_MOVE_WEIGHT = 0.25;
/**
 * A move before a shot may give up at most this many points of hit chance against the shot the
 * unit has where it stands: cover is not worth turning a good shot into a hopeful one.
 */
const KEEP_SHOT = 15;
/**
 * A unit whose exposure where it stands is at least this share of its health may move for a shot
 * worse than `KEEP_SHOT` allows: staying would likely cost it the unit.
 */
const BAD_EXPOSURE = 0.5;
/** What standing still is worth, in hit points: a tie stays, two equal tiles never alternate. */
const STAY_BONUS = 0.25;
/** The share of the best shot from a tile, as the enemies stand now, that counts for next turn. */
const NEXT_SHOT_WEIGHT = 0.5;
/** Hit points a tile of distance to the nearest enemy costs: a unit closes in, all else equal. */
const APPROACH_WEIGHT = 0.15;
/**
 * A move ends on an open tile (one an enemy that can see it gets no cover from) only when no
 * covered tile scores within this many hit points of it.
 */
const COVER_MARGIN = 1;
/**
 * With 1 AP and an empty weapon a unit reloads, unless stepping to the best tile lowers the
 * damage it expects to take (weighted by `EXPOSURE_WEIGHT`) by at least this many hit points: then
 * it steps, and reloads next turn (reload and shoot still fit in two AP).
 */
const RELOAD_STEP_MARGIN = 1;
/**
 * Turn changes in a row without a shot or a frag, after which the sides are taken to be waiting
 * each other out: units then press on, so a game still ends before the draw at `MAX_TURNS`. What
 * an enemy could do after a move no longer holds them back, and a pressure that grows by
 * `PRESS_STEP` for every quiet turn change from here until somebody shoots multiplies the pull
 * of distance and divides the weight of exposure and `COVER_MARGIN`. Two rounds.
 */
const QUIET_TURNS = 4;
/** How much the pressure grows per quiet turn change from `QUIET_TURNS` on. */
const PRESS_STEP = 1;
/**
 * What a kill is worth past the hit points it takes, for a shot as for the exposure: a dead unit
 * never shoots again. Without it a unit spreads its fire and trades evenly; with it, it finishes
 * the wounded first.
 */
const KILL_BONUS = 5;

/** A tile as `[x, y]`. */
type Spot = [number, number];
const keyOf = ([x, y]: Spot) => `${x},${y}`;

/**
 * What one shot of `shooter` from `from` at `target` on `at` is worth, without asking for AP or
 * ammo: its chance times the average damage (capped by the target's health), plus `KILL_BONUS`
 * times the chance that it kills, with every damage in the range taken as equally likely.
 */
function hitFrom(
    state: GameState,
    shooter: Unit,
    shooterFx: UnitEffect[],
    from: Spot,
    target: Unit,
    targetFx: UnitEffect[],
    at: Spot,
): { value: number; chance: number } {
    const stats = effectiveStats({ stats: shooter.stats, effects: shooterFx });
    const defense = effectiveStats({ stats: target.stats, effects: targetFx }).defense;
    const chance = shotChance(state, stats, from[0], from[1], at[0], at[1], defense) ?? 0;
    const { min, max } = damageRange(stats, target);
    const kills = Math.min(1, Math.max(0, (max - target.hp + 1) / (max - min + 1)));
    const value = (chance / 100) * (Math.min(target.hp, (min + max) / 2) + kills * KILL_BONUS);
    return { value, chance };
}

/**
 * The fight as one side sees it in one call: the enemies, where each can go on its next turn, and
 * the exposure of every tile asked about, kept for the call (several of my units ask about the
 * same tiles).
 */
interface Field {
    state: GameState;
    /** The enemies that can shoot. */
    enemies: Unit[];
    /** Every enemy, armed or not. */
    targets: Unit[];
    /** The tiles an enemy can move to and shoot from next turn: none with an empty weapon. */
    reach: Map<Unit, Spot[]>;
    exposure: Map<string, number>;
    /** The pressure to close in: 1, more once the game has gone quiet (`QUIET_TURNS`). */
    pressing: number;
}

/** Turn changes since the last shot or frag of either side, from the history. */
function quietTurns(state: GameState): number {
    let quiet = 0;
    for (let i = state.history.length - 1; i >= 0; i--) {
        const kind = state.history[i].kind;
        if (kind === "attack" || kind === "grenade") break;
        if (kind === "next_turn") quiet += 1;
    }
    return quiet;
}

function fieldOf(state: GameState, side: number): Field {
    const targets = state.units.filter((unit) => unit.side !== side);
    const enemies = targets.filter((unit) => hasAction(unit, "attack"));
    const quiet = quietTurns(state);
    const pressing = quiet < QUIET_TURNS ? 1 : 1 + (quiet - QUIET_TURNS + 1) * PRESS_STEP;
    const reach = new Map<Unit, Spot[]>();
    for (const enemy of enemies) {
        const tiles: Spot[] = [];
        // an empty weapon spends one AP on the reload: it shoots from where it stands
        if (pressing === 1 && enemy.ammo > 0 && hasAction(enemy, "move")) {
            for (const key of reachable(state, enemy).keys()) {
                tiles.push(key.split(",").map(Number) as Spot);
            }
        }
        reach.set(enemy, tiles);
    }
    return { state, enemies, targets, reach, exposure: new Map(), pressing };
}

/**
 * The damage `unit` can expect to take on `at` over the enemy's next turn: per enemy, its chance
 * from where it stands, or `ENEMY_MOVE_WEIGHT` of its best chance from a tile it can move to if
 * that is more, times the damage a hit deals, all with directional cover and the effects that
 * will still be on both. A dazed enemy threatens nothing.
 */
function exposure(field: Field, unit: Unit, at: Spot): number {
    const key = `${unit.recruit}@${keyOf(at)}`;
    const known = field.exposure.get(key);
    if (known !== undefined) return known;
    const { state } = field;
    const mine = lasting(unit);
    let total = 0;
    for (const enemy of field.enemies) {
        const theirs = lasting(enemy);
        if (effectiveStats({ stats: enemy.stats, effects: theirs }).aim === 0) continue;
        const still = hitFrom(state, enemy, theirs, [enemy.x, enemy.y], unit, mine, at);
        let moved = 0;
        const range = enemy.stats.range + 3;
        for (const tile of field.reach.get(enemy)!) {
            if (manhattan(tile[0], tile[1], at[0], at[1]) > range) continue;
            const shot = hitFrom(state, enemy, theirs, tile, unit, mine, at);
            moved = Math.max(moved, shot.value);
        }
        total += Math.max(still.value, moved * ENEMY_MOVE_WEIGHT);
    }
    field.exposure.set(key, total);
    return total;
}

/** The best shot `unit` has from `from` at the enemies as they stand (its AP and ammo aside). */
function shotFrom(field: Field, unit: Unit, from: Spot): Shot {
    let best: Shot = { value: 0, chance: 0 };
    if (!hasAction(unit, "attack")) return best;
    for (const enemy of field.targets) {
        const at: Spot = [enemy.x, enemy.y];
        const shot = hitFrom(field.state, unit, unit.effects, from, enemy, enemy.effects, at);
        if (shot.chance > 0 && shot.value > best.value) best = { ...shot, target: enemy };
    }
    return best;
}

interface Shot {
    value: number;
    chance: number;
    target?: Unit;
}

/** Whether `at` is open: an enemy that can shoot the unit there gets no cover from it. */
function isOpen(field: Field, unit: Unit, at: Spot): boolean {
    const { state } = field;
    const { defense } = effectiveStats(unit);
    return field.enemies.some((enemy) => {
        const sees = shotChance(state, effectiveStats(enemy), enemy.x, enemy.y, ...at, defense);
        return sees !== null && coverBonus(state, enemy.x, enemy.y, ...at) === 0;
    });
}

/**
 * What ending the turn on `at` is worth, in hit points, past this turn's shot: the damage the unit
 * expects to take there (weighted), a share of the shot it would have next turn, and the
 * distance to the nearest enemy.
 */
function standing(field: Field, unit: Unit, at: Spot): number {
    const near = field.targets.reduce(
        (low, enemy) => Math.min(low, manhattan(enemy.x, enemy.y, ...at)),
        Infinity,
    );
    return (
        (-EXPOSURE_WEIGHT / field.pressing) * exposure(field, unit, at) +
        NEXT_SHOT_WEIGHT * shotFrom(field, unit, at).value -
        APPROACH_WEIGHT * field.pressing * (Number.isFinite(near) ? near : 0)
    );
}

/** A unit's next order and what it gains over leaving the unit be. */
interface Plan {
    id: string;
    gain: number;
    /** A shot from where the unit stands, by its chance: those go first. */
    shot?: number;
}

/**
 * The best tile to end on without a shot this turn, the unit's own included (with
 * `STAY_BONUS`): a tile by `standing`, and an open one only when no covered tile is within
 * `COVER_MARGIN` of it.
 */
function bestTile(
    field: Field,
    unit: Unit,
    moves: Map<string, number[]>,
): { path?: number[]; at: Spot; score: number } {
    const here: Spot = [unit.x, unit.y];
    const options: { path?: number[]; at: Spot; score: number }[] = [
        { at: here, score: standing(field, unit, here) + STAY_BONUS },
    ];
    for (const [key, path] of moves) {
        const at = key.split(",").map(Number) as Spot;
        options.push({ at, path, score: standing(field, unit, at) });
    }
    return pickCovered(field, unit, options);
}

/** The best-scoring option, moved off an open tile onto a covered one within `COVER_MARGIN`. */
function pickCovered<T extends { at: Spot; score: number }>(
    field: Field,
    unit: Unit,
    options: T[],
): T {
    const best = options.reduce((top, o) => (o.score > top.score ? o : top));
    if (!isOpen(field, unit, best.at)) return best;
    const covered = options.filter(
        (o) => o.score >= best.score - COVER_MARGIN / field.pressing && !isOpen(field, unit, o.at),
    );
    return covered.length ? covered.reduce((top, o) => (o.score > top.score ? o : top)) : best;
}

/**
 * What one unit does next. Every option ends the unit's turn somewhere: its worth is the
 * expected damage of this turn's shot plus `standing` of the tile it ends on.
 *
 * - Two AP and a loaded weapon: stay and shoot, or move to a reachable tile and shoot from there
 *   (the move now, the shot on the next call), whichever is worth most among the shots of at
 *   least `WORTHWHILE_SHOT`. A move keeps its shot within `KEEP_SHOT` of the standing one unless
 *   the unit stands badly exposed (`BAD_EXPOSURE`). With no such shot anywhere it walks to
 *   `bestTile`, and takes a poor standing shot only when it stays.
 * - Two AP and an empty weapon: walk to `bestTile` first, reload with the AP left.
 * - One AP: shoot where it stands, or step to `bestTile`, whichever is worth more. Empty, it
 *   reloads, unless the step saves `RELOAD_STEP_MARGIN`.
 * - Nothing better than standing: reload a weapon that is not full, or nothing.
 */
function planFor(field: Field, unit: Unit, legal: LegalAction[]): Plan | null {
    const here: Spot = [unit.x, unit.y];
    const own = (a: LegalAction) => a.unit![0] === unit.x && a.unit![1] === unit.y;
    const moves = legal.some((a) => a.kind === "move" && own(a))
        ? reachable(field.state, unit)
        : new Map<string, number[]>();
    const moveId = (path: number[]) => actionId({ kind: "move", x: unit.x, y: unit.y, path });
    const reload = legal.find((a) => a.kind === "reload" && own(a))?.id;
    const reloading = reload ? { id: reload, gain: 0 } : null;
    const attackId = (target: Unit) =>
        legal.find(
            (a) => a.kind === "attack" && own(a) && a.to![0] === target.x && a.to![1] === target.y,
        )?.id;

    const idle = standing(field, unit, here) + STAY_BONUS;
    const loaded = hasAction(unit, "attack") && unit.ammo > 0;
    const shot = loaded ? shotFrom(field, unit, here) : { value: 0, chance: 0 };
    const shoot = shot.target && attackId(shot.target);
    const tile = bestTile(field, unit, moves);
    const walk = tile.path && { id: moveId(tile.path), gain: tile.score - idle };

    if (unit.ap >= 2 && loaded) {
        const exposed = exposure(field, unit, here) >= BAD_EXPOSURE * unit.hp;
        const options: { at: Spot; path?: number[]; score: number }[] = [];
        if (shoot && shot.chance >= WORTHWHILE_SHOT) {
            options.push({ at: here, score: shot.value + idle });
        }
        for (const [key, path] of moves) {
            const at = key.split(",").map(Number) as Spot;
            const from = shotFrom(field, unit, at);
            if (from.chance < WORTHWHILE_SHOT) continue;
            if (shoot && !exposed && from.chance < shot.chance - KEEP_SHOT) continue;
            options.push({ at, path, score: from.value + standing(field, unit, at) });
        }
        if (options.length) {
            const best = pickCovered(field, unit, options);
            const gain = best.score - idle;
            if (best.path) return { id: moveId(best.path), gain };
            return { id: shoot!, gain, shot: shot.chance };
        }
        if (walk) return walk;
        if (shoot) return { id: shoot, gain: shot.value, shot: shot.chance };
        return reloading;
    }

    // empty with two AP: the move first, so the reload is decided where the unit ends up
    if (unit.ap >= 2) return walk ?? reloading;

    // one AP left
    if (shoot) {
        if (walk && tile.score > shot.value + idle) return walk;
        return { id: shoot, gain: shot.value, shot: shot.chance };
    }
    if (loaded) return walk ?? reloading;
    const saved = exposure(field, unit, here) - (walk ? exposure(field, unit, tile.at) : 0);
    if (walk && EXPOSURE_WEIGHT * saved >= RELOAD_STEP_MARGIN) return walk;
    return reloading ?? walk ?? null;
}

/**
 * The reference bot. A unit with a flashbang or a frag grenade throws it first when
 * `flashbangThrow` or `fragThrow` finds it worth more than the turn's other uses (a smoke
 * grenade is never thrown); then every unit with AP gets a `planFor`: shots from where a unit
 * stands go first, the best chance first, then the plan that gains most. Seeking cover is the
 * default: a shot is weighed with the tile it is taken from, so a unit moves into cover (or
 * round an enemy's cover) and then shoots, where that is worth more than shooting from the
 * open. Nothing is random: the same state gives the same orders. A baseline to beat and the
 * sandbox's opponent, not a strategy.
 */
export const referencePolicy: Policy = ({ state, side, legal }) => {
    const first = (test: (action: LegalAction) => boolean) => legal.find(test)?.id;

    const lifecycle = first((a) => a.kind === "deploy" || a.kind === "complete");
    if (lifecycle) return [lifecycle];

    // a unit that carries a throw weighs it against its shot (see `flashbangThrow`, `fragThrow`)
    const throws = [flashbangThrow(state, side, legal), fragThrow(state, side, legal)];
    const thrown = throws.reduce((top, t) => (t && (!top || t.score > top.score) ? t : top));
    if (thrown) return [thrown.id];

    const field = fieldOf(state, side);
    const plans = state.units
        .filter((unit) => unit.side === side && unit.ap > 0)
        .map((unit) => planFor(field, unit, legal))
        .filter((plan): plan is Plan => plan !== null);
    const shots = plans.filter((plan) => plan.shot !== undefined);
    if (shots.length) return [shots.reduce((top, p) => (p.shot! > top.shot! ? p : top)).id];
    if (plans.length) return [plans.reduce((top, p) => (p.gain > top.gain ? p : top)).id];
    return ["next_turn"];
};
