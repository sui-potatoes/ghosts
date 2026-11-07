// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { moveScore, type LegalAction } from "./rules.ts";
import type { GameState } from "./types.ts";

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

/**
 * The reference bot: take a good shot, reload when empty, otherwise walk to the
 * best tile, and end the turn when no unit has anything left. It is a baseline
 * to beat and the sandbox's opponent, not a strategy.
 */
export const referencePolicy: Policy = ({ legal }) => {
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
