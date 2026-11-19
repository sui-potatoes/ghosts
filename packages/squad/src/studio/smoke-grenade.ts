// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { gearFinish } from "./gear-geometry.ts";
import { NECK, UV, lathe, stud } from "./frag-grenade.ts";
import { assembleGrenade, canLever } from "./grenade-family.ts";
import { WeaponGeometry, type WeaponFinish } from "./weapon-finish.ts";
import { familyFinish, isLow, seg, type Detail } from "./rifle-shapes.ts";

/**
 * Smoke Grenade: a tall drawn-steel can on the Frag Grenade's fuze
 * (`grenade-family.ts`). Flat ends with rolled beads, one fine seam round the
 * lower body, a broad pale band under the fuze, and four emission ports in
 * the lid around the fuze boss: the charge vents through them once the fuze
 * fires. The carry stud under the base is the frag's.
 *
 * About 64 mm across and 145 mm from stud to lever. Same frame as the frag:
 * +Y up the fuze axis, +X the lever side, +Z the ring side, metres; the
 * fuze stands where it does on the frag, so the can's origin is the frag's.
 */

/** Wall radius of the can. */
const R = 0.0318;
/** Bottom of the can (the stud's seat). */
const BOTTOM = -0.078;
/** The lid around the fuze boss. */
const LID = NECK - 0.0012;
/** The pale band: under the top bead, broad. */
const BAND: [number, number] = [0.0085, 0.0285];
/** The seam round the lower body. */
const SEAM = -0.044;

/** Points other code may want, in the grenade frame (as `FRAG_GRENADE_POINTS`). */
export const SMOKE_GRENADE_POINTS = {
  grip: [0, -0.012, 0] as [number, number, number],
  carry: [0, BOTTOM - 0.0031, 0] as [number, number, number],
};

/** Where a stencil pass puts its labels (as `FRAG_GRENADE_STENCILS`). */
export const SMOKE_GRENADE_STENCILS = [
  { text: "SMOKE", angle: 90, y: 0.0185, r: R, size: 0.0085, tone: "dark" },
  {
    text: "SMK / 9   WHITE",
    angle: 270,
    y: -0.012,
    r: R,
    size: 0.0036,
    tone: "light",
  },
] as const;

/** The family's slots, the can in matte grey-green and the band pale. */
export function smokeGrenadeFinish(base: WeaponFinish = familyFinish()) {
  return {
    ...base,
    shell: gearFinish("01_Cerakote", 0x343b33, 0.4, 0.5, 0.02),
    accent: gearFinish("05_Copper", 0x7f7b6f, 0.05, 0.75, 0.02),
  };
}

function can(g: WeaponGeometry, m: WeaponFinish) {
  const around = seg(56, 16);
  const bead = 0.0006;
  // Bottom plate, recessed inside the bottom bead; the stud stands on it.
  lathe(
    g,
    m.shell,
    [
      [BOTTOM + 0.0016, 0],
      [BOTTOM + 0.0016, 0.026],
      [BOTTOM + 0.0004, 0.0284],
      [BOTTOM, 0.0302],
      [BOTTOM + 0.0008, R + bead],
      [BOTTOM + 0.0026, R + bead],
      [BOTTOM + 0.0036, R],
      // The seam: a fine V round the lower body (baked at "low").
      ...(isLow()
        ? []
        : [
            [SEAM - 0.0009, R],
            [SEAM, R - 0.0008],
            [SEAM + 0.0009, R],
          ]),
      [BAND[0], R],
    ],
    around,
    [0, 0, 1, 0.3],
  );
  // Band: a painted ring, a hair proud so its edges catch the light.
  lathe(
    g,
    m.accent,
    [
      [BAND[0], R],
      [BAND[0] + 0.0002, R + 0.0002],
      [BAND[1] - 0.0002, R + 0.0002],
      [BAND[1], R],
    ],
    around,
    [0, 0.3, 1, 0.4],
  );
  // Top bead and the lid, stepping up to the boss the fuze screws into.
  lathe(
    g,
    m.shell,
    [
      [BAND[1], R],
      [LID - 0.0034, R],
      [LID - 0.0024, R + bead],
      [LID - 0.0004, R + bead],
      [LID + 0.0004, R - 0.0012],
      [LID - 0.0006, R - 0.0026],
      [LID - 0.0006, 0.0205],
      [NECK - 0.0002, 0.0178],
      [NECK, 0.0158],
      [NECK, 0.0141],
      [NECK, 0],
    ],
    around,
    [0, 0.4, 1, 0.56],
  );
}

/** Four emission ports in the lid, clear of the lever (+X) and the ring (+Z). */
function ports(g: WeaponGeometry, m: WeaponFinish) {
  if (isLow()) return;
  for (const deg of [45, 135, 225, 315]) {
    const a = T.MathUtils.degToRad(deg),
      at: [number, number, number] = [
        Math.cos(a) * 0.0248,
        LID - 0.0006,
        Math.sin(a) * 0.0248,
      ];
    // A pressed collar round the dark port.
    lathe(
      g,
      m.metal,
      [
        [-0.0002, 0.0038],
        [0.0005, 0.0037],
        [0.0009, 0.0032],
        [0.0009, 0.0025],
        [0.0004, 0.0023],
      ],
      16,
      UV.hardware,
      at,
    );
    lathe(
      g,
      m.rubber,
      [
        [0.0004, 0.0023],
        [0.0003, 0],
      ],
      16,
      UV.hardware,
      at,
    );
  }
}

/**
 * Builds the Smoke Grenade, with the frag's parts (`body`, `lever`, `pin`,
 * `keeper`) and details: "high" the authored model, "low" one baked material
 * with the ports left to the bake.
 */
export function createSmokeGrenade(
  options: { detail?: Detail; finish?: WeaponFinish } = {},
): T.Group {
  const detail = options.detail ?? "high";
  const m = options.finish ?? smokeGrenadeFinish();
  return assembleGrenade(
    "SmokeGrenade",
    detail,
    m,
    (g) => {
      can(g, m);
      ports(g, m);
      stud(g, m, BOTTOM + 0.0404);
    },
    canLever(R + 0.0006, LID, -0.034),
  );
}
