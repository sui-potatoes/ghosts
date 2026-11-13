// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WeaponGeometry,
  sizeWeapon,
  type WeaponFinish,
} from "./weapon-finish.ts";
import {
  X,
  Y,
  Z,
  band,
  breech,
  fillet,
  inAuthoringFrame,
  latheAlong,
  pistolGrip,
  plate,
  prism,
  shell,
  slab,
  smooth,
  superRing,
  toWeaponFrame,
  upperSection,
} from "./rifle-shapes.ts";
import type { AttachmentSlot } from "../types.ts";

/** Generic large-frame 18-inch designated-marksman rifle, the service carbine's
 * bigger sibling. Same authoring frame (metres, +X muzzle, +Y up, +Z the
 * shooter's left; see rifle-shapes.ts),
 * same bore height, grip, trigger and fire controls; the receivers are ~16%
 * longer and deeper (taller upper, longer port and carrier), the magazine
 * well is deeper and longer.
 * Not linked into `createLongGun` yet. */
export const MARKSMAN_BORE = 0.025;
const B = MARKSMAN_BORE;
/** Large-frame upper about the bore: 27 above, 21.5 below, 36.4 wide. */
const UPPER_SECTION = { top: 0.027, bottom: -0.0215, half: 0.0182 };
const RAIL_TOP = B + UPPER_SECTION.top + 0.0095;
const RAIL_BASE = B + 0.0195;
const UPPER = [-0.136, 0.078] as const;
const RECEIVER_FACE = UPPER[1];
const HANDGUARD = [0.0845, 0.4645] as const;
const TUBE = { R: 0.021, r: 0.0186 };
const BARREL = [RECEIVER_FACE - 0.004, 0.5315] as const;
const GAS_BLOCK = [0.402, 0.426] as const;
const BRAKE = [0.529, 0.596] as const;
export const MARKSMAN_MUZZLE = BRAKE[1];
const PARTING = B + UPPER_SECTION.bottom;
const LOWER_TOP = PARTING + 0.0002;
/** Trigger-guard roof: the lower is 28 deep from the parting line. */
const LOWER_FLOOR = -0.0245;
const WELL = {
  /** Rake datum (the original parting line), so the clip mount stays put. */
  top: 0.00792,
  bottom: -0.056,
  rake: 0.05,
  outer: -0.0062,
  center: -0.0069,
};
const wellShift = (y: number) => (WELL.top - y) * WELL.rake;
/** Port 72 long, centred over the magazine well where the well meets the
 * upper (x -0.043 to 0.029), so the magazine feeds up into the carrier path
 * under it; its front edge sits just behind the barrel extension. */
const PORT_CENTER = WELL.center + wellShift(LOWER_TOP);
const PORT: [number, number] = [PORT_CENTER - 0.036, PORT_CENTER + 0.036];
const PORT_Y: [number, number] = [-0.0075, 0.0115];
const MOUTH_X = WELL.center + wellShift(WELL.bottom);
const BIPOD = { pivot: 0.414, y: -0.0125, z: 0.0138, reach: 0.15 };

/** Mount points in the weapon frame; authored with the laser on the left
 * accessory rail. */
export const MARKSMAN_MOUNTS = toWeaponFrame<AttachmentSlot>({
  clip: [MOUTH_X, WELL.bottom, 0],
  stock: [-0.152, B, 0],
  scope: [-0.026, RAIL_TOP, 0],
  laser: [0.4225, B, TUBE.R + 0.0075 + 0.0022],
});

/** Revolved profile [axial, radius] about the X axis through (y, z). */
function lathe(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  y = B,
  z = 0,
  segments = 24,
) {
  const geo = new T.LatheGeometry(
    profile.map(([x, r]) => new T.Vector2(Math.max(r, 1e-5), x)),
    segments,
  );
  geo.rotateZ(-Math.PI / 2);
  g.add(geo, m, [0, y, z]);
}

/** Annular disc/sleeve [x0, x1] between radii, about the bore. */
function sleeve(
  g: WeaponGeometry,
  m: T.Material,
  x0: number,
  x1: number,
  r0: number,
  r1: number,
  segments = 24,
) {
  lathe(
    g,
    m,
    [
      [x0, r0],
      [x0, r1],
      [x1, r1],
      [x1, r0],
      [x0, r0],
    ],
    B,
    0,
    segments,
  );
}

/** Round walled ring about the bore, used by the handguard and brake shells. */
const boreRing = (x: number, radius: number, N: number) =>
  superRing(
    new T.Vector3(x, B, 0),
    Y,
    Z,
    radius,
    radius,
    radius,
    radius,
    2,
    N,
    Math.PI / N,
  );
const deg = Math.PI / 180;
const angleNear = (c: T.Vector3, target: number, half: number) => {
  const a = Math.atan2(c.z, c.y - B);
  return (
    Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target))) < half
  );
};

// ---------------------------------------------------------------------------
// Receiver group

export function marksmanRifle(g: WeaponGeometry, m: WeaponFinish) {
  inAuthoringFrame(g, (g) => {
    upperReceiver(g, m);
    lowerReceiver(g, m);
    pistolGrip(g, m);
    handguard(g, m);
    barrel(g, m);
    bipod(g, m);
    foldedSight(g, m, -0.119, false);
    foldedSight(g, m, 0.448, true);
  });
}

function upperReceiver(g: WeaponGeometry, m: WeaponFinish) {
  const { top, bottom, half } = UPPER_SECTION;
  const section = fillet(upperSection(top, bottom, half, PORT_Y), 0);
  const ring = (x: number, s: number) =>
    section.map((p) => new T.Vector3(x, B + p.y * s, p.x * s));
  const port = PORT;
  const [x0, x1] = UPPER;
  const stations: [number, number][] = [
    [x0, 0.95],
    [x0 + 0.0007, 0.985],
    [x0 + 0.0018, 1],
    [port[0], 1],
    [port[1], 1],
    [x1 - 0.002, 1],
    [x1 - 0.0011, 0.985],
    [x1, 0.95],
  ];
  const wall = 0.0027 / half;
  g.add(
    shell(
      stations.map(([x, s]) => ring(x, s)),
      {
        inner: stations.map(([x, s]) => ring(x, s * (1 - wall))),
        hole: (c) =>
          c.z < -0.01 &&
          c.x > port[0] &&
          c.x < port[1] &&
          c.y > B + PORT_Y[0] &&
          c.y < B + PORT_Y[1],
      },
    ),
    m.shell,
  );
  rail(g, m.shell, x0 + 0.0005, x1 - 0.0005);
  breech(g, m, {
    bore: B,
    r: 0.0138,
    port,
    portY: PORT_Y,
    rear: x0 + 0.003,
    face: RECEIVER_FACE,
    flank: half,
  });
  // Brass deflector immediately behind the port.
  const d = port[0] - 0.0005;
  slab(
    g,
    m.shell,
    [
      [d, B - 0.002],
      [d, B + 0.0155, 0.002],
      [d - 0.0075, B + 0.019, 0.003],
      [d - 0.0162, B + 0.0112, 0.004],
      [d - 0.0152, B - 0.002, 0.002],
    ],
    0.007,
    -half - 0.0007,
    0.0012,
  );
  // Forward assist housing and plunger behind it, angled rearward, outward and up.
  const f = d - 0.018 + 0.0965;
  slab(
    g,
    m.shell,
    [
      [-0.119 + f, B - 0.0048, 0.003],
      [-0.099 + f, B - 0.0048, 0.003],
      [-0.0965 + f, B + 0.014, 0.004],
      [-0.112 + f, B + 0.0185, 0.004],
    ],
    0.0045,
    -half + 0.0007,
    0.0012,
  );
  const fa = new T.Vector3(-0.8, 0.3, -0.52).normalize();
  const faAt = [-0.1 + f, B + 0.0065, -half + 0.0084];
  latheAlong(
    g,
    m.shell,
    [
      [0, 0],
      [0, 0.0068],
      [0.0165, 0.0068],
      [0.0178, 0.0058],
      [0.0178, 0],
    ],
    faAt,
    fa,
    20,
  );
  latheAlong(
    g,
    m.metal,
    [
      [0.0172, 0],
      [0.0172, 0.0052],
      [0.0225, 0.0052],
      [0.0228, 0.0046],
      [0.0236, 0.0046],
      [0.0238, 0.0052],
      [0.0262, 0.0052],
      [0.0274, 0.0042],
      [0.0274, 0],
    ],
    faAt,
    fa,
    20,
  );
  // Charging handle: T-handle over the receiver extension, latch on the left.
  plate(
    g,
    m.metal,
    [
      [-0.127, 0.006],
      [-0.139, 0.006, 0.002],
      [-0.1365, 0.0125, 0.002],
      [-0.1355, 0.0185, 0.002],
      [-0.1435, 0.0215, 0.002],
      [-0.152, 0.0215, 0.002],
      [-0.1542, 0.018, 0.002],
      [-0.1542, -0.018, 0.002],
      [-0.152, -0.0215, 0.002],
      [-0.1455, -0.0205, 0.002],
      [-0.145, -0.006, 0.002],
      [-0.127, -0.006],
    ],
    0.0066,
    B + 0.026,
    0.0012,
  );
  // Barrel nut with anti-rotation tabs keyed to the upper.
  lathe(g, m.metal, [
    [RECEIVER_FACE - 0.0005, 0],
    [RECEIVER_FACE - 0.0005, 0.0186],
    [RECEIVER_FACE, 0.0193],
    [HANDGUARD[0] - 0.0005, 0.0193],
    [HANDGUARD[0], 0.0186],
    [HANDGUARD[0], 0],
  ]);
  for (const side of [-1, 1])
    g.box(
      [RECEIVER_FACE - 0.0035, B + 0.02, side * 0.0098],
      [0.008, 0.004, 0.0028],
      m.metal,
    );
}

function lowerReceiver(g: WeaponGeometry, m: WeaponFinish) {
  const top = LOWER_TOP,
    w = 0.025,
    hw = w / 2;
  // Body behind the magazine well, 28 deep from the parting line to the
  // trigger-guard roof, rising at the rear into the extension ring.
  slab(
    g,
    m.shell,
    [
      [-0.048, top, 0.001],
      [-0.1362, top, 0],
      [-0.1366, 0.0085, 0.0005],
      [-0.1495, 0.0085, 0.004],
      [-0.1505, -0.01, 0.006],
      [-0.1365, LOWER_FLOOR, 0.005],
      [-0.048, LOWER_FLOOR, 0.001],
    ],
    w,
    0,
    0.0015,
  );
  lathe(g, m.shell, [
    [-0.152, 0],
    [-0.152, 0.0164],
    [-0.1505, 0.0178],
    [-0.1355, 0.0178],
    [-0.135, 0.0172],
    [-0.135, 0],
  ]);
  // Magazine well: walled, flared and open at the mouth, raked with the magazine.
  const wellRing = (y: number, inner: boolean) => {
    const flare = smooth(-0.049, WELL.bottom, y);
    const c = new T.Vector3(
      (inner ? WELL.center : WELL.outer) + wellShift(y),
      y,
      0,
    );
    const hx = inner ? 0.0368 + flare * 0.0022 : 0.0428 + flare * 0.0028;
    const hz = inner ? 0.0131 + flare * 0.0012 : 0.0155 + flare * 0.0016;
    return superRing(c, X, Z, hx, hx, hz, hz, inner ? 6 : 8, 40, Math.PI / 40);
  };
  const levels = [
    LOWER_TOP,
    -0.022,
    -0.044,
    -0.049,
    -0.052,
    -0.0545,
    WELL.bottom,
  ];
  g.add(
    shell(
      levels.map((y) => wellRing(y, false)),
      { inner: levels.map((y) => wellRing(y, true)), open: [false, true] },
    ),
    m.shell,
  );
  // Pivot-pin lug at the front of the lower.
  slab(
    g,
    m.shell,
    [
      [0.034, top],
      [0.052, top, 0.002],
      [0.058, -0.0015, 0.004],
      [0.053, -0.01, 0.004],
      [0.038, -0.0115],
    ],
    0.019,
    0,
    0.0012,
  );
  // Trigger guard and blade are the carbine's (shared trigger-hand fit).
  slab(
    g,
    m.shell,
    band(
      [
        [-0.0442, -0.0405],
        [-0.0505, -0.0429],
        [-0.06, -0.0436],
        [-0.075, -0.044],
        [-0.092, -0.0436],
        [-0.103, -0.0427],
        [-0.1125, -0.0402],
      ],
      0.0023,
    ),
    0.011,
    0,
    0.001,
    [],
    0,
  );
  slab(
    g,
    m.steel,
    band(
      [
        [-0.0685, -0.014],
        [-0.0732, -0.022],
        [-0.0742, -0.028],
        [-0.072, -0.0335],
      ],
      0.0019,
      20,
    ),
    0.0045,
    0,
    0.0007,
    [],
    0,
  );
  const pin = (x: number, y: number, r: number, length: number) => {
    g.cylinder([x, y, 0], r, length, m.steel, "z", r, 14);
    for (const side of [-1, 1])
      g.cylinder(
        [x, y, (side * length) / 2],
        r * 0.45,
        0.0004,
        m.metal,
        "z",
        r * 0.45,
        10,
      );
  };
  pin(0.049, -0.004, 0.0035, 0.0202);
  pin(-0.1295, -0.002, 0.0035, w + 0.0012);
  // Hammer pin ahead of and above the trigger pin, which sits over the blade.
  pin(-0.0685, -0.0045, 0.0021, w + 0.0008);
  pin(-0.082, -0.0155, 0.0021, w + 0.0008);
  // Left: selector at SAFE with index marks, bolt-catch paddle and its boss.
  const zl = hw + 0.0007;
  g.cylinder([-0.1115, -0.004, zl], 0.0048, 0.0018, m.metal, "z", 0.0048, 24);
  slab(
    g,
    m.metal,
    [
      [-0.1155, -0.0068, 0.003],
      [-0.0985, -0.0058, 0.0015],
      [-0.0965, -0.0035, 0.0015],
      [-0.1005, -0.0012, 0.0015],
      [-0.1155, -0.0012, 0.003],
    ],
    0.0024,
    zl + 0.0014,
    0.0005,
  );
  g.box([-0.1115, 0.0048, zl - 0.0006], [0.0016, 0.0032, 0.0006], m.marking);
  g.box([-0.1035, 0.0035, zl - 0.0006], [0.0014, 0.0014, 0.0006], m.marking);
  g.box([-0.1225, -0.0105, zl - 0.0006], [0.0014, 0.0014, 0.0006], m.marking);
  slab(
    g,
    m.metal,
    [
      [-0.0525, 0.0055, 0.0012],
      [-0.0565, 0.0055, 0.0012],
      [-0.0572, -0.006, 0.002],
      [-0.0618, -0.0105, 0.002],
      [-0.0612, -0.0165, 0.0018],
      [-0.0525, -0.016, 0.0018],
      [-0.0535, -0.006, 0.002],
    ],
    0.0026,
    hw + 0.0024,
    0.0006,
  );
  slab(
    g,
    m.shell,
    [
      [-0.0488, LOWER_TOP, 0.001],
      [-0.0655, LOWER_TOP, 0.003],
      [-0.0665, -0.009, 0.006],
      [-0.0605, LOWER_FLOOR + 0.0005, 0.004],
      [-0.0488, LOWER_FLOOR + 0.0005, 0.001],
    ],
    0.003,
    zl,
    0.0009,
  );
  // Right: magazine release inside its raised fence.
  g.cylinder(
    [-0.0575, -0.0145, -hw - 0.0017],
    0.0042,
    0.0034,
    m.metal,
    "z",
    0.0042,
    24,
  );
  slab(
    g,
    m.shell,
    band(
      [
        [-0.0505, -0.0075],
        [-0.0512, -0.0185],
        [-0.0575, -0.0215],
        [-0.0638, -0.0185],
        [-0.0645, -0.0095],
      ],
      0.0012,
      18,
    ),
    0.0036,
    -hw - 0.0009,
    0.0005,
    [],
    0,
  );
}

/** 1913-style rail: undercut spine plus individual cross-slot teeth on a 10 mm
 * pitch, phased from the upper's rear so upper and handguard teeth line up. */
function rail(
  g: WeaponGeometry,
  m: T.Material,
  x0: number,
  x1: number,
  base = RAIL_BASE,
  top = RAIL_TOP - B,
  y = B,
  rotation?: T.Euler,
) {
  const t = top;
  g.add(
    prism(
      [
        [-0.0078, base - y],
        [0.0078, base - y],
        [0.0078, t - 0.0058],
        [0.0104, t - 0.0032],
        [-0.0104, t - 0.0032],
        [-0.0078, t - 0.0058],
      ],
      x0,
      x1,
    ),
    m,
    [0, y, 0],
    rotation,
  );
  for (let x = UPPER[0] + 0.0045; x < x1; x += 0.01) {
    if (x < x0 + 0.0005 || x + 0.0048 > x1 - 0.0005) continue;
    g.add(
      prism(
        [
          [-0.0104, t - 0.0032],
          [0.0104, t - 0.0032],
          [0.0106, t - 0.0029],
          [0.0078, t],
          [-0.0078, t],
          [-0.0106, t - 0.0029],
        ],
        x,
        x + 0.0048,
      ),
      m,
      [0, y, 0],
      rotation,
    );
  }
}

/** 15-inch free-float tube with real slots, a left accessory rail near the
 * front and a short bottom rail section for the bipod. */
function handguard(g: WeaponGeometry, m: WeaponFinish) {
  const [x0, x1] = HANDGUARD;
  const { R, r } = TUBE;
  const N = 36;
  const main: [number, number][] = [],
    diagonal: [number, number][] = [];
  for (let i = 0; i < 5; i++) main.push([0.108 + i * 0.062, 0.152 + i * 0.062]);
  for (let i = 0; i < 4; i++)
    diagonal.push([0.139 + i * 0.062, 0.183 + i * 0.062]);
  const xs = new Set<number>([x0, x0 + 0.0012, x1 - 0.0012, x1]);
  for (const [a, b] of [...main, ...diagonal]) xs.add(a).add(b);
  const stations = [...xs].sort((a, b) => a - b);
  const edge = (x: number) => (x === x0 || x === x1 ? 0.0007 : 0);
  const within = (c: T.Vector3, list: [number, number][]) =>
    list.some(([a0, a1]) => c.x > a0 && c.x < a1);
  const inSlot = (c: T.Vector3) =>
    ((angleNear(c, 90 * deg, 11 * deg) ||
      angleNear(c, -90 * deg, 11 * deg) ||
      angleNear(c, 180 * deg, 11 * deg)) &&
      within(c, main)) ||
    ((angleNear(c, 135 * deg, 11 * deg) ||
      angleNear(c, -135 * deg, 11 * deg)) &&
      within(c, diagonal));
  g.add(
    shell(
      stations.map((x) => boreRing(x, R - edge(x), N)),
      {
        inner: stations.map((x) => boreRing(x, r + edge(x), N)),
        hole: inSlot,
        open: [true, true],
      },
    ),
    m.metal,
  );
  rail(g, m.metal, UPPER[1] + 0.001, x1 - 0.0005);
  // Left accessory rail for the laser, bottom rail for the bipod.
  rail(
    g,
    m.metal,
    0.4075,
    0.4375,
    R - 0.002,
    R + 0.0075,
    B,
    new T.Euler(Math.PI / 2, 0, 0),
  );
  rail(
    g,
    m.metal,
    0.398,
    0.4595,
    R - 0.002,
    R + 0.0075,
    B,
    new T.Euler(Math.PI, 0, 0),
  );
  for (const side of [-1, 1]) {
    g.screw(0.092, B - 0.0065, side * 0.0204, m, 0.0023);
    g.screw(0.0995, B - 0.0065, side * 0.0204, m, 0.0023);
    g.screw(0.452, B + 0.008, side * 0.0198, m, 0.0018);
  }
}

function barrel(g: WeaponGeometry, m: WeaponFinish) {
  // 18" medium-heavy barrel: full contour to the gas block, a step ahead of
  // it, then a short threaded shoulder for the brake.
  const [b0, b1] = BARREL;
  lathe(
    g,
    m.steel,
    [
      [b0, 0],
      [b0, 0.0106],
      [GAS_BLOCK[1] + 0.002, 0.0106],
      [GAS_BLOCK[1] + 0.006, 0.0098],
      [0.5205, 0.0098],
      [0.5212, 0.0088],
      [0.5225, 0.0084],
      [0.5235, 0.0079],
      [0.5245, 0.0084],
      [b1, 0.0084],
      [b1, 0],
    ],
    B,
    0,
    24,
  );
  // Rifle-length gas block with set screws; gas tube back into the upper.
  lathe(g, m.metal, [
    [GAS_BLOCK[0], 0],
    [GAS_BLOCK[0], 0.0133],
    [GAS_BLOCK[0] + 0.0013, 0.0144],
    [GAS_BLOCK[1] - 0.0013, 0.0144],
    [GAS_BLOCK[1], 0.0133],
    [GAS_BLOCK[1], 0],
  ]);
  for (const x of [GAS_BLOCK[0] + 0.006, GAS_BLOCK[1] - 0.006])
    g.cylinder([x, B - 0.0142, 0], 0.0017, 0.0012, m.steel, "y", 0.0017, 10);
  const tube = [RECEIVER_FACE - 0.012, GAS_BLOCK[0] + 0.004];
  g.cylinder(
    [(tube[0] + tube[1]) / 2, B + 0.0124, 0],
    0.0022,
    tube[1] - tube[0],
    m.steel,
    "x",
    0.0022,
    12,
  );
  // Timing nut between the shoulder and the brake.
  sleeve(g, m.metal, 0.5245, 0.529, 0.0084, 0.0112, 6);
  // Precision brake: three side-port chambers with baffles, closed top and
  // bottom, a chamfered crown.
  const N = 36;
  const [k0, k1] = BRAKE;
  const chambers: [number, number][] = [
    [0.5375, 0.5495],
    [0.5535, 0.5655],
    [0.5695, 0.5815],
  ];
  const outer = 0.0128,
    innerR = 0.0094;
  const xs = new Set<number>([
    k0,
    k0 + 0.0012,
    0.5345,
    0.5875,
    k1 - 0.0016,
    k1,
  ]);
  for (const [a, b] of chambers) xs.add(a).add(b);
  const stations = [...xs].sort((a, b) => a - b);
  const radius = (x: number) =>
    x === k0 ? outer - 0.0012 : x === k1 ? outer - 0.0014 : outer;
  g.add(
    shell(
      stations.map((x) => boreRing(x, radius(x), N)),
      {
        inner: stations.map((x) =>
          boreRing(x, x <= 0.5345 ? 0.0086 : innerR, N),
        ),
        open: [true, true],
        hole: (c) =>
          chambers.some(([a, b]) => c.x > a && c.x < b) &&
          (angleNear(c, 90 * deg, 38 * deg) ||
            angleNear(c, -90 * deg, 38 * deg)),
      },
    ),
    m.metal,
  );
  // Rear plug onto the thread and internal baffles with the bullet bore.
  sleeve(g, m.metal, k0 + 0.0012, 0.5345, 0.0046, 0.0087, 16);
  for (const x of [0.5495, 0.5655, 0.5815])
    sleeve(g, m.metal, x, x + 0.004, 0.0048, 0.0096, 16);
  sleeve(g, m.metal, 0.5875, k1 - 0.0004, 0.0052, 0.0096, 20);
  g.cylinder([k1 - 0.0022, B, 0], 0.0052, 0.0004, m.rubber, "x", 0.0052, 16);
}

/** Compact bipod clamped to the bottom rail, legs folded forward under the
 * barrel: pivot block, yoke cheeks, telescoping legs, rubber feet. */
function bipod(g: WeaponGeometry, m: WeaponFinish) {
  const { pivot, y, z, reach } = BIPOD;
  const railBottom = B - TUBE.R - 0.0075;
  // Clamp body: hooks around the rail, rounded front, pivot boss at the rear.
  slab(
    g,
    m.metal,
    [
      [pivot - 0.012, railBottom + 0.003, 0.002],
      [pivot + 0.038, railBottom + 0.003, 0.002],
      [pivot + 0.042, railBottom - 0.002, 0.004],
      [pivot + 0.036, railBottom - 0.008, 0.005],
      [pivot + 0.008, y - 0.004, 0.006],
      [pivot - 0.006, y - 0.0065, 0.006],
      [pivot - 0.0135, y + 0.002, 0.006],
    ],
    0.02,
    0,
    0.0016,
  );
  // Clamp knob on the right.
  latheAlong(
    g,
    m.rubber,
    [
      [0, 0],
      [0, 0.0045],
      [0.004, 0.0045],
      [0.0048, 0.0062],
      [0.0098, 0.0062],
      [0.0112, 0.0048],
      [0.0112, 0],
    ],
    [pivot + 0.022, railBottom + 0.0005, -0.0095],
    new T.Vector3(0, 0, -1),
    24,
  );
  // Yoke cheeks carrying each leg on the pivot pin.
  for (const side of [-1, 1]) {
    slab(
      g,
      m.metal,
      [
        [pivot - 0.0105, y + 0.0025, 0.005],
        [pivot + 0.003, y + 0.0085, 0.003],
        [pivot + 0.017, y + 0.006, 0.003],
        [pivot + 0.017, y - 0.006, 0.003],
        [pivot - 0.004, y - 0.0085, 0.005],
      ],
      0.0028,
      side * 0.0114,
      0.0007,
    );
    g.cylinder(
      [pivot, y, side * 0.0135],
      0.0026,
      0.004,
      m.steel,
      "z",
      0.0026,
      14,
    );
  }
  g.cylinder([pivot, y, 0], 0.0019, 0.032, m.steel, "z", 0.0019, 12);
  // Legs: anodised outer tube with a lock collar, steel extension, rubber foot.
  for (const side of [-1, 1]) {
    const zz = side * z;
    lathe(
      g,
      m.metal,
      [
        [pivot + 0.006, 0],
        [pivot + 0.006, 0.0036],
        [pivot + 0.012, 0.0053],
        [pivot + 0.096, 0.0053],
        [pivot + 0.0975, 0.0047],
        [pivot + 0.0975, 0],
      ],
      y,
      zz,
      14,
    );
    lathe(
      g,
      m.rubber,
      [
        [pivot + 0.083, 0],
        [pivot + 0.083, 0.0058],
        [pivot + 0.0845, 0.0063],
        [pivot + 0.0935, 0.0063],
        [pivot + 0.095, 0.0058],
        [pivot + 0.095, 0],
      ],
      y,
      zz,
      14,
    );
    const ext: number[][] = [
      [pivot + 0.09, 0],
      [pivot + 0.09, 0.0036],
    ];
    for (let k = 0; k < 2; k++) {
      const x = pivot + 0.104 + k * 0.012;
      ext.push([x, 0.0036], [x + 0.0008, 0.0031], [x + 0.0016, 0.0036]);
    }
    ext.push([pivot + reach - 0.012, 0.0036], [pivot + reach - 0.012, 0]);
    lathe(g, m.steel, ext, y, zz, 12);
    lathe(
      g,
      m.rubber,
      [
        [pivot + reach - 0.016, 0],
        [pivot + reach - 0.016, 0.0046],
        [pivot + reach - 0.012, 0.0062],
        [pivot + reach - 0.004, 0.0068],
        [pivot + reach, 0.0056],
        [pivot + reach + 0.0018, 0.0032],
        [pivot + reach + 0.0022, 0],
      ],
      y,
      zz,
      14,
    );
  }
}

/** Low-profile backup sight folded flat on the rail (the carbine's). */
function foldedSight(
  g: WeaponGeometry,
  m: WeaponFinish,
  x: number,
  front: boolean,
) {
  const y = RAIL_TOP;
  slab(
    g,
    m.metal,
    [
      [x - 0.014, y - 0.0045, 0.002],
      [x + 0.014, y - 0.0045, 0.002],
      [x + 0.0145, y + 0.0035, 0.003],
      [x + 0.01, y + 0.0072, 0.003],
      [x - 0.012, y + 0.0072, 0.003],
      [x - 0.0145, y + 0.004, 0.003],
    ],
    0.025,
    0,
    0.0012,
  );
  const tip = front ? 1 : -1;
  slab(
    g,
    m.metal,
    [
      [x - 0.011 * tip, y + 0.0068, 0.001],
      [x + 0.012 * tip, y + 0.0068, 0.001],
      [x + 0.0145 * tip, y + 0.0085, 0.0015],
      [x + 0.01 * tip, y + 0.0104, 0.002],
      [x - 0.0105 * tip, y + 0.0104, 0.002],
    ],
    0.017,
    0,
    0.0007,
  );
  if (front)
    g.cylinder(
      [x + 0.0155, y + 0.0086, 0],
      0.0013,
      0.004,
      m.steel,
      "x",
      0.0009,
      10,
    );
  else g.ring([x - 0.0045, y + 0.0108, 0], 0.0032, 0.0008, m.steel, "y");
  g.screw(x + 0.0055, y - 0.001, -0.0128, m, 0.0026);
}

// ---------------------------------------------------------------------------
// Standard furniture, authored relative to the clip and stock mounts.

export function createMarksmanFurniture(
  slot: "clip" | "stock",
  m: WeaponFinish,
) {
  const g = new WeaponGeometry();
  inAuthoringFrame(g, (g) => (slot === "clip" ? magazine(g, m) : stock(g, m)));
  return sizeWeapon(g.finish(`standard-${slot}`, WEAPON_BASIS));
}

/** Standard 10-round large-calibre box, 92 long: straight, showing ~32 below
 * the well mouth; short pressed ribs, floorplate with a lip. The 15/20/25
 * round boxes are the clip upgrades (furniture-upgrades.ts). */
function magazine(g: WeaponGeometry, m: WeaponFinish) {
  const [mx, my] = MARKSMAN_MOUNTS.clip;
  const top = new T.Vector3(WELL.center + wellShift(0.004) - mx, 0.004 - my, 0);
  const straight = 0.092,
    radius = 0.85,
    length = 0.092,
    hx = 0.0358,
    hz = 0.0127;
  const frame = (s: number) => {
    const p = top.clone();
    const a0 = WELL.rake;
    const along = (a: number) => new T.Vector3(Math.sin(a), -Math.cos(a), 0);
    if (s <= straight) p.addScaledVector(along(a0), s);
    else {
      p.addScaledVector(along(a0), straight);
      const t = (s - straight) / radius;
      const c0 = new T.Vector3(Math.cos(a0), Math.sin(a0), 0).multiplyScalar(
        radius,
      );
      const rot = (v: T.Vector3, a: number) =>
        new T.Vector3(
          v.x * Math.cos(a) - v.y * Math.sin(a),
          v.x * Math.sin(a) + v.y * Math.cos(a),
          0,
        );
      p.add(c0).sub(rot(c0, t));
    }
    const a = a0 + Math.max(0, s - straight) / radius;
    return { p, U: new T.Vector3(Math.cos(a), Math.sin(a), 0) };
  };
  const body = (s: number) => {
    const { p, U } = frame(s);
    // Slight taper at the back of the body, like a staggered-column box.
    const back = hx - 0.0006 * smooth(0.06, length, s);
    return superRing(p, U, Z, hx, back, hz, hz, 7, 40);
  };
  const ss: number[] = [0, 0.059];
  for (let s = 0.066; s < length - 0.004; s += 0.012) ss.push(s);
  ss.push(length);
  g.add(shell(ss.map(body)), m.metal);
  // Pressed ribs on both flanks; a raised spine at the back.
  for (const side of [-1, 1])
    for (const u of [-0.0135, 0.0095]) {
      const rings: T.Vector3[][] = [];
      for (let s = 0.066; s <= length - 0.0095; s += 0.0055) {
        const { p, U } = frame(s);
        const c = p
          .clone()
          .addScaledVector(U, u)
          .addScaledVector(Z, side * (hz - 0.0003));
        const k = s < 0.068 || s > length - 0.012 ? 0.55 : 1;
        rings.push(
          superRing(
            c,
            U,
            Z.clone().multiplyScalar(side),
            0.0021 * k,
            0.0021 * k,
            0.0011 * k,
            0.0008,
            3,
            12,
          ),
        );
      }
      g.add(shell(rings), m.metal);
    }
  // Floorplate: wider than the body with a forward lip and a rear tab.
  const plateRing = (s: number, k: number, front = 0.0378, back = 0.0365) => {
    const { p, U } = frame(s);
    return superRing(
      p,
      U,
      Z,
      front * k,
      back * k,
      0.0141 * k,
      0.0141 * k,
      7,
      40,
    );
  };
  g.add(
    shell([
      plateRing(length - 0.0015, 0.94),
      plateRing(length, 1),
      plateRing(length + 0.0085, 1, 0.0398),
      plateRing(length + 0.0108, 0.95, 0.0398),
      plateRing(length + 0.0118, 0.82, 0.0398),
    ]),
    m.rubber,
  );
}

/** Precision stock on a rifle-length extension: skeletonised body with a
 * support-hand hook and a flat bag-rider, cheek riser on two posts with its
 * lock knob, butt plate on twin rods with a length-of-pull thumbwheel. */
function stock(g: WeaponGeometry, m: WeaponFinish) {
  // Castle nut, then the extension tube that the body slides over.
  lathe(
    g,
    m.metal,
    [
      [-0.0095, 0],
      [-0.0095, 0.0166],
      [-0.0083, 0.0178],
      [-0.0012, 0.0178],
      [0, 0.0168],
      [0, 0],
    ],
    0,
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    g.box(
      [-0.002, Math.cos(a) * 0.0176, Math.sin(a) * 0.0176],
      [0.0045, 0.0026, 0.0026],
      m.rubber,
      new T.Euler(a, 0, 0),
    );
  }
  lathe(
    g,
    m.metal,
    [
      [-0.06, 0],
      [-0.06, 0.0148],
      [-0.0095, 0.0148],
      [-0.0095, 0],
    ],
    0,
  );
  // Collar where the body clamps the tube, with two cross bolts.
  lathe(
    g,
    m.shell,
    [
      [-0.058, 0],
      [-0.058, 0.0158],
      [-0.0555, 0.0172],
      [-0.0335, 0.0172],
      [-0.031, 0.016],
      [-0.031, 0],
    ],
    0,
    0,
    24,
  );
  for (const x of [-0.0395, -0.05]) g.screw(x, -0.0128, -0.0128, m, 0.0022);
  // Body: a lofted housing around the tube, slightly wider toward the butt,
  // over a narrower skeleton frame with the hook, window and bag-rider.
  const housing = (x: number, k: number) => {
    const t = smooth(-0.06, -0.24, x);
    return superRing(
      new T.Vector3(x, 0.001, 0),
      Y,
      Z,
      0.0186 * k,
      0.0186 * k,
      (0.0162 + 0.0014 * t) * k,
      (0.0162 + 0.0014 * t) * k,
      3.5,
      32,
    );
  };
  g.add(
    shell(
      (
        [
          [-0.05, 0.86],
          [-0.0522, 0.95],
          [-0.0555, 1],
          [-0.15, 1],
          [-0.237, 1],
          [-0.2398, 0.95],
          [-0.2415, 0.85],
        ] as [number, number][]
      ).map(([x, k]) => housing(x, k)),
    ),
    m.rubber,
  );
  slab(
    g,
    m.shell,
    [
      [-0.07, -0.006, 0.004],
      [-0.238, -0.006, 0.004],
      [-0.2412, -0.012, 0.003],
      [-0.2412, -0.0885, 0.012],
      [-0.152, -0.0885, 0.004],
      [-0.137, -0.0905, 0.005],
      [-0.124, -0.082, 0.006],
      [-0.116, -0.054, 0.014],
      [-0.098, -0.028, 0.01],
      [-0.074, -0.014, 0.006],
    ],
    0.022,
    0,
    0.0025,
    [
      [
        [-0.137, -0.0265, 0.008],
        [-0.2255, -0.0265, 0.01],
        [-0.2295, -0.0765, 0.014],
        [-0.152, -0.0765, 0.008],
        [-0.1295, -0.052, 0.014],
      ],
    ],
  );
  // Bag-rider flat: a wider runner under the frame.
  slab(
    g,
    m.rubber,
    [
      [-0.142, -0.0868, 0.002],
      [-0.2385, -0.0868, 0.002],
      [-0.2385, -0.0935, 0.003],
      [-0.145, -0.0935, 0.003],
    ],
    0.028,
    0,
    0.0012,
  );
  // QD sockets on both flanks of the housing.
  for (const side of [-1, 1]) {
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0066],
        [0.0022, 0.0066],
        [0.0026, 0.0056],
        [0.0026, 0.0032],
        [0.0008, 0.0032],
        [0.0008, 0],
      ],
      [-0.075, 0.001, side * 0.0152],
      new T.Vector3(0, 0, side),
      16,
    );
  }
  // Cheek riser on two posts; the gap above the body shows the posts.
  slab(
    g,
    m.rubber,
    [
      [-0.098, 0.0245, 0.004],
      [-0.232, 0.0245, 0.003],
      [-0.2355, 0.036, 0.004],
      [-0.222, 0.0402, 0.006],
      [-0.17, 0.0396, 0],
      [-0.132, 0.0374, 0],
      [-0.104, 0.0305, 0.008],
    ],
    0.03,
    0,
    0.0028,
  );
  for (const x of [-0.124, -0.206]) {
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0034],
        [0.009, 0.0034],
        [0.009, 0],
      ],
      [x, 0.0175, 0],
      new T.Vector3(0, 1, 0),
      18,
    );
  }
  // Riser lock knob, knurled, on the left.
  const knob: number[][] = [
    [0, 0],
    [0, 0.0045],
    [0.0018, 0.0045],
  ];
  for (let k = 0; k < 4; k++)
    knob.push([0.0024 + k * 0.0016, 0.0074], [0.0032 + k * 0.0016, 0.0068]);
  knob.push([0.0092, 0.007], [0.0102, 0.006], [0.0102, 0]);
  latheAlong(
    g,
    m.metal,
    knob,
    [-0.162, 0.002, 0.0164],
    new T.Vector3(0, 0, 1),
    20,
  );
  // Twin length-of-pull rods into the butt plate, thumbwheel on the upper rod.
  for (const y of [0.004, -0.068])
    lathe(
      g,
      m.steel,
      [
        [-0.2445, 0],
        [-0.2445, 0.0042],
        [-0.2605, 0.0042],
        [-0.2605, 0],
      ],
      y,
      0,
      18,
    );
  const wheel: number[][] = [
    [-0.2475, 0],
    [-0.2475, 0.0112],
  ];
  for (let k = 0; k < 2; k++)
    wheel.push([-0.249 - k * 0.002, 0.0128], [-0.25 - k * 0.002, 0.012]);
  wheel.push(
    [-0.2535, 0.0128],
    [-0.2555, 0.0124],
    [-0.2565, 0.0112],
    [-0.2565, 0],
  );
  lathe(g, m.metal, wheel, 0.004, 0, 20);
  // Butt plate with a vertical adjustment slot, then the rubber pad.
  slab(
    g,
    m.metal,
    [
      [-0.2595, 0.033, 0.004],
      [-0.2665, 0.033, 0.003],
      [-0.2665, -0.1, 0.003],
      [-0.2595, -0.1, 0.004],
    ],
    0.038,
    0,
    0.0015,
    [
      [
        [-0.2615, -0.024, 0.0012],
        [-0.2645, -0.024, 0.0012],
        [-0.2645, -0.046, 0.0012],
        [-0.2615, -0.046, 0.0012],
      ],
    ],
  );
  g.screw(-0.263, -0.035, 0.0192, m, 0.0026);
  slab(
    g,
    m.rubber,
    [
      [-0.266, 0.0385, 0.006],
      [-0.2785, 0.0365, 0.007],
      [-0.2812, 0.0, 0.05],
      [-0.2835, -0.094, 0.008],
      [-0.2775, -0.1075, 0.006],
      [-0.266, -0.1035, 0.004],
    ],
    0.041,
    0,
    0.003,
  );
}
