// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { BED_RMS, ENGINE_GENERATORS, SHOT_PEAK } from "./generators.ts";
import { GENERATORS, SLOT_IDS, SLOTS, slotFiles, validateManifest, voiceSlot, type Slot } from "./manifest.ts";
import { EFFECTS, effectSlot, effectUrl } from "../sfx.ts";
import { lineUrl, PHRASES } from "../voice.ts";

const ALL = new Set(Object.keys(GENERATORS));

test("the manifest is well formed, and a missing file or generator is reported", () => {
  assert.deepEqual(validateManifest(() => true, ["male-01"], ALL), []);
  const missing = validateManifest((f) => f !== "pistol-02.mp3", ["male-01"], ALL);
  assert.deepEqual(missing, ["weapon.pistol.shot: missing file pistol-02.mp3"]);
  const unimplemented = validateManifest(() => true, [], new Set());
  assert.ok(unimplemented.some((p) => p.startsWith("ambience.rain.bed.a: generator bed.rain.a")));
});

test("every engine generator in the table is implemented, and nothing else", () => {
  const engine = Object.entries(GENERATORS).filter(([, owner]) => owner === "engine").map(([name]) => name);
  assert.deepEqual(Object.keys(ENGINE_GENERATORS).sort(), engine.sort());
});

test("every slot has a note and a bus; ambience is all placeholder, the recordings are not", () => {
  for (const id of SLOT_IDS) {
    const s = SLOTS[id] as Slot;
    assert.ok(s.note.length > 0, id);
    if (s.bus === "ambience") assert.equal(s.placeholder, true, id);
    if ("file" in s.source && s.bus !== "ambience") assert.equal(s.placeholder, false, id);
  }
});

test("the effect tables are the manifest's", () => {
  assert.deepEqual(EFFECTS.rifle, slotFiles("weapon.rifle.shot").map((f) => f.replace(".mp3", "")));
  assert.equal(effectUrl("grenade-explodes-01"), "/sounds/grenade-explodes-01.mp3");
  assert.equal(effectSlot("rifle"), "weapon.rifle.shot");
  assert.equal(effectSlot("reload", "sniper"), "weapon.sniper.reload");
  assert.equal(effectSlot("aim", "pistol"), "weapon.pistol.raise");
  assert.equal(effectSlot("aim", "rifle"), null);
  assert.equal(effectSlot("reload"), null);
  assert.equal(effectSlot("smoke"), "grenade.smoke");
  assert.equal(effectSlot("click"), "combat.click");
});

test("every voice phrase has a slot and the lines resolve through it", () => {
  for (const phrase of new Set(Object.values(PHRASES).flat())) assert.ok(voiceSlot(phrase), phrase);
  assert.equal(lineUrl("copy", { sex: "male", index: 2 }), "/sounds/copy-male-02.mp3");
});

const RATE = 8000;

test("rendered beds loop without a seam and come out at the bed level", () => {
  for (const [name, g] of Object.entries(ENGINE_GENERATORS)) {
    if (g.kind !== "render" || !name.startsWith("bed.")) continue;
    const x = g.render(RATE);
    assert.ok(x.length > RATE * 10, `${name} is a long loop`);
    let sum = 0,
      step = 0;
    for (let i = 0; i < x.length; i++) {
      assert.ok(Number.isFinite(x[i]));
      sum += x[i] * x[i];
      if (i) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
    }
    assert.ok(Math.abs(Math.sqrt(sum / x.length) - BED_RMS) < 1e-3, name);
    // The wrap from the last sample to the first is no bigger a step than any inside the loop.
    assert.ok(Math.abs(x[x.length - 1] - x[0]) <= step * 1.01 + 1e-6, `${name} seam`);
  }
});

test("the two rain layers are decorrelated", () => {
  const a = (ENGINE_GENERATORS["bed.rain.a"] as { render(r: number): Float32Array }).render(RATE);
  const b = (ENGINE_GENERATORS["bed.rain.b"] as { render(r: number): Float32Array }).render(RATE);
  assert.notEqual(a.length, b.length);
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  assert.ok(Math.abs(ab / Math.sqrt(aa * bb)) < 0.05);
});

test("rendered one-shots start and end on silence and peak at the one-shot level", () => {
  for (const [name, g] of Object.entries(ENGINE_GENERATORS)) {
    if (g.kind !== "render" || name.startsWith("bed.")) continue;
    const x = g.render(RATE);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    assert.ok(Math.abs(peak - SHOT_PEAK) < 1e-6, name);
    assert.equal(Math.abs(x[0]), 0, `${name} start`);
    assert.equal(Math.abs(x[x.length - 1]), 0, `${name} end`);
    // Deterministic: the same samples every render.
    assert.deepEqual(g.render(RATE).slice(0, 64), x.slice(0, 64));
  }
});
