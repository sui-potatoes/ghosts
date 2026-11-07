// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The on-chain encoding of a recruit's looks: `ghosts::visuals::Visuals` in
 * the ghosts Move package holds five `u256` areas of 32 `u8` slots each,
 * slot 0 in the lowest byte. Move never reads the slots; this codec defines
 * them. `head[0]` is the codec version — `0` (all zero) means "unset".
 *
 * Every value takes one slot: option lists store their index, colors their
 * RGB bytes, `[-1, 1]` dials `round(v * 127) + 128` (zero stays exact) and
 * other ranges a 0–255 scale over their bounds. Lists and key orders below
 * are append-only: reordering them re-reads every recruit on chain.
 */

import { normalizeBody } from "../body.ts";
import { normalizeArmorColors } from "../armor-colors.ts";
import {
  BROWS,
  GLASSES,
  HAIR,
  SCARS,
  TATTOOS,
  normalize,
} from "./editor-state.js";
import { schema } from "./schema.ts";
import type { Appearance, ArmorColors } from "../types.ts";

export const VISUALS_VERSION = 1;

/** The `Visuals` areas, in struct order. */
export const AREAS = ["head", "face", "eyes", "body", "outfit"] as const;
export type Area = (typeof AREAS)[number];
export type VisualAreas = Record<Area, number[]>;

/** Slots per area: one `u256`. */
export const AREA_SLOTS = 32;

const SEXES = ["male", "female"];
const SHAPES = [
  "none",
  "oval",
  "round",
  "square",
  "triangular",
  "invertedtriangular",
  "diamond",
  "rectangular",
];
const SKINS = [
  "young_caucasian",
  "young_asian",
  "young_african",
  "middleage_caucasian",
  "middleage_asian",
  "middleage_african",
];
const IRISES = [
  "brown",
  "brownlight",
  "green",
  "bluegreen",
  "blue",
  "grey",
  "deepblue",
  "ice",
];
const BLUSH_PLACES = ["apples", "high"];
const SCAR_PLACES = ["cheekLeft", "cheekRight", "temple", "bridge"];
const TATTOO_PLACES = ["cheekLeft", "cheekRight", "temple", "forehead"];
const keys = (list: [string, string][]) => list.map(([key]) => key);

/** Contour, jaw and neck, nose, mouth and ears morphs. */
const FACE_KEYS = [
  "headWidth",
  "headLength",
  "headDepth",
  "faceFat",
  "cheekVolume",
  "cheekbone",
  "cheekHeight",
  "chinWidth",
  "chinHeight",
  "chinProjection",
  "jaw",
  "chinCleft",
  "neckWidth",
  "underChin",
  "noseWidth",
  "noseLength",
  "noseDepth",
  "noseBridge",
  "noseCurve",
  "noseTip",
  "noseAngle",
  "nostrils",
  "mouthWidth",
  "mouthHeight",
  "upperLip",
  "lowerLip",
  "cupidsBow",
  "mouthDepth",
  "earSize",
  "earAngle",
  "earLobe",
];
/** Eye morphs. */
const EYE_KEYS = [
  "eyeSpace",
  "eyeDepth",
  "eyeSize",
  "eyeHeight",
  "eyeTilt",
  "eyeOpen",
  "eyefold",
  "innerLid",
  "eyeInnerAngle",
  "eyeInnerOpen",
  "eyeOuterOpen",
  "eyeFoldAngle",
  "eyeFoldVolume",
  "eyeBag",
  "eyeBagHeight",
];
/** Brow, forehead morphs. */
const BROW_KEYS = [
  "browHeight",
  "browAngle",
  "browBone",
  "foreheadHeight",
  "foreheadSlope",
];
const BROW_DIALS = [
  "browThickness",
  "browLength",
  "browArch",
  "browTail",
] as const;
const BODY_KEYS = [
  "height",
  "build",
  "muscle",
  "chest",
  "waist",
  "hips",
] as const;

// === Slot coders ===

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0));

/** `[-1, 1]` → 1..255 with zero at exactly 128. */
const sym = (v: number) => Math.round(clamp(v, -1, 1) * 127) + 128;
const unsym = (b: number) => clamp((b - 128) / 127, -1, 1);

/** `[min, max]` → 0..255. */
const scale = (v: number, min: number, max: number) =>
  Math.round(((clamp(v, min, max) - min) / (max - min)) * 255);
const unscale = (b: number, min: number, max: number) =>
  min + (b / 255) * (max - min);

const index = (list: string[], value: string) =>
  Math.max(0, list.indexOf(value));
const pick = (list: string[], b: number) => list[b] ?? list[0];

const rgb = (hex: string) => {
  const n = /^#[\da-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

// === Codec ===

/** Encode a look into the five areas `ghosts::account::edit_recruit` takes. */
export function encodeVisuals(a: Appearance, armor: ArmorColors): VisualAreas {
  const body = normalizeBody(a.body);
  const colors = normalizeArmorColors(armor);
  const morph = (key: string) => sym(a.values[key] ?? 0);
  return {
    head: [
      VISUALS_VERSION,
      index(SHAPES, a.shape),
      scale(a.shapeAmount, 0, 1),
      index(SKINS, a.skin),
      ...rgb(a.skinTint),
      sym(a.warmth),
      scale(a.roughness, 0.45, 1),
      ...rgb(a.blushColor),
      scale(a.blushAmount, 0, 1),
      index(BLUSH_PLACES, a.blushPlacement),
      scale(a.blushSpread, 0, 1),
      index(keys(HAIR), a.hair),
      ...rgb(a.hairColor),
      index(keys(SCARS), a.scar),
      index(SCAR_PLACES, a.scarPlace),
      scale(a.scarAmount, 0, 1),
      index(keys(TATTOOS), a.tattoo),
      index(TATTOO_PLACES, a.tattooPlace),
      ...rgb(a.tattooColor),
      scale(a.tattooOpacity, 0, 1),
    ],
    face: FACE_KEYS.map(morph),
    eyes: [
      index(IRISES, a.eyes),
      ...EYE_KEYS.map(morph),
      index(keys(BROWS), a.brows),
      ...rgb(a.browColor),
      ...BROW_DIALS.map((key) => sym(a[key])),
      scale(a.browDensity, 0.35, 1),
      ...BROW_KEYS.map(morph),
    ],
    body: [index(SEXES, a.sex), ...BODY_KEYS.map((key) => sym(body[key]))],
    outfit: [
      ...rgb(colors.primary),
      ...rgb(colors.secondary),
      ...rgb(colors.accent),
      index(keys(GLASSES), a.glasses),
      ...rgb(a.glassesColor),
      ...rgb(a.lensColor),
      scale(a.lensTint, 0, 1),
    ],
  };
}

/**
 * Decode the areas back into a look. Null for unset visuals (version `0`) or
 * a codec version this client does not know.
 */
export function decodeVisuals(
  areas: Record<Area, bigint | string | number[]>,
): { appearance: Appearance; armorColors: ArmorColors } | null {
  const [h, f, e, b, o] = AREAS.map((area) => {
    const value = areas[area];
    return Array.isArray(value) ? value : unpackArea(value);
  });
  if (h[0] !== VISUALS_VERSION) return null;

  const values: Record<string, number> = {};
  FACE_KEYS.forEach((key, i) => (values[key] = unsym(f[i] ?? 128)));
  EYE_KEYS.forEach((key, i) => (values[key] = unsym(e[1 + i] ?? 128)));
  BROW_KEYS.forEach((key, i) => (values[key] = unsym(e[25 + i] ?? 128)));

  const appearance = normalize(
    {
      sex: pick(SEXES, b[0]),
      body: Object.fromEntries(
        BODY_KEYS.map((key, i) => [key, unsym(b[1 + i])]),
      ),
      shape: pick(SHAPES, h[1]),
      shapeAmount: unscale(h[2], 0, 1),
      skin: pick(SKINS, h[3]),
      skinTint: hex(h[4], h[5], h[6]),
      warmth: unsym(h[7]),
      roughness: unscale(h[8], 0.45, 1),
      blushColor: hex(h[9], h[10], h[11]),
      blushAmount: unscale(h[12], 0, 1),
      blushPlacement: pick(BLUSH_PLACES, h[13]),
      blushSpread: unscale(h[14], 0, 1),
      hair: pick(keys(HAIR), h[15]),
      hairColor: hex(h[16], h[17], h[18]),
      scar: pick(keys(SCARS), h[19]),
      scarPlace: pick(SCAR_PLACES, h[20]),
      scarAmount: unscale(h[21], 0, 1),
      tattoo: pick(keys(TATTOOS), h[22]),
      tattooPlace: pick(TATTOO_PLACES, h[23]),
      tattooColor: hex(h[24], h[25], h[26]),
      tattooOpacity: unscale(h[27], 0, 1),
      eyes: pick(IRISES, e[0]),
      brows: pick(keys(BROWS), e[16]),
      browColor: hex(e[17], e[18], e[19]),
      ...Object.fromEntries(
        BROW_DIALS.map((key, i) => [key, unsym(e[20 + i])]),
      ),
      browDensity: unscale(e[24], 0.35, 1),
      glasses: pick(keys(GLASSES), o[9]),
      glassesColor: hex(o[10], o[11], o[12]),
      lensColor: hex(o[13], o[14], o[15]),
      lensTint: unscale(o[16], 0, 1),
      values,
    },
    schema,
  );
  return {
    appearance,
    armorColors: normalizeArmorColors({
      primary: hex(o[0], o[1], o[2]),
      secondary: hex(o[3], o[4], o[5]),
      accent: hex(o[6], o[7], o[8]),
    }),
  };
}

/** Pack an area's slots into its `u256` (slot 0 in the lowest byte), as `bit_field::pack_u8` does. */
export function packArea(slots: number[]): bigint {
  if (slots.length > AREA_SLOTS)
    throw Error(`An area holds ${AREA_SLOTS} slots.`);
  return slots.reduce(
    (v, slot, i) => v | (BigInt(slot & 0xff) << BigInt(8 * i)),
    0n,
  );
}

/** Unpack an area's `u256` (a bigint or its decimal string) into its 32 slots. */
export function unpackArea(value: bigint | string): number[] {
  const v = BigInt(value);
  return Array.from({ length: AREA_SLOTS }, (_, i) =>
    Number((v >> BigInt(8 * i)) & 0xffn),
  );
}

/** Whether two looks encode to the same slots — what "unsaved changes" means on chain. */
export function sameVisuals(a: VisualAreas, b: VisualAreas): boolean {
  return AREAS.every((area) => packArea(a[area]) === packArea(b[area]));
}

/** The morph keys the codec stores, for coverage checks against the schema. */
export const ENCODED_MORPHS = [...FACE_KEYS, ...EYE_KEYS, ...BROW_KEYS];
