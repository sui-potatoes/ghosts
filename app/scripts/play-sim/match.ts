// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * One ranked match between two virtual squads, headless, under the chain's rules:
 * the agent package's sandbox (a port of `ghosts::map` and `ghosts::unit`, dice
 * included) on the Black Rain grid, both sides played by the same policy.
 */

import { BLACK_RAIN_POSITIONS } from "../../../packages/agent/src/maps.ts";
import { referencePolicy, type Policy } from "../../../packages/agent/src/bot.ts";
import {
    blastUnits,
    GRENADE_DAMAGE,
    legalActions,
    parseAction,
} from "../../../packages/agent/src/rules.ts";
import { createSandbox, type SquadUnit } from "../../../packages/agent/src/sandbox.ts";
import type { LegalAction } from "../../../packages/agent/src/rules.ts";
import type { UnitAction } from "../../../packages/agent/src/types.ts";
import { fieldUnit, type Loadout } from "../../src/features/play/economy/index.ts";

/**
 * Black Rain's three spawns a side plus one more each for 4x4, picked by the
 * simulation (walkable tiles beside each side's group); not a shipped layout.
 * The first half is the first player's: the side that moves first.
 */
export const FOUR_A_SIDE: [number, number][] = [
    [12, 12],
    ...BLACK_RAIN_POSITIONS.slice(0, 3),
    [4, 8],
    ...BLACK_RAIN_POSITIONS.slice(3),
];

const KINDS: Record<string, UnitAction> = {
    Move: "move",
    Attack: "attack",
    Reload: "reload",
    Grenade: "grenade",
};

export function squadUnits(squad: Loadout[]): SquadUnit[] {
    return squad.map((loadout) => {
        const { stats, actions } = fieldUnit(loadout);
        return { stats, actions: actions.map((a) => ({ kind: KINDS[a.kind], uses: a.uses })) };
    });
}

/**
 * The reference bot plus grenades, which it never throws: a throw that hurts no
 * friend and deals at least 3 damage (or kills) goes first, since it costs one
 * AP and leaves the unit free to shoot.
 */
export const simPolicy: Policy = (input) => {
    const { state, side, legal } = input;
    let best: { action: LegalAction; value: number } | null = null;
    for (const action of legal) {
        if (action.kind !== "grenade" || action.alliesHit) continue;
        let value = 0;
        for (const unit of blastUnits(state, action.to![0], action.to![1], 2)) {
            if (unit.side === side) continue;
            const dealt =
                unit.stats.armor >= GRENADE_DAMAGE ? 1 : GRENADE_DAMAGE - unit.stats.armor;
            value += Math.min(dealt, unit.hp) + (dealt >= unit.hp ? 3 : 0);
        }
        if (value >= 3 && (!best || value > best.value)) best = { action, value };
    }
    if (best) return [best.action.id];
    return referencePolicy(input);
};

export interface Result {
    /** 0 or 1 for the side that won, null for a draw. */
    winner: number | null;
    turns: number;
    /** Units left standing per side. */
    left: [number, number];
}

const MAX_ACTIONS = 32;

/** Play squads[0] (moves first) against squads[1]. */
export async function playMatch(
    squads: [Loadout[], Loadout[]],
    seed: number,
    policy: Policy = simPolicy,
): Promise<Result> {
    const positions = squads[0].length === 4 ? FOUR_A_SIDE : BLACK_RAIN_POSITIONS;
    // you wait and are found: you are side 0 and go first
    const backend = createSandbox({
        seed,
        seated: true,
        opponent: policy,
        now: () => 0,
        squads: [squadUnits(squads[0]), squadUnits(squads[1])],
        positions,
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
        if (state.active !== 0) throw new Error("the opponent did not end its turn");
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
    const left: [number, number] = [0, 1].map(
        (s) => state.units.filter((u) => u.side === s).length,
    ) as [number, number];
    return { winner, turns: state.turn, left };
}
