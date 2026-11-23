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
    hasUsesLeft,
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


// === Cover ===

/**
 * What a hit point the unit may lose on the enemy's next turn weighs against one it deals this
 * turn: the same. The enemy's reply against the tile a unit ends on is as real as the unit's own
 * shot; weighed lower, every even trade looks like a gain and the closest tile (where both sides
 * hit most) wins, which walks the squad to point blank.
 */
const EXPOSURE_WEIGHT = 1;
/**
 * The share of an enemy's best shot after a move (from any tile it can reach) that counts in the
 * exposure, next to its shot from where it stands. An enemy moves and shoots when that is better
 * (this bot does), but it has its own tile to care about and other targets: most of it, not all.
 * Close to an enemy this is what grows: from more of the tiles it can reach it flanks the unit,
 * at the distance bonus of a short shot.
 */
const ENEMY_MOVE_WEIGHT = 0.6;
/** What standing still is worth, in hit points: a tie stays, two equal tiles never alternate. */
const STAY_BONUS = 0.25;
/**
 * The share of the best shot from a tile, as the enemies stand now, that counts for next turn:
 * they move before it comes.
 */
const NEXT_SHOT_WEIGHT = 0.5;
/**
 * Hit points a tile of distance to the nearest enemy costs past the unit's weapon range: a unit
 * closes to its range, all else equal, and gains nothing from going closer.
 */
const APPROACH_WEIGHT = 0.4;
/**
 * A move ends on an open tile (one an enemy that can see it gets no cover from) only when no
 * covered tile scores within this many hit points of it: a squad in cover is the default, and
 * the open has to be clearly better. Measured on Black Rain against the policy before it: from
 * 1.5 to 2.5 the squad ends more turns in cover and still wins more than it loses; at 4 it hides
 * from shots it should take and loses.
 */
const COVER_MARGIN = 2.5;
/**
 * Point blank: a tile this close to an enemy is one it can flank with a single step, at its best
 * chance. A unit ends there only to shoot with an even chance of a kill (`CLOSE_KILL`), or in
 * cover against every enemy that sees the tile; otherwise it holds its range.
 */
const CLOSE_RANGE = 2;
/**
 * The kill chance (hit chance times the chance a hit kills) that pays for a point-blank tile:
 * a dead enemy shoots nobody back from its flank.
 */
const CLOSE_KILL = 0.35;
/**
 * A squadmate within this many tiles supports a unit: it shoots at whatever comes for the unit.
 * A tile with none costs `ISOLATION` (a dazed unit `REGROUP`): a lone unit draws every enemy.
 */
const SUPPORT_RANGE = 6;
const ISOLATION = 1;
const REGROUP = 2;
/**
 * The share of a frag grenade's damage to a squadmate that a tile within one blast of it costs,
 * while an enemy still carries one: two units side by side are one throw.
 */
const FRAG_THREAT = 0.4;
/**
 * With 1 AP and an empty weapon a unit reloads, unless stepping to the best tile lowers the
 * damage it expects to take (weighted by `EXPOSURE_WEIGHT`) by at least this many hit points: then
 * it steps, and reloads next turn (reload and shoot still fit in two AP).
 */
const RELOAD_STEP_MARGIN = 1;
/**
 * Turn changes in a row without a shot or a frag, after which the sides are taken to be waiting
 * each other out: units then press on, so a game still ends before the draw at `MAX_TURNS`. A
 * pressure that grows by `PRESS_STEP` for every quiet turn change from here until somebody
 * shoots multiplies the pull of distance and divides the weight of exposure; pressing still ends
 * on a covered tile wherever one is in reach: cover to cover, never into the open. Two rounds.
 */
const QUIET_TURNS = 4;
/** How much the pressure grows per quiet turn change from `QUIET_TURNS` on. */
const PRESS_STEP = 1;
/**
 * The pressure (three more quiet turn changes) at which pressing gives up the cover rules: a
 * unit may then end in the open or at point blank when that scores best, as the last way into a
 * fight two squads hiding round one corner from each other never start. Matches must end.
 */
const LAST_RESORT = 4;
/**
 * What a kill is worth past the hit points it takes, for a shot, a frag and the exposure alike:
 * a dead unit never shoots again. Without it a unit spreads its fire and trades evenly; with it,
 * it finishes the wounded first.
 */
const KILL_BONUS = 7;
/**
 * A frag grenade is thrown from at least this far from every enemy it catches: a throw from
 * closer is a substitute for a position, and leaves the thrower next to what survives.
 */
const FRAG_STANDOFF = 3;
/**
 * A frag grenade is one use per match: a throw that catches a single enemy and kills nobody has
 * to beat the unit's best plan without it by this many hit points while two enemies or more are
 * left. A throw that catches two, kills, or is aimed at the last enemy owes nothing.
 */
const FRAG_KEEP = 2;
/**
 * The least a frag grenade must be worth on its own (damage, kills and cover), in hit points,
 * before the thrower's AP are counted: a throw for a point of damage soaked by armor wastes the
 * one use, whatever the thrower would do instead.
 */
const FRAG_MIN_VALUE = 1.5;

/** A tile as `[x, y]`. */
type Spot = [number, number];
const keyOf = ([x, y]: Spot) => `${x},${y}`;

const isDazed = (unit: Unit) => unit.effects.some((effect) => effect.kind === "daze");

/**
 * What one shot of `shooter` from `from` at `target` on `at` is worth, without asking for AP or
 * ammo: its chance times the share the target does not dodge times the average damage (capped
 * by the target's health), plus `KILL_BONUS` times the chance that it kills, with every damage in
 * the range taken as equally likely. `kill` is that chance, `chance` the hit chance alone.
 */
function hitFrom(
    state: GameState,
    shooter: Unit,
    shooterFx: UnitEffect[],
    from: Spot,
    target: Unit,
    targetFx: UnitEffect[],
    at: Spot,
): { value: number; chance: number; kill: number } {
    const stats = effectiveStats({ stats: shooter.stats, effects: shooterFx });
    const theirs = effectiveStats({ stats: target.stats, effects: targetFx });
    const chance = shotChance(state, stats, from[0], from[1], at[0], at[1], theirs.defense) ?? 0;
    const { min, max } = damageRange(stats, target);
    const kills = Math.min(1, Math.max(0, (max - target.hp + 1) / (max - min + 1)));
    const lands = (chance / 100) * (stats.canBeDodged ? 1 - Math.min(100, theirs.dodge) / 100 : 1);
    const value = lands * (Math.min(target.hp, (min + max) / 2) + kills * KILL_BONUS);
    return { value, chance, kill: lands * kills };
}

/**
 * The fight as one side sees it in one call: the enemies, where each can go on its next turn, and
 * the exposure of every tile asked about, kept for the call (several of my units ask about the
 * same tiles).
 */
interface Field {
    state: GameState;
    side: number;
    /** The enemies that can shoot. */
    enemies: Unit[];
    /** Every enemy, armed or not. */
    targets: Unit[];
    /** The tiles an enemy can move to and shoot from next turn: none with an empty weapon. */
    reach: Map<Unit, Spot[]>;
    exposure: Map<string, Map<Unit, number>>;
    /** Whether an enemy still carries a frag grenade. */
    frags: boolean;
    /** The pressure to close in: 1, more once the game has gone quiet (`QUIET_TURNS`). */
    pressing: number;
    /** While pressing: steps from each tile to the nearest enemy, round the walls. */
    steps: Map<string, number>;
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
        if (enemy.ammo > 0 && hasAction(enemy, "move")) {
            for (const key of reachable(state, enemy).keys()) {
                tiles.push(key.split(",").map(Number) as Spot);
            }
        }
        reach.set(enemy, tiles);
    }
    const frags = targets.some((unit) => hasUsesLeft(unit, "grenade"));
    const steps = pressing > 1 ? stepsTo(state, targets) : new Map<string, number>();
    return { state, side, enemies, targets, reach, exposure: new Map(), frags, pressing, steps };
}

/**
 * Steps from every tile to the nearest of `units`, walking round walls and unwalkable tiles
 * (units and high cover edges aside): how far a fight is when a wall stands between.
 */
function stepsTo(state: GameState, units: Unit[]): Map<string, number> {
    const steps = new Map<string, number>(units.map((u) => [keyOf([u.x, u.y]), 0]));
    let frontier: Spot[] = units.map((u) => [u.x, u.y]);
    for (let distance = 1; frontier.length > 0; distance++) {
        const next: Spot[] = [];
        for (const [x, y] of frontier) {
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as Spot[]) {
                const kind = state.tiles[nx]?.[ny]?.kind;
                if (kind === undefined || kind === "wall" || kind === "unwalkable") continue;
                if (steps.has(keyOf([nx, ny]))) continue;
                steps.set(keyOf([nx, ny]), distance);
                next.push([nx, ny]);
            }
        }
        frontier = next;
    }
    return steps;
}

/**
 * The damage `unit` can expect to take on `at` over the enemy's next turn: per enemy (every one
 * that can shoot, not the nearest alone), its shot from where it stands, or `ENEMY_MOVE_WEIGHT`
 * of its best shot from a tile it can move to if that is more, each with the hit chance of the
 * rules (the distance bonus up close, the penalty past range, directional cover) and the unit's
 * dodge, with the effects that will still be on both. A dazed enemy threatens nothing.
 */
function exposure(field: Field, unit: Unit, at: Spot): number {
    let total = 0;
    for (const threat of threats(field, unit, at).values()) total += threat;
    return total;
}

/** `exposure` enemy by enemy: what each one is expected to deal to `unit` on `at`. */
function threats(field: Field, unit: Unit, at: Spot): Map<Unit, number> {
    const key = `${unit.recruit}@${keyOf(at)}`;
    const known = field.exposure.get(key);
    if (known !== undefined) return known;
    const { state } = field;
    const mine = lasting(unit);
    const total = new Map<Unit, number>();
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
        total.set(enemy, Math.max(still.value, moved * ENEMY_MOVE_WEIGHT));
    }
    field.exposure.set(key, total);
    return total;
}

/** The best shot `unit` has from `from` at the enemies as they stand (its AP and ammo aside). */
function shotFrom(field: Field, unit: Unit, from: Spot): Shot {
    let best: Shot = { value: 0, chance: 0, kill: 0 };
    if (!hasAction(unit, "attack") || isDazed(unit)) return best;
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
    kill: number;
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

/** Tiles from `at` to the nearest enemy. */
const nearest = (field: Field, at: Spot) =>
    field.targets.reduce(
        (low, enemy) => Math.min(low, manhattan(enemy.x, enemy.y, ...at)),
        Infinity,
    );

/**
 * What ending the turn on `at` is worth, in hit points, past this turn's shot: the damage the unit
 * expects to take there, a share of the shot it would have next turn, the distance past its
 * range to the nearest enemy, and where its squadmates are: none within `SUPPORT_RANGE` costs
 * `ISOLATION` (`REGROUP` when dazed), and each one inside a frag's reach of it costs
 * `FRAG_THREAT` of the frag while an enemy carries one.
 */
function standing(field: Field, unit: Unit, at: Spot): number {
    const near =
        field.pressing > 1
            ? (field.steps.get(keyOf(at)) ?? nearest(field, at))
            : nearest(field, at);
    // pressing, every tile counts: a line of fire round the corner is what is wanted
    const range = field.pressing > 1 ? 0 : effectiveStats(unit).range;
    // a dazed unit has no shot to close in for: it holds or falls back
    const past = Number.isFinite(near) && !isDazed(unit) ? Math.max(0, near - range) : 0;
    const mates = field.state.units.filter((u) => u.side === unit.side && u !== unit);
    const distances = mates.map((mate) => manhattan(mate.x, mate.y, ...at));
    let squad = 0;
    if (mates.length && !distances.some((d) => d <= SUPPORT_RANGE)) {
        squad -= isDazed(unit) ? REGROUP : ISOLATION;
    }
    if (field.frags) {
        mates.forEach((mate, i) => {
            if (distances[i] > 2 * GRENADE_RADIUS) return;
            const hurt = Math.min(mate.hp, Math.max(1, GRENADE_DAMAGE - mate.stats.armor));
            squad -= FRAG_THREAT * hurt;
        });
    }
    return (
        (-EXPOSURE_WEIGHT / field.pressing) * exposure(field, unit, at) +
        NEXT_SHOT_WEIGHT * shotFrom(field, unit, at).value -
        APPROACH_WEIGHT * field.pressing * past +
        squad
    );
}

/**
 * What a shot from `at` is worth with the tile: its own worth, and the reply of its target
 * against `at` that a kill takes away (the kill chance of it, weighed as the exposure is).
 */
function firing(field: Field, unit: Unit, at: Spot, shot: Shot): number {
    const reply = shot.target ? (threats(field, unit, at).get(shot.target) ?? 0) : 0;
    return shot.value + (EXPOSURE_WEIGHT / field.pressing) * shot.kill * reply;
}

/**
 * Whether the unit may end on `at` with `shot` (none for a tile it only walks to): beyond
 * `CLOSE_RANGE` of every enemy always; closer only to shoot, and then for a likely kill of the
 * only enemy that close (`CLOSE_KILL`), or to flank a target covered against the unit where it
 * stands while ending in cover itself against every enemy that sees the tile. Once pressing
 * gives up (`LAST_RESORT`), anywhere.
 */
function allowed(field: Field, unit: Unit, at: Spot, shot?: Shot): boolean {
    if (field.pressing >= LAST_RESORT || nearest(field, at) > CLOSE_RANGE) return true;
    if (!shot?.target) return false;
    const { x, y } = shot.target;
    // the kill must be of the enemy that close: no other one left beside the tile
    const close = field.targets.filter((e) => manhattan(e.x, e.y, ...at) <= CLOSE_RANGE);
    if (shot.kill >= CLOSE_KILL && close.every((e) => e === shot.target)) return true;
    const flanks =
        coverBonus(field.state, unit.x, unit.y, x, y) > 0 &&
        coverBonus(field.state, ...at, x, y) === 0;
    return flanks && !isOpen(field, unit, at);
}

/** A unit's next order and what it gains over leaving the unit be. */
interface Plan {
    id: string;
    gain: number;
    /** The score of the turn the plan ends in: its shot and the tile it ends on. */
    score: number;
    /** A shot from where the unit stands, by its chance: those go first. */
    shot?: number;
}

interface Option {
    path?: number[];
    at: Spot;
    score: number;
    /** The tile is also where the unit shoots from. */
    shoots?: boolean;
}

/**
 * The best tile to end on without a shot this turn, the unit's own included (with
 * `STAY_BONUS`): a tile by `standing`, kept off point blank (`allowed`), and an open one only
 * when no covered tile is within `COVER_MARGIN` of it.
 */
function bestTile(field: Field, unit: Unit, moves: Map<string, number[]>): Option {
    const here: Spot = [unit.x, unit.y];
    const options: Option[] = [{ at: here, score: standing(field, unit, here) + STAY_BONUS }];
    for (const [key, path] of moves) {
        const at = key.split(",").map(Number) as Spot;
        if (!allowed(field, unit, at)) continue;
        options.push({ at, path, score: standing(field, unit, at) });
    }
    return pickCovered(field, unit, options);
}

/**
 * The best-scoring option, moved off an open tile onto a covered one within `COVER_MARGIN`; when
 * the game has gone quiet, onto the best covered one wherever one is (cover to cover).
 */
function pickCovered<T extends Option>(field: Field, unit: Unit, options: T[]): T {
    const best = options.reduce((top, o) => (o.score > top.score ? o : top));
    if (!isOpen(field, unit, best.at)) return best;
    const margin =
        field.pressing >= LAST_RESORT ? COVER_MARGIN : field.pressing > 1 ? Infinity : COVER_MARGIN;
    const covered = options.filter(
        (o) => o.score >= best.score - margin && !isOpen(field, unit, o.at),
    );
    return covered.length ? covered.reduce((top, o) => (o.score > top.score ? o : top)) : best;
}

/**
 * What one unit does next, and the score of the turn it plans (the shot plus `standing` of the
 * tile it ends on). Every option ends the unit's turn somewhere.
 *
 * - Two AP and a loaded weapon: shoot from here, move and shoot from the tile moved to, or only
 *   move (to `bestTile`), whichever is worth most, the shots counted at `WORTHWHILE_SHOT` or
 *   better. All on one scale, so a shot from the open is taken first only when it beats moving
 *   into cover and shooting from there with the enemy's reply on each tile counted: a kill, or a
 *   unit already covered. No tile within `CLOSE_RANGE` of an enemy but as `allowed` says.
 * - Dazed: no shot (the aim is gone); the AP go to `bestTile`, away from the enemies and back to
 *   the squad (`REGROUP`); with nothing threatening it holds.
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
    const attackId = (target: Unit) =>
        legal.find(
            (a) => a.kind === "attack" && own(a) && a.to![0] === target.x && a.to![1] === target.y,
        )?.id;

    const idle = standing(field, unit, here) + STAY_BONUS;
    const reloading = reload ? { id: reload, gain: 0, score: idle } : null;
    const loaded = hasAction(unit, "attack") && unit.ammo > 0 && !isDazed(unit);
    const shot = loaded ? shotFrom(field, unit, here) : { value: 0, chance: 0, kill: 0 };
    const shoot = shot.target && attackId(shot.target);
    const tile = bestTile(field, unit, moves);
    const walk = tile.path && { id: moveId(tile.path), gain: tile.score - idle, score: tile.score };
    const fire = (score: number) => ({ id: shoot!, gain: score - idle, score, shot: shot.chance });

    if (unit.ap >= 2 && loaded) {
        const options: Option[] = [tile];
        if (shoot && shot.chance >= WORTHWHILE_SHOT) {
            options.push({ at: here, score: firing(field, unit, here, shot) + idle, shoots: true });
        }
        for (const [key, path] of moves) {
            const at = key.split(",").map(Number) as Spot;
            const from = shotFrom(field, unit, at);
            if (from.chance < WORTHWHILE_SHOT || !allowed(field, unit, at, from)) continue;
            const score = firing(field, unit, at, from) + standing(field, unit, at);
            options.push({ at, path, score, shoots: true });
        }
        const best = pickCovered(field, unit, options);
        if (best.path) return { id: moveId(best.path), gain: best.score - idle, score: best.score };
        if (best.shoots) return fire(best.score);
        // staying put without a shot is the best: a poor shot is still better than nothing
        if (shoot) return fire(firing(field, unit, here, shot) + idle);
        return reloading;
    }

    // empty with two AP, or dazed: the move first, so the rest is decided where the unit ends up
    if (unit.ap >= 2) return walk ?? reloading;

    // one AP left
    if (shoot) {
        const score = firing(field, unit, here, shot) + idle;
        return walk && tile.score > score ? walk : fire(score);
    }
    if (loaded || isDazed(unit)) return walk ?? (unit.ammo > 0 ? null : reloading);
    const saved = exposure(field, unit, here) - (walk ? exposure(field, unit, tile.at) : 0);
    if (walk && EXPOSURE_WEIGHT * saved >= RELOAD_STEP_MARGIN) return walk;
    return reloading ?? walk ?? null;
}

/**
 * A frag grenade worth a unit's turn, or undefined. It catches none of mine (the thrower
 * included, so the thrower stands outside the blast), and it is thrown from at least
 * `FRAG_STANDOFF` from every enemy it catches. It cannot miss or be dodged, so its worth is sure:
 * the damage to every enemy in the blast after armor (a kill `KILL_BONUS` more), the most when
 * enemies cluster; plus the cover it destroys (every cover tile and obstacle in the blast is
 * gone): the shots of my units at the enemies who stood behind it gain what the cover took off,
 * in full for those with AP left this turn and at `NEXT_SHOT_WEIGHT` for the next; less the
 * cover my own units lose (what each enemy left gains on its best shot at one of mine). It is
 * worth at least `FRAG_MIN_VALUE`. A throw that catches nobody is for the
 * cover alone. The thrower then has the AP left (a shot from here, or a move to `bestTile`).
 * It is thrown when all that beats the thrower's own best plan without it, by `FRAG_KEEP` for a
 * throw that only catches one enemy and kills nobody.
 */
function fragThrow(
    field: Field,
    legal: LegalAction[],
    plans: Map<Unit, number>,
): Throw | undefined {
    const { state, side } = field;
    const throws = legal.filter((a) => a.kind === "grenade" && !a.alliesHit);
    if (throws.length === 0) return undefined;
    const mine = state.units.filter((unit) => unit.side === side);
    const enemies = field.targets;
    const shooters = mine.filter((m) => hasAction(m, "attack") && m.ammo > 0 && !isDazed(m));
    const dealtTo = (enemy: Unit) => Math.max(1, GRENADE_DAMAGE - enemy.stats.armor);
    const shotAt = (m: Unit, e: Unit) =>
        hitFrom(state, m, m.effects, [m.x, m.y], e, e.effects, [e.x, e.y]).value;
    const shotOn = (e: Unit, m: Unit) =>
        hitFrom(state, e, lasting(e), [e.x, e.y], m, lasting(m), [m.x, m.y]).value;

    let best: Throw | undefined;
    for (const throwing of throws) {
        const [tx, ty] = throwing.to!;
        const thrower = mine.find((u) => u.x === throwing.unit![0] && u.y === throwing.unit![1])!;
        const hit = blastUnits(state, tx, ty, GRENADE_RADIUS).filter((unit) => unit.side !== side);
        if (hit.some((e) => manhattan(e.x, e.y, thrower.x, thrower.y) < FRAG_STANDOFF)) continue;
        const killed = (enemy: Unit) => hit.includes(enemy) && dealtTo(enemy) >= enemy.hp;
        // nobody left next to a thrower in the open that cannot step away
        const left = enemies.filter((e) => !killed(e));
        const adjacent = left.some((e) => manhattan(e.x, e.y, thrower.x, thrower.y) <= 1);
        if (adjacent && thrower.ap < 2 && isOpen(field, thrower, [thrower.x, thrower.y])) continue;

        let value = 0;
        for (const enemy of hit) {
            value += Math.min(dealtTo(enemy), enemy.hp) + (killed(enemy) ? KILL_BONUS : 0);
        }

        // the cover tiles and obstacles it takes away, and what that changes on both sides
        const gone: Spot[] = [];
        for (let x = tx - GRENADE_RADIUS; x <= tx + GRENADE_RADIUS; x++) {
            for (let y = ty - GRENADE_RADIUS; y <= ty + GRENADE_RADIUS; y++) {
                const kind = state.tiles[x]?.[y]?.kind;
                const near = manhattan(x, y, tx, ty) <= GRENADE_RADIUS;
                if ((kind === "cover" || kind === "obstacle") && near) gone.push([x, y]);
            }
        }
        if (gone.length > 0) {
            const before = (m: Unit) => left.map((e) => shotAt(m, e));
            // each enemy left shoots once: at whichever of mine it hits best
            const reply = () =>
                left.reduce((sum, e) => sum + Math.max(0, ...mine.map((m) => shotOn(e, m))), 0);
            const was = new Map(shooters.map((m) => [m, before(m)]));
            const wasExposed = reply();
            const kept = gone.map(([x, y]) => state.tiles[x][y]);
            gone.forEach(([x, y]) => (state.tiles[x][y] = { kind: "empty" }));
            const now = new Map(shooters.map((m) => [m, before(m)]));
            const nowExposed = reply();
            gone.forEach(([x, y], i) => (state.tiles[x][y] = kept[i]));
            // this turn: every shooter with AP left takes its best gain once
            for (const m of shooters) {
                const ap = m === thrower ? m.ap - 1 : m.ap;
                if (ap <= 0) continue;
                const gains = left.map((_, i) => now.get(m)![i] - was.get(m)![i]);
                value += Math.max(0, ...gains);
            }
            // next turn: the best gain on each uncovered enemy, if it stays
            left.forEach((_, i) => {
                const gains = shooters.map((m) => now.get(m)![i] - was.get(m)![i]);
                value += NEXT_SHOT_WEIGHT * Math.max(0, ...gains);
            });
            value -= EXPOSURE_WEIGHT * (nowExposed - wasExposed);
        }
        if (value < FRAG_MIN_VALUE) continue;

        // the thrower's AP left: a shot from here or a move, as `planFor` weighs them
        const here: Spot = [thrower.x, thrower.y];
        let after = standing(field, thrower, here) + STAY_BONUS;
        if (thrower.ap >= 2) {
            const loaded = hasAction(thrower, "attack") && thrower.ammo > 0 && !isDazed(thrower);
            if (loaded) after += shotFrom(field, thrower, here).value;
            const moves = hasAction(thrower, "move") ? reachable(state, thrower) : new Map();
            after = Math.max(after, bestTile(field, thrower, moves).score);
        }
        const single = hit.length < 2 && !hit.some(killed) && left.length > 1;
        const score = value + after - plans.get(thrower)! - (single ? FRAG_KEEP : 0);
        if (score > 0 && (!best || score > best.score)) best = { id: throwing.id, score };
    }
    return best;
}

/**
 * The reference bot. A unit with a flashbang throws it first when `flashbangThrow` finds it worth
 * more than its shot; a unit with a frag grenade throws it when `fragThrow` finds it worth more
 * than its own best plan (a smoke grenade is never thrown); then every unit with AP gets a
 * `planFor`: shots from where a unit stands go first, the best chance first, then the plan that
 * gains most. Seeking cover is the default: a shot is weighed with the tile it is taken from and
 * the enemies' reply against that tile, so a unit moves into cover at its range and then shoots,
 * where that is worth more than shooting from the open; it keeps off point blank, near its squad.
 * Nothing is random: the same state gives the same orders. A baseline to beat and the sandbox's
 * opponent, not a strategy.
 */
export const referencePolicy: Policy = ({ state, side, legal }) => {
    const first = (test: (action: LegalAction) => boolean) => legal.find(test)?.id;

    const lifecycle = first((a) => a.kind === "deploy" || a.kind === "complete");
    if (lifecycle) return [lifecycle];

    const field = fieldOf(state, side);
    const units = state.units.filter((unit) => unit.side === side && unit.ap > 0);
    const planned = units.map((unit) => ({ unit, plan: planFor(field, unit, legal) }));

    // a unit that carries a throw weighs it against its shot or its plan; one that can likely
    // kill from where it stands takes the kill (`CLOSE_KILL`)
    const killers = new Set(
        units
            .filter((unit) => unit.ammo > 0)
            .filter((unit) => shotFrom(field, unit, [unit.x, unit.y]).kill >= CLOSE_KILL)
            .map((unit) => keyOf([unit.x, unit.y])),
    );
    const flash = flashbangThrow(
        state,
        side,
        legal.filter((a) => a.kind !== "flashbang" || !killers.has(keyOf(a.unit!))),
    );
    if (flash) return [flash.id];
    const plans = new Map(
        planned.map(({ unit, plan }) => [
            unit,
            plan?.score ?? standing(field, unit, [unit.x, unit.y]) + STAY_BONUS,
        ]),
    );
    const frag = fragThrow(field, legal, plans);
    if (frag) return [frag.id];

    const chosen = planned.map(({ plan }) => plan).filter((plan): plan is Plan => plan !== null);
    const shots = chosen.filter((plan) => plan.shot !== undefined);
    if (shots.length) return [shots.reduce((top, p) => (p.shot! > top.shot! ? p : top)).id];
    if (chosen.length) return [chosen.reduce((top, p) => (p.gain > top.gain ? p : top)).id];
    return ["next_turn"];
};
