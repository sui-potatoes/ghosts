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
import { sceneOfLevel } from "./match-scene";

/** Night Shift, built once: building it registers its scenery. */
let nightShiftScene: Scenario | null = null;
const nightShiftOnce = () => (nightShiftScene ??= nightShift());

/** The scene, and the bounds that place it on the grid, of the level a game's map came from. */
export function matchBase(mapId: string): Scenario {
    return sceneOfLevel(mapId, [[LEVELS.nightShift, nightShiftOnce]], blackRain);
}
