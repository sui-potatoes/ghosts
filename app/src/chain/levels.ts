// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Which scene a game on chain is shown in: the level its map comes from. A game's
 * `Map.id` is the ID of the `Preset` it was cloned from (`map::clone` keeps it),
 * so the level is known from the game alone. Black Rain, the preset `init`
 * freezes, is every other game's scene. Brings the engine along.
 */

import { blackRain, nightShift, type Scenario } from "@ghosts/engine";

import { LEVELS } from "../constants";
import { isListedLevel, sceneOfLevel } from "./match-scene";

/** Night Shift, built once: building it registers its scenery. */
let nightShiftScene: Scenario | null = null;
const nightShiftOnce = () => (nightShiftScene ??= nightShift());

/**
 * The scene, and the bounds that place it on the grid, of the level a game's map came
 * from; null for a retired revision of a level (`LEVELS.retired`), whose scene this
 * build no longer has.
 */
export function levelScene(mapId: string): Scenario | null {
    if (isListedLevel(mapId, LEVELS.retired)) return null;
    return sceneOfLevel(mapId, [[LEVELS.nightShift, nightShiftOnce]], blackRain);
}

/** A game on a level whose scene this build no longer has. */
export class LevelUnavailable extends Error {
    constructor(mapId: string) {
        super(`The scene of level ${mapId} is not in this build`);
    }
}

/** `levelScene`, for a game being played: a retired level's throws `LevelUnavailable`. */
export function matchBase(mapId: string): Scenario {
    const scene = levelScene(mapId);
    if (!scene) throw new LevelUnavailable(mapId);
    return scene;
}
