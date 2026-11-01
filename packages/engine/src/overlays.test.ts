// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { Encounter } from "./game.ts";
import { Overlays } from "./scene/overlays.ts";
import { Space } from "./scene/space.ts";

function field(t: TestContext) {
  const game = new Encounter(), unit = game.allies[0], target = game.enemies[0];
  unit.pos = [0, 4]; unit.ap = 1;
  target.pos = [0, -4];
  game.units = [unit, target];
  const scene = new T.Scene();
  const overlays = new Overlays(scene, new Space(game.map));
  const rings = () => scene.getObjectByName("Shooting range")!.children.map((ring) => ring.name);
  t.after(() => {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    scene.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  });
  return { game, unit, target, overlays, rings };
}

test("enemy range rings survive hovering valid and invalid destinations with one AP", (t) => {
  const { game, unit, target, overlays, rings } = field(t);
  overlays.showRange(game, unit, true);
  assert.deepEqual(rings(), [target.id], "selection immediately shows current range");
  const path = overlays.previewPath([0, 3]);
  assert(path, "the preview destination must be walkable");
  overlays.showPath(path);
  assert.deepEqual(rings(), [target.id], "spending the last AP on a move does not hide range");
  const blocked = overlays.previewPath(game.map.covers[0]);
  assert.equal(blocked, undefined);
  overlays.showPath(blocked);
  assert.deepEqual(rings(), [target.id], "an invalid tile falls back to current range");
  overlays.showPath(path);
  assert.deepEqual(rings(), [target.id], "returning to a valid destination keeps its range visible");
});

test("enemy range rings remain after moving and spending the last AP", (t) => {
  const { game, unit, target, overlays, rings } = field(t);
  unit.pos = [0, 3]; unit.ap = 0;
  overlays.showRange(game, unit, true);
  assert.deepEqual(rings(), [target.id]);
  assert.equal(overlays.previewPath([0, 2]), undefined, "spent units cannot preview another move");
  overlays.showRange(game, undefined, false);
  assert.deepEqual(rings(), [], "deselecting removes range markers");
});

test("leaving the field clears projected range and restores the selected unit's current range", (t) => {
  const { game, unit, target, overlays, rings } = field(t);
  unit.range = 3;
  overlays.showRange(game, unit, true);
  assert.deepEqual(rings(), []);
  const path = overlays.previewPath([0, 2]);
  assert(path);
  overlays.hoverAt([0, 2]);
  overlays.setHover(true);
  overlays.showPath(path);
  assert.deepEqual(rings(), [target.id], "moving closer brings the target into range");
  assert.equal(overlays.leave(), true);
  assert.deepEqual(rings(), [], "pointer exit restores the current position's range");
  assert.equal(overlays.hoverVisible, false);
  assert.equal(overlays.leave(), false);
});
