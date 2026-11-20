// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Bakes the scenes' tactical maps into the ghosts Move package, so a game played
 * on chain can be shown in them: each map is read off the same `TacticalMap` the
 * scene enforces, BCS-encoded, and written with its spawn positions between the
 * `maps:begin` / `maps:end` markers of `ghosts::map`. The spawns set the size of
 * a squad on the map: half of them per side.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TacticalMap, type MapPlan } from "../../packages/engine/src/map.ts";
import { blackRain, type Scenario } from "../../packages/engine/src/scenario.ts";

const TARGET = fileURLToPath(
    new URL("../../move/packages/ghosts/sources/map/map.move", import.meta.url),
);

type Cell = [x: number, z: number];

/** The scene's own deployment, the first `perSide` of each side. */
function spawnsOf(scenario: Scenario, perSide: number): Cell[] {
    const pick = (enemy: boolean) =>
        scenario.units.filter((u) => !u.enemy === !enemy).map((u) => u.pos as Cell);
    return [...pick(false).slice(0, perSide), ...pick(true).slice(0, perSide)];
}

const MAPS = [
    {
        fn: "black_rain",
        doc: "The K\u014dra district of the first demo, three recruits a side.",
        scenario: blackRain,
        spawns: spawnsOf(blackRain, 3),
    },
];

/** Whether a building's footprint, which also stops shots, covers the cell. */
function inBuilding(plan: MapPlan, [x, z]: Cell) {
    return plan.buildings.some((b) => {
        const minX = b.x - Math.floor(b.w / 2);
        const minZ = b.z - Math.floor(b.d / 2);
        return x >= minX && x < minX + b.w && z >= minZ && z < minZ + b.d;
    });
}

/** The `TileType` tags a unit can stand on: `Empty` and `Cover`. */
const STANDABLE = [0, 1];
/** The `TileType` tag of an `Obstacle`. */
const OBSTACLE = 4;

const u16 = (value: number) => [value & 0xff, value >> 8];
const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

/** `ghosts::map::Map`: an empty id, the rows of tiles, then `rows` and `cols`. */
function encode({ map }: Scenario) {
    const plan = map;
    const tactical = new TacticalMap(plan);
    const { minX, maxX, minZ, maxZ } = plan.bounds;
    const [rows, cols] = [maxZ - minZ + 1, maxX - minX + 1];
    if (rows >= 128 || cols >= 128) throw new Error("Vector lengths past 127 need ULEB128");

    const bytes = [...new Array(32).fill(0), rows];
    // the `TileType` tag of each tile, `kinds[row][col]`
    const kinds: number[][] = [];
    for (let z = minZ; z <= maxZ; z++) {
        bytes.push(cols);
        const row: number[] = [];
        for (let x = minX; x <= maxX; x++) {
            // `TileType` by declaration order, then an empty `Option<Unit>`: a
            // scene's cover prop fills its cell, so it is an `Obstacle` (4), low
            // cover to its neighbors that no unit stands on
            const kind = tactical.isCover([x, z])
                ? OBSTACLE
                : tactical.open([x, z])
                  ? 0
                  : inBuilding(plan, [x, z])
                    ? 3
                    : 2;
            bytes.push(kind, 0);
            row.push(kind);
        }
        kinds.push(row);
    }
    bytes.push(...u16(rows), ...u16(cols));
    // `Map.fallen`: nobody has fallen on a preset
    bytes.push(0);
    return { bytes, kinds, rows, cols };
}

const functions = MAPS.map(({ fn, doc, scenario, spawns }) => {
    const { bytes, kinds, rows, cols } = encode(scenario);
    const { minX, minZ } = scenario.map.bounds;

    if (new Set(spawns.map(String)).size !== spawns.length)
        throw new Error(`${fn}: repeated spawn`);
    // A cell is `[x, z]` in the scene and `[row, col]` on chain.
    const tiles = spawns.map(([x, z]) => [z - minZ, x - minX]);
    // a spawn is `Empty` as baked: not a cover, an obstacle, a wall or an
    // unwalkable tile; and a unit deployed there has a tile to step onto
    for (const [i, [row, col]] of tiles.entries()) {
        const kind = kinds[row]?.[col];
        if (kind === OBSTACLE)
            throw new Error(`${fn}: spawn [${spawns[i]}] is an obstacle on chain`);
        if (kind !== 0) throw new Error(`${fn}: spawn [${spawns[i]}] is not empty ground on chain`);
        const around = [
            [row - 1, col],
            [row + 1, col],
            [row, col - 1],
            [row, col + 1],
        ];
        if (!around.some(([r, c]) => STANDABLE.includes(kinds[r]?.[c] ?? -1)))
            throw new Error(`${fn}: spawn [${spawns[i]}] has no tile to step onto`);
    }

    const positions = tiles.map(([row, col]) => `vector[${row}, ${col}]`).join(", ");
    console.log(`${fn}: ${rows}x${cols}, ${bytes.length} bytes, ${spawns.length / 2} a side`);

    return `/// ${doc}
public fun ${fn}(id: ID): Map {
    // prettier-ignore
    let mut map = from_bytes(x"${hex(bytes)}");
    map.id = id;
    map
}

/// Spawn positions of \`${fn}\`: half for the first player, half for the second.
public fun ${fn}_positions(): vector<vector<u8>> {
    // prettier-ignore
    vector[${positions}]
}`;
}).join("\n\n");

const source = readFileSync(TARGET, "utf8");
const next = source.replace(
    /\/\/ maps:begin[\s\S]*?\/\/ maps:end/,
    `// maps:begin - generated by \`pnpm --dir app build:map-preset\`\n${functions}\n// maps:end`,
);
if (!next.includes("maps:begin - generated")) throw new Error("Markers not found");
writeFileSync(TARGET, next);
