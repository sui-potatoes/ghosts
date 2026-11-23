// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics, the first training: one 8 × 8 simulation room that reconfigures
 * between lessons. Each stage is a level in the editor's model (`Level`,
 * the format the editor reads and writes; the editor opens the first stage
 * as a base): real catalog props on the simulation floor (crates, barriers,
 * a vending machine), drawn as they are, with the simulation's cover overlay
 * on them. Every stage shares the room's size, so the map and its scenery
 * stay put while the pieces and the units change.
 *
 * ```
 *        x 0 1 2 3 4 5 6 7         1 Contact   VEX behind a barrier, one target in the open
 *   z 0    . . . . . . . .         2 Cover     a crate to hide behind or not, a shooter behind its own crate
 *     1    . . . T . . b .         3 Grenade   a target boxed in by crates on every side
 *     2    c . . . . . . .         4 Squad     three operators, two targets behind crates, one flanker
 *     3    . . . . . . . .
 *     4    . . . . . . . .         (stage 1: T target, = barrier on VEX's north edge,
 *     5    . p . . . . . V          c crate, b drums, p pallets, V vending machine)
 *     6    . . . A . . . .
 *     7    . . . = . . . .
 * ```
 */
import { newLevel, type Level, type Placement, type Turn } from "../../editor/level.ts";
import { levelOrigin } from "../../editor/playtest.ts";
import type { Cell } from "../../map.ts";

/** The room, in cells. */
export const ROOM = { w: 8, d: 8 };

export type StageId = "contact" | "cover" | "grenade" | "squad";

/** What stands in the room for a stage: catalog uid, level cell, turn (an edge's side). */
type Prop = [uid: string, x: number, z: number, turn?: Turn];

const BARRIER = "s01",
  CRATE = "s02",
  CARGO = "s03",
  DRUMS = "s04",
  PALLETS = "s19",
  VENDING = "s17",
  TALL_FENCE = "s14";

/** Each stage's pieces. Low cover: crates, drums, pallets (vaulted) and barriers (an edge); a wall: the vending machine. */
const PROPS: Record<StageId, Prop[]> = {
  contact: [
    [BARRIER, 3, 6, 0],
    [CRATE, 0, 2],
    [DRUMS, 6, 1],
    [PALLETS, 1, 5],
    [VENDING, 7, 5],
  ],
  cover: [
    [TALL_FENCE, 0, 4, 0],
    [TALL_FENCE, 1, 4, 0],
    [CRATE, 3, 3],
    [CARGO, 5, 2],
    [VENDING, 0, 0],
    [DRUMS, 7, 6],
  ],
  grenade: [
    [CRATE, 4, 2],
    [CARGO, 3, 1],
    [DRUMS, 5, 1],
    [CRATE, 4, 5],
    [VENDING, 0, 3],
    [PALLETS, 7, 3],
  ],
  squad: [
    [CRATE, 2, 2],
    [CARGO, 3, 2],
    [BARRIER, 2, 5, 0],
    [CRATE, 5, 4],
    [VENDING, 7, 0],
  ],
};

/** A stage as the editor holds it: the room, its props, a deployment the rules accept. */
export function stageLevel(stage: StageId): Level {
  const level = newLevel(ROOM.w, ROOM.d);
  level.name = `basics-${stage}`;
  level.placements = PROPS[stage].map(([asset, x, z, turn = 0]): Placement => ({ asset, at: [x, z], turn }));
  // The rules need sides to deploy; each stage places its own units (`scenario.ts`).
  level.spawns = {
    a: [
      [0, 7],
      [1, 7],
      [2, 7],
    ],
    b: [
      [5, 0],
      [6, 0],
      [4, 0],
    ],
  };
  level.lighting = { time: "night" };
  return level;
}

/** The first stage: the editor's Basics base. */
export function basicsLevel(): Level {
  return stageLevel("contact");
}

const [ox, oz] = levelOrigin(stageLevel("contact"));

/** A room cell, `x` east and `z` south from its corner, as a scene cell. */
export const cell = (x: number, z: number): Cell => [x + ox, z + oz];

/** Every scene cell of the room: what the camera frames. */
export function roomCells(): Cell[] {
  const out: Cell[] = [];
  for (let x = 0; x < ROOM.w; x++) for (let z = 0; z < ROOM.d; z++) out.push(cell(x, z));
  return out;
}

/** Where units wait while a stage does not use them: far outside the room, lost in the void. */
export const parked = (i: number, enemy: boolean): Cell => [(enemy ? 40 : -40) + i * 2, 70];
