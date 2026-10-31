// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { assetByUid, assetCatalog, assetSpec, floorByUid, floorCatalog } from "./catalog.ts";
import { propBlastMultiplier, propHealth, resistsGunfire } from "./environment.ts";
import { koraPlan } from "./district-plan.ts";
import { officePlan } from "./office/plan.ts";

test("uids are unique, opaque and stable", () => {
  assert.equal(new Set(assetCatalog.map((a) => a.uid)).size, assetCatalog.length);
  assert.equal(new Set(floorCatalog.map((f) => f.uid)).size, floorCatalog.length);
  for (const a of assetCatalog) {
    assert.match(a.uid, /^[bos]\d\d$/);
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
  }
  // The indestructible stand-in blocks movement without owning cover cells.
  assert.equal(assetByUid("b05")?.hp, 0);
  assert.equal(assetByUid("b05")?.footprint, "obstacle");
});
