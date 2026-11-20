// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game on chain as the engine's scene and rules take it: the scenario a game
 * opens as (the scene with the units the map holds), and the rules brought in
 * line with a read of the game. Shared by a player's match (`driver.ts`) and
 * the viewer (`features/watch/chain`). Only types come from the engine, so it
 * runs in node: the scene to build on is passed in.
 */

import type { EncounterRules, Scenario, UnitSpec } from "@ghosts/engine";
import { unpack } from "@ghosts/squad/stats";

import type { ChainGame } from "./bcs.ts";
import {
    blastCells,
    effectsOf,
    toCell,
    unitActions,
    unitsOnMap,
    type Bounds,
} from "./match-rules.ts";

/** How a unit looks when the scene is told (a recruit's face and armor). */
export type UnitLook = NonNullable<UnitSpec["look"]>;

const callsign = (name: string) => (name.split(" ").pop() ?? name).toUpperCase();

/**
 * The encounter a game starts as for `side`: `base`'s scene with the units the
 * map holds right now, so it also picks a game up after a reload. `looks` dress
 * the units of the other side (the scene dresses `side`'s from the squad it is given).
 */
export function scenarioFor(
    base: Scenario,
    game: ChainGame,
    side: number,
    names: ReadonlyMap<string, string>,
    looks?: ReadonlyMap<string, UnitLook>,
): Scenario {
    const bounds = base.map.bounds;
    const hostile = base.units.find((u) => u.enemy)?.color ?? "#e77469";
    const allyColors = base.units.filter((u) => !u.enemy).map((u) => u.color);
    let allies = 0;
    // By side and recruit, not by tile: a player's cards stay in order wherever the
    // units stand.
    const sideOf = (owner: string) => game.players.indexOf(owner);
    const onMap = unitsOnMap(game).sort(
        (a, b) =>
            sideOf(a.unit.owner) - sideOf(b.unit.owner) ||
            a.unit.recruit.localeCompare(b.unit.recruit),
    );
    const units: UnitSpec[] = onMap.map(({ row, col, unit }) => {
        const enemy = unit.owner !== game.players[side];
        const name = names.get(unit.recruit) ?? "Operative";
        const look = enemy ? looks?.get(unit.recruit) : undefined;
        return {
            id: unit.recruit,
            name: callsign(name),
            full: name,
            role: "ASSAULT",
            pos: toCell([row, col], bounds),
            color: enemy ? hostile : allyColors[allies++ % allyColors.length],
            enemy,
            ...(look ? { look } : {}),
        };
    });
    return { ...base, id: "match", versus: true, units };
}

/**
 * What the blasts of a game did to its scene, for an encounter opened after them:
 * the same damage in the same order, so it stands as if it had been there.
 */
export function restoreBlasts(rules: EncounterRules, game: ChainGame, bounds: Bounds) {
    for (const cell of blastCells(game, bounds))
        rules.map.applyPropDamage(rules.map.blastProps(cell));
}

/** Bring the rules in line with the chain: it decides, the rules only show. */
export function syncUnits(rules: EncounterRules, game: ChainGame, bounds: Bounds) {
    const onMap = new Map(unitsOnMap(game).map((entry) => [entry.unit.recruit, entry]));
    for (const u of rules.units) {
        const entry = onMap.get(u.id);
        if (!entry) {
            u.hp = 0;
            continue;
        }
        const { unit, row, col } = entry;
        const stats = unpack(BigInt(unit.stats.value));
        u.pos = toCell([row, col], bounds);
        u.hp = unit.hp.value;
        u.maxHp = unit.hp.maxValue;
        // the contract gives a side its AP back as its turn begins
        u.ap = unit.ap.value;
        u.ammo = unit.ammo.value;
        u.clip = unit.ammo.maxValue;
        u.armor = stats.armor;
        u.aim = stats.aim;
        u.range = stats.range;
        u.mobility = stats.mobility;
        u.damage = stats.damage;
        // what the unit carries, with the uses left: the command bar offers exactly these
        u.actions = unitActions(unit.actions);
        // daze and smoke as the chain has them; the base stats above stay as they are
        u.effects = effectsOf(unit.effects);
    }
}
