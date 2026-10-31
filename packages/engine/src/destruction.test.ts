// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { koraPlan } from "./district-plan.ts";
import { CELL, TacticalMap, footprint } from "./map.ts";
import { cityBlocks } from "./city-blocks.ts";
import { PropAssets } from "./scene/prop-assets.ts";
import { Destruction, loadDestruction, MAX_DEBRIS } from "./scene/destruction.ts";
import { cracksWhenDamaged } from "./scene/prop-deformation.ts";
import { propHealth, type MapProp } from "./environment.ts";

test("all prop templates build finite fractures and stay clear of walking cells and buildings", () => {
  const assets = new PropAssets();
  try {
    const buildings = [
      ...koraPlan.buildings.map(footprint),
      ...cityBlocks().map((b) => {
        const w = Math.abs(Math.cos(b.rotation)) * b.w + Math.abs(Math.sin(b.rotation)) * b.d;
        const d = Math.abs(Math.cos(b.rotation)) * b.d + Math.abs(Math.sin(b.rotation)) * b.w;
        return { minX: b.x - w / 2, maxX: b.x + w / 2, minZ: b.z - d / 2, maxZ: b.z + d / 2 };
      }),
    ];
    const b = koraPlan.bounds;
    const playable = new T.Box2(new T.Vector2((b.minX - 0.5) * CELL, (b.minZ - 0.5) * CELL),
      new T.Vector2((b.maxX + 0.5) * CELL, (b.maxZ + 0.5) * CELL));
    for (const prop of koraPlan.props!) {
      const asset = assets.get(prop);
      assert(asset.fragments.length > 0 && asset.fragments.length <= 20, prop.kind);
      for (const fragment of asset.fragments)
        assert([...fragment.geometry.attributes.position.array].every(Number.isFinite), prop.kind);
      const transform = new T.Matrix4().compose(new T.Vector3(prop.x, 0, prop.z),
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), prop.yaw), new T.Vector3(1, 1, 1));
      const bounds = asset.bounds.clone().applyMatrix4(transform);
      const rect = new T.Box2(new T.Vector2(bounds.min.x, bounds.min.z), new T.Vector2(bounds.max.x, bounds.max.z));
      if (prop.storefront) {
        assert.equal(prop.cover, undefined);
        assert.equal(asset.frame.children.length, 0, "storefront frames belong to static scenery");
        const owner = buildings[prop.storefront.building];
        assert(rect.intersectsBox(new T.Box2(new T.Vector2(owner.minX, owner.minZ), new T.Vector2(owner.maxX, owner.maxZ))));
        continue;
      }
      if (!prop.cover) assert(!rect.intersectsBox(playable), `${prop.id} ${prop.kind} blocks a playable cell`);
      for (const building of buildings)
        assert(!rect.intersectsBox(new T.Box2(
          new T.Vector2(building.minX + 0.01, building.minZ + 0.01),
          new T.Vector2(building.maxX - 0.01, building.maxZ - 0.01),
        )), `${prop.id} ${prop.kind} intersects a building`);
    }
  } finally { assets.dispose(); }
});

test("storefront panes match their openings, follow building visibility and reset after shattering", async () => {
  await loadDestruction();
  const map = new TacticalMap(koraPlan), destruction = new Destruction(map, () => {});
  try {
    const panes = map.props.filter((p) => p.storefront);
    assert.equal(panes.length, 16);
    for (const prop of panes) {
      const size = destruction.assets.get(prop).bounds.getSize(new T.Vector3());
      assert(Math.abs(size.x - prop.storefront!.width) < 1e-5);
      assert(Math.abs(size.y - prop.storefront!.height) < 1e-5);
    }
    const changes = map.strayShotProps([5, 0], [5, -3], 28);
    map.applyPropDamage(changes);
    destruction.apply(changes, new T.Vector3(6.75, 1.2, 0));
    assert.equal(destruction.stats.destroyed, 1);
    assert.equal(destruction.stats.debris, 10);
    destruction.syncBuildingVisibility([false, true]);
    for (const prop of panes)
      assert.equal(destruction.group.getObjectByName(`glass / ${prop.id}`)!.visible, prop.storefront!.building === 1);
    destruction.reset(new TacticalMap(koraPlan));
    assert.equal(destruction.stats.destroyed, 0);
    assert.equal(destruction.stats.debris, 0);
  } finally { destruction.dispose(); }
});

test("real Rapier fragments stay bounded, settle, ignore duplicate events and reset", async () => {
  await loadDestruction();
  const map = new TacticalMap(koraPlan), camera = new T.PerspectiveCamera();
  const destruction = new Destruction(map, () => {});
  try {
    const changes = map.props.map((p) => ({ id: p.id, hp: 0, destroyed: true }));
    map.applyPropDamage(changes);
    destruction.apply(changes, new T.Vector3(0, 0.2, 0));
    assert(destruction.stats.bodies > 0);
    assert(destruction.stats.bodies <= MAX_DEBRIS);
    const count = destruction.stats.debris;
    destruction.apply(changes, new T.Vector3());
    assert.equal(destruction.stats.debris, count);
    for (let i = 0; i < 430; i++) destruction.update(1 / 60, camera);
    assert.equal(destruction.active, false);
    destruction.group.traverse((o) => assert([...o.position.toArray()].every(Number.isFinite)));
    destruction.reset(new TacticalMap(koraPlan));
    assert.deepEqual(destruction.stats, { props: koraPlan.props!.length, destroyed: 0, bodies: 0, debris: 0 });
  } finally { destruction.dispose(); }
});

test("damage stays on existing prop meshes, isolates shared finishes, and disposes on destruction/reset", async () => {
  await loadDestruction();
  const map = new TacticalMap({
    ...koraPlan, buildings: [], covers: [],
    props: [
      { id: "a", kind: "window-wall", seed: 731, x: 0, z: 0, yaw: 0.7 },
      { id: "b", kind: "window-wall", seed: 731, x: 5, z: 0, yaw: 0 },
    ],
  });
  const destruction = new Destruction(map, () => {});
  const root = (id: string) => destruction.group.getObjectByName(`window-wall / ${id}`)!;
  const meshes = (object: T.Object3D) => {
    const list: T.Mesh[] = [];
    object.traverse((part) => { if (part instanceof T.Mesh) list.push(part); });
    return list;
  };
  try {
    const a = meshes(root("a")), b = meshes(root("b"));
    const materials = a.map((mesh) => mesh.material);
    const geometry = a.map((mesh) => mesh.geometry);
    assert.deepEqual(materials, b.map((mesh) => mesh.material), "intact props share finishes");
    const changes = map.damageProp("a", 28, "blast");
    map.applyPropDamage(changes); destruction.apply(changes, new T.Vector3(0, 1, 3));
    assert.deepEqual(a.map((mesh) => mesh.geometry), geometry, "no floating overlay geometry");
    assert.equal(meshes(root("a")).length, a.length, "no extra draw meshes");
    root("a").traverse((part) => assert(!(part instanceof T.LineSegments), "no bounding-box scars"));
    for (let i = 0; i < a.length; i++) {
      assert.notEqual(a[i].material, materials[i], "damaged prop owns its finishes");
      assert.equal(b[i].material, materials[i], "neighbor stays undamaged");
    }
    let disposed = 0;
    for (const mesh of a) (mesh.material as T.Material).addEventListener("dispose", () => disposed++);
    destruction.reset(map);
    assert.equal(disposed, a.length, "reset releases the damaged clones");
    const restored = meshes(root("a"));
    assert(restored.every((mesh) => (mesh.material as T.Material).name.includes("surface damage")),
      "replayed health restores surface damage");
    let brokenDisposed = 0;
    for (const mesh of restored)
      (mesh.material as T.Material).addEventListener("dispose", () => brokenDisposed++);
    const destroyed = map.damageProp("a", 200, "blast");
    map.applyPropDamage(destroyed); destruction.apply(destroyed, new T.Vector3(0, 1, 3));
    assert.equal(brokenDisposed, restored.length, "breaking the prop releases the damage finishes");
    assert.equal(root("a").children[0].visible, false);
    assert.equal(destruction.stats.destroyed, 1);
  } finally { destruction.dispose(); }
});

test("non-brittle props shed/deform without cracks; damage stages are cached and leave templates intact", () => {
  const assets = new PropAssets();
  try {
    for (const kind of ["crate", "cargo", "barrels", "smoking-barrel", "fence-sheet", "fence-chain",
      "fence-picket", "cone", "sign"] as const) {
      const prop: MapProp = { id: kind, kind, seed: 731, x: 0, z: 0, yaw: 0 };
      const asset = assets.get(prop);
      const original = asset.intact.children.map((child) => Array.from((child as T.Mesh).geometry.attributes.position.array));
      const stage = assets.damaged(prop, 0.8)!;
      assert(!cracksWhenDamaged(kind));
      assert.equal(stage, assets.damaged(prop, 0.85), "repeated hits reuse cached geometry");
      const positions = stage.intact.children.map((child) => Array.from((child as T.Mesh).geometry.attributes.position.array));
      assert.notDeepEqual(positions, original, kind);
      assert(positions.flat().every(Number.isFinite), kind);
      if (["cargo", "barrels", "smoking-barrel", "fence-sheet", "fence-chain", "fence-picket"].includes(kind)) {
        const vertices = new Set<string>();
        for (const mesh of original) for (let i = 0; i < mesh.length; i += 3)
          vertices.add(mesh.slice(i, i + 3).join(","));
        for (const mesh of positions) for (let i = 0; i < mesh.length; i += 3)
          assert(vertices.has(mesh.slice(i, i + 3).join(",")), `${kind}: surviving vertices must not bend`);
      }
      assert.deepEqual(asset.intact.children.map((child) => Array.from((child as T.Mesh).geometry.attributes.position.array)), original);
      stage.intact.traverse((part) => {
        if (part instanceof T.Mesh) assert(!(part.material as T.Material).name.includes("surface damage"));
      });
      if (["crate", "cargo", "barrels", "fence-sheet", "fence-chain", "fence-picket"].includes(kind))
        assert(stage.shed.size > 0, `${kind} loses real parts before destruction`);
    }
    for (const kind of ["barrier", "wall", "window-wall", "glass"] as const) assert(cracksWhenDamaged(kind));
  } finally { assets.dispose(); }
});

test("partial destruction sheds once, retains cover, restores damage silently and never duplicates final debris", async () => {
  await loadDestruction();
  const prop: MapProp = { id: "crate", kind: "crate", seed: 731, x: 0, z: 0, yaw: 0.6, cover: [0, 0] };
  const plan = { ...koraPlan, buildings: [], covers: [[0, 0] as [number, number]], props: [prop] };
  const map = new TacticalMap(plan), destruction = new Destruction(map, () => {});
  try {
    const origin = new T.Vector3(0, 0.5, 3);
    const damage = map.damageProp(prop.id, 56);
    map.applyPropDamage(damage); destruction.apply(damage, origin);
    assert(map.health(prop.id) > 0);
    assert.equal(map.covers.length, 1);
    assert(destruction.stats.bodies > 0);
    const partialCount = destruction.stats.debris;
    destruction.apply(damage, origin);
    assert.equal(destruction.stats.debris, partialCount, "duplicate damage does not shed twice");
    const stage = destruction.assets.damaged(prop, 56 / propHealth.crate)!;
    assert.equal(partialCount, stage.shed.size);
    const fragments = destruction.assets.get(prop).fragments.length;
    const kill = map.damageProp(prop.id, 100);
    map.applyPropDamage(kill); destruction.apply(kill, origin);
    assert.equal(destruction.stats.debris, fragments, "partial + final equals one set of fragments");
    assert.equal(map.covers.length, 0);
    const damagedMap = new TacticalMap(plan);
    damagedMap.applyPropDamage(damage);
    destruction.reset(damagedMap);
    assert.equal(destruction.stats.debris, 0, "replay/reset restores shape without replaying old physics");
    const root = destruction.group.getObjectByName("crate / crate")!;
    assert.equal((root.children[0].children[0] as T.Mesh).geometry,
      (stage.intact.children[0] as T.Mesh).geometry);
    destruction.apply(kill, origin);
    assert.equal(destruction.stats.debris, fragments - partialCount, "restored partial pieces stay absent");
  } finally { destruction.dispose(); }
});

test("a crate takes four standard hits, shedding separate boards on the second and third", async () => {
  await loadDestruction();
  const prop: MapProp = { id: "crate", kind: "crate", seed: 731, x: 0, z: 0, yaw: 0, cover: [0, 0] };
  const map = new TacticalMap({ ...koraPlan, buildings: [], covers: [[0, 0]], props: [prop] });
  const destruction = new Destruction(map, () => {});
  try {
    for (const [index, hp] of [72, 44, 16, 0].entries()) {
      const changes = map.damageProp(prop.id, 28);
      map.applyPropDamage(changes);
      destruction.apply(changes, new T.Vector3(0, 0.5, 3));
      assert.equal(map.health(prop.id), hp);
      assert.equal(map.isCover([0, 0]), hp > 0);
      assert.equal(destruction.stats.destroyed, hp > 0 ? 0 : 1);
      const expectedPieces = hp > 0 ? index : destruction.assets.get(prop).fragments.length;
      assert.equal(destruction.stats.debris, expectedPieces, `hit ${index + 1}`);
    }
  } finally { destruction.dispose(); }
});
