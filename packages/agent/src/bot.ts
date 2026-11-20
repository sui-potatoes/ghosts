// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    blastUnits,
    coverBonus,
    effectiveStats,
    effectOf,
    GRENADE_RADIUS,
    hasAction,
    moveScore,
    shotChance,
    type LegalAction,
} from "./rules.ts";
import type { GameState, Unit } from "./types.ts";

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

/** A shot at least this likely is a threat worth a flashbang or a smoke grenade. */
const THREATENING_SHOT = 35;
/** A shot this likely is worth a flashbang even from a single enemy. */
const SURE_SHOT = 50;

/**
 * The best chance `shooter` has of hitting any of `targets` from where it stands, effects
 * counted: 0 for one that cannot shoot (no weapon, empty, dazed).
 */
function danger(state: GameState, shooter: Unit, targets: Unit[]): number {
    if (!hasAction(shooter, "attack") || shooter.ammo <= 0) return 0;
    const stats = effectiveStats(shooter);
    return targets.reduce((best, target) => {
        const chance = shotChance(
            state,
            stats,
            shooter.x,
            shooter.y,
            target.x,
            target.y,
            effectiveStats(target).defense,
        );
        return Math.max(best, chance ?? 0);
    }, 0);
}

/**
 * A flashbang or a smoke grenade worth the unit's turn, or undefined. A flashbang goes where it
 * dazes enemies about to shoot, with none of mine in it: two of them, or one that is a sure
 * threat (`SURE_SHOT`). A smoke grenade covers my units that an enemy is likely to hit and
 * that have no cover against it, with no enemy in it, and only when no good shot is open, since
 * smoke costs aim.
 */
function effectThrow(state: GameState, side: number, legal: LegalAction[]): string | undefined {
    const mine = state.units.filter((unit) => unit.side === side);
    const enemies = state.units.filter((unit) => unit.side !== side);
    const at = ({ to }: LegalAction) => blastUnits(state, to![0], to![1], GRENADE_RADIUS);

    let best: { id: string; score: number } | undefined;
    const consider = (id: string, score: number) => {
        if (score > 0 && (!best || score > best.score)) best = { id, score };
    };

    for (const throwing of legal.filter((a) => a.kind === "flashbang" && !a.alliesHit)) {
        const threats = at(throwing).map((enemy) => danger(state, enemy, mine));
        const likely = threats.filter((chance) => chance >= THREATENING_SHOT);
        const sure = likely.some((chance) => chance >= SURE_SHOT);
        if (likely.length >= 2 || sure) consider(throwing.id, likely.length * 100 + threats.length);
    }

    for (const throwing of legal.filter((a) => a.kind === "smoke_grenade" && !a.enemiesHit)) {
        const exposed = at(throwing).filter((unit) => {
            if (effectOf(unit, "smoke")) return false;
            return enemies.some(
                (enemy) =>
                    danger(state, enemy, [unit]) >= THREATENING_SHOT &&
                    coverBonus(state, enemy.x, enemy.y, unit.x, unit.y) === 0,
            );
        });
        consider(throwing.id, exposed.length);
    }
    return best?.id;
}

/**
 * The reference bot: take a good shot, reload when empty, otherwise walk to the
 * best tile, and end the turn when no unit has anything left. A unit with a
 * flashbang or a smoke grenade throws it when `effectThrow` finds it worth it, once no good
 * shot is open. It is a baseline to beat and the sandbox's opponent, not a strategy.
 */
export const referencePolicy: Policy = ({ state, side, legal }) => {
    const first = (test: (action: LegalAction) => boolean) => legal.find(test)?.id;

    const lifecycle = first((a) => a.kind === "deploy" || a.kind === "complete");
    if (lifecycle) return [lifecycle];

    const shots = legal.filter((a) => a.kind === "attack");
    const best = shots.reduce<LegalAction | null>(
        (top, shot) => (!top || shot.hitChance! > top.hitChance! ? shot : top),
        null,
    );
    if (best && best.hitChance! >= WORTHWHILE_SHOT) return [best.id];

    const reload = first((a) => a.kind === "reload");
    if (reload && shots.length === 0) return [reload];

    const thrown = effectThrow(state, side, legal);
    if (thrown) return [thrown];

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
