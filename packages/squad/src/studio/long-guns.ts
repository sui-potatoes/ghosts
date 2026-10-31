// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WeaponGeometry,
  weaponFinish,
  sizeWeapon,
  WEAPON_SCALE,
  type WeaponFinish,
} from "./weapon-finish.ts";
import {
  createStandardFurniture,
  createWeaponAttachment,
} from "./weapon-attachments.ts";
import { ATTACHMENT_SLOTS, attachmentById } from "../catalog.ts";
import type { AttachmentSlot, WeaponAttachments } from "../types.ts";

export type LongGunKind = "rifle" | "sniper" | "plasma";
export const LONG_GUN_GRIP = [0, -0.114, 0.045] as const;
export const BORE_HEIGHT = 0.046;
export const PRECISION_OPTIC_HEIGHT = 0.132;
export const WEAPON_MOUNTS: Record<AttachmentSlot, [number, number, number]> = {
  clip: [0.018, -0.023, 0],
  stock: [-0.19, 0.044, 0],
  scope: [-0.015, 0.092, 0],
  laser: [0.255, 0.058, 0.023],
};

/** Three independently authored receivers on a common grip and modular mounting standard.
 * Source geometry is also exported to UV-unwrapped GLBs by scripts/weapons/build.py. */
export function createLongGun(
  kind: LongGunKind,
  attachments: WeaponAttachments = {},
) {
  const m = weaponFinish(kind),
    g = new WeaponGeometry();
  grip(g, m);
  if (kind === "rifle") serviceReceiver(g, m);
  if (kind === "sniper") precisionReceiver(g, m);
  if (kind === "plasma") plasmaReceiver(g, m);
  const root = g.finish(
    {
      rifle: "StandardRifle",
      sniper: "SharpshooterRifle",
      plasma: "PlasmaRifle",
    }[kind],
    WEAPON_BASIS,
  );
  sizeWeapon(root, new T.Vector3(...LONG_GUN_GRIP));
  root.userData.model = kind;
  root.userData.assetVersion = 3;
  root.userData.muzzle = sizedWeaponPoint(
    new T.Vector3(
      0,
      { rifle: 0.369, sniper: 0.59, plasma: 0.405 }[kind],
      -BORE_HEIGHT,
    ),
  ).toArray();
  root.userData.textureWorkflow =
    "Per-material UV0 atlas; metre scale; rigid hand socket; no deforming skin";
  for (const slot of ATTACHMENT_SLOTS) {
    const socket = new T.Group();
    socket.name = `mount_${slot}`;
    socket.position.fromArray(WEAPON_MOUNTS[slot]).applyMatrix4(WEAPON_BASIS);
    if (kind === "plasma" && slot === "laser")
      socket.position.set(0.27, 0.058, 0.052).applyMatrix4(WEAPON_BASIS);
    sizedWeaponPoint(socket.position);
    socket.userData.interface = `ghosts:${slot}:v1`;
    root.add(socket);
    const fitting = attachmentById(attachments[slot]);
    if (fitting?.slot === slot)
      socket.add(createWeaponAttachment(slot, fitting.tier));
    else if (slot === "clip" || slot === "stock")
      socket.add(createStandardFurniture(slot, kind, m));
  }
  return root;
}

/** Donor coordinates, scaled around the invariant trigger-hand contact. */
export function sizedWeaponPoint(point: T.Vector3) {
  const grip = new T.Vector3(...LONG_GUN_GRIP);
  return point.sub(grip).multiplyScalar(WEAPON_SCALE).add(grip);
}

function grip(g: WeaponGeometry, m: WeaponFinish) {
  // The grip is the invariant: authored around the existing trigger-hand animation socket.
  g.profile(
    [
      [-0.131, -0.009],
      [-0.11, -0.015],
      [-0.123, -0.097],
      [-0.147, -0.1],
      [-0.154, -0.09],
    ],
    0.016,
    m.rubber,
    0.0095,
    0.001,
  );
  g.profile(
    [
      [-0.07, -0.009],
      [-0.036, -0.009],
      [-0.027, -0.022],
      [-0.036, -0.052],
      [-0.07, -0.052],
      [-0.075, -0.04],
    ],
    0.015,
    m.metal,
    0,
    0.0015,
    [
      [
        [-0.064, -0.018],
        [-0.044, -0.018],
        [-0.038, -0.025],
        [-0.044, -0.041],
        [-0.065, -0.041],
      ],
    ],
  );
  g.profile(
    [
      [-0.066, -0.012],
      [-0.06, -0.014],
      [-0.057, -0.029],
      [-0.066, -0.037],
      [-0.071, -0.033],
      [-0.065, -0.026],
    ],
    0.006,
    m.steel,
    0,
    0.0007,
  );
  for (const side of [-1, 1]) {
    g.profile(
      [
        [-0.139, -0.031],
        [-0.119, -0.033],
        [-0.129, -0.085],
        [-0.146, -0.089],
      ],
      0.002,
      m.metal,
      side * 0.0085 + 0.009,
      0.001,
    );
    for (let i = 0; i < 8; i++)
      g.box(
        [-0.133 - i * 0.0015, -0.038 - i * 0.007, side * 0.009 + 0.009],
        [0.016, 0.0013, 0.001],
        m.rubber,
      );
    g.screw(-0.14, -0.084, side * 0.009 + 0.01, m);
  }
  // Universal magazine well and its visible retention latch.
  g.profile(
    [
      [-0.018, 0.007],
      [0.053, 0.007],
      [0.051, -0.026],
      [0.044, -0.033],
      [-0.016, -0.033],
    ],
    0.047,
    m.metal,
    0,
    0.002,
  );
  for (const side of [-1, 1]) {
    g.box([0.036, -0.011, side * 0.027], [0.018, 0.008, 0.004], m.shell);
    g.cylinder(
      [-0.12, 0.005, side * 0.025],
      0.007,
      0.004,
      m.steel,
      "z",
      0.007,
      24,
    );
    g.box(
      [-0.111, 0.007, side * 0.028],
      [0.021, 0.004, 0.003],
      m.metal,
      new T.Euler(0, 0, 0.3),
    );
    for (const x of [-0.132, -0.113])
      g.box([x, 0.017, side * 0.026], [0.004, 0.002, 0.001], m.marking);
  }
}

function serviceReceiver(g: WeaponGeometry, m: WeaponFinish) {
  // Ochre monolithic upper, dark forged lower, short open handguard and stepped brake.
  g.profile(
    [
      [-0.19, 0.015],
      [-0.19, 0.063],
      [-0.172, 0.078],
      [0.056, 0.078],
      [0.065, 0.06],
      [0.065, 0.018],
      [0.052, 0.02],
    ],
    0.045,
    m.shell,
    0,
    0.0025,
  );
  // Hollow fore-end, real angled ports, and a steel gas system visible behind them.
  g.cylinder([0.16, BORE_HEIGHT, 0], 0.01, 0.21, m.metal, "x", 0.01, 32);
  g.cylinder([0.159, 0.065, 0], 0.0035, 0.205, m.steel, "x", 0.0035, 16);
  for (const side of [-1, 1]) {
    const holes: number[][][] = [];
    for (let i = 0; i < 5; i++) {
      const x = 0.078 + i * 0.031;
      holes.push([
        [x - 0.009, 0.034],
        [x + 0.008, 0.034],
        [x + 0.013, 0.054],
        [x - 0.004, 0.054],
      ]);
    }
    g.profile(
      [
        [0.059, 0.012],
        [0.233, 0.012],
        [0.251, 0.025],
        [0.251, 0.06],
        [0.229, 0.078],
        [0.059, 0.078],
      ],
      0.005,
      m.shell,
      side * 0.0175,
      0.0018,
      holes,
    );
    g.box([0.15, 0.068, side * 0.025], [0.165, 0.004, 0.002], m.metal);
    // Replaceable lower rail insert, counterbored retention bolts, and numbered rail teeth.
    g.box([0.143, 0.018, side * 0.021], [0.14, 0.011, 0.004], m.metal);
    for (let i = 0; i < 9; i++)
      g.box(
        [0.089 + i * 0.013, 0.018, side * 0.024],
        [0.008, 0.014, 0.003],
        m.rubber,
      );
    for (const x of [0.078, 0.208]) g.screw(x, 0.018, side * 0.026, m);
    g.profile(
      [
        [-0.183, 0.025],
        [-0.032, 0.025],
        [-0.043, 0.032],
        [-0.177, 0.032],
      ],
      0.002,
      m.metal,
      side * 0.026,
      0.0007,
    );
  }
  g.profile(
    [
      [-0.185, 0.018],
      [0.047, 0.018],
      [0.044, -0.01],
      [-0.027, -0.015],
      [-0.098, 0.01],
      [-0.17, 0.012],
    ],
    0.042,
    m.metal,
    0,
    0.002,
  );
  for (const side of [-1, 1]) {
    const z = side * 0.026;
    g.box([-0.071, 0.022, z], [0.214, 0.0013, 0.001], m.rubber);
    g.box([-0.085, 0.05, z], [0.086, 0.019, 0.002], m.rubber);
    g.box([-0.08, 0.051, z + side * 0.0015], [0.066, 0.012, 0.001], m.steel);
    g.box([-0.047, 0.051, z + side * 0.003], [0.009, 0.015, 0.003], m.metal);
    g.box([-0.124, 0.042, z + side * 0.003], [0.007, 0.023, 0.006], m.shell);
    for (const x of [-0.167, -0.025, 0.051, 0.229]) g.screw(x, 0.03, z, m);
    g.box([0.008, 0.045, z], [0.064, 0.023, 0.0015], m.metal);
    g.box([0.013, 0.046, z + side * 0.001], [0.052, 0.014, 0.001], m.shell);
    g.box([-0.155, 0.057, z + side * 0.001], [0.024, 0.009, 0.001], m.metal);
    for (let i = 0; i < 3; i++)
      g.box(
        [-0.162 + i * 0.006, 0.057, z + side * 0.002],
        [0.002, 0.005, 0.001],
        m.marking,
      );
    g.box([-0.175, 0.067, side * 0.032], [0.023, 0.009, 0.014], m.metal);
  }
  g.box([0.16, 0.004, 0], [0.177, 0.012, 0.039], m.rubber);
  for (let i = 0; i < 12; i++)
    g.box([0.083 + i * 0.013, -0.003, 0], [0.005, 0.004, 0.041], m.metal);
  barrel(g, m, 0.25, 0.369, 0.012, false);
  g.rail(-0.178, 0.244, 0.083, m);
  ironSights(g, m, -0.156, 0.222);
}

function precisionReceiver(g: WeaponGeometry, m: WeaponFinish) {
  // Slender titanium action on a machined teal chassis; long free-floating ventilated fore-end.
  g.cylinder([-0.066, 0.047, 0], 0.026, 0.25, m.metal, "x", 0.026, 32);
  g.profile(
    [
      [-0.19, 0.023],
      [-0.171, 0.039],
      [0.055, 0.039],
      [0.071, 0.017],
      [0.038, -0.014],
      [-0.03, -0.017],
      [-0.1, 0.01],
      [-0.167, 0.012],
    ],
    0.046,
    m.shell,
    0,
    0.002,
  );
  for (const side of [-1, 1]) {
    g.profile(
      [
        [-0.177, 0.021],
        [-0.037, 0.021],
        [-0.049, 0.006],
        [-0.163, 0.006],
      ],
      0.002,
      m.metal,
      side * 0.025,
      0.001,
    );
    for (const x of [-0.166, -0.068, 0.032])
      g.screw(x, 0.015, side * 0.028, m, 0.0035);
    g.box([-0.067, 0.05, side * 0.026], [0.091, 0.014, 0.002], m.rubber);
    g.box([-0.06, 0.05, side * 0.028], [0.066, 0.011, 0.002], m.steel);
    for (let i = 0; i < 6; i++)
      g.box(
        [-0.085 + i * 0.008, 0.05, side * 0.03],
        [0.001, 0.011, 0.001],
        m.metal,
      );
  }
  // Prominent bolt shroud, swept handle, ribbed knob, and recoil lug.
  g.cylinder([-0.183, 0.047, 0], 0.022, 0.028, m.steel, "x", 0.022, 32);
  g.cylinder([-0.155, 0.037, -0.043], 0.005, 0.044, m.steel, "z", 0.005, 16);
  g.cylinder([-0.155, 0.037, -0.068], 0.011, 0.026, m.metal, "z", 0.009, 24);
  for (let i = 0; i < 5; i++)
    g.ring([-0.155, 0.037, -0.059 - i * 0.004], 0.0105, 0.001, m.rubber, "z");
  g.cylinder([0.059, BORE_HEIGHT, 0], 0.029, 0.027, m.steel, "x", 0.029, 32);
  g.cylinder([0.3, BORE_HEIGHT, 0], 0.013, 0.48, m.metal, "x", 0.011, 32);
  for (const side of [-1, 1]) {
    const holes: number[][][] = [];
    for (let x = 0.1; x < 0.32; x += 0.043)
      holes.push([
        [x, 0.028],
        [x + 0.024, 0.028],
        [x + 0.029, 0.043],
        [x + 0.005, 0.054],
        [x - 0.004, 0.045],
      ]);
    g.profile(
      [
        [0.073, 0.007],
        [0.324, 0.007],
        [0.348, 0.026],
        [0.341, 0.07],
        [0.078, 0.074],
      ],
      0.005,
      m.shell,
      side * 0.0175,
      0.0015,
      holes,
    );
    for (const x of [0.085, 0.329]) g.screw(x, 0.018, side * 0.023, m);
    // Folded bipod, deliberately forward of the support hand.
    g.cylinder([0.281, -0.014, side * 0.032], 0.005, 0.11, m.metal);
    g.cylinder([0.33, -0.014, side * 0.032], 0.009, 0.025, m.rubber);
    g.screw(0.222, 0.003, side * 0.032, m, 0.006);
  }
  g.box([0.205, 0.008, 0], [0.267, 0.009, 0.036], m.metal);
  g.rail(-0.17, 0.335, 0.083, m);
  barrel(g, m, 0.347, 0.59, 0.013, true);
  ironSights(g, m, -0.145, 0.317);
}

function plasmaReceiver(g: WeaponGeometry, m: WeaponFinish) {
  // Ceramic split shell, copper induction spine, twin side capacitors and a floating muzzle cage.
  g.profile(
    [
      [-0.19, 0.016],
      [-0.192, 0.058],
      [-0.158, 0.079],
      [-0.048, 0.079],
      [-0.025, 0.064],
      [0.06, 0.064],
      [0.076, 0.036],
      [0.049, 0.004],
      [-0.041, 0.008],
      [-0.17, 0.012],
    ],
    0.054,
    m.metal,
    0,
    0.003,
  );
  for (const side of [-1, 1]) {
    const z = side * 0.031;
    g.profile(
      [
        [-0.18, 0.027],
        [-0.174, 0.06],
        [-0.149, 0.071],
        [-0.055, 0.071],
        [-0.035, 0.052],
        [-0.055, 0.026],
        [-0.12, 0.018],
      ],
      0.006,
      m.shell,
      z,
      0.002,
    );
    g.profile(
      [
        [-0.019, 0.023],
        [0.055, 0.025],
        [0.064, 0.05],
        [0.042, 0.061],
        [-0.014, 0.059],
      ],
      0.005,
      m.shell,
      z,
      0.002,
    );
    g.box([-0.099, 0.048, z + side * 0.005], [0.055, 0.014, 0.001], m.rubber);
    for (let i = 0; i < 5; i++)
      g.box(
        [-0.119 + i * 0.01, 0.048, z + side * 0.006],
        [0.005, 0.009, 0.001],
        m.light,
      );
    for (const x of [-0.161, -0.05, 0.039])
      g.screw(x, 0.031, z + side * 0.006, m);
    g.cylinder(
      [0.25, 0.052, side * 0.027],
      0.011,
      0.135,
      m.metal,
      "x",
      0.011,
      24,
    );
    for (let i = 0; i < 7; i++) {
      const x = 0.181 + i * 0.021;
      g.ring([x, 0.052, side * 0.027], 0.013, 0.003, m.accent);
      g.ring([x + 0.009, 0.052, side * 0.027], 0.0115, 0.001, m.light);
    }
    // Slotted protective ceramic shrouds leave the coils legible through the side windows.
    const holes: number[][][] = [];
    for (let i = 0; i < 2; i++) {
      const x = 0.184 + i * 0.068;
      holes.push([
        [x, 0.035],
        [x + 0.046, 0.035],
        [x + 0.055, 0.059],
        [x + 0.009, 0.068],
      ]);
    }
    g.profile(
      [
        [0.164, 0.021],
        [0.327, 0.021],
        [0.349, 0.044],
        [0.326, 0.081],
        [0.164, 0.081],
      ],
      0.005,
      m.shell,
      side * 0.046,
      0.0015,
      holes,
    );
    for (const x of [0.175, 0.327]) g.screw(x, 0.028, side * 0.05, m);
    g.box([0.25, 0.023, side * 0.049], [0.14, 0.003, 0.003], m.accent);
  }
  g.cylinder([0.224, BORE_HEIGHT, 0], 0.014, 0.32, m.steel, "x", 0.014, 32);
  g.box([0.17, 0.006, 0], [0.213, 0.017, 0.044], m.rubber);
  for (let i = 0; i < 10; i++)
    g.box([0.081 + i * 0.019, -0.005, 0], [0.009, 0.004, 0.041], m.metal);
  for (const x of [0.073, 0.333])
    g.cylinder([x, BORE_HEIGHT, 0], 0.029, 0.022, m.metal, "x", 0.029, 8);
  for (const x of [0.35, 0.376]) {
    g.ring([x, BORE_HEIGHT, 0], 0.022, 0.004, m.accent);
    g.ring([x + 0.007, BORE_HEIGHT, 0], 0.021, 0.002, m.light);
  }
  for (const side of [-1, 1])
    g.box([0.367, BORE_HEIGHT, side * 0.029], [0.072, 0.017, 0.008], m.shell);
  g.cylinder([0.397, BORE_HEIGHT, 0], 0.024, 0.016, m.metal, "x", 0.022, 12);
  g.cylinder([0.405, BORE_HEIGHT, 0], 0.014, 0.001, m.rubber, "x", 0.014, 32);
  g.ring([0.405, BORE_HEIGHT, 0], 0.017, 0.003, m.steel);
  g.rail(-0.172, 0.064, 0.083, m);
  g.rail(0.095, 0.322, 0.083, m);
  ironSights(g, m, -0.151, 0.305);
}

function barrel(
  g: WeaponGeometry,
  m: WeaponFinish,
  start: number,
  end: number,
  radius: number,
  precision: boolean,
) {
  g.cylinder(
    [(start + end) / 2, BORE_HEIGHT, 0],
    radius,
    end - start,
    m.steel,
    "x",
    radius * 0.85,
    32,
  );
  g.cylinder(
    [start + 0.009, BORE_HEIGHT, 0],
    radius + 0.004,
    0.019,
    m.metal,
    "x",
    radius + 0.004,
    24,
  );
  if (precision)
    for (let i = 0; i < 6; i++)
      g.ring(
        [start + 0.018 + i * 0.007, BORE_HEIGHT, 0],
        radius,
        0.001,
        m.metal,
      );
  const length = precision ? 0.06 : 0.041,
    r = precision ? 0.02 : 0.018;
  g.cylinder([end - length / 2, BORE_HEIGHT, 0], r, length, m.metal, "x", r, 8);
  for (const side of [-1, 1])
    for (let i = 0; i < 3; i++)
      g.box(
        [end - 0.009 - i * (length / 3.6), BORE_HEIGHT, side * r],
        [0.006, 0.017, 0.001],
        m.rubber,
      );
  g.cylinder(
    [end, BORE_HEIGHT, 0],
    r * 0.65,
    0.001,
    m.rubber,
    "x",
    r * 0.65,
    32,
  );
  g.ring([end, BORE_HEIGHT, 0], r * 0.82, r * 0.16, m.steel);
}

function ironSights(
  g: WeaponGeometry,
  m: WeaponFinish,
  back: number,
  front: number,
) {
  for (const x of [back, front]) {
    g.box([x, 0.097, 0], [0.019, 0.01, 0.031], m.metal);
    g.cylinder([x, 0.1, 0], 0.005, 0.035, m.steel, "z");
    for (const side of [-1, 1])
      g.box([x, 0.11, side * 0.009], [0.006, 0.023, 0.005], m.metal);
  }
  g.box([front, 0.11, 0], [0.003, 0.016, 0.003], m.steel);
  g.box([back, 0.111, 0], [0.004, 0.006, 0.022], m.metal);
}
