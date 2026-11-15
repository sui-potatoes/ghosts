// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { bcs } from "@mysten/sui/bcs";
import { assetSpec } from "../../packages/engine/src/catalog.ts";
import { newLevel, toMoveMap, type MoveTile } from "../../packages/engine/src/editor/level.ts";
import { encodeMap, toPreset } from "../../packages/engine/src/editor/preset.ts";
import { GameMap } from "../src/chain/bcs.ts";

/**
 * The editor's preset bytes against the app's decoder of the DEPLOYED `Map`
 * (`bcs.ts`, no trailing `units`) and against the frozen testnet `Preset`.
 * `Preset` is `ghosts::ghosts::Preset`: id, map, name, positions.
 */
const Preset = bcs.struct("Preset", {
    id: bcs.Address,
    map: GameMap,
    name: bcs.string(),
    positions: bcs.vector(bcs.vector(bcs.u8())),
});

/** The object `GHOSTS.preset` (testnet, package published before the unit index), read once. */
const LIVE =
    "6e834d1a513585caf95dd3a104723b1ad4de19c88e75f47a209dd2e0c96451b96e834d1a513585caf95dd3a104723b1ad4de19c88e75f47a209dd2e0c96451b90e1203000300030003000300000000000000000000000000000000000300030003000300030012030003000300030003000000000000000000000000000000000003000300030003000300120300030003000300030000000000000000000000000000000101010101000300030003000300030012030003000300030003000000000000000000010101010100000000000000030003000300030003001200000000000000000000010101010100000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000101010101000101010101000000000000001200000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000000000000120300030003000000000000000101010101000101010101000000000000000101010101000101010101000000000000000000000012030003000300000000000000000000000000000000000000000000000000000000000000120300030003000101010101000000000000000000000000000000000000000300030003000300000012030003000300000000000000000000000000000000000000000003000300030003000000120000000000000000000000000000000000000000000000000000030003000300030000000e001200000a426c61636b205261696e06020b06020c08020b0a02040b02050e020306";

/** The deployed decoder's tiles in the editor's JSON shape. */
function tilesOf(map: typeof GameMap.$inferType): MoveTile[][] {
    return map.grid.grid.map((row) =>
        row.map((tile): MoveTile => {
            assert.equal(tile.unit, null);
            switch (tile.tileType.$kind) {
                case "Empty":
                    return { t: "empty" };
                case "Cover": {
                    const { left, top, right, bottom } = tile.tileType.Cover;
                    return { t: "cover", sides: [left, top, right, bottom] };
                }
                case "Unwalkable":
                    return { t: "unwalkable" };
                default:
                    return { t: "wall" };
            }
        }),
    );
}

test("the frozen testnet preset decodes, and the editor's framing reproduces its Map bytes", () => {
    const bytes = Uint8Array.from(Buffer.from(LIVE, "hex"));
    const preset = Preset.parse(bytes);
    assert.equal(preset.name, "Black Rain");
    assert.equal(preset.map.grid.rows, 14);
    assert.equal(preset.map.grid.cols, 18);
    assert.equal(preset.positions.length, 6);
    // The map's id is the preset's; the editor writes zeros there, as map.move's baked bytes do.
    const encoded = encodeMap(tilesOf(preset.map));
    assert.deepEqual(
        [...encoded.slice(32)],
        [...bytes.slice(32 + 32, 32 + 32 + encoded.length - 32)],
    );
});

test("an editor level's preset bytes parse with the deployed Map schema", () => {
    const level = newLevel(9, 6);
    const put = (
        kind: Parameters<typeof assetSpec>[0],
        at: [number, number],
        turn: 0 | 1 | 2 | 3 = 0,
    ) => level.placements.push({ asset: assetSpec(kind).uid, at, turn });
    put("block-fill", [4, 3]);
    put("crate", [2, 2]);
    put("block-high", [5, 1], 3);
    put("block-cover", [6, 4], 0);
    level.unwalkable.push([8, 5]);
    level.spawns = {
        a: [
            [0, 0],
            [0, 5],
        ],
        b: [
            [8, 0],
            [8, 4],
        ],
    };
    const preset = toPreset(level);
    assert.deepEqual(
        preset.issues.filter((i) => i.level === "error"),
        [],
    );
    const map = GameMap.parse(preset.bytes);
    assert.equal(map.grid.rows, 6);
    assert.equal(map.grid.cols, 9);
    assert.equal(map.fallen.length, 0);
    assert.deepEqual(tilesOf(map), toMoveMap(level).tiles);
    // BCS writes the same bytes back: nothing the contract reads is left over.
    assert.deepEqual([...GameMap.serialize(map).toBytes()], [...preset.bytes]);
});
