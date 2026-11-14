// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Weapon skins as recipes in the gun's own space. One recipe is applied to
 * every gun: offline to the baked atlas of the gun's body and standard clip
 * and stock (`app/scripts/weapon-skins`, which reads this file), and live to
 * the fittings beside it (`studio/skin-paint.ts`), so a scope or an upgraded
 * stock carries the same pattern, at the same scale and orientation, as the
 * receiver it sits on.
 *
 * Space: the Armory weapon frame, metres (+X muzzle, +Y up, +Z the shooter's
 * right, `WEAPON_SCALE` applied). Colours are sRGB.
 *
 * What a recipe paints: the shell (`01_Cerakote`) and frame (`02_Graphite`)
 * finishes, plus the rubber where `rubber` is set (baked body only; fittings'
 * pads keep theirs). Everything functional keeps the gun's factory finish:
 * steel, copper coils, optics glass, indicators, markings. Body-only extras
 * (AO grime, stencils, liveries) live in the bake.
 *
 * No three.js here; the numbers are mirrored exactly by the bake (numpy) and
 * the live shader (GLSL), so change both stages' code together with them.
 */

export interface SkinFinish {
  color: number;
  rough: number;
  metal: number;
}

/** A pattern over the painted finishes. Tones replace the paint's finish. */
export type SkinPattern =
  /** Two or three noise fields thresholded into 2–4 tones (camouflage). */
  | { kind: "blotch"; scale: number; tones: SkinFinish[] }
  /** The blotch fields sampled on a cubic grid: pixelated "digital" camo. */
  | { kind: "digital"; scale: number; cell: number; tones: SkinFinish[] }
  /** Angular shards: cells of three slanted plane families, hashed to tones. */
  | { kind: "splinter"; scale: number; tones: SkinFinish[] }
  /** A hard two-tone split along a plane: tones[1] where n·P > offset. */
  | {
      kind: "split";
      normal: [number, number, number];
      offset: number;
      tones: [SkinFinish, SkinFinish];
    };

export interface SkinRecipe {
  /** Paint on the shell finish. */
  shell: SkinFinish;
  /** Paint on the frame (graphite) finish. */
  frame: SkinFinish;
  pattern?: SkinPattern;
  /** Low-frequency tone variation across the paint (0 = flat). */
  mottle: number;
  /** Paint chipped off edges to the metal underneath. */
  wear?: { amount: number; color: number; rough: number; metal: number };
  /** Also paint the gun's rubber (baked body only). */
  rubber?: boolean;
  /** Stencil and marking ink. */
  ink: number;
  /** Grime in crevices (baked from AO; the body only). */
  dirt: number;
  /** Body-only marking set beyond the receiver stencil. */
  livery?: "hardtest";
}

const f = (color: number, rough: number, metal: number): SkinFinish => ({
  color,
  rough,
  metal,
});

export const SKIN_RECIPES: Record<string, SkinRecipe> = {
  // Lifted gunmetal with the receiver stencil and light edge wear.
  standard: {
    shell: f(0x474d52, 0.44, 0.32),
    frame: f(0x394045, 0.38, 0.6),
    mottle: 0.08,
    wear: { amount: 0.55, color: 0x7b8287, rough: 0.3, metal: 0.85 },
    ink: 0xd7dfd9,
    dirt: 0.25,
  },
  // Four-tone temperate blotches.
  camo: {
    shell: f(0x565a43, 0.62, 0.1),
    frame: f(0x565a43, 0.62, 0.1),
    pattern: {
      kind: "blotch",
      scale: 0.045,
      tones: [
        f(0x565a43, 0.62, 0.1),
        f(0x7f795f, 0.62, 0.1),
        f(0x2a2c25, 0.64, 0.1),
        f(0x66706c, 0.6, 0.1),
      ],
    },
    mottle: 0.06,
    wear: { amount: 0.35, color: 0x9a9a8c, rough: 0.4, metal: 0.5 },
    ink: 0x1d1f1b,
    dirt: 0.3,
  },
  // Bone and safety orange split on the diagonal, stripes and roundels.
  hardtest: {
    shell: f(0xd9d4c7, 0.45, 0.05),
    frame: f(0xd9d4c7, 0.45, 0.05),
    pattern: {
      kind: "split",
      normal: [0.785, 0.62, 0],
      offset: 0.005,
      tones: [f(0xc8551e, 0.45, 0.05), f(0xd9d4c7, 0.45, 0.05)],
    },
    mottle: 0.04,
    rubber: true,
    ink: 0x111316,
    dirt: 0.2,
    livery: "hardtest",
  },
  // Sand over coyote brown in broad, soft-edged fields.
  desert: {
    shell: f(0xc2a878, 0.68, 0.05),
    frame: f(0xc2a878, 0.68, 0.05),
    pattern: {
      kind: "blotch",
      scale: 0.06,
      tones: [f(0xc2a878, 0.68, 0.05), f(0x7a5f40, 0.7, 0.05)],
    },
    mottle: 0.07,
    wear: { amount: 0.45, color: 0x55575a, rough: 0.35, metal: 0.8 },
    ink: 0x3a3024,
    dirt: 0.35,
  },
  // Pixelated city greys.
  urban: {
    shell: f(0x868b8f, 0.6, 0.1),
    frame: f(0x868b8f, 0.6, 0.1),
    pattern: {
      kind: "digital",
      scale: 0.035,
      cell: 0.0055,
      tones: [
        f(0x868b8f, 0.6, 0.1),
        f(0xb3b7b9, 0.6, 0.08),
        f(0x2c3135, 0.62, 0.12),
        f(0x5a6065, 0.6, 0.1),
      ],
    },
    mottle: 0.03,
    wear: { amount: 0.25, color: 0x9ea4a8, rough: 0.35, metal: 0.8 },
    ink: 0x1a1d20,
    dirt: 0.3,
  },
  // Satin white with pale blue-grey shards.
  arctic: {
    shell: f(0xe3e6e5, 0.5, 0.04),
    frame: f(0xe3e6e5, 0.5, 0.04),
    pattern: {
      kind: "splinter",
      scale: 0.05,
      tones: [
        f(0xdfe3e2, 0.5, 0.04),
        f(0xa3adb3, 0.52, 0.04),
        f(0x66727a, 0.55, 0.05),
      ],
    },
    mottle: 0.03,
    wear: { amount: 0.3, color: 0x5d6569, rough: 0.35, metal: 0.8 },
    ink: 0x2a3035,
    dirt: 0.2,
  },
  // Grey-green phosphate worn through to bright steel on every edge.
  worn: {
    shell: f(0x6a7164, 0.7, 0.35),
    frame: f(0x5b6257, 0.68, 0.4),
    mottle: 0.16,
    wear: { amount: 1, color: 0xb9bec1, rough: 0.22, metal: 0.95 },
    ink: 0xc9cfc8,
    dirt: 0.45,
  },
};
