// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What lies round Night Shift's grid, as data for the surroundings builder:
 * the street goes on past every edge, so the playable block never ends in a
 * cliff over fog. Cells are the level's (`[x, z]`, north at z = 0); a run
 * outside the grid has negative cells or cells past `width` / `depth`. The
 * builder draws all of it as scenery only: nothing here is on chain.
 *
 * The block: a two-lane north–south street on the west (x 2–5, Japan drives on
 * the left, so northbound traffic keeps to x 2–3), its pavements (x 0–1 and
 * x 6–7), the konbini and its car park east of it, a back lane along the
 * north (z 4–6) and a service alley along the east (x 17–18).
 */

/** One run of narrow buildings along a side: each a footprint, a height in storeys and a ground-floor use. */
export interface SurroundingBuilding {
  /** Footprint, inclusive cells. */
  from: [x: number, z: number];
  to: [x: number, z: number];
  storeys: number;
  use: string;
}

export interface Surroundings {
  /** Streets continuing off the grid: their axis, the cells they span across, how far they run. */
  streets: { name: string; axis: "x" | "z"; across: [from: number, to: number]; from: number; to: number; lanes: number; pavements: [from: number, to: number][] }[];
  buildings: SurroundingBuilding[];
  /** Wired poles carrying on the grid's line, so the cables run off it. */
  poles: [x: number, z: number][];
  /** Parked cars on the street beyond the grid: cell of the nose, facing. */
  parked: { at: [x: number, z: number]; facing: "north" | "south" | "east" | "west" }[];
  /** Distant towers on the skyline, beyond the near rows. */
  towers: { at: [x: number, z: number]; storeys: number }[];
}

export const NIGHT_SHIFT_SURROUNDINGS: Surroundings = {
  streets: [
    // the main street runs on north and south past the grid, pavements both sides
    { name: "main street, north", axis: "z", across: [2, 5], from: -24, to: -1, lanes: 2, pavements: [[0, 1], [6, 7]] },
    { name: "main street, south", axis: "z", across: [2, 5], from: 25, to: 48, lanes: 2, pavements: [[0, 1], [6, 7]] },
    // a cross street meets it just south of the car park, a lane north of the depot
    { name: "cross street, south", axis: "x", across: [26, 29], from: -20, to: 40, lanes: 2, pavements: [[25, 25], [30, 30]] },
    { name: "lane, north", axis: "x", across: [-4, -3], from: -20, to: 40, lanes: 1, pavements: [] },
  ],
  buildings: [
    // west of the main street: a row of narrow fronts facing the grid
    { from: [-4, -8], to: [-1, -5], storeys: 3, use: "ramen shop, flats above" },
    { from: [-4, -4], to: [-1, -1], storeys: 2, use: "dry cleaner, shuttered" },
    { from: [-4, 0], to: [-1, 3], storeys: 4, use: "apartment entrance" },
    { from: [-4, 4], to: [-1, 6], storeys: 2, use: "tobacconist, shuttered" },
    { from: [-4, 7], to: [-1, 10], storeys: 5, use: "small office block" },
    { from: [-4, 11], to: [-1, 13], storeys: 2, use: "snack bar, lit sign" },
    { from: [-4, 14], to: [-1, 17], storeys: 3, use: "clinic, closed" },
    { from: [-4, 18], to: [-1, 20], storeys: 2, use: "hairdresser, shuttered" },
    { from: [-4, 21], to: [-1, 24], storeys: 4, use: "apartment block" },
    // north, beyond the depot and the lane's buildings
    { from: [8, -6], to: [11, -1], storeys: 2, use: "the depot's sheds" },
    { from: [12, -6], to: [15, -1], storeys: 4, use: "apartments over the izakaya" },
    { from: [16, -6], to: [19, -1], storeys: 6, use: "apartment tower" },
    // east, behind the alley's row
    { from: [20, 4], to: [23, 7], storeys: 2, use: "laundrette's back, flats" },
    { from: [20, 8], to: [23, 15], storeys: 3, use: "apartments" },
    { from: [20, 16], to: [23, 24], storeys: 3, use: "office and parking deck" },
    // south, across the cross street
    { from: [6, 31], to: [10, 35], storeys: 3, use: "pachinko parlour, lit" },
    { from: [11, 31], to: [15, 35], storeys: 2, use: "noodle shop" },
    { from: [16, 31], to: [22, 35], storeys: 4, use: "apartments" },
  ],
  poles: [[6, -8], [6, -16], [6, 31], [6, 39], [22, 5], [-2, 26]],
  parked: [
    { at: [2, -6], facing: "north" },
    { at: [5, 30], facing: "south" },
    { at: [5, 40], facing: "south" },
  ],
  towers: [
    { at: [30, -30], storeys: 24 },
    { at: [-20, -40], storeys: 30 },
    { at: [40, 10], storeys: 18 },
  ],
};
