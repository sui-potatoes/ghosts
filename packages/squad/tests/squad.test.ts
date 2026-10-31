// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { MeshStandardMaterial } from "three";
import { paintArmor } from "../src/studio/armor-materials.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  initialSquad,
  equip,
  equipAttachment,
  available,
  addRecruit,
  editRecruit,
  restoreSquad,
  savedRecruits,
  MAX_RECRUITS,
} from "../src/model.ts";
import {
  add,
  CLASSIFIED,
  contributions,
  ITEM_STATS,
  pack,
  recruitStats,
  RECRUIT_DEFAULT,
  STAT_KEYS,
  stats,
  unpack,
  VISIBLE,
} from "../src/stats.ts";
import { shuffleFace, normalize } from "../src/appearance/editor-state.js";
import { schema } from "../src/appearance/schema.ts";

test("equipping swaps conserve the shared inventory and enforce slots", () => {
  const start = initialSquad();
  assert.equal(available(start, "mx4"), 1);
  assert.equal(available(start, "srs9"), 1);
  const swapped = equip(start, "vex", "primary", "srs9");
  assert.equal(available(swapped, "srs9"), 0);
  assert.equal(available(swapped, "mx4"), 2);
  assert.throws(
    () => equip(swapped, "bishop", "primary", "srs9"),
    /All copies/,
  );
  assert.throws(() => equip(swapped, "bishop", "armor", "mx4"), /does not fit/);
  const returned = equip(swapped, "vex", "primary", null);
  assert.equal(available(returned, "srs9"), 1);
  assert.equal(start.recruits[0].equipment.primary, "mx4");
});
for (const armor of ["nyx", "nyx-mid", "nyx-heavy"])
  test(`${armor}: separate armor choice survives saving and preserves appearance`, () => {
    const start = initialSquad();
    const swapped = equip(start, "vex", "armor", armor);
    assert.equal(available(swapped, armor), 3);
    assert.equal(
      available(swapped, "spectre"),
      available(start, "spectre") + 1,
    );
    assert.deepEqual(
      swapped.recruits[0].appearance,
      start.recruits[0].appearance,
    );
    const restored = restoreSquad(JSON.parse(JSON.stringify(swapped)));
    assert.equal(restored.recruits[0].equipment.armor, armor);
    assert.deepEqual(
      restored.recruits[0].appearance,
      swapped.recruits[0].appearance,
    );
    const returned = equip(restored, "vex", "armor", "spectre");
    assert.equal(available(returned, armor), 4);
    assert.equal(start.recruits[0].equipment.armor, "spectre");
  });
test("personnel validation normalizes names and rejects duplicate callsigns", () => {
  const start = initialSquad();
  const edited = editRecruit(start, "vex", {
    name: "  Mara   Voss ",
    callsign: "nova",
  });
  assert.equal(edited.recruits[0].name, "Mara Voss");
  assert.equal(edited.recruits[0].appearance.name, "Mara Voss");
  assert.equal(edited.recruits[0].callsign, "NOVA");
  assert.throws(
    () => editRecruit(start, "vex", { callsign: "ghost" }),
    /already/,
  );
  assert.throws(() => editRecruit(start, "vex", { name: "X" }), /2–40/);
});
test("recruitment starts unequipped, cannot duplicate identities and caps roster at four", () => {
  const start = initialSquad();
  let state = { ...start, recruits: start.recruits.slice(0, 2) };
  const recruit = { ...start.recruits[0], id: "new", callsign: "NEW" };
  const stock = available(state, "mx4");
  state = addRecruit(state, recruit);
  assert.ok(
    Object.values(state.recruits[2].equipment).every((v) => v === null),
  );
  assert.equal(available(state, "mx4"), stock);
  assert.throws(() => addRecruit(state, recruit), /already exists/);
  for (let i = state.recruits.length; i < MAX_RECRUITS; i++)
    state = addRecruit(state, {
      ...recruit,
      id: `new${i}`,
      callsign: `NEW${i}`,
    });
  assert.throws(
    () => addRecruit(state, { ...recruit, id: "extra", callsign: "EXTRA" }),
    /four/,
  );
});
test("saved rosters restore valid state without trusting stock, morph ranges or asset paths", () => {
  const state = initialSquad();
  state.stock.mx4 = 999;
  state.recruits[0].appearance.hair = "../../bad";
  state.recruits[0].appearance.values.eyeSpace = 999;
  const restored = restoreSquad(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.stock.mx4, 4);
  assert.equal(restored.recruits[0].appearance.values.eyeSpace, 1);
  assert.equal(restored.recruits[0].appearance.hair, "bob01");
  assert.throws(
    () => restoreSquad({ version: 99, recruits: [] }),
    /Unsupported/,
  );
  assert.throws(() => restoreSquad(null), /Invalid/);
  assert.deepEqual(
    restoreSquad(restoreSquad(initialSquad())),
    restoreSquad(initialSquad()),
  );
});
test("shuffle changes morphology and complexion while preserving identity and equipment-independent features", () => {
  const current = initialSquad().recruits[0].appearance;
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const shuffled = shuffleFace(schema, current, random);
  assert.equal(shuffled.sex, current.sex);
  assert.equal(shuffled.hair, current.hair);
  assert.notDeepEqual(shuffled.values, current.values);
  assert.ok(
    schema.controls
      .filter((c) => c.group === "Eyes")
      .some((c) => shuffled.values[c.key] !== current.values[c.key]),
  );
  assert.deepEqual(normalize(shuffled, schema), shuffled);
});

test("armor finishes persist per recruit without changing equipment or identity", () => {
  const start = initialSquad();
  const colors = {
    primary: "#aba89a",
    secondary: "#353a3d",
    accent: "#be713d",
  };
  const painted = editRecruit(start, "vex", { armorColors: colors });
  assert.deepEqual(painted.recruits[0].armorColors, colors);
  assert.deepEqual(painted.recruits[0].equipment, start.recruits[0].equipment);
  assert.deepEqual(
    painted.recruits[0].appearance,
    start.recruits[0].appearance,
  );
  assert.equal(painted.recruits[1], start.recruits[1]);
  assert.notDeepEqual(start.recruits[0].armorColors, colors);
  const swapped = equip(painted, "vex", "armor", "nyx-heavy");
  assert.deepEqual(
    restoreSquad(JSON.parse(JSON.stringify(swapped))).recruits[0].armorColors,
    colors,
  );
});

test("legacy saves and malformed armor channels are restored safely", () => {
  const saved = JSON.parse(JSON.stringify(initialSquad()));
  delete saved.recruits[0].armorColors;
  saved.recruits[1].armorColors = {
    primary: "#ABCDEF",
    secondary: "red",
    accent: null,
  };
  const restored = restoreSquad(saved);
  const defaults = initialSquad().recruits[0].armorColors;
  assert.deepEqual(restored.recruits[0].armorColors, defaults);
  assert.deepEqual(restored.recruits[1].armorColors, {
    ...defaults,
    primary: "#abcdef",
  });
  assert.notEqual(
    restored.recruits[0].armorColors,
    restored.recruits[2].armorColors,
  );
});

test("armor paint changes the three channels without repainting cloth or shared assets", () => {
  const names = [
    "NYX / carbon ceramic",
    "NYX / edge binding",
    "NYX / cyan identification",
    "NYX / graphite weave",
    "NYX / titanium hardware",
  ];
  const original = names.map((name) => {
    const m = new MeshStandardMaterial({ color: "#123456", roughness: 0.7 });
    m.name = name;
    return m;
  });
  const owned = original.map((m) => m.clone());
  paintArmor(owned, {
    primary: "#abcdef",
    secondary: "#fedcba",
    accent: "#ff8844",
  });
  assert.deepEqual(
    owned.map((m) => m.color.getHexString()),
    ["abcdef", "fedcba", "ff8844", "123456", "123456"],
  );
  assert.equal(owned[2].emissive.getHexString(), "ff8844");
  assert.ok(owned.every((m) => m.roughness === 0.7));
  assert.ok(original.every((m) => m.color.getHexString() === "123456"));
});

test("stats mirror commander::stats packing, item presets and modifier rules", () => {
  // items::rifle(1) and its Move test expectations.
  const rifle = unpack(0x03_04_00_00_01_0a_0a_02_04n << 48n);
  assert.deepEqual(
    [
      rifle.damage,
      rifle.spread,
      rifle.plusOne,
      rifle.critChance,
      rifle.canBeDodged,
    ],
    [4, 2, 10, 10, 1],
  );
  assert.deepEqual(
    [rifle.areaSize, rifle.envDamage, rifle.range, rifle.ammo],
    [0, 0, 4, 3],
  );
  assert.equal(pack(rifle), 0x03_04_00_00_01_0a_0a_02_04n << 48n);
  assert.deepEqual(ITEM_STATS.mx4, rifle);
  // items::armor(3): vector[128 + 1, 0, 1, 3, 128 + 10], signed bytes round-trip.
  const heavy = pack(ITEM_STATS["nyx-heavy"]);
  assert.equal(heavy & 0xffn, 129n);
  assert.equal((heavy >> 32n) & 0xffn, 138n);
  assert.deepEqual(unpack(heavy), ITEM_STATS["nyx-heavy"]);
  // stats::add: zero skips, negatives floor at 0, results cap at 127.
  const sum = add(
    stats({ aim: 120, mobility: 2 }),
    stats({ aim: 20, mobility: -3, health: 0 }),
  );
  assert.deepEqual([sum.aim, sum.mobility, sum.health], [127, 0, 0]);
  assert.equal(add(RECRUIT_DEFAULT, stats({ mobility: -1 })).mobility, 6);
  // Every field is either listed or classified; spread rides inside damage.
  const covered = new Set([
    ...VISIBLE.map((r) => r.key),
    ...CLASSIFIED,
    "spread",
  ]);
  assert.deepEqual(
    [...STAT_KEYS].filter((k) => !covered.has(k)),
    [],
  );
});
test("recruit stats combine operative, primary weapon and armor like unit.move", () => {
  const squad = initialSquad();
  const vex = recruitStats(squad.recruits[0]); // mx4 + spectre
  assert.deepEqual(
    [
      vex.mobility,
      vex.aim,
      vex.health,
      vex.armor,
      vex.dodge,
      vex.damage,
      vex.range,
      vex.ammo,
    ],
    [7, 65, 10, 1, 10, 4, 4, 3],
  );
  // Sidearm and utility never contribute.
  const bare = equip(
    equip(squad, "vex", "sidearm", null),
    "vex",
    "utility",
    null,
  );
  assert.deepEqual(recruitStats(bare.recruits[0]), vex);
  // Heavy armor's penalties reach the recruit; dodge 0 − 10 floors at zero, as on chain.
  const heavy = equip(squad, "vex", "armor", "nyx-heavy").recruits[0];
  const h = recruitStats(heavy);
  assert.deepEqual([h.mobility, h.health, h.armor, h.dodge], [6, 11, 3, 0]);
  // Each gear piece's share is reported, with what the floor took away.
  const parts = contributions(heavy).byStat;
  assert.deepEqual(parts.mobility, [
    { source: "armor", item: "nyx-heavy", requested: -1, applied: -1 },
  ]);
  assert.deepEqual(parts.dodge, [
    { source: "armor", item: "nyx-heavy", requested: -10, applied: 0 },
  ]);
  assert.deepEqual(
    parts.damage.map((p) => [p.source, p.item, p.applied]),
    [["weapon", "mx4", 4]],
  );
  assert.deepEqual(parts.aim, []);
  // No gear at all is the chain default.
  const unarmed = equip(
    equip(squad, "vex", "primary", null),
    "vex",
    "armor",
    null,
  ).recruits[0];
  assert.deepEqual(recruitStats(unarmed), RECRUIT_DEFAULT);
});

test("a corrupt or missing save reads as no recruits", () => {
  assert.equal(savedRecruits(null), null);
  assert.equal(savedRecruits("{broken"), null);
  assert.equal(
    savedRecruits(JSON.stringify({ version: 2, recruits: [] })),
    null,
  );
  assert.equal(
    savedRecruits(JSON.stringify(initialSquad()))?.length,
    initialSquad().recruits.length,
  );
});

test("every attachment tier fits all three rifles and changes only its specified stat", () => {
  const families = [
    ["clip", "ammo", 1],
    ["stock", "range", 1],
    ["laser", "critChance", 5],
    ["scope", "aim", 5],
  ] as const;
  for (const weapon of ["mx4", "srs9", "plasma"]) {
    const start = equip(initialSquad(), "vex", "primary", weapon);
    const base = recruitStats(start.recruits[0]);
    assert.equal(base.areaSize, 0);
    for (const [slot, stat, step] of families)
      for (const tier of [1, 2, 3]) {
        const fitted = equipAttachment(start, "vex", slot, `${slot}-${tier}`);
        assert.deepEqual(recruitStats(fitted.recruits[0]), {
          ...base,
          [stat]: base[stat] + step * tier,
        });
        assert.equal(available(fitted, `${slot}-${tier}`), 3);
        assert.deepEqual(
          recruitStats(equipAttachment(fitted, "vex", slot, null).recruits[0]),
          base,
        );
      }
  }
});

test("attachment swaps persist, conserve stock, transfer between rifles and clear when returned", () => {
  let squad = initialSquad();
  for (const slot of ["clip", "stock", "laser", "scope"] as const)
    squad = equipAttachment(squad, "vex", slot, `${slot}-3`);
  squad = equip(squad, "vex", "primary", "plasma");
  const total = recruitStats(squad.recruits[0]);
  assert.deepEqual(
    [
      total.damage,
      total.spread,
      total.critChance,
      total.range,
      total.ammo,
      total.aim,
    ],
    [6, 1, 45, 8, 6, 80],
  );
  assert.deepEqual(restoreSquad(JSON.parse(JSON.stringify(squad))), squad);
  squad = equipAttachment(squad, "vex", "clip", "clip-1");
  assert.equal(available(squad, "clip-3"), 4);
  assert.equal(available(squad, "clip-1"), 3);
  const returned = equip(squad, "vex", "primary", null);
  assert.equal(available(returned, "clip-1"), 4);
  assert.deepEqual(returned.recruits[0].attachments, {});
  assert.throws(
    () => equipAttachment(returned, "vex", "clip", "clip-1"),
    /primary weapon/,
  );
  assert.throws(
    () => equipAttachment(squad, "vex", "clip", "scope-1"),
    /does not fit/,
  );
  const depleted = { ...squad, stock: { ...squad.stock, "scope-1": 0 } };
  assert.throws(
    () => equipAttachment(depleted, "vex", "scope", "scope-1"),
    /All copies/,
  );
});

test("attachment restore ignores unknown and mismatched ids and handles legacy saves", () => {
  const saved = JSON.parse(JSON.stringify(initialSquad()));
  delete saved.recruits[0].attachments;
  saved.recruits[1].attachments = {
    clip: "scope-3",
    stock: "not-an-item",
    scope: "scope-2",
    laser: "laser-1",
  };
  saved.recruits[2].equipment.primary = null;
  saved.recruits[2].attachments = { scope: "scope-3" };
  const restored = restoreSquad(saved);
  assert.deepEqual(restored.recruits[0].attachments, {});
  assert.deepEqual(restored.recruits[1].attachments, {
    scope: "scope-2",
    laser: "laser-1",
  });
  assert.deepEqual(restored.recruits[2].attachments, {});
});
