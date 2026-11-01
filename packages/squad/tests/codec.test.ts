// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import {
  AREAS,
  AREA_SLOTS,
  decodeVisuals,
  ENCODED_MORPHS,
  encodeVisuals,
  packArea,
  sameVisuals,
  unpackArea,
} from "../src/appearance/codec.ts";
import {
  fromPreset,
  normalize,
  presets,
  randomIdentity,
} from "../src/appearance/editor-state.js";
import { schema } from "../src/appearance/schema.ts";
import { ARMOR_FINISHES, DEFAULT_ARMOR_COLORS } from "../src/armor-colors.ts";

const look = (i: number) => normalize(fromPreset(presets[i]), schema);

test("every face morph has exactly one slot", () => {
  assert.deepEqual(
    [...ENCODED_MORPHS].sort(),
    schema.controls.map((c) => c.key).sort(),
  );
});

test("every area fits a u256", () => {
  const areas = encodeVisuals(look(0), DEFAULT_ARMOR_COLORS);
  for (const area of AREAS) {
    assert.ok(
      areas[area].length <= AREA_SLOTS,
      `${area}: ${areas[area].length} slots`,
    );
    for (const slot of areas[area])
      assert.ok(Number.isInteger(slot) && slot >= 0 && slot <= 255);
  }
});

test("areas pack like bit_field::pack_u8 and unpack back", () => {
  assert.equal(packArea([1, 2, 3]), 0x030201n);
  assert.equal(packArea([]), 0n);
  assert.deepEqual(unpackArea(0x030201n).slice(0, 4), [1, 2, 3, 0]);
  assert.deepEqual(unpackArea("197121").slice(0, 3), [1, 2, 3]);
  const full = Array.from({ length: 32 }, (_, i) => 255 - i);
  assert.deepEqual(unpackArea(packArea(full)), full);
  assert.throws(() => packArea(new Array(33).fill(1)));
});

test("unset visuals decode to null", () => {
  const zero = { head: 0n, face: 0n, eyes: 0n, body: 0n, outfit: 0n };
  assert.equal(decodeVisuals(zero), null);
});

test("presets survive the chain within one quantization step", () => {
  presets.forEach((_, i) => {
    const before = look(i);
    const colors = ARMOR_FINISHES[i % ARMOR_FINISHES.length].colors;
    const areas = encodeVisuals(before, colors);
    const packed = Object.fromEntries(
      AREAS.map((a) => [a, packArea(areas[a])]),
    ) as Record<(typeof AREAS)[number], bigint>;
    const decoded = decodeVisuals(packed);
    assert.ok(decoded);
    const after = decoded.appearance;

    for (const key of [
      "sex",
      "shape",
      "skin",
      "skinTint",
      "eyes",
      "hair",
      "hairColor",
      "brows",
      "browColor",
      "blushColor",
      "blushPlacement",
      "glasses",
      "glassesColor",
      "lensColor",
      "scar",
      "scarPlace",
      "tattoo",
      "tattooPlace",
      "tattooColor",
    ] as const)
      assert.equal(after[key], before[key], `${presets[i].name}.${key}`);
    for (const c of schema.controls)
      assert.ok(
        Math.abs(after.values[c.key] - before.values[c.key]) <= 1 / 127,
        `${presets[i].name}.${c.key}`,
      );
    assert.ok(Math.abs(after.shapeAmount - before.shapeAmount) <= 1 / 255);
    assert.ok(Math.abs(after.roughness - before.roughness) <= 0.55 / 255);
    assert.ok(Math.abs(after.browDensity - before.browDensity) <= 0.65 / 255);
    assert.deepEqual(decoded.armorColors, colors);

    // once quantized, a look is a fixed point: saving it again changes nothing
    assert.ok(sameVisuals(encodeVisuals(after, decoded.armorColors), areas));
  });
});

test("zero dials stay exactly zero", () => {
  const base = look(0);
  const areas = encodeVisuals(
    { ...base, values: {}, warmth: 0 },
    DEFAULT_ARMOR_COLORS,
  );
  const decoded = decodeVisuals(areas)!;
  assert.equal(decoded.appearance.warmth, 0);
  for (const c of schema.controls)
    assert.equal(decoded.appearance.values[c.key], 0);
});

test("random identities round-trip", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const sex of ["male", "female"] as const) {
    for (let n = 0; n < 10; n++) {
      const a = randomIdentity(schema, sex, random);
      const areas = encodeVisuals(a, DEFAULT_ARMOR_COLORS);
      const d = decodeVisuals(areas)!;
      assert.equal(d.appearance.sex, sex);
      assert.equal(d.appearance.glasses, a.glasses);
      assert.ok(sameVisuals(encodeVisuals(d.appearance, d.armorColors), areas));
    }
  }
});
