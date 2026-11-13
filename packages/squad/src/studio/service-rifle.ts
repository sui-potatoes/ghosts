// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WeaponGeometry,
  sizeWeapon,
  type WeaponFinish,
} from "./weapon-finish.ts";
import type { AttachmentSlot } from "../types.ts";
import {
  X,
  Y,
  Z,
  bakeOnly,
  band,
  breech,
  isLow,
  lowSegments,
  seg,
  simplifyProfile,
  withDetail,
  type Detail,
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

/** Generic mil-pattern 11.5-inch carbine, drawn in the authoring frame
 * (+X muzzle, +Y up, +Z the shooter's left; see the axis convention in
 * rifle-shapes.ts). Bodies are filleted side profiles, lofts and lathes; only parts
 * under ~8 mm are primitives. The bore axis is the datum for everything above
 * the grip; the grip web stays where the shared hand fit expects it. */
export const RIFLE_BORE = 0.025;
const B = RIFLE_BORE;
const RAIL_TOP = B + 0.03;
const RECEIVER_FACE = 0.055;
const HANDGUARD = [0.0605, 0.3255] as const;
export const RIFLE_MUZZLE = 0.391;
const WELL = { top: 0.0085, bottom: -0.05, rake: 0.087, center: -0.01225 };
const wellShift = (y: number) => (WELL.top - y) * WELL.rake;
const MOUTH_X = WELL.center + wellShift(WELL.bottom);

/** Stencil labels for the bake, in app/scripts/weapons/build.py's
 * `add_markings` format: [text, x, y, z, size]. `add_markings` sets each label
 * on both flanks at ±z, facing out and reading front to back, so z is a
 * half-width, not a side. */
export const RIFLE_STENCILS: [string, number, number, number, number][] = [
  ["SABLE / 04", -0.04, -0.017, 0.0142, 0.0045],
  ["GHOST SYSTEMS", -0.04, -0.0255, 0.0142, 0.0026],
  ["SN 004-271", -0.04, -0.0315, 0.0142, 0.0022],
];

/** Mount points in the weapon frame; authored with the laser on the left
 * side rail. */
export const RIFLE_MOUNTS = toWeaponFrame<AttachmentSlot>({
  clip: [MOUTH_X, WELL.bottom, 0],
  stock: [-0.143, B, 0],
  scope: [-0.04, RAIL_TOP, 0],
  laser: [0.283, B, 0.028],
});

// ---------------------------------------------------------------------------
// Shape helpers (the rest are shared in rifle-shapes.ts)

/** Revolved profile [axial, radius] about the X axis through (y, z). Close both ends on the axis. */
function lathe(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  y = B,
  z = 0,
  segments = 28,
) {
  const geo = new T.LatheGeometry(
    simplifyProfile(profile).map(
      ([x, r]) => new T.Vector2(Math.max(r, 1e-5), x),
    ),
    isLow() ? lowSegments(Math.max(...profile.map((p) => p[1]))) : segments,
  );
  geo.rotateZ(-Math.PI / 2);
  g.add(geo, m, [0, y, z]);
}

/** Fasteners keep their own material at low detail (the atlas carries relief,
 * not colour), so they stay as coarse geometry instead of going to the bake. */
function screw(
  g: WeaponGeometry,
  x: number,
  y: number,
  z: number,
  m: WeaponFinish,
  r: number,
) {
  if (!isLow()) return g.screw(x, y, z, m, r);
  const side = Math.sign(z) || 1;
  g.cylinder([x, y, z], r, 0.002, m.steel, "z", r, 8);
  g.cylinder(
    [x, y, z + side * 0.0011],
    r * 0.48,
    0.0003,
    m.rubber,
    "z",
    r * 0.48,
    6,
  );
}

function box(
  g: WeaponGeometry,
  p: number[],
  size: number[],
  m: T.Material,
  rotation?: T.Euler,
) {
  if (!isLow()) return g.box(p, size, m, rotation);
  g.add(new T.BoxGeometry(size[0], size[1], size[2]), m, p, rotation);
}

// ---------------------------------------------------------------------------
// Receiver group

/** `detail: "low"` builds the game mesh for a baked normal map (see `Detail`). */
export function serviceRifle(
  g: WeaponGeometry,
  m: WeaponFinish,
  detail: Detail = "high",
) {
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      upperReceiver(g, m);
      lowerReceiver(g, m);
      pistolGrip(g, m);
      handguard(g, m);
      barrel(g, m);
      foldedSight(g, m, -0.112, false);
      foldedSight(g, m, 0.312, true);
    }),
  );
}

/** Upper: a rounded tube about the bore (top 20.5, bottom 20.5 below, 33.6
 * wide) whose flanks narrow into the lower at the parting line. */
const UPPER_SECTION = { top: 0.0205, bottom: -0.0205, half: 0.0168 };
const PARTING = B + UPPER_SECTION.bottom;
const LOWER_TOP = PARTING + 0.0002;
/** Trigger-guard roof: the lower is 28 deep from the parting line. */
const LOWER_FLOOR = -0.0235;
/** Port 56 long, centred over the magazine well where the well meets the
 * upper (x -0.040 to 0.016), so the magazine feeds up into the carrier path
 * under it; its front edge sits just behind the barrel extension. */
const PORT_CENTER = WELL.center + wellShift(LOWER_TOP);
const PORT: [number, number] = [PORT_CENTER - 0.028, PORT_CENTER + 0.028];
const PORT_Y: [number, number] = [-0.0065, 0.0095];

function upperReceiver(g: WeaponGeometry, m: WeaponFinish) {
  const { top, bottom, half } = UPPER_SECTION;
  const section = fillet(upperSection(top, bottom, half, PORT_Y), 0);
  const ring = (x: number, s: number) =>
    section.map((p) => new T.Vector3(x, B + p.y * s, p.x * s));
  const port = PORT;
  const stations: [number, number][] = isLow()
    ? [
        [-0.128, 1],
        [port[0], 1],
        [port[1], 1],
        [RECEIVER_FACE, 1],
      ]
    : [
        [-0.128, 0.95],
        [-0.1273, 0.985],
        [-0.1262, 1],
        [port[0], 1],
        [port[1], 1],
        [0.0535, 1],
        [0.0544, 0.985],
        [RECEIVER_FACE, 0.95],
      ];
  const wall = 0.0025 / half;
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
  rail(g, m.shell, -0.1265, 0.054);
  breech(g, m, {
    bore: B,
    r: 0.0125,
    port,
    portY: PORT_Y,
    rear: -0.125,
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
      [d, B + 0.0135, 0.002],
      [d - 0.007, B + 0.0165, 0.003],
      [d - 0.015, B + 0.0095, 0.004],
      [d - 0.014, B - 0.002, 0.002],
    ],
    0.007,
    -0.0175,
    0.0012,
  );
  // Forward assist housing and plunger behind it, angled rearward, outward and up.
  const f = d - 0.017 + 0.0965;
  slab(
    g,
    m.shell,
    [
      [-0.119 + f, B - 0.0045, 0.003],
      [-0.099 + f, B - 0.0045, 0.003],
      [-0.0965 + f, B + 0.012, 0.004],
      [-0.112 + f, B + 0.0155, 0.004],
    ],
    0.0045,
    -0.0162,
    0.0012,
  );
  const fa = new T.Vector3(-0.8, 0.3, -0.52).normalize();
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
    [-0.1 + f, B + 0.0055, -0.009],
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
    [-0.1 + f, B + 0.0055, -0.009],
    fa,
    20,
  );
  // Charging handle: T-handle over the receiver extension, latch on the left.
  plate(
    g,
    m.metal,
    [
      [-0.12, 0.006],
      [-0.131, 0.006, 0.002],
      [-0.1285, 0.0125, 0.002],
      [-0.1275, 0.0175, 0.002],
      [-0.1355, 0.0205, 0.002],
      [-0.144, 0.0205, 0.002],
      [-0.1462, 0.017, 0.002],
      [-0.1462, -0.017, 0.002],
      [-0.144, -0.0205, 0.002],
      [-0.1375, -0.0195, 0.002],
      [-0.137, -0.006, 0.002],
      [-0.12, -0.006],
    ],
    0.0064,
    B + 0.0198,
    0.0012,
  );
  // Barrel-nut ring with anti-rotation tabs keyed to the upper.
  lathe(g, m.metal, [
    [RECEIVER_FACE - 0.0005, 0],
    [RECEIVER_FACE - 0.0005, 0.0172],
    [RECEIVER_FACE, 0.0178],
    [HANDGUARD[0] - 0.0005, 0.0178],
    [HANDGUARD[0], 0.0172],
    [HANDGUARD[0], 0],
  ]);
  bakeOnly(() => {
    for (const side of [-1, 1])
      g.box(
        [0.0515, B + 0.0185, side * 0.0092],
        [0.008, 0.004, 0.0028],
        m.metal,
      );
  });
}

function lowerReceiver(g: WeaponGeometry, m: WeaponFinish) {
  // Body behind the magazine well: 23 wide, 28 deep from the parting line to
  // the trigger-guard roof (room for the hammer/trigger pocket), rising at the
  // rear into the receiver-extension ring.
  slab(
    g,
    m.shell,
    [
      [-0.048, LOWER_TOP, 0.001],
      [-0.1282, LOWER_TOP, 0],
      [-0.1286, 0.0095, 0.0005],
      [-0.1405, 0.0095, 0.004],
      [-0.1412, -0.01, 0.006],
      [-0.1325, LOWER_FLOOR, 0.005],
      [-0.048, LOWER_FLOOR, 0.001],
    ],
    0.023,
    0,
    0.0015,
  );
  lathe(g, m.shell, [
    [-0.143, 0],
    [-0.143, 0.0153],
    [-0.1415, 0.0166],
    [-0.1275, 0.0166],
    [-0.127, 0.016],
    [-0.127, 0],
  ]);
  // Magazine well: a walled sleeve, flared and open at the mouth, raked with the magazine.
  const wellRing = (y: number, inner: boolean) => {
    const flare = smooth(-0.044, WELL.bottom, y);
    const c = new T.Vector3(
      (inner ? WELL.center : -0.0115) + wellShift(y),
      y,
      0,
    );
    const hx = inner ? 0.03225 + flare * 0.0022 : 0.0385 + flare * 0.0028;
    const hz = inner ? 0.0118 + flare * 0.0012 : 0.014 + flare * 0.0016;
    const n = seg(48, 16);
    return superRing(c, X, Z, hx, hx, hz, hz, inner ? 6 : 8, n, Math.PI / n);
  };
  const levels = isLow()
    ? [LOWER_TOP, -0.044, -0.049, WELL.bottom]
    : [LOWER_TOP, -0.02, -0.04, -0.044, -0.047, -0.049, WELL.bottom];
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
      [0.02, LOWER_TOP],
      [0.034, LOWER_TOP, 0.002],
      [0.0395, 0, 0.004],
      [0.035, -0.0085, 0.004],
      [0.022, -0.01],
    ],
    0.017,
    0,
    0.0012,
  );
  // Trigger guard: a thin, slightly dropped bow from the rear foot of the
  // magazine well into the grip front; the well wall closes its front.
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
      seg(28, 10),
    ),
    0.011,
    0,
    0.001,
    [],
    0,
  );
  // Curved trigger blade; its face sits at x = -0.072.
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
      seg(20, 8),
    ),
    0.0045,
    0,
    0.0007,
    [],
    0,
  );
  // Pins: pivot, takedown, hammer and trigger.
  const pin = (x: number, y: number, r: number, length: number) => {
    g.cylinder([x, y, 0], r, length, m.steel, "z", r, seg(18, 8));
    for (const side of [-1, 1])
      g.cylinder(
        [x, y, (side * length) / 2],
        r * 0.45,
        0.0004,
        m.metal,
        "z",
        r * 0.45,
        seg(10, 6),
      );
  };
  pin(0.031, -0.002, 0.0033, 0.0182);
  pin(-0.1215, -0.001, 0.0033, 0.0242);
  // Hammer pin ahead of and above the trigger pin, which sits over the blade.
  pin(-0.0685, -0.0035, 0.0021, 0.0238);
  pin(-0.082, -0.0145, 0.0021, 0.0238);
  // Left: safety selector at SAFE with index marks, bolt-catch paddle.
  g.cylinder(
    [-0.1115, -0.004, 0.0122],
    0.0048,
    0.0018,
    m.metal,
    "z",
    0.0048,
    seg(24, 10),
  );
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
    0.0136,
    0.0005,
  );
  // Index marks are colour, not relief: plain boxes at low detail.
  const mark = (p: number[], size: number[]) =>
    isLow()
      ? g.add(new T.BoxGeometry(...size), m.marking, p)
      : g.box(p, size, m.marking);
  mark([-0.1115, 0.0048, 0.0116], [0.0016, 0.0032, 0.0006]);
  mark([-0.1035, 0.0035, 0.0116], [0.0014, 0.0014, 0.0006]);
  mark([-0.1225, -0.0105, 0.0116], [0.0014, 0.0014, 0.0006]);
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
    0.0146,
    0.0006,
  );
  // Raised boss that guards the bolt catch, swept into the guard roof.
  slab(
    g,
    m.shell,
    [
      [-0.0488, LOWER_TOP, 0.001],
      [-0.0655, LOWER_TOP, 0.003],
      [-0.0665, -0.008, 0.006],
      [-0.0605, LOWER_FLOOR + 0.0005, 0.004],
      [-0.0488, LOWER_FLOOR + 0.0005, 0.001],
    ],
    0.003,
    0.0122,
    0.0009,
  );
  // Right: magazine release button inside its raised fence.
  g.cylinder(
    [-0.0575, -0.014, -0.0132],
    0.0042,
    0.0034,
    m.metal,
    "z",
    0.0042,
    seg(24, 10),
  );
  bakeOnly(() =>
    slab(
      g,
      m.shell,
      band(
        [
          [-0.0505, -0.007],
          [-0.0512, -0.018],
          [-0.0575, -0.021],
          [-0.0638, -0.018],
          [-0.0645, -0.009],
        ],
        0.0012,
        18,
      ),
      0.0036,
      -0.0124,
      0.0005,
      [],
      0,
    ),
  );
}

/** Continuous 1913-style rail: undercut spine plus individual cross-slot teeth on a 10 mm pitch. */
function rail(
  g: WeaponGeometry,
  m: T.Material,
  x0: number,
  x1: number,
  base = B + 0.016,
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
  for (let x = -0.1255; x < 0.33; x += 0.01) {
    if (x < x0 + 0.0005 || x + 0.0048 > x1 - 0.0005) continue;
    g.add(
      prism(
        isLow()
          ? [
              [-0.0104, t - 0.0032],
              [0.0104, t - 0.0032],
              [0.0078, t],
              [-0.0078, t],
            ]
          : [
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

/** Free-float tube: real slots at 3, 6 and 9 o'clock and the two lower 45° lines. */
function handguard(g: WeaponGeometry, m: WeaponFinish) {
  const [x0, x1] = HANDGUARD;
  const R = 0.0195,
    r = 0.017,
    N = seg(48, 32);
  const main: [number, number][] = [],
    diagonal: [number, number][] = [];
  for (let i = 0; i < 5; i++) main.push([0.086 + i * 0.044, 0.116 + i * 0.044]);
  for (let i = 0; i < 4; i++)
    diagonal.push([0.108 + i * 0.044, 0.138 + i * 0.044]);
  const xs = new Set<number>(
    isLow() ? [x0, x1] : [x0, x0 + 0.0012, x1 - 0.0012, x1],
  );
  for (const [a, b] of [...main, ...diagonal]) xs.add(a).add(b);
  const stations = [...xs].sort((a, b) => a - b);
  const ring = (x: number, radius: number) =>
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
      isLow() ? 0 : Math.PI / N,
    );
  const edge = (x: number) => (!isLow() && (x === x0 || x === x1) ? 0.0007 : 0);
  const deg = Math.PI / 180;
  const inSlot = (c: T.Vector3) => {
    const a = Math.atan2(c.z, c.y - B);
    const near = (target: number) =>
      Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target))) <
      (isLow() ? 12 : 8) * deg;
    const within = (list: [number, number][]) =>
      list.some(([a0, a1]) => c.x > a0 && c.x < a1);
    return (
      ((near(90 * deg) || near(-90 * deg) || near(180 * deg)) &&
        within(main)) ||
      ((near(135 * deg) || near(-135 * deg)) && within(diagonal))
    );
  };
  g.add(
    shell(
      stations.map((x) => ring(x, R - edge(x))),
      {
        inner: stations.map((x) => ring(x, r + edge(x))),
        hole: inSlot,
        open: [true, true],
      },
    ),
    m.metal,
  );
  rail(g, m.metal, x0 + 0.0005, x1 - 0.0005);
  // Short side rail section on the left for the laser mount.
  rail(
    g,
    m.metal,
    0.2685,
    0.2985,
    0.016,
    0.0258,
    B,
    new T.Euler(Math.PI / 2, 0, 0),
  );
  for (const side of [-1, 1]) {
    screw(g, 0.068, B - 0.006, side * 0.0189, m, 0.0022);
    screw(g, 0.0745, B - 0.006, side * 0.0189, m, 0.0022);
  }
}

function barrel(g: WeaponGeometry, m: WeaponFinish) {
  // 11.5" barrel from the receiver face; stepped at the gas-block journal.
  lathe(
    g,
    m.steel,
    [
      [RECEIVER_FACE - 0.004, 0],
      [RECEIVER_FACE - 0.004, 0.0093],
      [0.2245, 0.0093],
      [0.2455, 0.0093],
      [0.2465, 0.0086],
      [0.3455, 0.0086],
      [0.3462, 0.0078],
      [0.3462, 0],
    ],
    B,
    0,
    28,
  );
  // Low-profile gas block with set screws, gas tube back into the upper.
  lathe(g, m.metal, [
    [0.2245, 0],
    [0.2245, 0.0126],
    [0.2258, 0.0137],
    [0.2442, 0.0137],
    [0.2455, 0.0126],
    [0.2455, 0],
  ]);
  for (const x of [0.2295, 0.2405])
    g.cylinder(
      [x, B - 0.0135, 0],
      0.0017,
      0.0012,
      m.steel,
      "y",
      0.0017,
      seg(10, 6),
    );
  g.cylinder(
    [0.1405, B + 0.0114, 0],
    0.0022,
    0.191,
    m.steel,
    "x",
    0.0022,
    seg(12, 6),
  );
  // Crush washer and birdcage flash hider with five slots and a closed bottom.
  lathe(g, m.steel, [
    [0.3448, 0],
    [0.3448, 0.0098],
    [0.3465, 0.0098],
    [0.3465, 0],
  ]);
  // Low: 20 cells of 18 degrees, so the five slots still land on cells.
  const N = seg(60, 20),
    deg = Math.PI / 180;
  const stations: [number, number, number][] = isLow()
    ? [
        [0.3465, 0.011, 0.0075],
        [0.3605, 0.011, 0.0075],
        [0.3855, 0.011, 0.0075],
        [RIFLE_MUZZLE, 0.011, 0.0082],
      ]
    : [
        [0.3465, 0.0104, 0.0075],
        [0.3475, 0.011, 0.0075],
        [0.3605, 0.011, 0.0075],
        [0.3855, 0.011, 0.0075],
        [0.3898, 0.011, 0.0075],
        [RIFLE_MUZZLE, 0.0102, 0.0082],
      ];
  const ring = (x: number, radius: number) =>
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
  g.add(
    shell(
      stations.map(([x, R]) => ring(x, R)),
      {
        inner: stations.map(([x, , r]) => ring(x, r)),
        open: [false, true],
        hole: (c) => {
          if (c.x < 0.3605 || c.x > 0.3855) return false;
          const a = Math.atan2(c.z, c.y - B);
          return [0, 72, -72, 144, -144].some(
            (t) =>
              Math.abs(
                Math.atan2(Math.sin(a - t * deg), Math.cos(a - t * deg)),
              ) <
              7.5 * deg,
          );
        },
      },
    ),
    m.metal,
  );
  bakeOnly(() =>
    g.cylinder([0.3468, B, 0], 0.0028, 0.0004, m.rubber, "x", 0.0028, 16),
  );
}

/** Low-profile backup sight folded flat on the rail. */
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
  // Post and aperture ring stand above the leaf: silhouette, so geometry.
  if (front)
    g.cylinder(
      [x + 0.0155, y + 0.0086, 0],
      0.0013,
      0.004,
      m.steel,
      "x",
      0.0009,
      seg(10, 6),
    );
  else if (isLow())
    g.add(
      new T.TorusGeometry(0.0032, 0.0008, 4, 10),
      m.steel,
      [x - 0.0045, y + 0.0108, 0],
      new T.Euler(Math.PI / 2, 0, 0),
    );
  else g.ring([x - 0.0045, y + 0.0108, 0], 0.0032, 0.0008, m.steel, "y");
  screw(g, x + 0.0055, y - 0.001, -0.0128, m, 0.0026);
}

// ---------------------------------------------------------------------------
// Standard furniture, authored relative to the clip and stock mounts.

export function createServiceFurniture(
  slot: "clip" | "stock",
  m: WeaponFinish,
  detail: Detail = "high",
) {
  const g = new WeaponGeometry();
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => (slot === "clip" ? magazine(g, m) : stock(g, m))),
  );
  return sizeWeapon(g.finish(`standard-${slot}`, WEAPON_BASIS));
}

/** 30-round magazine, 62 x 23: straight in the well, then a gentle constant curve forward. */
function magazine(g: WeaponGeometry, m: WeaponFinish) {
  const [mx, my] = RIFLE_MOUNTS.clip;
  const top = new T.Vector3(WELL.center + wellShift(0.004) - mx, 0.004 - my, 0);
  const straight = 0.056,
    radius = 0.48,
    length = 0.151;
  const frame = (s: number) => {
    const p = top.clone();
    const a0 = WELL.rake;
    const along = (a: number) => new T.Vector3(Math.sin(a), -Math.cos(a), 0);
    if (s <= straight) p.addScaledVector(along(a0), s);
    else {
      p.addScaledVector(along(a0), straight);
      // Integrate the arc analytically: centre of curvature lies ahead of the spine.
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
  const body = (s: number, k = 1) => {
    const { p, U } = frame(s);
    return superRing(
      p,
      U,
      Z,
      0.031 * k,
      0.031 * k,
      0.0115 * k,
      0.0115 * k,
      6,
      seg(48, 20),
    );
  };
  const ss: number[] = [0, straight - 0.001];
  const pitch = seg(0.012, 0.024);
  for (let s = straight + 0.01; s < length; s += pitch) ss.push(s);
  ss.push(length);
  g.add(shell(ss.map((s) => body(s))), m.metal);
  // Pressed ribs along the curved body, on both sides.
  for (const side of isLow() ? [] : [-1, 1])
    for (const u of [-0.0115, 0.0105]) {
      const rings: T.Vector3[][] = [];
      for (let s = straight + 0.006; s <= length - 0.012; s += 0.009) {
        const { p, U } = frame(s);
        const c = p
          .clone()
          .addScaledVector(U, u)
          .addScaledVector(Z, side * 0.0112);
        const k = s < straight + 0.01 || s > length - 0.016 ? 0.6 : 1;
        rings.push(
          superRing(
            c,
            U,
            Z.clone().multiplyScalar(side),
            0.0017 * k,
            0.0017 * k,
            0.001 * k,
            0.0008,
            3,
            12,
          ),
        );
      }
      g.add(shell(rings), m.metal);
    }
  // Floorplate with a forward lip.
  const plateRing = (s: number, k: number) => {
    const { p, U } = frame(s);
    return superRing(
      p,
      U,
      Z,
      0.0335 * k,
      0.0326 * k,
      0.0125 * k,
      0.0125 * k,
      7,
      seg(48, 20),
    );
  };
  const plates: [number, number][] = isLow()
    ? [
        [length - 0.0015, 0.93],
        [length, 1],
        [length + 0.0108, 1],
        [length + 0.0118, 0.85],
      ]
    : [
        [length - 0.0015, 0.93],
        [length, 1],
        [length + 0.0085, 1],
        [length + 0.0108, 0.95],
        [length + 0.0118, 0.82],
      ];
  g.add(shell(plates.map(([s, k]) => plateRing(s, k))), m.rubber);
}

/** Adjustable carbine stock on a 29 mm buffer tube. */
function stock(g: WeaponGeometry, m: WeaponFinish) {
  // Castle nut with notches and the receiver-extension tube.
  lathe(
    g,
    m.metal,
    [
      [-0.0095, 0],
      [-0.0095, 0.0162],
      [-0.0083, 0.0174],
      [-0.0012, 0.0174],
      [0, 0.0164],
      [0, 0],
    ],
    0,
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    box(
      g,
      [-0.002, Math.cos(a) * 0.0172, Math.sin(a) * 0.0172],
      [0.0045, 0.0026, 0.0026],
      m.rubber,
      new T.Euler(a, 0, 0),
    );
  }
  lathe(
    g,
    m.metal,
    [
      [-0.187, 0],
      [-0.187, 0.0128],
      [-0.1855, 0.0145],
      [-0.0095, 0.0145],
      [-0.0095, 0],
    ],
    0,
  );
  // Adjustment rib under the tube, visible ahead of the stock.
  slab(
    g,
    m.metal,
    [
      [-0.012, -0.0128],
      [-0.18, -0.0128],
      [-0.18, -0.0172, 0.001],
      [-0.014, -0.0172, 0.001],
    ],
    0.0065,
    0,
    0.0006,
  );
  for (let i = 0; i < 3; i++)
    g.cylinder(
      [-0.024 - i * 0.008, -0.0172, 0],
      0.0015,
      0.0012,
      m.rubber,
      "y",
      0.0015,
      seg(10, 6),
    );
  // Housing around the tube: lofted, widening and rising toward the butt, flat cheek sides.
  const housing = (x: number, k: number) => {
    const t = smooth(-0.05, -0.19, x);
    return superRing(
      new T.Vector3(x, 0, 0),
      Y,
      Z,
      (0.0185 + 0.0055 * t) * k,
      (0.0185 + 0.0012 * t) * k,
      (0.0165 + 0.002 * t) * k,
      (0.0165 + 0.002 * t) * k,
      4,
      seg(44, 20),
    );
  };
  const rings: [number, number][] = isLow()
    ? [
        [-0.0465, 0.9],
        [-0.0495, 1],
        [-0.09, 1],
        [-0.13, 1],
        [-0.17, 1],
        [-0.196, 1],
      ]
    : [
        [-0.046, 0.86],
        [-0.0472, 0.95],
        [-0.0495, 1],
        [-0.08, 1],
        [-0.11, 1],
        [-0.14, 1],
        [-0.17, 1],
        [-0.196, 1],
      ];
  g.add(shell(rings.map(([x, k]) => housing(x, k))), m.rubber);
  // Diagonal strut with a real lightening window, joining housing to toe.
  slab(
    g,
    m.rubber,
    [
      [-0.07, -0.0125, 0.001],
      [-0.19, -0.0125, 0.002],
      [-0.19, -0.098, 0.004],
      [-0.181, -0.1005, 0.006],
      [-0.13, -0.0595, 0.03],
      [-0.075, -0.019, 0.006],
    ],
    0.02,
    0,
    0.002,
    [
      [
        [-0.114, -0.0265],
        [-0.1745, -0.0265],
        [-0.1745, -0.0725],
      ],
    ],
    0.005,
  );
  // Butt block with a through sling slot, then the wider recoil pad with an angled toe.
  slab(
    g,
    m.rubber,
    [
      [-0.186, 0.0215, 0.004],
      [-0.2075, 0.0225, 0.003],
      [-0.2095, -0.095, 0.003],
      [-0.199, -0.1055, 0.004],
      [-0.186, -0.1035, 0.004],
      [-0.1845, -0.09, 0.004],
    ],
    0.036,
    0,
    0.002,
    [
      [
        [-0.2025, -0.046],
        [-0.1925, -0.046],
        [-0.1925, -0.026],
        [-0.2025, -0.026],
      ],
    ],
    0.003,
  );
  slab(
    g,
    m.rubber,
    [
      [-0.206, 0.0238, 0.004],
      [-0.2165, 0.0228, 0.004],
      [-0.2185, -0.0935, 0.004],
      [-0.2085, -0.1068, 0.004],
      [-0.2035, -0.1035, 0.003],
      [-0.2045, -0.092, 0.003],
    ],
    0.04,
    0,
    0.0025,
  );
  // Release latch lever, QD cups and a sling loop at the toe.
  slab(
    g,
    m.metal,
    band(
      [
        [-0.052, -0.0168],
        [-0.064, -0.0198],
        [-0.077, -0.0204],
      ],
      0.0018,
      seg(14, 6),
    ),
    0.008,
    0,
    0.0006,
    [],
    0,
  );
  for (const side of [-1, 1])
    g.cylinder(
      [-0.064, 0.001, side * 0.0172],
      0.0052,
      0.0026,
      m.steel,
      "z",
      0.0052,
      seg(20, 10),
    );
  if (isLow())
    g.add(
      new T.TorusGeometry(0.0062, 0.0013, 4, 10),
      m.steel,
      [-0.172, -0.099, 0],
    );
  else g.ring([-0.172, -0.099, 0], 0.0062, 0.0013, m.steel, "z");
}
