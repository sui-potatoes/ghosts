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
import { lookOfGame } from "@ghosts/engine/look";
import { unpack } from "@ghosts/squad/stats";

import type { ChainGame } from "./bcs.ts";
import {
    blastCells,
    effectsOf,
    terrainAt,
    toCell,
    toTile,
    unitActions,
    unitsOnMap,
    type Bounds,
    type Cell,
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
    // The look comes from the game's ID alone: both players and every viewer see the same sky.
    return { ...base, id: "match", versus: true, units, look: lookOfGame(game.id) };
}

/** Object IDs compare as Sui addresses: any case, with or without `0x`. */
const sameId = (a: string, b: string) =>
    a.toLowerCase().replace(/^0x/, "") === b.toLowerCase().replace(/^0x/, "");

/** Whether `mapId` is one of `ids` (a retired level's, say), compared as Sui addresses. */
export const isListedLevel = (mapId: string, ids: readonly string[]) =>
    ids.some((id) => id !== "" && sameId(id, mapId));

/**
 * The scene a game is played in, by its map's ID (the level's `Preset` ID,
 * `Map.id`): the listed level's, else `fallback`. A level with no ID yet (not
 * on chain) is never picked. `levels` builds its scene only when picked.
 */
export function sceneOfLevel(
    mapId: string,
    levels: readonly (readonly [id: string, scene: () => Scenario])[],
    fallback: Scenario,
): Scenario {
    const level = levels.find(([id]) => id !== "" && sameId(id, mapId));
    return level ? level[1]() : fallback;
}

/**
 * What the blasts of a game did to its scene, for an encounter opened after them:
 * the same damage in the same order, so it stands as if it had been there.
 */
export function restoreBlasts(rules: EncounterRules, game: ChainGame, bounds: Bounds) {
    for (const cell of blastCells(game, bounds))
        rules.map.applyPropDamage(rules.map.blastProps(cell));
}

type Props = EncounterRules["map"];
/** More damage than any prop has health. */
const BREAK = 1e9;
type PropDamage = ReturnType<Props["blastProps"]>[number];

/** The cells a prop holds as tactical cover. */
const coverCells = (prop: Props["props"][number]) =>
    prop.covers ?? (prop.cover ? [prop.cover] : []);

/**
 * What a blast the chain ran does to the scene, for a reader that follows the chain
 * (the viewer): `Map.explode` turns every `Obstacle` (and `Cover`) tile within `radius`
 * of the blast into `Empty`, whatever its health, and only those. So the cover props on those
 * tiles are destroyed outright, and no other cover prop is touched; the rest of the
 * scenery breaks as the scene's own blast says (scenery the ground does not keep).
 * An area weapon without `env_damage` leaves the scene as it is.
 */
export function chainBlast(map: Props, at: Cell, radius: number, scorches = true): PropDamage[] {
    if (!scorches) return [];
    const changes = new Map<string, PropDamage>();
    const take = (list: readonly PropDamage[]) => {
        for (const change of list) {
            const was = changes.get(change.id);
            if (!was || was.hp > change.hp) changes.set(change.id, change);
        }
    };
    const covers = new Set(map.props.filter((prop) => coverCells(prop).length).map((p) => p.id));
    take(map.blastProps(at).filter((change) => !covers.has(change.id)));
    for (const prop of map.props) {
        const cells = coverCells(prop);
        const reached = cells.some(
            (cell) => Math.abs(cell[0] - at[0]) + Math.abs(cell[1] - at[1]) <= radius,
        );
        // the prop's own health is not the question: the tile is cover, then it is not
        if (reached && map.health(prop.id) > 0) take(map.damageProp(prop.id, BREAK, "blast"));
    }
    return [...changes.values()];
}

/**
 * The scene as a game that is already under way left it, for the viewer: the cover
 * the game's map no longer has is gone, exactly (a cover prop stands on an `Obstacle`
 * tile, which only a blast ever turns to `Empty`), and the scenery its blasts reached is broken as they
 * would have. A game with no blasts in its history is left as the scene has it.
 */
export function restoreChainBlasts(rules: EncounterRules, game: ChainGame, bounds: Bounds) {
    const cells = blastCells(game, bounds);
    if (!cells.length) return;
    const map = rules.map;
    const covers = new Set(map.props.filter((prop) => coverCells(prop).length).map((p) => p.id));
    for (const cell of cells)
        map.applyPropDamage(map.blastProps(cell).filter((change) => !covers.has(change.id)));
    for (const prop of map.props) {
        const cells = coverCells(prop);
        // a tile off the game's grid says nothing
        const gone = cells.some((cell) => {
            const [row, col] = toTile(cell, bounds);
            return !!game.map.grid.grid[row]?.[col] && terrainAt(game, [row, col]) !== "obstacle";
        });
        if (gone && map.health(prop.id) > 0)
            map.applyPropDamage(map.damageProp(prop.id, BREAK, "blast"));
    }
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
