// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WeaponGeometry,
  weaponFinish,
  sizeWeapon,
  type WeaponFinish,
} from "./weapon-finish.ts";
import type { AttachmentSlot } from "../types.ts";

/** Every asset is authored around a shared mechanical interface, in metres. */
export function createWeaponAttachment(
  slot: AttachmentSlot,
  tier: 1 | 2 | 3,
  finish: WeaponFinish = weaponFinish("attachment"),
) {
  const g = new WeaponGeometry(),
    m = finish;
  if (slot === "clip") magazine(g, m, tier);
  if (slot === "stock") stock(g, m, tier);
  if (slot === "scope") scope(g, m, tier);
  if (slot === "laser") laser(g, m, tier);
  const root = g.finish(`${slot}-${tier}`, WEAPON_BASIS);
  if (slot === "laser")
    root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.scale(0.62, 0.62, 0.62);
    });
  root.userData.attachmentSlot = slot;
  root.userData.tier = tier;
  root.userData.interface = `ghosts:${slot}:v1`;
  return sizeWeapon(root);
}

export function createStandardFurniture(
  slot: "clip" | "stock",
  kind: "rifle" | "sniper" | "plasma",
  m: WeaponFinish,
) {
  const g = new WeaponGeometry();
  if (slot === "clip") magazine(g, m, 0, kind);
  else stock(g, m, 0, kind);
  return sizeWeapon(g.finish(`standard-${slot}`, WEAPON_BASIS));
}

function magazine(
  g: WeaponGeometry,
  m: WeaponFinish,
  tier: number,
  kind = "rifle",
) {
  const length = [0.068, 0.089, 0.105, 0.119][tier];
  const wide = tier === 3 ? 0.036 : 0.032;
  // Feed collar is identical on every magazine, including the plasma power-feed adapter.
  g.box([0, -0.006, 0], [0.052, 0.021, 0.032], m.metal);
  for (const z of [-0.017, 0.017])
    g.box([0, -0.009, z], [0.049, 0.004, 0.003], m.steel);
  g.profile(
    [
      [-0.025, -0.017],
      [0.026, -0.017],
      [0.027, -length * 0.55],
      [0.04, -length],
      [-0.015, -length - 0.009],
      [-0.027, -length * 0.6],
    ],
    wide,
    kind === "plasma" ? m.shell : m.metal,
    0,
    0.002,
  );
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = -0.015 + i * 0.016;
      g.profile(
        [
          [x, -0.027],
          [x + 0.004, -0.027],
          [x + 0.004, -length * 0.58],
          [x + 0.015, -length + 0.009],
          [x + 0.01, -length + 0.009],
          [x, -length * 0.58],
        ],
        0.002,
        m.rubber,
        side * (wide / 2 + 0.002),
        0.0004,
      );
    }
    if (tier >= 2) {
      // Witness window follows the same two-segment sweep as the stamped ribs.
      const sweep = (y: number) =>
        0.019 + (Math.max(0, -y - length * 0.58) / (length * 0.42)) * 0.011;
      const upper = -0.029,
        bend = -length * 0.58,
        lower = -length + 0.014;
      g.profile(
        [
          [sweep(upper) - 0.004, upper],
          [sweep(upper) + 0.004, upper],
          [sweep(bend) + 0.004, bend],
          [sweep(lower) + 0.004, lower],
          [sweep(lower) - 0.004, lower],
          [sweep(bend) - 0.004, bend],
        ],
        0.0015,
        m.rubber,
        side * (wide / 2 + 0.003),
        0.0004,
      );
      for (let i = 0; i < tier + 2; i++) {
        const y = upper - 0.006 + ((lower - upper + 0.012) * i) / (tier + 1);
        g.box(
          [sweep(y), y, side * (wide / 2 + 0.004)],
          [0.0035, 0.004, 0.001],
          m.accent,
          new T.Euler(0, 0, y < bend ? Math.atan(0.011 / (length * 0.42)) : 0),
        );
      }
    }
    for (let i = 0; i < Math.max(1, tier); i++)
      g.box(
        [-0.013 + i * 0.009, -0.022, side * (wide / 2 + 0.003)],
        [0.004, 0.004, 0.001],
        m.marking,
      );
  }
  g.box(
    [0.011, -length - 0.007, 0],
    [0.065, 0.013, wide + 0.009],
    tier === 3 ? m.shell : m.rubber,
    new T.Euler(0, 0, 0.12),
  );
  if (tier >= 1) {
    // Exposed extension seam and a compact flared pull shoe identify capacity tiers.
    for (const side of [-1, 1]) {
      g.profile(
        [
          [0.0, -length + 0.013],
          [0.039, -length + 0.006],
          [0.039, -length - 0.001],
          [0.0, -length + 0.006],
        ],
        0.002,
        tier === 3 ? m.accent : m.shell,
        side * (wide / 2 + 0.002),
        0.0005,
      );
    }
  }
}

function stock(
  g: WeaponGeometry,
  m: WeaponFinish,
  tier: number,
  kind = "rifle",
) {
  const end = -0.15;
  g.cylinder([-0.05, 0, 0], 0.013, 0.105, m.metal, "x", 0.013, 24);
  g.cylinder([-0.007, 0, 0], 0.018, 0.014, m.steel, "x", 0.018, 24);
  for (let i = 0; i < 4; i++)
    g.ring([-0.017 - i * 0.005, 0, 0], 0.013, 0.001, m.metal);
  const precision = tier === 3 || kind === "sniper";
  g.profile(
    [
      [end, 0.023],
      [-0.055, 0.022],
      [-0.036, 0.002],
      [-0.048, -0.017],
      [end + 0.021, -0.071],
      [end, -0.073],
    ],
    0.036,
    m.shell,
    0,
    0.0025,
    [
      [
        [end + 0.027, -0.039],
        [-0.071, -0.014],
        [-0.061, 0.002],
        [end + 0.027, 0.002],
      ],
    ],
  );
  g.box([end - 0.005, -0.023, 0], [0.013, 0.111, 0.044], m.rubber);
  for (let i = 0; i < 10; i++)
    g.box([end - 0.013, -0.069 + i * 0.01, 0], [0.003, 0.003, 0.043], m.metal);
  g.box(
    [end / 2 - 0.022, 0.021, 0],
    [0.087, precision ? 0.016 : 0.014, 0.041],
    m.rubber,
  );
  for (const side of [-1, 1]) {
    g.screw(end + 0.022, -0.006, side * 0.021, m, 0.004);
    g.ring([end + 0.027, -0.052, side * 0.02], 0.007, 0.002, m.steel, "z");
    if (tier >= 2 || precision) {
      for (const x of [end + 0.024, -0.071]) {
        g.cylinder([x, 0.018, side * 0.016], 0.003, 0.023, m.steel, "y");
        g.screw(x, 0.011, side * 0.024, m, 0.005);
      }
      g.box(
        [end + 0.025, -0.023, side * 0.023],
        [0.031, 0.005, 0.004],
        m.accent,
      );
    }
  }
  if (tier === 1) g.box([-0.079, -0.025, 0], [0.03, 0.009, 0.025], m.metal);
  if (tier === 3) {
    g.cylinder([end + 0.025, -0.068, 0], 0.006, 0.034, m.steel, "y");
    g.box([end + 0.025, -0.087, 0], [0.025, 0.009, 0.028], m.rubber);
  }
}

function scope(g: WeaponGeometry, m: WeaponFinish, tier: number) {
  if (tier === 1) {
    microReflex(g, m);
    return;
  }
  const y = 0.04;
  g.box([0, 0.006, 0], [0.112, 0.012, 0.04], m.metal);
  for (const x of [-0.021, 0.021]) {
    g.box([x, 0.004, -0.024], [0.017, 0.012, 0.009], m.shell);
    g.screw(x, 0.004, -0.03, m, 0.004);
  }
  {
    const length = tier === 2 ? 0.14 : 0.23;
    const front = length / 2;
    for (const x of [-0.035, 0.034]) {
      g.box([x, 0.018, 0], [0.019, 0.022, 0.025], m.metal);
      g.ring([x, y, 0], 0.018, 0.004, m.shell);
      for (const side of [-1, 1]) g.screw(x, y + 0.011, side * 0.022, m);
    }
    g.cylinder([0, y, 0], 0.016, length, m.metal, "x", 0.016, 32);
    g.cylinder([-front + 0.006, y, 0], 0.022, 0.043, m.rubber, "x", 0.022, 32);
    g.cylinder([front - 0.009, y, 0], 0.017, 0.04, m.shell, "x", 0.028, 32);
    g.cylinder([front + 0.02, y, 0], 0.028, 0.026, m.metal, "x", 0.028, 32);
    for (const [x, radius] of [
      [-front - 0.016, 0.018],
      [front + 0.034, 0.024],
    ]) {
      g.cylinder([x, y, 0], radius, 0.001, m.glass, "x", radius, 32);
      g.ring(
        [x + (x > 0 ? 0.002 : -0.002), y, 0],
        radius + 0.002,
        0.002,
        m.shell,
      );
    }
    for (let i = 0; i < 7; i++)
      g.ring([-front + 0.027 + i * 0.003, y, 0], 0.018, 0.0012, m.rubber);
    g.cylinder([0, y + 0.023, 0], 0.014, 0.02, m.shell, "y", 0.014, 24);
    g.cylinder([0, y, 0.023], 0.012, 0.018, m.shell, "z", 0.012, 24);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      g.box(
        [Math.cos(a) * 0.013, y + 0.033, Math.sin(a) * 0.013],
        [0.002, 0.003, 0.002],
        m.steel,
      );
    }
    if (tier === 3) {
      g.box([0.043, y + 0.025, 0], [0.031, 0.018, 0.025], m.shell);
      g.box([0.026, y + 0.026, 0], [0.001, 0.01, 0.016], m.glass);
      g.box([0.043, y + 0.035, 0], [0.018, 0.002, 0.013], m.light);
    }
  }
}

/** Low reflex optic: the window and its protective hood face along the bore. */
function microReflex(g: WeaponGeometry, m: WeaponFinish) {
  g.box([0, 0.004, 0], [0.043, 0.008, 0.029], m.metal);
  g.box([-0.003, 0.01, 0], [0.036, 0.006, 0.027], m.shell);
  g.box([0, 0.003, -0.017], [0.028, 0.006, 0.006], m.metal);
  for (const x of [-0.009, 0.009]) g.screw(x, 0.003, -0.021, m, 0.0023);
  // Thin chamfered hood, extruded along X, with a real optical aperture.
  const outer = [
    [-0.017, 0.012],
    [-0.017, 0.033],
    [-0.01, 0.041],
    [0.01, 0.041],
    [0.017, 0.033],
    [0.017, 0.012],
  ];
  const inner = [
    [-0.012, 0.015],
    [-0.012, 0.031],
    [-0.008, 0.036],
    [0.008, 0.036],
    [0.012, 0.031],
    [0.012, 0.015],
  ];
  const shape = new T.Shape(outer.map(([z, y]) => new T.Vector2(z, y)));
  shape.holes.push(new T.Path(inner.map(([z, y]) => new T.Vector2(z, y))));
  const hood = new T.ExtrudeGeometry(shape, {
    depth: 0.007,
    bevelEnabled: true,
    bevelSize: 0.0007,
    bevelThickness: 0.0007,
    bevelSegments: 2,
    steps: 1,
  });
  g.add(hood, m.shell, [0.014, 0, 0], new T.Euler(0, Math.PI / 2, 0));
  g.box(
    [0.015, 0.025, 0],
    [0.001, 0.02, 0.023],
    m.glass,
    new T.Euler(0, 0, -0.12),
  );
  // Recessed rear emitter, small battery drawer, and windage indexing.
  g.box([-0.015, 0.014, 0], [0.009, 0.005, 0.009], m.rubber);
  g.box([-0.0095, 0.014, 0], [0.001, 0.002, 0.002], m.light);
  g.box([-0.004, 0.011, 0.015], [0.021, 0.006, 0.003], m.metal);
  g.screw(-0.008, 0.012, 0.017, m, 0.0021);
  g.cylinder([0.018, 0.021, -0.018], 0.0035, 0.003, m.metal, "z", 0.0035, 24);
  g.box([0.018, 0.021, -0.0197], [0.004, 0.0007, 0.0004], m.steel);
  for (const x of [-0.004, 0, 0.004])
    g.box([x, 0.014, 0.0168], [0.001, 0.001, 0.0005], m.marking);
}

function laser(g: WeaponGeometry, m: WeaponFinish, tier: number) {
  const length = [0, 0.054, 0.072, 0.087][tier];
  g.box([0, 0, 0], [0.046, 0.023, 0.007], m.metal);
  g.box([0, 0.005, 0.017], [length, 0.031, 0.028], m.shell);
  g.box([-0.006, 0.022, 0.017], [length * 0.65, 0.006, 0.021], m.rubber);
  for (const [y, r] of [
    [0.011, 0.007],
    [-0.003, 0.005],
  ]) {
    if (tier === 1 && y < 0) continue;
    g.cylinder(
      [length / 2 + 0.002, y, 0.019],
      r + 0.002,
      0.008,
      m.metal,
      "x",
      r + 0.002,
      24,
    );
    g.cylinder([length / 2 + 0.0065, y, 0.019], r, 0.001, m.glass, "x", r, 24);
    g.cylinder([length / 2 + 0.007, y, 0.019], r * 0.35, 0.001, m.light);
  }
  for (const x of [-length * 0.3, length * 0.3]) g.screw(x, 0.004, 0.033, m);
  g.cylinder([-length / 2 - 0.002, 0.004, 0.02], 0.008, 0.01, m.rubber);
  if (tier === 3)
    for (let i = 0; i < 5; i++)
      g.box(
        [-0.026 + i * 0.009, -0.012, 0.018],
        [0.003, 0.006, 0.025],
        m.metal,
      );
  for (let i = 0; i < tier; i++)
    g.box([-0.012 + i * 0.008, 0.014, 0.033], [0.004, 0.003, 0.001], m.accent);
}
