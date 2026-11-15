// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The level editor's engine half: the asset and floor catalogs, the level
 * model with its twofold export (the Move `Map` tile grid and the render
 * dressing), the shipped demos reconstructed as editable levels, the
 * three.js editing viewport, and a level as a playable encounter (playtest). The React screen hosting it lives in the app.
 */
export {
  assetByUid, assetCatalog, assetSpec, floorByUid, floorCatalog, replacementsFor,
  type AssetSpec, type FloorSpec, type Footprint,
} from "../catalog.ts";
export {
  addSpawn, canPlace, canonicalEdge, edgeCells, edgeKey, exportLevel, fitsBounds, floorRaise, hostTop,
  importLevel, inLevel, interiorPreset, newLevel, placementCells, placementSeat, placementsAt, removeSpawn,
  restHeight, SIDES, spawnSide, SQUAD_SIZE, swapAsset, toMoveMap, turnOffset,
  type FloorTile, type Level, type LevelExport, type LevelLighting, type LightSource,
  type MoveMapExport, type MoveTile, type Placement, type Side, type Spawns, type Turn,
} from "./level.ts";
export {
  MAX_CHAIN_SIDE, MAX_CHAIN_TILES, deploymentIssues, encodeMap, presetIssues, toPreset,
  type PresetExport, type PresetIssue,
} from "./preset.ts";
export { levelOrigin, levelPlan, levelProps, playtestIssues, scenarioFromLevel } from "./playtest.ts";
export { levelView, playtestScenario } from "./playtest-view.ts";
export { demoLevels, levelFromPlan, levelFromScenario, type FloorZone, type PlanExtras } from "./from-plan.ts";
export { officeFinishes, type OfficeFinish } from "../office/catalog.ts";
export { timePresets, type TimeOfDay } from "../scene-weather.ts";
export { EditorScene, SIDE_COLORS } from "./scene.ts";
