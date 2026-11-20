// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    blastUnits,
    damageRange,
    effectiveStats,
    GRENADE_DAMAGE,
    GRENADE_RADIUS,
    hasAction,
    manhattan,
    moveScore,
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

/**
 * The reference bot: take a good shot, reload when empty, otherwise walk to the
 * best tile, and end the turn when no unit has anything left. A unit with a
 * flashbang or a frag grenade throws it first when `flashbangThrow` or `fragThrow` finds it
 * worth more than the turn's other uses; a smoke grenade is never thrown. It is a baseline to beat and the sandbox's opponent, not a strategy.
 */
export const referencePolicy: Policy = ({ state, side, legal }) => {
    const first = (test: (action: LegalAction) => boolean) => legal.find(test)?.id;

    const lifecycle = first((a) => a.kind === "deploy" || a.kind === "complete");
    if (lifecycle) return [lifecycle];

    // a unit that carries a throw weighs it against its shot (see `flashbangThrow`, `fragThrow`)
    const throws = [flashbangThrow(state, side, legal), fragThrow(state, side, legal)];
    const thrown = throws.reduce((top, t) => (t && (!top || t.score > top.score) ? t : top));
    if (thrown) return [thrown.id];

    const shots = legal.filter((a) => a.kind === "attack");
    const best = shots.reduce<LegalAction | null>(
        (top, shot) => (!top || shot.hitChance! > top.hitChance! ? shot : top),
        null,
    );
    if (best && best.hitChance! >= WORTHWHILE_SHOT) return [best.id];

    const reload = first((a) => a.kind === "reload");
    if (reload && shots.length === 0) return [reload];

    const moves = legal.filter((a) => a.kind === "move");
    const move = moves.length
        ? moves.reduce((top, m) => (moveScore(m) > moveScore(top) ? m : top))
        : null;

    // A poor shot still beats walking unless the walk opens a better one: units
    // that only ever walk spend all their AP and never fire.
    if (best && best.hitChance! > 0 && (move?.bestShot ?? 0) <= best.hitChance!) return [best.id];
    if (move) return [move.id];
    return ["next_turn"];
};
