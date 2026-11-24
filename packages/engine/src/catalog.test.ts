// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { allFinishes, assetByUid, assetCatalog, assetSpec, finishOf, floorByUid, floorCatalog } from "./catalog.ts";
import { propBlastMultiplier, propHealth, resistsGunfire } from "./environment.ts";
import { koraPlan } from "./district-plan.ts";
import { officePlan } from "./office/plan.ts";

test("uids are unique, opaque and stable", () => {
  assert.equal(new Set(assetCatalog.map((a) => a.uid)).size, assetCatalog.length);
  assert.equal(new Set(floorCatalog.map((f) => f.uid)).size, floorCatalog.length);
  for (const a of assetCatalog) {
    assert.match(a.uid, /^[boskuv]\d\d$/);
    assert.equal(assetByUid(a.uid), a);
  }
  for (const f of floorCatalog) {
    assert.match(f.uid, /^f\d\d$/);
    assert.equal(floorByUid(f.uid), f);
  }
  // Variants may share a kind (low/tall fences); the combat numbers must agree.
  for (const a of assetCatalog) {
    const primary = assetSpec(a.kind);
    assert.equal(a.hp, primary.hp);
    assert.equal(!!a.gunproof, !!primary.gunproof);
    assert.equal(a.blast ?? 1, primary.blast ?? 1);
  }
  // Saves reference these ids: renaming an asset must never change them.
  const pinned: Record<string, string> = {
    b01: "block-cover", b02: "block-high", b03: "block-weak", b04: "block-obstacle", b05: "block-solid",
    b06: "block-fill",
    s01: "barrier", s02: "crate", s03: "cargo", s04: "barrels", s05: "smoking-barrel",
    s06: "fence-sheet", s07: "fence-chain", s08: "fence-picket", s09: "cone", s10: "sign",
    s11: "wall", s12: "window-wall", s13: "glass",
    s14: "fence-sheet", s15: "fence-chain", s16: "fence-picket",
    s17: "vending", s18: "bicycle", s19: "pallet", s20: "utility-pole",
    o01: "office-desk", o04: "office-meeting-table", o18: "office-steel-door",
    o19: "office-keypad", o20: "office-steel-wall", o25: "office-locker",
    k01: "shop-fridge-single", k03: "shop-fridge-mid", k05: "shop-fridge-corner", k06: "shop-fridge-dead",
    k09: "shop-chiller-mid", k14: "shop-wall-shelf-mid", k17: "shop-gondola-single", k19: "shop-gondola-mid",
    k22: "shop-gondola-tall-mid", k25: "shop-freezer-mid", k26: "shop-counter-straight", k28: "shop-counter-corner",
    k29: "shop-register", k30: "shop-hot-case",
    k31: "shop-wood-wall", k34: "shop-lantern", k42: "shop-bar-counter-straight", k45: "shop-stool",
    k63: "shop-table-set-drinks", k67: "shop-espresso", k76: "shop-bar-fridge", k79: "shop-back-bar-mid",
    k88: "shop-rail-guard", k95: "shop-pay-station", k99: "shop-ashtray-stand",
    v01: "shop-kei-car", v05: "shop-taxi", v07: "shop-mamachari",
    u01: "shop-building-1", u04: "shop-building-8", u05: "shop-auto-door",
  };
  for (const [uid, kind] of Object.entries(pinned)) assert.equal(assetByUid(uid)?.kind, kind);
  for (const uid of ["f01", "f05", "f08", "f12"]) assert.ok(floorByUid(uid));
  // The street floors reuse the district's own materials, not invented tints.
  assert.equal(floorByUid("f03")?.street, "asphalt");
  assert.equal(floorByUid("f02")?.street, "concrete");
  assert.ok(floorByUid("f01")?.slabs);
  assert.equal(floorByUid("f12")?.stripes, "x");
  assert.equal(floorByUid("f13")?.stripes, "z");
});

test("the combat tables derive from the catalog unchanged", () => {
  assert.equal(propHealth.crate, 100);
  assert.equal(propHealth.barrier, 140);
  assert.equal(propHealth["office-steel-wall"], 180);
  assert.equal(propHealth["office-papers"], 8);
  for (const kind of ["wall", "window-wall", "office-steel-wall", "office-window-wall", "office-steel-door"] as const)
    assert.equal(resistsGunfire(kind), true);
  assert.equal(resistsGunfire("crate"), false);
  assert.equal(resistsGunfire("block-high"), true);
  assert.equal(resistsGunfire("block-weak"), false);
  for (const kind of ["office-desk", "office-desk-tucked", "office-corner-desk", "office-meeting-table"] as const)
    assert.equal(propBlastMultiplier(kind), 2);
  assert.equal(propBlastMultiplier("barrier"), 1);
});

test("every prop the shipped maps place is in the catalog", () => {
  for (const plan of [koraPlan, officePlan])
    for (const prop of plan.props ?? []) {
      const spec = assetSpec(prop.kind);
      assert.ok(spec, `${prop.kind} missing from the catalog`);
      assert.equal(propHealth[prop.kind], spec.hp);
    }
});

test("footprints give every entry tactical meaning", () => {
  for (const a of assetCatalog) {
    assert.ok(["cover", "solid", "obstacle", "none"].includes(a.footprint));
    if (a.place === "edge") assert.equal(a.cells.length, 0, `${a.uid} seats on an edge`);
    else {
      assert.ok(a.cells.length >= 1);
      assert.deepEqual(a.cells[0], [0, 0]);
    }
    // Rifle-proof construction is full height: a solid cell or a solid/door edge.
    if (a.gunproof) assert.ok(a.footprint === "solid" || a.place === "edge");
    if (a.mount === "wall") assert.equal(a.place, "edge");
    if (a.mount === "surface") assert.equal(a.footprint, "none");
    // A scheme list always names its default first and only known schemes.
    for (const f of a.finishes ?? []) assert.ok(allFinishes.includes(f), `${a.uid} ${f}`);
  }
  // The indestructible stand-in blocks movement without owning cover cells.
  assert.equal(assetByUid("b05")?.hp, 0);
  assert.equal(assetByUid("b05")?.footprint, "obstacle");
});

test("the shop pack maps onto the existing tactical classes", () => {
  const shop = assetCatalog.filter((a) => a.kind.startsWith("shop-"));
  assert.ok(shop.length >= 110);
  for (const a of shop) {
    assert.match(a.uid, /^[kuv]\d\d$/);
    assert.ok(a.tags, `${a.uid} is searchable`);
  }
  for (const a of shop.filter((a) => /^k(0\d|[12]\d|30)$/.test(a.uid)))
    assert.deepEqual(a.finishes, ["plain", "eleventy", "yandottir"], a.uid);
  assert.deepEqual(assetByUid("k31")?.finishes, ["cedar", "smoked", "black"]);
  const of = (kind: string) => shop.find((a) => a.kind === `shop-${kind}`)!;
  // Everything a frag can destroy is `cover`: on chain an Obstacle, the one cell class a grenade
  // clears, so the rules and the scene agree when it breaks — the full-height fridges included.
  for (const kind of ["fridge-mid", "fridge-corner", "chiller-single", "wall-shelf-left", "gondola-tall-mid", "back-bar-mid",
    "bar-fridge", "gondola-mid", "gondola-end", "freezer-mid", "counter-straight", "counter-corner", "table-four",
    "beer-crates", "sake-barrel", "cafe-table", "dumpster", "ac-pair", "roll-cage"])
    assert.equal(of(kind).footprint, "cover", kind);
  // No new cell asset is a permanent no-go tile: seating is walk-through dressing.
  // Cars are the exception: unwalkable with a low rim, never a wall or destructible cover.
  for (const a of shop) if (a.place !== "edge" && !a.lowRim) assert.notEqual(a.footprint, "obstacle", a.uid);
  for (const kind of ["stool", "cafe-chair"]) assert.equal(of(kind).footprint, "none");
  // The register and hot case are counter-top clutter; the counter carries them.
  for (const kind of ["register", "hot-case"]) {
    assert.equal(of(kind).mount, "surface");
    assert.equal(of(kind).footprint, "none");
  }
  assert.equal(of("counter-end").top, 1);
  // Every run piece of a kit shares its durability, so a run breaks evenly.
  for (const family of ["fridge", "chiller", "wall-shelf"]) {
    const hp = new Set(shop.filter((a) => a.kind.startsWith(`shop-${family}-`)).map((a) => a.hp));
    assert.equal(hp.size, 1, family);
  }
  assert.equal(finishOf(of("fridge-mid")), "plain");
  assert.equal(finishOf(of("fridge-mid"), "sage"), "plain");
  assert.equal(finishOf(of("fridge-mid"), "yandottir"), "yandottir");
  assert.equal(finishOf(assetSpec("barrier")), undefined);
  // Edges follow the street fences: a low rail is low cover, a tall mesh is high (obstacle),
  // a chain or an opening is a passage, a doorway in glazing too.
  assert.equal(of("rail-guard").footprint, "cover");
  assert.equal(of("rail-mesh").footprint, assetByUid("s15")!.footprint);
  for (const kind of ["rail-chain", "rail-gap", "auto-door", "noren"]) assert.equal(of(kind).footprint, "none");
  for (const kind of ["bus-shelter", "taxi-shelter"]) assert.equal(of(kind).footprint, "cover");
  // Buildings a frag cannot remove are wall tiles with no hit points, like the building block.
  for (const kind of ["building-1", "building-8"]) {
    assert.equal(of(kind).footprint, assetByUid("b06")!.footprint);
    assert.equal(of(kind).hp, 0);
  }
  // Cars cannot be cleared either, but they are no wall: unwalkable with a low rim, shot over.
  for (const kind of ["kei-car", "van", "taxi"]) {
    assert.equal(of(kind).footprint, assetByUid("b05")!.footprint);
    assert.equal(of(kind).lowRim, true);
    assert.equal(of(kind).hp, 0);
  }
  // Shell walls are permanent wall tiles, like the masses they replace in a store's shell.
  for (const uid of ["u15", "u16", "u17", "u18", "u19"]) {
    const spec = assetByUid(uid)!;
    assert.ok(spec.kind.startsWith("shop-building-wall-"), uid);
    assert.equal(spec.footprint, assetByUid("u01")!.footprint);
    assert.equal(spec.hp, 0);
  }
  assert.deepEqual(assetByUid("u15")!.finishes, ["plain", "eleventy", "yandottir"]);
  assert.deepEqual(new Set(of("hatchback").cells.map(([x]) => x)), new Set([0, 1]));
  assert.equal(of("kei-car").cells.length, 3);
});
