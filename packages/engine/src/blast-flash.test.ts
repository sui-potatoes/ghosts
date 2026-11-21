// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { GRENADE_RADIUS } from "./action-registry.ts";
import { BLAST_TILES, blastTiles, FLASH, flashLevel, tileWeight } from "./blast-flash.ts";
import { distance, Encounter } from "./game.ts";
import { blackRain } from "./scenario.ts";
import type { Cell } from "./map.ts";

const map = () => new Encounter(blackRain).map;
const keys = (cells: Cell[]) => cells.map((c) => c.join(",")).sort();

test("a burst in the open lights the whole diamond the rules count", () => {
  const m = map();
  const at: Cell = [0, 0];
  const tiles = blastTiles(m, at);
  assert.equal(tiles.length, BLAST_TILES);
  assert.ok(tiles.every((c) => distance(c, at) <= GRENADE_RADIUS));
  assert.equal(new Set(keys(tiles)).size, tiles.length);
});

test("a burst lights exactly the tiles a unit would be caught on", () => {
  const m = map();
  const at: Cell = [1, -1];
  const lit = new Set(keys(blastTiles(m, at)));
  for (let x = -9; x <= 8; x++)
    for (let z = -7; z <= 6; z++) {
      const cell: Cell = [x, z];
      const rules = distance(cell, at) <= GRENADE_RADIUS && m.inBounds(cell) && !m.isWall(cell);
      assert.equal(lit.has(cell.join(",")), rules, `${cell}`);
    }
});

test("walls and tiles off the map stay dark", () => {
  const m = map();
  const wall = blackRain.map.buildings.find((b) => !b.prop)!;
  const beside: Cell = [wall.x, wall.z];
  assert.ok(m.isWall(beside));
  const tiles = blastTiles(m, [beside[0], beside[1] - 1]);
  assert.ok(!keys(tiles).includes(beside.join(",")));
  const edge: Cell = [m.bounds.minX, m.bounds.minZ];
  assert.ok(blastTiles(m, edge).every((c) => m.inBounds(c)));
  assert.ok(blastTiles(m, edge).length < BLAST_TILES);
  assert.deepEqual(blastTiles(m, [m.bounds.maxX + 9, 0]), []);
});

test("cover and props are lit: a frag clears them, the flash shows it", () => {
  const m = map();
  const cover = m.covers[0];
  assert.ok(keys(blastTiles(m, cover)).includes(cover.join(",")));
});

test("the flash rises fast, falls eased and is gone by the end", () => {
  assert.equal(flashLevel(0), 0);
  assert.ok(Math.abs(flashLevel(FLASH.rise) - 1) < 1e-9);
  assert.ok(flashLevel(FLASH.rise / 2) > 0.5, "ease-out rise");
  assert.equal(flashLevel(FLASH.duration), 0);
  assert.equal(flashLevel(FLASH.duration + 5), 0);
  assert.equal(flashLevel(-1), 0);
  let last = 1;
  for (let t = FLASH.rise; t < FLASH.duration; t += 0.01) {
    const v = flashLevel(t);
    assert.ok(v <= last + 1e-12, "never brightens on the way down");
    last = v;
  }
  assert.ok(FLASH.duration >= 0.5 && FLASH.duration <= 0.7);
});

test("reduced motion swells slower to a lower peak and still fades out", () => {
  let peak = 0;
  for (let t = 0; t < FLASH.duration; t += 0.005) peak = Math.max(peak, flashLevel(t, true));
  assert.ok(peak <= FLASH.calm.peak + 1e-9 && peak > 0.3);
  assert.ok(flashLevel(FLASH.rise, true) < flashLevel(FLASH.rise));
  assert.equal(flashLevel(FLASH.duration, true), 0);
});

test("tiles dim away from the centre but never to nothing", () => {
  assert.equal(tileWeight(0), 1);
  assert.ok(tileWeight(GRENADE_RADIUS) > 0.5 && tileWeight(GRENADE_RADIUS) < tileWeight(1));
});
