// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { ShopAssets, SHOP_VARIANTS, shopFinishes, shopKinds } from "./assets.ts";
import { shopRoster } from "./catalog.ts";
import { OfficeAssets } from "../office/assets.ts";
import { CELL } from "../map.ts";

const H = CELL / 2;

function stats(group: T.Object3D) {
  let triangles = 0, calls = 0;
  group.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    calls++;
    const index = o.geometry.index;
    triangles += (index ? index.count : o.geometry.getAttribute("position").count) / 3;
  });
  return { triangles, calls, bounds: new T.Box3().setFromObject(group) };
}

// Print the budget table: SHOP_STATS=1 pnpm test.
if (process.env.SHOP_STATS) {
  const shop = new ShopAssets(), office = new OfficeAssets();
  for (const kind of shopKinds) {
    const { triangles, calls, bounds } = stats(shop.create(kind));
    const size = bounds.getSize(new T.Vector3());
    console.log(`${kind.padEnd(26)} ${String(calls).padStart(3)} calls ${String(triangles).padStart(6)} tris  ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`);
  }
  for (const kind of ["desk", "desk-tucked", "shelf", "locker", "filing-cabinet", "keyboard"] as const) {
    const { triangles, calls } = stats(office.create(kind));
    console.log(`office-${kind.padEnd(19)} ${String(calls).padStart(3)} calls ${String(triangles).padStart(6)} tris`);
  }
  shop.dispose(); office.dispose();
}

// Geometry regressions can be invisible in a compile: check every scheme and seeded look.
test("shop kit builds bounded, finite, floor-origin meshes within one cell and shares resources", () => {
  const assets = new ShopAssets();
  for (const kind of shopKinds) for (const finish of shopFinishes) for (let variant = 0; variant < SHOP_VARIANTS; variant++) {
    const a = assets.create(kind, finish, variant), b = assets.create(kind, finish, variant);
    const { calls, triangles, bounds } = stats(a);
    assert(!bounds.isEmpty(), kind);
    const spec = shopRoster[kind];
    // Wall mounts hang from their lift; everything else stands on the floor (road paint sinks 2 mm, as on the street).
    assert(bounds.min.y + (spec.lift ?? 0) >= -0.0021, `${kind} sits on the floor`);
    // Furniture stays inside its own cell (a hair of tolerance for proud trim). Buildings and
    // vehicles may overhang (balcony units, mirrors), edge pieces straddle their edge.
    const roomy = spec.place || spec.hp === 0 || spec.cells.length > 1 || spec.mount;
    if (!roomy) for (const v of [bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z])
      assert(Math.abs(v) <= H + 0.006, `${kind} stays in its cell: ${v}`);
    assert(calls <= 16, `${kind} batches by material: ${calls} draw calls`);
    assert(triangles < 9000, `${kind} triangle budget: ${triangles}`);
    const meshes: T.Mesh[] = [], copies: T.Mesh[] = [];
    a.traverse(o => { if (o instanceof T.Mesh) meshes.push(o); });
    b.traverse(o => { if (o instanceof T.Mesh) copies.push(o); });
    meshes.forEach((mesh, i) => {
      assert.equal(mesh.geometry, copies[i].geometry);
      assert(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite), kind);
    });
  }
  assets.dispose();
});

test("wall-backed pieces keep their back on the cell's north edge and join flush", () => {
  const assets = new ShopAssets();
  for (const family of ["fridge", "chiller", "wall-shelf"] as const) {
    const heights: number[] = [];
    for (const piece of ["single", "left", "mid", "right", "corner"] as const) {
      const { bounds } = stats(assets.create(`${family}-${piece}`));
      // Clear of a wall panel on the edge (0.07 into the cell), never through it.
      assert(bounds.min.z >= -H + 0.07, `${family}-${piece} back clears the wall`);
      assert(bounds.min.z <= -0.59, `${family}-${piece} backs onto the wall`);
      // Modules run edge to edge, so a run of N cells is N modules with no gap.
      assert(Math.abs(bounds.max.x - H) < 0.006 && Math.abs(bounds.min.x + (piece === "corner" ? 0.6 : H)) < 0.006,
        `${family}-${piece} spans its cell`);
      heights.push(bounds.max.y);
    }
    assert(Math.max(...heights) - Math.min(...heights) < 0.02, `${family} pieces share one height`);
    // The corner's second arm is a slice of the turn-1 module: it reaches the cell's south edge.
    assert(Math.abs(stats(assets.create(`${family}-corner`)).bounds.max.z - H) < 0.006, `${family} corner turns the run`);
  }
  assets.dispose();
});

test("heights follow the gameplay classes", () => {
  const assets = new ShopAssets();
  const height = (kind: Parameters<ShopAssets["create"]>[0]) => stats(assets.create(kind)).bounds.max.y;
  // Tall pieces block sight in the scene and fade over units; low cover is seen over (a unit stands 1.8 m).
  for (const kind of ["fridge-mid", "chiller-mid", "wall-shelf-mid", "gondola-tall-mid", "back-bar-mid", "bar-fridge"] as const)
    assert(height(kind) >= 1.75, `${kind} is tall`);
  for (const kind of ["gondola-mid", "gondola-end", "freezer-mid", "counter-straight", "table-two", "beer-crates", "sake-barrel",
    "dumpster", "recycling-bins", "roll-cage", "sample-case"] as const)
    assert(height(kind) <= 1.75, `${kind} is low enough to see over`);
  assert(height("counter-straight") >= 0.97 && height("counter-straight") <= 1.02, "counter top carries the register");
  assert.equal(shopRoster["counter-straight"].top, 1);
  assets.dispose();
});

test("seeded looks vary a run without new materials", () => {
  const assets = new ShopAssets();
  const signature = (variant: number) => {
    const a = assets.create("gondola-mid", "plain", variant);
    let n = 0; a.traverse(o => { if (o instanceof T.Mesh) n += o.geometry.getAttribute("position").count; });
    return n;
  };
  const looks = new Set(Array.from({ length: SHOP_VARIANTS }, (_, v) => signature(v)));
  assert(looks.size > 1, "variants differ");
  const materials = new Set<T.Material>();
  for (let v = 0; v < SHOP_VARIANTS; v++) assets.create("fridge-mid", "plain", v).traverse(o => {
    if (o instanceof T.Mesh) materials.add(o.material as T.Material);
  });
  assert(materials.size <= 14, `variants share materials: ${materials.size}`);
  const dead = assets.parts("fridge-dead");
  assert(dead.getObjectByName("door-hinge"), "the dead fridge hangs a door open");
  assets.dispose();
});

test("fence and storefront sections share square posts on their edge ends", () => {
  const assets = new ShopAssets(), office = new OfficeAssets();
  for (const kind of ["rail-guard", "rail-mesh", "rail-gap", "auto-door"] as const) {
    const { bounds } = stats(assets.create(kind));
    // Posts centred on ±H: the run's next section and a 90° turn land on the same post.
    assert(Math.abs(bounds.max.x + bounds.min.x) < 0.001 && bounds.max.x > H && bounds.max.x < H + 0.08, kind);
  }
  const glass = stats(office.create("glass-wall")).bounds;
  assert(Math.abs(glass.max.x - (H + 0.07)) < 0.001, "glass wall posts centred on the module ends");
  assert.equal(shopRoster["auto-door"].footprint, "none");
  assets.dispose(); office.dispose();
});

test("buildings stack whole storeys and vehicles keep to their bays", () => {
  const assets = new ShopAssets();
  for (const floors of [1, 2, 4, 8] as const) {
    const { bounds } = stats(assets.create(`building-${floors}`));
    assert(bounds.max.y >= floors * 3 && bounds.max.y < floors * 3 + 1.6, `building-${floors}`);
  }
  for (const kind of ["building-wall-store", "building-wall-corner", "building-wall-partition", "building-wall-timber", "building-wall-concrete"] as const) {
    const { bounds } = stats(assets.create(kind));
    // One storey, flat top, and nothing past the cell but the outside skin's few millimetres.
    assert(bounds.max.y > 2.9 && bounds.max.y < 3.1, kind);
    assert(Math.max(-bounds.min.x, bounds.max.x, -bounds.min.z, bounds.max.z) < H + 0.07, kind);
  }
  for (const kind of ["kei-car", "kei-truck", "hatchback", "van", "taxi"] as const) {
    const spec = shopRoster[kind], { bounds } = stats(assets.create(kind));
    const cols = new Set(spec.cells.map(([x]) => x)).size, rows = new Set(spec.cells.map(([, z]) => z)).size;
    const size = bounds.getSize(new T.Vector3());
    assert(size.z <= rows * CELL + 0.01, `${kind} length fits its ${rows} cells`);
    // A kei car is 1.48 m at most against a 1.35 m tile: a hand's width over each side, mirrors aside.
    assert(size.x - 0.32 <= cols * CELL, `${kind} body fits its ${cols} column(s), mirrors aside`);
    assert.equal(spec.footprint, "solid");
    assert.equal(spec.hp, 0, "vehicles are indestructible for now");
  }
  assets.dispose();
});
