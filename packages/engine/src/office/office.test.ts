// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { OfficeAssets, officeCatalog, officeFinishes } from "./assets.ts";
import { officePlan, officeLayout } from "./plan.ts";
import { paperTrail } from "./scenario.ts";
import { CELL, TacticalMap, type Cell } from "../map.ts";

// Geometry regressions can be invisible in a compile: check every palette and semantic pivot.
test("office kit builds bounded, finite, floor-origin meshes with shared resources", () => {
  const assets = new OfficeAssets();
  for (const [kind] of officeCatalog) for (const finish of officeFinishes) {
    const a = assets.create(kind, finish), b = assets.create(kind, finish);
    const bounds = new T.Box3().setFromObject(a);
    assert(!bounds.isEmpty(), kind);
    assert(bounds.min.y >= -0.02, `${kind} sits on the floor`);
    const size = bounds.getSize(new T.Vector3());
    assert([size.x, size.y, size.z].every(n => Number.isFinite(n) && n > 0 && n < 3), kind);
    const meshes: T.Mesh[] = [], copies: T.Mesh[] = [];
    a.traverse(o => { if (o instanceof T.Mesh) meshes.push(o); });
    b.traverse(o => { if (o instanceof T.Mesh) copies.push(o); });
    assert(meshes.length < 32, `${kind} batches small details`);
    meshes.forEach((mesh, i) => {
      assert.equal(mesh.geometry, copies[i].geometry);
      const positions = mesh.geometry.getAttribute("position");
      assert(Array.from(positions.array).every(Number.isFinite));
    });
    if (kind.endsWith("-door")) {
      a.getObjectByName("door-hinge")!.rotation.y = Math.PI / 2;
      assert.equal(b.getObjectByName("door-hinge")!.rotation.y, 0, "instances open independently");
      assert(Math.abs(size.x - CELL) < 0.001, "door matches wall module");
    }
  }
  assets.dispose();
});

test("every operator, open doorway and objective connects through office aisles", () => {
  const map = new TacticalMap(officePlan);
  const queue: Cell[] = [paperTrail.relay], reached = new Set([paperTrail.relay.join()]);
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const next of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]] as Cell[]) {
      if (!map.open(next) || reached.has(next.join())) continue;
      reached.add(next.join()); queue.push(next);
    }
  }
  for (const unit of paperTrail.units) assert(reached.has(unit.pos.join()), `${unit.name} can reach the archive`);
  for (const cell of [[-3, -4], [3, -4]] as Cell[]) assert(reached.has(cell.join()), "doorway stays open");
  for (const p of officeLayout) if (p.collision) assert(!map.open(p.collision.cell), `${p.kind} blocks movement`);
  for (let x = -7; x <= 7; x++) for (let z = -6; z <= 6; z++)
    if (map.open([x, z])) assert(reached.has([x, z].join()), `no trapped walkable tile ${x},${z}`);
});

test("glass blocks walking without granting cover or blocking rifle sight lines", () => {
  const map = new TacticalMap(officePlan);
  assert(!map.open([5, -4]));
  assert(!map.isCover([5, -4]));
  assert.equal(map.physicalCover([5, -3]), "none");
  assert(map.clearBuildingShot([5 * CELL, -3 * CELL], [5 * CELL, -5 * CELL]));
  assert(!map.clearBuildingShot([-6 * CELL, -3 * CELL], [-6 * CELL, -5 * CELL]));
  assert(map.isCover([-5, 1]));
  assert.equal(map.surfaceHeight(6, 6), 0);
});

test("indoor fixtures survive time changes with a bounded shadow budget", async () => {
  const { addOfficeLighting, applyOfficeLighting } = await import("./lighting.ts");
  const scene = new T.Scene();
  const key = new T.DirectionalLight(), ambient = new T.HemisphereLight(), rim = new T.DirectionalLight();
  scene.add(key, ambient, rim); addOfficeLighting(scene);
  const sources: T.Light[] = [];
  scene.traverse(o => { if (o instanceof T.Light && o.name.startsWith("office-")) sources.push(o); });
  assert.equal(sources.length, 13);
  const intensities = sources.map(o => o.intensity);
  for (const time of ["night", "day", "evening", "morning", "night"] as const) {
    const exposure = applyOfficeLighting(scene, key, ambient, rim, time);
    assert(Number.isFinite(exposure) && exposure > 0);
    assert.equal(scene.fog, null);
    assert.equal(key.intensity, 0, "outdoor sun stays off");
    assert.equal(key.castShadow, false);
    assert.deepEqual(sources.map(o => o.intensity), intensities, "electric lights stay on during daytime");
    assert.equal(sources.filter(o => o.castShadow).length, 2);
  }
  for (const source of sources) if (source instanceof T.SpotLight) {
    assert(source.angle < Math.PI / 2);
    assert(source.distance > 0 && source.distance <= 8);
    if (source.castShadow) assert(source.shadow.mapSize.x <= 512);
  }
});

test("office destruction releases shared cover and all furniture cells without floating contents", () => {
  const map = new TacticalMap(officePlan);
  const desk = map.props.find(p => p.kind === "office-desk" && p.cover?.join() === "-5,-2")!;
  const cubicle = map.props.find(p => p.kind === "office-cubicle" && p.cover?.join() === "-5,-2")!;
  for (let i = 0; i < 3; i++) map.applyPropDamage(map.damageProp(desk.id, 28));
  assert.equal(map.health(desk.id), 16);
  const contents = map.props.filter(p => p.support === desk.id);
  assert(contents.length >= 3);
  map.applyPropDamage(map.damageProp(desk.id, 28));
  assert(contents.every(p => map.health(p.id) === 0));
  assert(map.isCover([-5, -2]), "cubicle still owns the shared cover cell");
  assert(!map.open([-5, -2]));
  map.applyPropDamage(map.damageProp(cubicle.id, 100));
  assert(!map.isCover([-5, -2])); assert(map.open([-5, -2]));
  const table = map.props.find(p => p.kind === "office-meeting-table")!;
  map.applyPropDamage(map.damageProp(table.id, 200));
  for (const cell of [[-7, -1], [-7, 0]] as Cell[]) { assert(map.open(cell)); assert(!map.isCover(cell)); }
  const chair = map.props.find(p => p.kind === "office-task-chair")!;
  map.applyPropDamage(map.damageProp(chair.id, 100));
  assert(map.open(chair.blocks![0]));
});

test("office glass shatters from either side; steel walls need blasts and release their footprint", () => {
  for (const [from, toward] of [[[5, -3], [5, -5]], [[5, -5], [5, -3]]] as [Cell, Cell][]) {
    const map = new TacticalMap(officePlan);
    const changes = map.strayShotProps(from, toward, 28);
    assert.equal(changes.length, 1);
    assert.equal(map.props.find(p => p.id === changes[0].id)!.kind, "office-glass-wall");
    assert(changes[0].impact && Math.abs(changes[0].impact[2] + 4 * CELL) < .03);
    map.applyPropDamage(changes); assert(map.open([5, -4]));
  }
  const map = new TacticalMap(officePlan);
  const window = map.props.find(p => p.kind === "office-window-wall" && p.blocks?.length)!;
  const pane = map.props.find(p => p.support === window.id && p.pane)!;
  const changes = map.strayShotProps([-5, -3], [-5, -5], 28);
  assert.equal(changes[0]?.id, pane.id);
  map.applyPropDamage(changes);
  assert.equal(map.health(pane.id), 0); assert.equal(map.health(window.id), 160);
  assert(!map.open([-5, -4]), "window frame remains a movement obstacle");
  assert.deepEqual(map.damageProp(window.id, 999), [], "rifles cannot erase steel");
  map.applyPropDamage(map.blastProps([-5, -3]));
  assert(map.open([-5, -4]));
  assert(map.clearBuildingShot([-5 * CELL, -3 * CELL], [-5 * CELL, -5 * CELL]));
});

test("one grenade breaches office panels and glass from either side, including rotated perimeter panes", () => {
  for (const prop of officePlan.props!.filter(p =>
    ["office-steel-wall", "office-window-wall", "office-glass-wall", "office-steel-door", "office-glass-door"].includes(p.kind))) {
    // Isolate each authored placement to exercise its real yaw and open-leaf offset.
    const props = [prop, ...officePlan.props!.filter(p => p.support === prop.id)];
    const box = prop.hitbox!, c = Math.cos(prop.yaw), s = Math.sin(prop.yaw);
    const x = prop.x + (box.x ?? 0) * c + (box.z ?? 0) * s;
    const z = prop.z - (box.x ?? 0) * s + (box.z ?? 0) * c;
    for (const side of [-1, 1]) {
      const map = new TacticalMap({ ...officePlan, buildings: [], covers: [], props });
      const changes = map.blastProps([x / CELL + side * s * 2, z / CELL + side * c * 2]);
      assert(changes.find(p => p.id === prop.id)?.destroyed, `${prop.id} / ${prop.kind} / side ${side}`);
      assert(props.filter(p => p.support).every(p => changes.find(change => change.id === p.id)?.destroyed), "attached panes and keypads come down");
      assert(map.health(prop.id) > 0, "preview does not mutate durability");
    }
  }
});

test("a nearby pane edge catches the blast even when its centre is outside range; a solid wall still shields it", () => {
  for (const yaw of [0, Math.PI / 2]) {
    const prop = { id: "pane", kind: "office-glass-wall" as const, x: 0, z: 0, yaw, seed: 731,
      hitbox: { width: 1.25, height: 2.55, depth: .018 } };
    const at: Cell = yaw === 0 ? [1.4, 1] : [1, 1.4];
    const plan = { ...officePlan, buildings: [], covers: [], props: [prop] };
    assert(new TacticalMap(plan).blastProps(at)[0]?.destroyed);
    assert.deepEqual(new TacticalMap(plan).blastProps([3, 3]), []);
    const shielded = new TacticalMap({ ...plan, buildings: [{ x: 1, z: 1, w: 1, d: 1, h: 3, kind: "wall" }] });
    assert.deepEqual(shielded.blastProps(at), []);
  }
});

test("office grenade commands breach partitions, release movement and sight, and replay identically", async () => {
  const { Encounter, replayEncounter } = await import("../game.ts");
  for (const x of [-6, -5, 5]) {
    const game = new Encounter(paperTrail);
    const unit = game.allies[0]; unit.pos = [x, 0];
    const wall = game.map.props.find(p => p.blocks?.some(cell => cell[0] === x && cell[1] === -4))!;
    // Two cells from the partition, matching a blast amongst the desks.
    const events = game.apply({ type: "grenade", unit: unit.id, at: [x, -2] });
    assert.equal(events[0]?.type, "grenade");
    assert(events[0].type === "grenade" && events[0].environment?.some(p => p.id === wall.id && p.destroyed));
    assert(game.map.open([x, -4]));
    assert(game.map.clearBuildingShot([x * CELL, -3 * CELL], [x * CELL, -5 * CELL]));
    const replay = replayEncounter(paperTrail, events);
    for (const prop of game.map.props) assert.equal(replay.map.health(prop.id), game.map.health(prop.id));
    assert(replay.map.open([x, -4]));
    assert(!new TacticalMap(officePlan).open([x, -4]), "restart restores the partition");
  }
});

test("all office specimens have bounded rigid fragments and glass frames survive", async () => {
  const { PropAssets } = await import("../scene/prop-assets.ts");
  const assets = new PropAssets();
  try {
    for (const [kind] of officeCatalog) {
      const prop = { id: kind, kind: `office-${kind}` as const, x: 0, z: 0, yaw: 0, seed: 731 };
      const asset = assets.get(prop);
      assert(asset.fragments.length > 0 && asset.fragments.length <= 18, kind);
      assert(!asset.bounds.isEmpty());
      for (const fragment of asset.fragments) assert([...fragment.geometry.attributes.position.array].every(Number.isFinite), kind);
      if (kind === "glass-wall" || kind === "glass-door") assert(asset.frame.children.length > 0);
      else assert(assets.damaged(prop, .75), `${kind} supports a rigid damage stage`);
    }
  } finally { assets.dispose(); }
});

test("office grenade damage runs through live physics and resets with a bounded debris count", async () => {
  const { Destruction, loadDestruction, MAX_DEBRIS } = await import("../scene/destruction.ts");
  await loadDestruction();
  const map = new TacticalMap(officePlan), destruction = new Destruction(map, () => {});
  try {
    const changes = map.blastProps([-5, -2]);
    assert(changes.some(c => c.destroyed));
    map.applyPropDamage(changes); destruction.apply(changes, new T.Vector3(-5 * CELL, .2, -2 * CELL));
    const wall = map.props.find(p => p.kind === "office-window-wall" && p.blocks?.length)!;
    assert.equal(map.health(wall.id), 0);
    assert.equal(destruction.isPropVisible(wall.id), false, "breached panel leaves the rendered scene");
    assert(destruction.group.children.some(o => o.name === "debris / office-window-wall"), "wall panels become live debris");
    assert(destruction.stats.destroyed >= 4); assert(destruction.stats.bodies > 0);
    assert(destruction.stats.bodies <= MAX_DEBRIS);
    destruction.syncOfficeVisibility(new T.Vector3(10, 15, 20), [new T.Vector3()]);
    const camera = new T.PerspectiveCamera();
    for (let i = 0; i < 430; i++) destruction.update(1 / 60, camera);
    assert(!destruction.active);
    destruction.reset(new TacticalMap(officePlan));
    assert.equal(destruction.stats.destroyed, 0); assert.equal(destruction.stats.bodies, 0);
    assert.equal(destruction.stats.props, officePlan.props!.length);
  } finally { destruction.dispose(); }
});

test("tucked chairs fit under the desk and do not occupy the aisle tile", () => {
  const assets = new OfficeAssets();
  try {
    const desk = assets.create("desk-tucked");
    const chair = desk.getObjectByName("tucked-chair")!;
    const bounds = new T.Box3().setFromObject(desk);
    const seat = new T.Box3().setFromObject(chair.getObjectByName("seat")!);
    assert(bounds.max.z < CELL / 2, "chair stays in the desk cell");
    assert(seat.max.y < .707, "seat clears the underside of the desktop");
    assert(seat.min.z < .36 && seat.max.z > .36, "seat is partly tucked under the tabletop");
    const map = new TacticalMap(officePlan);
    const tucked = map.props.filter(p => p.kind === "office-desk-tucked");
    assert.equal(tucked.length, 4);
    for (const p of tucked) {
      assert.equal(p.blocks!.length, 1);
      assert(map.open([p.blocks![0][0], p.blocks![0][1] + 1]));
      assert(map.props.some(item => item.support === p.id), "desktop items track the new variant");
    }
  } finally { assets.dispose(); }
});

test("one nearby grenade destroys every table variant but distant or shielded tables survive", () => {
  for (const kind of ["office-desk", "office-desk-tucked", "office-corner-desk", "office-meeting-table"] as const) {
    const prop = { id: "table", kind, x: 0, z: 0, yaw: 0, seed: 731 };
    const plan = { ...officePlan, buildings: [], covers: [], props: [prop] };
    for (const at of [[0, 0], [1, 0], [2, 0]] as Cell[]) {
      const map = new TacticalMap(plan);
      assert.equal(map.blastProps(at).find(p => p.id === prop.id)?.destroyed, true, `${kind}: ${at}`);
    }
    const map = new TacticalMap(plan);
    assert.equal(map.damageProp(prop.id, 28)[0].destroyed, false, "rifle durability unchanged");
    assert.deepEqual(map.blastProps([3, 0]), []);
    const shielded = new TacticalMap({ ...plan, buildings: [{ x: 1, z: 0, w: 1, d: 1, h: 3, kind: "wall" }] });
    assert.deepEqual(shielded.blastProps([2, 0]), []);
  }
});

test("papers loft above folders and heavy table debris while physics still retires", async () => {
  const { Destruction, loadDestruction } = await import("../scene/destruction.ts");
  await loadDestruction();
  const heights: number[] = [];
  for (const kind of ["office-papers", "office-folders", "office-desk"] as const) {
    const map = new TacticalMap({ ...officePlan, buildings: [], covers: [], props: [
      { id: "test", kind, x: 0, y: .8, z: 0, yaw: 0, seed: 731 },
    ] });
    const destruction = new Destruction(map, () => {});
    try {
      const changes = map.damageProp("test", 200, "blast");
      map.applyPropDamage(changes); destruction.apply(changes, new T.Vector3(0, .2, 1));
      const camera = new T.PerspectiveCamera();
      for (let i = 0; i < 60; i++) destruction.update(1 / 60, camera);
      const pieces = destruction.group.children.filter(o => o.name === `debris / ${kind}`);
      assert(pieces.length > 0);
      heights.push(pieces.reduce((sum, p) => sum + p.position.y, 0) / pieces.length);
      for (let i = 0; i < 370; i++) destruction.update(1 / 60, camera);
      assert(!destruction.active);
    } finally { destruction.dispose(); }
  }
  assert(heights[0] > heights[1] && heights[1] > heights[2] + 1, `launch heights ${heights}`);
});
