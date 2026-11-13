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
  fillet,
  fins,
  helix,
  inAuthoringFrame,
  hose,
  latheAlong as revolve,
  pClip,
  pistolGrip,
  route,
  shell,
  smooth,
  superRing,
  sweep,
  toWeaponFrame,
  type P2,
} from "./rifle-shapes.ts";
import type { AttachmentSlot } from "../types.ts";

/** Prototype directed-energy rifle on the service family's lower: the shared
 * grip, trigger and fire controls, the carbine stock, and a bench-built
 * accelerator ahead of the receiver. Same authoring frame (metres, +X muzzle,
 * +Y up, +Z the shooter's left; see rifle-shapes.ts). Power and data run on the right; the left stays clean for
 * the support thumb and the laser.
 * Not linked into `createLongGun` yet. */
export const PLASMA_BORE = 0.045;
const B = PLASMA_BORE;
const RAIL_TOP = 0.088;
const RAIL_BASE = 0.0785;
/** Upper housing about the emitter axis: 35 above, down to the parting line, 43 wide. */
const UPPER_SECTION = { top: 0.035, bottom: 0.0045 - B, half: 0.0215 };
const UPPER = [-0.143, 0.062] as const;
/** The housing's top ramps down behind the rail toward the stock. */
const REAR_RAMP = -0.124;
const LOWER_TOP = 0.0047;
const LOWER_FLOOR = -0.0235;
/** Access opening on the right flank, its cover left off. */
const ACCESS = { x: [-0.088, -0.022], y: [0.022, 0.058] } as const;
/** Power-cell well: vertical, wider than a magazine well. */
const WELL = {
  x: -0.0075,
  top: LOWER_TOP,
  bottom: -0.048,
  hx: 0.041,
  hz: 0.0225,
};
/** Accelerator frame: rear and front bulkheads, the coil stack between them. */
const REAR_BULKHEAD = [0.092, 0.098] as const;
const FRONT_BULKHEAD = [0.334, 0.342] as const;
const HEAT_SINK = [0.062, 0.092] as const;
const TROUGH = { R: 0.0375, r: 0.0357 };
const HANDGUARD = [0.1, 0.226] as const;
const RADIATOR = [0.236, 0.328] as const;
const TANK = { y: -0.004, z: 0.0235, r: 0.007 };
const ROD = { y: 0.04, z: 0.04, r: 0.0035 };
/** Ladder tray for the coil leads, under the spine on the right. */
const TRAY = { floor: 0.0695, top: 0.078, inner: -0.0185, outer: -0.0385 };
export const PLASMA_MUZZLE = 0.4115;
const LASER_RAIL = { x: [0.258, 0.29], base: 0.0285, top: 0.0375 } as const;

/** Mount points in the weapon frame; authored with the laser on the left
 * radiator tank's rail. */
export const PLASMA_MOUNTS = toWeaponFrame<AttachmentSlot>({
  clip: [WELL.x, WELL.bottom, 0],
  stock: [UPPER[0], B, 0],
  scope: [-0.04, RAIL_TOP, 0],
  laser: [
    (LASER_RAIL.x[0] + LASER_RAIL.x[1]) / 2,
    TANK.y,
    LASER_RAIL.top + 0.0022,
  ],
});

/** Six staged coils: [rear flange x, winding length, winding radius]. */
const COILS: [number, number, number][] = (() => {
  const lengths = [0.022, 0.02, 0.019, 0.018, 0.017, 0.016];
  const radii = [0.029, 0.027, 0.025, 0.023, 0.021, 0.019];
  const start = 0.104,
    end = 0.33,
    t = 0.0025;
  const used = lengths.reduce((s, l) => s + l + 2 * t, 0);
  const gap = (end - start - used) / (lengths.length - 1);
  let x = start;
  return lengths.map((l, i) => {
    const c: [number, number, number] = [x, l, radii[i]];
    x += l + 2 * t + gap;
    return c;
  });
})();
const FLANGE = 0.0025;
const flangeR = (r: number) => r + 0.0025;
/** Lug angle from the top toward the right. */
const LUG = (65 * Math.PI) / 180;
const lugDir = new T.Vector3(0, Math.cos(LUG), -Math.sin(LUG));
const lugTip = (i: number) => {
  const [x0, , r] = COILS[i];
  return new T.Vector3(x0 + FLANGE / 2, B, 0).addScaledVector(
    lugDir,
    flangeR(r) + 0.0045,
  );
};

// ---------------------------------------------------------------------------
// Shape helpers

/** Segment count for a revolved part: fewer for small radii, never above `asked`. */
const around = (profile: number[][], asked: number) =>
  Math.min(
    asked,
    Math.max(6, Math.ceil(Math.max(...profile.map((p) => p[1])) / 0.0009)),
  );

/** Revolved profile along a direction, segments scaled to its size. */
function latheAlong(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  origin: number[],
  direction: T.Vector3,
  segments = 20,
) {
  revolve(g, m, profile, origin, direction, around(profile, segments));
}

/** Revolved profile [axial, radius] about the X axis through (y, z). */
function lathe(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  y = B,
  z = 0,
  segments = 16,
) {
  const geo = new T.LatheGeometry(
    profile.map(([x, r]) => new T.Vector2(Math.max(r, 1e-5), x)),
    around(profile, segments),
  );
  geo.rotateZ(-Math.PI / 2);
  g.add(geo, m, [0, y, z]);
}

/** Annular disc [x0, x1] between radii, about the emitter axis. */
function sleeve(
  g: WeaponGeometry,
  m: T.Material,
  x0: number,
  x1: number,
  r0: number,
  r1: number,
  segments = 18,
) {
  const e = Math.min(0.0004, (x1 - x0) / 4);
  lathe(
    g,
    m,
    [
      [x0, r0],
      [x0, r1 - e],
      [x0 + e, r1],
      [x1 - e, r1],
      [x1, r1 - e],
      [x1, r0],
      [x0, r0],
    ],
    B,
    0,
    segments,
  );
}

/** Profile extruded symmetrically about z = 0 with a single-step chamfer:
 * the light-weight variant of the family extrusion for small parts. */
function extrude(
  points: P2[],
  width: number,
  bevel = 0.0012,
  holes: P2[][] = [],
  radius = 0.0015,
) {
  const shape = new T.Shape(fillet(points, radius));
  for (const hole of holes) shape.holes.push(new T.Path(fillet(hole, radius)));
  const b = Math.min(bevel, width * 0.3);
  const depth = width - 2 * b;
  const geo = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Cross-section (z, y) extruded along +X from x0 to x1. */
function prism(section: P2[], x0: number, x1: number, bevel = 0, radius = 0) {
  const geo = extrude(
    section.map((p) => [-p[0], p[1], p[2] ?? radius] as P2),
    x1 - x0,
    bevel,
    [],
    radius,
  );
  geo.rotateY(Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, 0);
  return geo;
}

/** Side profile (x, y) extruded across the width, centred on z. */
function slab(
  g: WeaponGeometry,
  m: T.Material,
  points: P2[],
  width: number,
  z = 0,
  bevel = 0.0012,
  holes: P2[][] = [],
  radius = 0.0015,
) {
  g.add(extrude(points, width, bevel, holes, radius), m, [0, 0, z]);
}

/** Small part (under 8 mm): a plain box. */
function chip(g: WeaponGeometry, p: number[], size: number[], m: T.Material) {
  g.add(new T.BoxGeometry(size[0], size[1], size[2]), m, p);
}

/** Exposed fastener: a socket head with a dark recess, its axis along Z. */
function screw(
  g: WeaponGeometry,
  x: number,
  y: number,
  z: number,
  m: WeaponFinish,
  r = 0.0022,
) {
  const side = Math.sign(z) || 1;
  g.cylinder([x, y, z], r, 0.0018, m.steel, "z", r, 7);
  g.cylinder(
    [x, y, z + side * 0.0009],
    r * 0.5,
    0.0003,
    m.rubber,
    "z",
    r * 0.5,
    4,
  );
}

const circle = (cz: number, cy: number, r: number, n = 12): P2[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return [cz + Math.cos(a) * r, cy + Math.sin(a) * r, 0] as P2;
  });

/** Cross-section (z, y) with holes, extruded along +X from x0 to x1. */
function bulkheadPlate(
  section: P2[],
  holes: P2[][],
  x0: number,
  x1: number,
  bevel = 0.001,
) {
  const flip = (pts: P2[]) =>
    pts.map((p) => [-p[0], p[1], p[2] ?? 0.002] as P2);
  const geo = extrude(flip(section), x1 - x0, bevel, holes.map(flip), 0.002);
  geo.rotateY(Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, 0);
  return geo;
}

/** Top-view profile (x, z) with holes, extruded vertically between y0 and y1. */
function plateWithHoles(
  g: WeaponGeometry,
  m: T.Material,
  points: P2[],
  holes: P2[][],
  y0: number,
  y1: number,
  bevel = 0.0008,
) {
  const geo = extrude(points, y1 - y0, bevel, holes);
  geo.rotateX(Math.PI / 2);
  g.add(geo, m, [0, (y0 + y1) / 2, 0]);
}

/** Cable of radius r along a route, with a short steel ferrule on each end. */
function cable(
  g: WeaponGeometry,
  m: WeaponFinish,
  points: number[][],
  r: number,
  ends: [boolean, boolean] = [true, true],
  radial = 5,
) {
  const curve = route(points);
  const length = curve.getLength();
  g.add(
    sweep(curve, r, Math.max(6, Math.ceil(length / 0.008)), radial),
    m.rubber,
  );
  ends.forEach((on, k) => {
    if (!on) return;
    const u = k === 0 ? 0 : 1;
    const p = curve.getPointAt(u),
      t = curve.getTangentAt(u).multiplyScalar(k === 0 ? 1 : -1);
    // Crimp ferrule: sleeve from the end back along the cable.
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, r * 1.15],
        [0.0012, r * 1.3],
        [0.0068, r * 1.3],
        [0.0068, 0],
      ],
      p.toArray(),
      t,
      8,
    );
  });
  return curve;
}

// ---------------------------------------------------------------------------
// Receiver group

export function plasmaRifle(g: WeaponGeometry, m: WeaponFinish) {
  inAuthoringFrame(g, (g) => {
    upperHousing(g, m);
    lowerReceiver(g, m);
    pistolGrip(g, m);
    capacitorBank(g, m);
    controlBox(g, m);
    accelerator(g, m);
    emitter(g, m);
    supportZone(g, m);
    radiator(g, m);
    power(g, m);
    coolant(g, m);
  });
}

/** 1913-style rail on the upper: undercut spine plus cross-slot teeth. */
function rail(
  g: WeaponGeometry,
  m: T.Material,
  x0: number,
  x1: number,
  base: number,
  top: number,
  y = 0,
  rotation?: T.Euler,
) {
  const t = top;
  g.add(
    prism(
      [
        [-0.0078, base],
        [0.0078, base],
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
  for (let x = UPPER[0] + 0.0035; x < x1; x += 0.01) {
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

function upperHousing(g: WeaponGeometry, m: WeaponFinish) {
  const { top, bottom, half } = UPPER_SECTION;
  const ring = (x: number, s: number, low = 1, high = 1) =>
    superRing(
      new T.Vector3(x, B, 0),
      Y,
      Z,
      top * s * high,
      -bottom * s * low,
      half * s,
      half * s,
      6,
      30,
      Math.PI / 30,
    );
  const [x0, x1] = UPPER;
  // Three lofts: solid rear and front, a walled middle with the open access
  // bay whose end walls are the solids' faces. The underside sweeps up ahead
  // of the well into the heat-sink collar.
  const wall = 0.0025 / half;
  const [ax0, ax1] = ACCESS.x;
  g.add(
    shell([
      ring(x0, 0.95, 1, 0.66),
      ring(x0 + 0.0015, 1, 1, 0.68),
      ring(REAR_RAMP, 1),
      ring(ax0, 1),
    ]),
    m.metal,
  );
  g.add(
    shell([ring(ax0, 1), ring(ax1, 1)], {
      inner: [ring(ax0, 1 - wall), ring(ax1, 1 - wall)],
      open: [true, true],
      hole: (c) => c.z < -0.01 && c.y > ACCESS.y[0] && c.y < ACCESS.y[1],
    }),
    m.metal,
  );
  g.add(
    shell([
      ring(ax1, 1),
      ring(0.034, 1),
      ring(x1 - 0.0015, 1, 0.62),
      ring(x1, 0.95, 0.62),
    ]),
    m.metal,
  );
  rail(g, m.metal, REAR_RAMP + 0.001, 0.034, RAIL_BASE, RAIL_TOP);
  // Receiver-extension ring for the stock, inside the housing's rear.
  lathe(g, m.metal, [
    [x0 - 0.0005, 0],
    [x0 - 0.0005, 0.0166],
    [x0 + 0.006, 0.0166],
    [x0 + 0.006, 0],
  ]);
  // Behind the missing cover: a backing plate and three copper bus bars.
  const [ay0, ay1] = ACCESS.y;
  slab(
    g,
    m.metal,
    [
      [ax0 - 0.004, ay0 - 0.004],
      [ax1 + 0.004, ay0 - 0.004],
      [ax1 + 0.004, ay1 + 0.004],
      [ax0 - 0.004, ay1 + 0.004],
    ],
    0.003,
    -0.0095,
    0.0008,
    [],
    0.003,
  );
  ([0.0295, 0.04, 0.0505] as const).forEach((y, i) => {
    const xa = ax0 + 0.005 + i * 0.004,
      xb = ax1 - 0.006;
    slab(
      g,
      m.accent,
      [
        [xa, y - 0.0022],
        [xb, y - 0.0022],
        [xb, y + 0.0022],
        [xa, y + 0.0022],
      ],
      0.0018,
      -0.0122,
      0.0004,
      [],
      0.0018,
    );
    for (const x of [xa + 0.0035, xb - 0.0035])
      g.cylinder([x, y, -0.0136], 0.0021, 0.0015, m.steel, "z", 0.0021, 6);
  });
  // A braided jumper from the lower bar down into the well.
  g.add(
    sweep(
      route([
        [ax1 - 0.012, 0.0295, -0.0133],
        [ax1 - 0.004, 0.024, -0.0128],
        [ax1 + 0.002, 0.012, -0.0115],
        [ax1 + 0.004, 0.003, -0.011],
      ]),
      0.0016,
      10,
      5,
    ),
    m.accent,
  );
  // Empty screw holes where the cover was.
  for (const [x, y] of [
    [ax0 - 0.0035, ay0 - 0.0005],
    [ax0 - 0.0035, ay1 + 0.0005],
    [ax1 + 0.0035, ay0 - 0.0005],
    [ax1 + 0.0035, ay1 + 0.0005],
    [(ax0 + ax1) / 2, ay1 + 0.0032],
    [(ax0 + ax1) / 2, ay0 - 0.0032],
  ])
    g.cylinder(
      [x, y, -half - 0.0001],
      0.0014,
      0.0004,
      m.rubber,
      "z",
      0.0014,
      8,
    );
  // Exposed fasteners on both flanks.
  for (const side of [-1, 1])
    for (const [x, y] of [
      [-0.134, 0.062],
      [-0.134, 0.016],
      [0.052, 0.016],
      [0.052, 0.07],
    ])
      screw(g, x, y, side * (half + 0.0004), m, 0.0022);
}

function lowerReceiver(g: WeaponGeometry, m: WeaponFinish) {
  const top = LOWER_TOP;
  // Body behind the well: the carbine's, flat on top under the long housing.
  slab(
    g,
    m.metal,
    [
      [-0.048, top, 0.001],
      [-0.1405, top, 0.004],
      [-0.1412, -0.01, 0.006],
      [-0.1325, LOWER_FLOOR, 0.005],
      [-0.048, LOWER_FLOOR, 0.001],
    ],
    0.023,
    0,
    0.0015,
  );
  // Power-cell well: walled, flared and open at the mouth.
  const wellRing = (y: number, inner: boolean) => {
    const flare = smooth(-0.042, WELL.bottom, y);
    const hx = inner
      ? WELL.hx - 0.0045 + flare * 0.0018
      : WELL.hx + flare * 0.0024;
    const hz = inner
      ? WELL.hz - 0.003 + flare * 0.0012
      : WELL.hz + flare * 0.0016;
    return superRing(
      new T.Vector3(WELL.x, y, 0),
      X,
      Z,
      hx,
      hx,
      hz,
      hz,
      inner ? 6 : 8,
      24,
      Math.PI / 24,
    );
  };
  const levels = [top, -0.02, -0.038, -0.042, -0.045, -0.047, WELL.bottom];
  g.add(
    shell(
      levels.map((y) => wellRing(y, false)),
      { inner: levels.map((y) => wellRing(y, true)), open: [false, true] },
    ),
    m.metal,
  );
  // Terminal box on the well's front face, three cable glands.
  slab(
    g,
    m.metal,
    [
      [WELL.x + WELL.hx - 0.002, -0.006, 0.002],
      [0.044, -0.006, 0.003],
      [0.046, -0.011, 0.003],
      [0.046, -0.036, 0.003],
      [0.041, -0.042, 0.004],
      [WELL.x + WELL.hx - 0.002, -0.042, 0.002],
    ],
    0.02,
    GLAND_Z,
    0.0012,
  );
  for (const [x, y] of [
    [0.04, -0.01],
    [0.04, -0.038],
  ])
    screw(g, x, y, GLAND_Z - 0.0104, m, 0.0018);
  for (const y of GLAND_Y)
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0042],
        [0.0022, 0.0042],
        [0.0026, 0.0036],
        [0.006, 0.0035],
        [0.008, 0.0031],
        [0.008, 0],
      ],
      [0.046, y, GLAND_Z],
      X,
      12,
    );
  // Trigger guard and blade are the carbine's (shared trigger-hand fit).
  slab(
    g,
    m.metal,
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
    g.cylinder([x, y, 0], r, length, m.steel, "z", r, 10);
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
  pin(-0.1215, -0.001, 0.0033, 0.0242);
  pin(-0.0685, -0.0035, 0.0021, 0.0238);
  pin(-0.082, -0.0145, 0.0021, 0.0238);
  pin(0.024, -0.03, 0.0033, 2 * WELL.hz + 0.0045);
  // Left: selector at SAFE with index marks, bolt-catch paddle and its boss.
  g.cylinder(
    [-0.1115, -0.004, 0.0122],
    0.0048,
    0.0018,
    m.steel,
    "z",
    0.0048,
    14,
  );
  slab(
    g,
    m.steel,
    [
      [-0.1155, -0.0068, 0.003],
      [-0.0985, -0.0058, 0.0015],
      [-0.0965, -0.0035, 0.0015],
      [-0.1005, -0.0012, 0.0015],
      [-0.1155, -0.0012, 0.003],
    ],
    0.0024,
    0.0136,
    0,
  );
  chip(g, [-0.1115, 0.0048, 0.0116], [0.0016, 0.0032, 0.0006], m.marking);
  chip(g, [-0.1035, 0.0035, 0.0116], [0.0014, 0.0014, 0.0006], m.marking);
  chip(g, [-0.1225, -0.0105, 0.0116], [0.0014, 0.0014, 0.0006], m.marking);
  slab(
    g,
    m.steel,
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
    0,
  );
  slab(
    g,
    m.metal,
    [
      [-0.0488, LOWER_TOP, 0.001],
      [-0.0655, LOWER_TOP, 0.003],
      [-0.0665, -0.008, 0.006],
      [-0.0605, LOWER_FLOOR + 0.0005, 0.004],
      [-0.0488, LOWER_FLOOR + 0.0005, 0.001],
    ],
    0.003,
    0.0122,
    0,
  );
  // Right: cell release inside its raised fence.
  g.cylinder(
    [-0.0575, -0.014, -0.0132],
    0.0042,
    0.0034,
    m.steel,
    "z",
    0.0042,
    14,
  );
  slab(
    g,
    m.metal,
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
    0,
    [],
    0,
  );
}

/** Three film capacitors strapped in a cradle on the left flank. */
function capacitorBank(g: WeaponGeometry, m: WeaponFinish) {
  const z = UPPER_SECTION.half + 0.0015,
    r = 0.0068,
    cz = z + r + 0.0002,
    x0 = -0.096,
    x1 = -0.04;
  slab(
    g,
    m.metal,
    [
      [x0 - 0.006, 0.027, 0.004],
      [x1 + 0.004, 0.027, 0.004],
      [x1 + 0.004, 0.073, 0.004],
      [x0 - 0.006, 0.073, 0.004],
    ],
    0.003,
    z,
    0.0008,
    [],
    0.004,
  );
  for (const y of [0.0362, 0.05, 0.0638]) {
    lathe(
      g,
      m.steel,
      [
        [x0, 0],
        [x0, r * 0.86],
        [x0 + 0.0012, r],
        [x1 - 0.006, r],
        [x1 - 0.0055, r * 0.9],
        [x1 - 0.0045, r * 0.9],
        [x1 - 0.004, r],
        [x1 - 0.001, r],
        [x1, r * 0.88],
        [x1, 0],
      ],
      y,
      cz,
      12,
    );
    lathe(
      g,
      m.rubber,
      [
        [x1 - 0.0002, 0],
        [x1 - 0.0002, r * 0.78],
        [x1 + 0.0012, r * 0.72],
        [x1 + 0.0012, 0],
      ],
      y,
      cz,
      10,
    );
    for (const dz of [-0.0032, 0.0032])
      g.cylinder(
        [x1 + 0.0032, y, cz + dz],
        0.0011,
        0.004,
        m.steel,
        "x",
        0.0011,
        8,
      );
  }
  // Straps around the stack.
  for (const x of [x0 + 0.012, x1 - 0.014]) {
    const ring = (dx: number, k: number) =>
      superRing(
        new T.Vector3(x + dx, 0.05, cz - 0.0004),
        Y,
        Z,
        0.0213 * k,
        0.0213 * k,
        0.0074 * k,
        0.0074 * k,
        5,
        20,
      );
    g.add(
      shell([ring(-0.0028, 1.06), ring(0.0028, 1.06)], {
        inner: [ring(-0.0028, 1), ring(0.0028, 1)],
        open: [true, true],
      }),
      m.metal,
    );
  }
  // Copper bus strap joining the front terminals, bent into the housing.
  g.add(
    sweep(
      route([
        [x1 + 0.0055, 0.0662, cz + 0.0032],
        [x1 + 0.0062, 0.05, cz + 0.0032],
        [x1 + 0.0062, 0.034, cz + 0.0032],
        [x1 + 0.0045, 0.028, cz - 0.002],
        [x1 + 0.002, 0.026, z + 0.0005],
      ]),
      0.0011,
      16,
      5,
    ),
    m.accent,
  );
  // Charge strip under the bank: a rubber bezel with six segments.
  slab(
    g,
    m.rubber,
    [
      [x0, 0.0175],
      [x0 + 0.05, 0.0175],
      [x0 + 0.05, 0.0225],
      [x0, 0.0225],
    ],
    0.0016,
    UPPER_SECTION.half + 0.0006,
    0.0005,
    [],
    0.0015,
  );
  for (let i = 0; i < 6; i++)
    chip(
      g,
      [x0 + 0.0055 + i * 0.0078, 0.02, UPPER_SECTION.half + 0.0015],
      [0.005, 0.0028, 0.0008],
      i < 4 ? m.light : m.rubber,
    );
}

/** Bench control box on the right rear: two toggles, a knob, status LEDs. */
function controlBox(g: WeaponGeometry, m: WeaponFinish) {
  const z0 = -UPPER_SECTION.half,
    w = 0.012,
    face = z0 - w;
  slab(
    g,
    m.shell,
    [
      [-0.134, 0.03, 0.004],
      [-0.097, 0.03, 0.004],
      [-0.095, 0.067, 0.003],
      [-0.131, 0.068, 0.004],
    ],
    w,
    z0 - w / 2,
    0.0014,
  );
  for (const [x, y] of [
    [-0.1305, 0.0335],
    [-0.1005, 0.0335],
    [-0.1005, 0.0635],
    [-0.1275, 0.0645],
  ])
    screw(g, x, y, face - 0.0002, m, 0.0016);
  for (const [x, tilt] of [
    [-0.124, 0.6],
    [-0.11, -0.6],
  ]) {
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0034],
        [0.0012, 0.0034],
        [0.0012, 0.0024],
        [0.0042, 0.0024],
        [0.0046, 0.0019],
        [0.0046, 0],
      ],
      [x, 0.058, face],
      new T.Vector3(0, 0, -1),
      12,
    );
    const dir = new T.Vector3(0, tilt, -1).normalize();
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0009],
        [0.0085, 0.0012],
        [0.0098, 0.0012],
        [0.0104, 0],
      ],
      [x, 0.058, face - 0.0044],
      dir,
      8,
    );
  }
  const knob: number[][] = [
    [0, 0],
    [0, 0.0058],
  ];
  for (let k = 0; k < 3; k++)
    knob.push([0.0012 + k * 0.0018, 0.0058], [0.0021 + k * 0.0018, 0.0052]);
  knob.push([0.0066, 0.0055], [0.0074, 0.0044], [0.0074, 0]);
  latheAlong(
    g,
    m.rubber,
    knob,
    [-0.114, 0.04, face],
    new T.Vector3(0, 0, -1),
    18,
  );
  chip(g, [-0.114, 0.0425, face - 0.0076], [0.0012, 0.004, 0.0006], m.marking);
  for (const [y, lit] of [
    [0.044, true],
    [0.036, false],
  ] as const)
    latheAlong(
      g,
      lit ? m.light : m.accent,
      [
        [0, 0],
        [0, 0.0017],
        [0.0008, 0.0015],
        [0.0013, 0],
      ],
      [-0.1285, y, face],
      new T.Vector3(0, 0, -1),
      10,
    );
  // Data cable: gland on the front face, along the flank into the junction block.
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0034],
      [0.004, 0.0032],
      [0.0055, 0.0026],
      [0.0055, 0],
    ],
    [-0.0955, 0.062, z0 - w / 2],
    X,
    10,
  );
  const data = cable(
    g,
    m,
    [
      [-0.0905, 0.062, z0 - w / 2],
      [-0.08, 0.0655, -0.0244],
      [-0.05, 0.0662, -0.0236],
      [-0.01, 0.0662, -0.0236],
      [0.018, 0.0655, -0.0262],
      [0.0295, 0.0655, -0.0322],
    ],
    0.002,
    [false, true],
    5,
  );
  for (const u of [0.32, 0.72]) {
    const p = data.getPointAt(u);
    pClip(g, m, p, data.getTangentAt(u), 0.002, new T.Vector3(0, 0, 1));
  }
}

/** Accelerator: heat sink on the breech, two bulkheads tied by a top spine,
 * two side rods and a ladder tray; six coils on the emitter tube between them. */
function accelerator(g: WeaponGeometry, m: WeaponFinish) {
  // Heat sink: ten thin disc fins with real gaps on a core.
  const [h0, h1] = HEAT_SINK;
  lathe(g, m.metal, [
    [h0 - 0.001, 0],
    [h0 - 0.001, 0.0145],
    [h1, 0.0145],
    [h1, 0],
  ]);
  for (let i = 0; i < 7; i++) {
    const x = h0 + 0.0018 + i * 0.0042;
    lathe(
      g,
      m.metal,
      [
        [x, 0.0144],
        [x, 0.03],
        [x + 0.0013, 0.03],
        [x + 0.0013, 0.0144],
      ],
      B,
      0,
      16,
    );
  }
  // Three copper heat pipes through the stack.
  for (const a of [150, 180, 210]) {
    const t = (a * Math.PI) / 180;
    lathe(
      g,
      m.accent,
      [
        [h0 + 0.0005, 0],
        [h0 + 0.0005, 0.0019],
        [h1 + 0.0004, 0.0019],
        [h1 + 0.0004, 0],
      ],
      B + Math.cos(t) * 0.0222,
      Math.sin(t) * 0.0222,
      8,
    );
  }
  // Emitter tube through the whole stack.
  lathe(g, m.steel, [
    [h1 - 0.001, 0],
    [h1 - 0.001, 0.0085],
    [0.398, 0.0085],
    [0.398, 0],
  ]);
  // Bulkheads.
  const top = 0.0895;
  const trayNotch: P2[] = [
    [TRAY.inner + 0.0025, TRAY.floor - 0.0005, 0.001],
    [TRAY.outer - 0.004, TRAY.floor - 0.0005, 0.001],
    [TRAY.outer - 0.004, 0.0835, 0.002],
    [TRAY.inner + 0.0025, 0.0835, 0.002],
  ];
  const outline = (rightEar: boolean): P2[] => [
    [0.014, top, 0.004],
    [-0.046, top, 0.004],
    ...((rightEar
      ? [
          [-0.05, 0.066, 0.006],
          [-0.058, 0.06, 0.004],
          [-0.058, 0.022, 0.005],
          [-0.04, 0.012, 0.01],
        ]
      : [
          [-0.048, 0.06, 0.008],
          [-0.047, 0.028, 0.01],
        ]) as P2[]),
    [-0.03, 0.006, 0.012],
    [0, 0.003, 0.02],
    [0.03, 0.006, 0.012],
    [0.047, 0.026, 0.01],
    [0.047, 0.052, 0.01],
    [0.03, 0.08, 0.012],
  ];
  const lightening = [circle(0.03, 0.017, 0.0052, 8)];
  g.add(
    bulkheadPlate(
      outline(true),
      [circle(0, B, 0.0095, 14), trayNotch, ...lightening],
      REAR_BULKHEAD[0],
      REAR_BULKHEAD[1],
    ),
    m.metal,
  );
  g.add(
    bulkheadPlate(
      outline(false),
      [circle(0, B, 0.0095, 14), ...lightening],
      FRONT_BULKHEAD[0],
      FRONT_BULKHEAD[1],
    ),
    m.metal,
  );
  // Rubber grommet lining the rear tray notch.
  for (const [x0, x1] of [REAR_BULKHEAD, FRONT_BULKHEAD])
    for (const side of [-1, 1]) {
      screw(g, x1 + 0.0004, 0.084, side * 0.004 + 0.002, m, 0.0018);
      void x0;
    }
  for (const [x, z] of [
    [FRONT_BULKHEAD[1], 0.036],
    [FRONT_BULKHEAD[1], -0.036],
  ]) {
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0024],
        [0.0012, 0.0024],
        [0.0016, 0.0016],
        [0.0016, 0],
      ],
      [x, 0.012, z],
      X,
      10,
    );
  }
  // Top spine: a lightened strap from the housing across both bulkheads.
  const slots: P2[][] = [];
  for (let i = 0; i < 4; i++) {
    const x = 0.112 + i * 0.053;
    slots.push([
      [x, -0.0058, 0],
      [x + 0.04, -0.0058, 0],
      [x + 0.04, 0.0058, 0],
      [x, 0.0058, 0],
    ]);
  }
  plateWithHoles(
    g,
    m.metal,
    [
      [0.035, -0.011, 0.002],
      [0.348, -0.011, 0.004],
      [0.348, 0.011, 0.004],
      [0.035, 0.011, 0.002],
    ],
    slots,
    0.0802,
    0.088,
  );
  for (const x of [
    0.04,
    0.054,
    REAR_BULKHEAD[0] + 0.003,
    FRONT_BULKHEAD[0] + 0.004,
  ])
    for (const side of [-1, 1])
      latheAlong(
        g,
        m.steel,
        [
          [0, 0],
          [0, 0.0022],
          [0.0013, 0.0018],
          [0.0013, 0],
        ],
        [x, 0.088, side * 0.0065],
        Y,
        6,
      );
  // Side rods with nuts on the bulkhead faces.
  for (const side of [-1, 1]) {
    const z = side * ROD.z;
    lathe(
      g,
      m.steel,
      [
        [REAR_BULKHEAD[0] - 0.003, 0],
        [REAR_BULKHEAD[0] - 0.003, ROD.r * 0.8],
        [REAR_BULKHEAD[0] - 0.0025, ROD.r],
        [FRONT_BULKHEAD[1] + 0.0025, ROD.r],
        [FRONT_BULKHEAD[1] + 0.003, ROD.r * 0.8],
        [FRONT_BULKHEAD[1] + 0.003, 0],
      ],
      ROD.y,
      z,
      12,
    );
    for (const x of [REAR_BULKHEAD[0] - 0.0028, FRONT_BULKHEAD[1]])
      lathe(
        g,
        m.metal,
        [
          [x, ROD.r * 0.9],
          [x, ROD.r * 1.75],
          [x + 0.0028, ROD.r * 1.75],
          [x + 0.0028, ROD.r * 0.9],
          [x, ROD.r * 0.9],
        ],
        ROD.y,
        z,
        6,
      );
  }
  // Ladder tray: two rails through the bulkhead notches, rungs on a 25 mm pitch.
  for (const z of [TRAY.inner, TRAY.outer])
    g.add(
      prism(
        [
          [z - 0.001, TRAY.floor],
          [z + 0.001, TRAY.floor],
          [z + 0.001, TRAY.top],
          [z - 0.001, TRAY.top],
        ],
        REAR_BULKHEAD[0] - 0.004,
        FRONT_BULKHEAD[0],
        0.0003,
        0,
      ),
      m.metal,
    );
  for (let x = 0.112; x < 0.33; x += 0.025)
    g.add(
      prism(
        [
          [TRAY.inner + 0.001, TRAY.floor],
          [TRAY.outer - 0.001, TRAY.floor],
          [TRAY.outer - 0.001, TRAY.floor + 0.0016],
          [TRAY.inner + 0.001, TRAY.floor + 0.0016],
        ],
        x,
        x + 0.003,
        0,
        0,
      ),
      m.metal,
    );
  coils(g, m);
}

function coils(g: WeaponGeometry, m: WeaponFinish) {
  COILS.forEach(([x0, length, r], i) => {
    const R = flangeR(r),
      a = x0 + FLANGE,
      b = a + length;
    // Insulating flanges, chamfered, on a bobbin core.
    for (const x of [x0, b])
      lathe(
        g,
        m.shell,
        [
          [x, 0.0086],
          [x, R - 0.0005],
          [x + 0.0005, R],
          [x + FLANGE - 0.0005, R],
          [x + FLANGE, R - 0.0005],
          [x + FLANGE, 0.0086],
        ],
        B,
        0,
        16,
      );
    lathe(
      g,
      m.shell,
      [
        [a - 0.0002, r - 0.0012],
        [b + 0.0002, r - 0.0012],
      ],
      B,
      0,
      12,
    );
    // Winding: one helical sweep of wire, the turns sitting side by side.
    const wire = 0.00115;
    const turns = Math.round((length - 2 * wire) / (wire * 2.05));
    g.add(
      sweep(
        helix(a + wire, b - wire, r - 0.0001, turns, B, 0, -LUG + Math.PI / 2),
        wire,
        turns * 13,
        3,
      ),
      m.accent,
    );
    // Lead-out from the winding to the terminal lug on the rear flange.
    const tip = lugTip(i);
    const base = new T.Vector3(x0 + FLANGE / 2, B, 0).addScaledVector(
      lugDir,
      R,
    );
    g.add(
      sweep(
        route([
          [a + wire, B + lugDir.y * r, lugDir.z * r],
          [a + 0.0006, B + lugDir.y * (R + 0.0008), lugDir.z * (R + 0.0008)],
          [
            x0 + FLANGE + 0.0012,
            base.y + lugDir.y * 0.0022,
            base.z + lugDir.z * 0.0022,
          ],
        ]),
        0.0009,
        6,
        3,
      ),
      m.accent,
    );
    // Lug: a stud on a boss with its nut.
    latheAlong(
      g,
      m.shell,
      [
        [-0.0012, 0],
        [-0.0012, 0.0028],
        [0.0012, 0.0028],
        [0.0018, 0.002],
        [0.0018, 0],
      ],
      base.toArray(),
      lugDir,
      10,
    );
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0011],
        [0.0045, 0.0011],
        [0.0045, 0],
      ],
      base.toArray(),
      lugDir,
      8,
    );
    latheAlong(
      g,
      m.steel,
      [
        [0.0024, 0],
        [0.0024, 0.0021],
        [0.0038, 0.0021],
        [0.0038, 0],
      ],
      base.toArray(),
      lugDir,
      6,
    );
    void tip;
    // Status LED on top of the front flange.
    latheAlong(
      g,
      m.light,
      [
        [0, 0],
        [0, 0.0014],
        [0.0006, 0.0013],
        [0.0011, 0],
      ],
      [b + FLANGE / 2, B + R - 0.0002, 0],
      Y,
      8,
    );
  });
}

/** Open emitter: focusing rings on three standoffs, electrodes, a ceramic
 * aperture cup with the lens recessed in it. */
function emitter(g: WeaponGeometry, m: WeaponFinish) {
  const x0 = FRONT_BULKHEAD[1];
  const rings: [number, number][] = [
    [0.354, 0.0255],
    [0.38, 0.023],
  ];
  for (const [x, R] of rings) sleeve(g, m.steel, x, x + 0.003, 0.0092, R, 20);
  // Focusing winding on a ceramic former between the rings.
  lathe(
    g,
    m.shell,
    [
      [0.357, 0.0092],
      [0.357, 0.0124],
      [0.38, 0.0124],
      [0.38, 0.0092],
    ],
    B,
    0,
    12,
  );
  g.add(
    sweep(helix(0.3585, 0.3785, 0.0134, 8, B, 0, 0.4), 0.0011, 64, 3),
    m.accent,
  );
  // Three standoffs from the bulkhead to the front ring, nuts on both rings.
  const standoff = 0.0195;
  for (const a of [0, 120, 240]) {
    const t = (a * Math.PI) / 180;
    const y = B + Math.cos(t) * standoff,
      z = Math.sin(t) * standoff;
    lathe(
      g,
      m.steel,
      [
        [x0, 0],
        [x0, 0.0017],
        [0.3855, 0.0017],
        [0.3855, 0],
      ],
      y,
      z,
      6,
    );
    for (const x of [0.354, 0.383])
      lathe(
        g,
        m.metal,
        [
          [x - (x === 0.354 ? 0.0024 : 0), 0.0016],
          [x - (x === 0.354 ? 0.0024 : 0), 0.003],
          [x + (x === 0.354 ? 0 : 0.0024), 0.003],
          [x + (x === 0.354 ? 0 : 0.0024), 0.0016],
        ],
        y,
        z,
        6,
      );
  }
  // Aperture cup: ceramic, bolted to the front ring, lens recessed in it.
  lathe(
    g,
    m.shell,
    [
      [0.383, 0.0085],
      [0.383, 0.0172],
      [0.4005, 0.0172],
      [0.4075, 0.0135],
      [0.4075, 0.0112],
      [0.4045, 0.0106],
      [0.4045, 0.0085],
    ],
    B,
    0,
    24,
  );
  // Lens: a plain disc, so the bore axis meets a face, not a lathe pole.
  g.cylinder([0.4048, B, 0], 0.0107, 0.0012, m.glass, "x", 0.0101, 20);
  // Electrodes leaning in around the aperture.
  for (const a of [60, 180, 300]) {
    const t = (a * Math.PI) / 180;
    const from = new T.Vector3(
      0.383,
      B + Math.cos(t) * 0.0215,
      Math.sin(t) * 0.0215,
    );
    const to = new T.Vector3(
      PLASMA_MUZZLE,
      B + Math.cos(t) * 0.0168,
      Math.sin(t) * 0.0168,
    );
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0013],
        [from.distanceTo(to) - 0.002, 0.001],
        [from.distanceTo(to), 0],
      ],
      from.toArray(),
      to.clone().sub(from),
      6,
    );
  }
  // Sensor pod on the spine's front end.
  lathe(
    g,
    m.metal,
    [
      [0.319, 0],
      [0.319, 0.0045],
      [0.3205, 0.0056],
      [0.3405, 0.0056],
      [0.3425, 0.0048],
      [0.3425, 0],
    ],
    0.0936,
    0,
    16,
  );
  lathe(
    g,
    m.glass,
    [
      [0.3424, 0],
      [0.3424, 0.0036],
      [0.343, 0.0033],
      [0.3433, 0],
    ],
    0.0936,
    0,
    14,
  );
  slab(
    g,
    m.metal,
    [
      [0.322, 0.0878],
      [0.338, 0.0878],
      [0.336, 0.0918],
      [0.324, 0.0918],
    ],
    0.009,
    0,
    0.0006,
  );
  // Data cable from the junction block, on the tray's outer rail, up to the pod.
  const data = cable(
    g,
    m,
    [
      [0.0605, 0.0808, TRAY.outer - 0.0005],
      [0.08, 0.0805, TRAY.outer],
      [0.15, 0.0802, TRAY.outer],
      [0.25, 0.0802, TRAY.outer],
      [0.29, 0.0815, TRAY.outer + 0.002],
      [0.304, 0.0875, -0.027],
      [0.312, 0.0925, -0.012],
      [0.3165, 0.0936, -0.002],
      [0.319, 0.0936, 0],
    ],
    0.0018,
    [false, true],
    5,
  );
  for (const u of [0.18, 0.4, 0.62]) {
    const p = data.getPointAt(u);
    pClip(g, m, p, data.getTangentAt(u), 0.0018, new T.Vector3(0, -1, 0));
  }
}

/** Heat shield trough under the coils, and the insulated elastomer handguard
 * that hugs it from below and beside, flaring into a hand stop at the front. */
function supportZone(g: WeaponGeometry, m: WeaponFinish) {
  const N = 32,
    deg = Math.PI / 180;
  const x0 = REAR_BULKHEAD[1],
    x1 = FRONT_BULKHEAD[0];
  const vents: [number, number][] = [];
  for (let x = 0.236; x < 0.32; x += 0.024) vents.push([x, x + 0.014]);
  const xs = new Set<number>([x0, x1]);
  for (const [a, b] of vents) xs.add(a).add(b);
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
      Math.PI / N,
    );
  const angle = (c: T.Vector3) => Math.abs(Math.atan2(c.z, c.y - B)) / deg;
  g.add(
    shell(
      stations.map((x) => ring(x, TROUGH.R)),
      {
        inner: stations.map((x) => ring(x, TROUGH.r)),
        open: [true, true],
        hole: (c) => {
          const a = angle(c);
          if (a < 112) return true;
          return (
            a > 122 && a < 150 && vents.some(([v0, v1]) => c.x > v0 && c.x < v1)
          );
        },
      },
    ),
    m.steel,
  );
  // Handguard: a thick C-section around the trough's lower half.
  const [h0, h1] = HANDGUARD;
  const outer = (x: number, k: number) =>
    superRing(
      new T.Vector3(x, B - 0.009, 0),
      Y,
      Z,
      0.04 * k,
      0.0475 * k,
      0.0402 * k,
      0.0402 * k,
      2.3,
      N,
      Math.PI / N,
    );
  const st: [number, number][] = [
    [h0, 0.955],
    [h0 + 0.003, 1],
  ];
  st.push([h1 - 0.022, 1], [h1 - 0.012, 1.09], [h1 - 0.003, 1.09], [h1, 1.05]);
  g.add(
    shell(
      st.map(([x, k]) => outer(x, k)),
      {
        inner: st.map(([x]) => ring(x, TROUGH.R + 0.0003)),
        open: [true, true],
        hole: (c) => angle(c) < 117,
      },
    ),
    m.rubber,
  );
  for (const side of [-1, 1])
    for (const x of [h0 + 0.012, h1 - 0.034])
      screw(g, x, 0.019, side * 0.0372, m, 0.0018);
}

/** Small cross-flow radiator under the front of the stack: thin fins between
 * two tanks; its rear plate is the hand stop. Laser rail on the left tank. */
function radiator(g: WeaponGeometry, m: WeaponFinish) {
  const [x0, x1] = RADIATOR;
  const troughY = (z: number) => B - Math.sqrt(TROUGH.R ** 2 - z * z);
  const top = (half: number): P2[] => {
    const pts: P2[] = [];
    for (let k = 0; k <= 4; k++) {
      const z = half - (k / 4) * 2 * half;
      pts.push([z, troughY(z) - 0.0002, 0]);
    }
    return pts;
  };
  const endPlate = (bottom: number): P2[] => [
    [-0.031, bottom + 0.012, 0.006],
    [-0.022, bottom, 0.006],
    [0.022, bottom, 0.006],
    [0.031, bottom + 0.012, 0.006],
    ...top(0.031),
  ];
  const finSection = (bottom: number): P2[] => [
    [-0.0215, bottom + 0.004, 0],
    [-0.017, bottom, 0],
    [0.017, bottom, 0],
    [0.0215, bottom + 0.004, 0],
    ...top(0.0215),
  ];
  const bottom = (_x: number) => TANK.y - TANK.r + 0.0005;
  for (const [a, b] of [
    [x0, x0 + 0.004],
    [x1 - 0.003, x1],
  ])
    g.add(prism(endPlate(bottom(a) - 0.001), a, b, 0.0006, 0.004), m.metal);
  for (let x = x0 + 0.007; x < x1 - 0.005; x += 0.0045)
    fins(g, m.metal, finSection(bottom(x)), [x], 0.001, 0, 0);
  for (const side of [-1, 1]) {
    const z = side * TANK.z;
    lathe(
      g,
      m.steel,
      [
        [x0 - 0.002, 0],
        [x0 - 0.002, TANK.r * 0.6],
        [x0, TANK.r * 0.95],
        [x0 + 0.002, TANK.r],
        [x1 - 0.002, TANK.r],
        [x1, TANK.r * 0.95],
        [x1 + 0.002, TANK.r * 0.6],
        [x1 + 0.002, 0],
      ],
      TANK.y,
      z,
      16,
    );
    for (const x of [x0 + 0.002, x1 - 0.0015])
      screw(g, x, 0.009, side * 0.0315, m, 0.0018);
  }
  // Hose barbs on the right tank.
  for (const x of BARB_X)
    latheAlong(
      g,
      m.steel,
      [
        [-0.002, 0],
        [-0.002, 0.0042],
        [0.002, 0.0042],
        [0.002, 0.0034],
        [0.005, 0.0034],
        [0.0075, 0.0046],
        [0.008, 0.0034],
        [0.0105, 0.0046],
        [0.011, 0.0034],
        [0.011, 0],
      ],
      [x, TANK.y, -TANK.z - TANK.r + 0.001],
      new T.Vector3(0, 0, -1),
      12,
    );
  // Filler cap on top of the left tank.
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0042],
      [0.0035, 0.0042],
      [0.0042, 0.0034],
      [0.0042, 0],
    ],
    [x1 - 0.012, TANK.y + 0.0045, TANK.z + 0.004],
    new T.Vector3(0, 0.6, 1),
    12,
  );
  rail(
    g,
    m.metal,
    LASER_RAIL.x[0],
    LASER_RAIL.x[1],
    LASER_RAIL.base,
    LASER_RAIL.top,
    TANK.y,
    new T.Euler(Math.PI / 2, 0, 0),
  );
}
const BARB_X = [0.29, 0.317];

const GLAND_Y = [-0.0145, -0.024, -0.0335];
const GLAND_Z = -0.0135;
const BUS_Z = [-0.0255, -0.033, -0.0405];
/** Junction block on the right front of the housing. */
const JUNCTION = {
  x: [0.03, 0.0605],
  y: [0.046, 0.083],
  z: [-0.0213, -0.0445],
} as const;

/** Power: three bus cables from the well's terminal box up to the junction
 * block; six leads from the block through the tray to each coil's lug. */
function power(g: WeaponGeometry, m: WeaponFinish) {
  const { x, y, z } = JUNCTION;
  slab(
    g,
    m.shell,
    [
      [x[0], y[0], 0.003],
      [x[1], y[0], 0.003],
      [x[1], y[1], 0.003],
      [x[0] + 0.004, y[1], 0.004],
      [x[0], y[1] - 0.006, 0.003],
    ],
    z[0] - z[1],
    (z[0] + z[1]) / 2,
    0.0012,
  );
  for (const [sx, sy] of [
    [x[0] + 0.004, y[0] + 0.004],
    [x[1] - 0.004, y[0] + 0.004],
    [x[1] - 0.004, y[1] - 0.004],
    [x[0] + 0.007, y[1] - 0.004],
  ])
    screw(g, sx, sy, z[1] - 0.0003, m, 0.0018);
  // High-voltage flash on the lid: three copper witness tabs.
  for (let k = 0; k < 3; k++)
    chip(
      g,
      [x[0] + 0.009 + k * 0.006, 0.064, z[1] - 0.0004],
      [0.0035, 0.009, 0.0006],
      m.accent,
    );
  // Bus cables, strain reliefs at the block, a triple clamp on the flank.
  BUS_Z.forEach((bz, k) => {
    const gy = GLAND_Y[k];
    cable(
      g,
      m,
      [
        [0.052, gy, GLAND_Z],
        [0.0595, gy + 0.003, GLAND_Z - 0.003 - 0.004 * k],
        [0.0625 + 0.002 * k, -0.004 - 0.003 * k, (GLAND_Z + bz) / 2 - 0.004],
        [0.058, 0.004, bz],
        [0.05, 0.014, bz],
        [0.046, 0.032, bz],
        [0.0455, y[0] - 0.006, bz],
      ],
      0.003,
      [false, false],
      6,
    );
    latheAlong(
      g,
      m.rubber,
      [
        [0, 0],
        [0, 0.0037],
        [0.003, 0.0037],
        [0.0095, 0.0033],
        [0.0095, 0],
      ],
      [0.0455, y[0] + 0.001, bz],
      new T.Vector3(0, -1, 0),
      12,
    );
  });
  plateWithHoles(
    g,
    m.steel,
    [
      [0.043, -0.0205, 0.002],
      [0.057, -0.0205, 0.002],
      [0.057, -0.0455, 0.003],
      [0.043, -0.0455, 0.003],
    ],
    BUS_Z.map((bz) => circle(0.05, bz, 0.0031, 8)),
    0.012,
    0.016,
    0.0005,
  );
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.002],
      [0.0012, 0.002],
      [0.0012, 0],
    ],
    [0.0455, 0.016, -0.023],
    Y,
    8,
  );
  // Leads.
  COILS.forEach((_, i) => {
    const layer = i < 3 ? 0 : 1,
      col = i % 3;
    const ly = TRAY.floor + 0.0016 + 0.0024 + layer * 0.0049;
    const lz = TRAY.inner - 0.0035 - col * 0.006;
    const tip = lugTip(i);
    const drop = tip.x - 0.008;
    latheAlong(
      g,
      m.rubber,
      [
        [0, 0],
        [0, 0.0034],
        [0.0025, 0.0034],
        [0.0025, 0],
      ],
      [x[1], ly, lz],
      X,
      10,
    );
    cable(
      g,
      m,
      [
        [x[1] + 0.001, ly, lz],
        [x[1] + 0.012, ly, lz],
        [REAR_BULKHEAD[1] + 0.006, ly, lz],
        [Math.max(REAR_BULKHEAD[1] + 0.014, drop - 0.022), ly, lz],
        [drop - 0.006, ly - 0.0015, lz + 0.0005],
        [tip.x - 0.0015, tip.y + 0.0075, (lz + tip.z) / 2],
        [tip.x, tip.y + 0.0012, tip.z],
      ],
      0.0024,
      [false, true],
      5,
    );
  });
}

/** Coolant: a manifold on the rear bulkhead, two corrugated hoses along the
 * right rod to the radiator's right tank, held by saddle clamps. */
function coolant(g: WeaponGeometry, m: WeaponFinish) {
  const mz = -0.051;
  slab(
    g,
    m.metal,
    [
      [REAR_BULKHEAD[1], 0.024, 0.002],
      [0.111, 0.024, 0.004],
      [0.113, 0.03, 0.003],
      [0.113, 0.054, 0.003],
      [0.111, 0.058, 0.004],
      [REAR_BULKHEAD[1], 0.058, 0.002],
    ],
    0.013,
    mz,
    0.0012,
  );
  screw(g, 0.105, 0.0545, mz - 0.0065, m, 0.0016);
  screw(g, 0.105, 0.0275, mz - 0.0065, m, 0.0016);
  // Bleed screw on top.
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0026],
      [0.002, 0.0026],
      [0.002, 0],
    ],
    [0.105, 0.058, mz],
    Y,
    10,
  );
  const levels = [0.0475, 0.0335];
  const clampX = [0.17, 0.245];
  levels.forEach((hy, k) => {
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0042],
        [0.0018, 0.0042],
        [0.0018, 0.0034],
        [0.004, 0.0034],
        [0.0065, 0.0046],
        [0.007, 0.0034],
        [0.0095, 0.0046],
        [0.01, 0.0034],
        [0.01, 0],
      ],
      [0.113, hy, mz],
      X,
      12,
    );
    const barbX = BARB_X[1 - k];
    const end = new T.Vector3(barbX, TANK.y, -TANK.z - TANK.r - 0.004);
    const dive = barbX - 0.026;
    const pts =
      k === 0
        ? [
            [0.1175, hy, mz],
            [0.14, hy, mz - 0.0003],
            [clampX[0], hy, mz],
            [0.21, hy - 0.0008, mz],
            [clampX[1], hy, mz],
            [dive, hy - 0.001, mz - 0.001],
            [barbX - 0.008, 0.024, mz - 0.003],
            [barbX - 0.001, 0.006, mz + 0.002],
            [barbX, -0.0025, end.z - 0.004],
            [end.x, end.y, end.z],
          ]
        : [
            [0.1175, hy, mz],
            [0.14, hy, mz - 0.0003],
            [clampX[0], hy, mz],
            [0.21, hy - 0.0012, mz],
            [clampX[1], hy, mz],
            [dive, hy - 0.002, mz - 0.0005],
            [barbX - 0.009, 0.016, mz + 0.001],
            [barbX - 0.001, 0.002, mz + 0.006],
            [barbX, -0.0035, end.z - 0.003],
            [end.x, end.y, end.z],
          ];
    const curve = route(pts);
    g.add(hose(curve, 0.0055, 0.0058, 6), m.rubber);
    // Worm-drive bands at both ends.
    for (const u of [0, 1]) {
      const p = curve.getPointAt(u),
        t = curve.getTangentAt(u);
      const back = u === 0 ? 0.005 : -0.005;
      latheAlong(
        g,
        m.steel,
        [
          [-0.002, 0.0056],
          [-0.002, 0.0064],
          [0.002, 0.0064],
          [0.002, 0.0056],
          [-0.002, 0.0056],
        ],
        p.clone().addScaledVector(t, back).toArray(),
        t,
        14,
      );
    }
  });
  // Saddle clamps: hoses and the right rod pass through one bolted block.
  for (const x of clampX) {
    const geo = bulkheadPlate(
      [
        [-0.0355, 0.0255, 0.002],
        [-0.059, 0.0255, 0.002],
        [-0.059, 0.0555, 0.002],
        [-0.0355, 0.0555, 0.002],
      ],
      [
        circle(mz, levels[0], 0.0057, 10),
        circle(mz, levels[1], 0.0057, 10),
        circle(-ROD.z, ROD.y, ROD.r + 0.0001, 8),
      ],
      x - 0.003,
      x + 0.003,
      0,
    );
    g.add(geo, m.metal);
    screw(g, x, ROD.y + 0.001, -0.0592, m, 0.0018);
  }
}

// ---------------------------------------------------------------------------
// Standard furniture, authored relative to the clip and stock mounts.

export function createPlasmaFurniture(slot: "clip" | "stock", m: WeaponFinish) {
  const g = new WeaponGeometry();
  inAuthoringFrame(g, (g) =>
    slot === "stock" ? benchStock(g, m) : powerCell(g, m),
  );
  return sizeWeapon(g.finish(`standard-${slot}`, WEAPON_BASIS));
}

/** Power cell: a squat rounded pack in the well, cooling ribs, charge window,
 * rear latch, contacts on top and a pull handle under the rubber base. */
function powerCell(g: WeaponGeometry, m: WeaponFinish) {
  const [mx, my] = PLASMA_MOUNTS.clip;
  g.offset.set(-mx, -my, 0);
  const cx = WELL.x,
    hx = WELL.hx - 0.0055,
    hz = WELL.hz - 0.004;
  const body = (y: number, k = 1) =>
    superRing(
      new T.Vector3(cx, y, 0),
      X,
      Z,
      hx * k,
      hx * k,
      hz * k,
      hz * k,
      7,
      24,
    );
  const ys = [0.002, 0.0015, 0.0, -0.05, -0.075, -0.112];
  g.add(
    shell(ys.map((y, i) => body(y, i === 0 ? 0.95 : i === 1 ? 0.985 : 1))),
    m.metal,
  );
  // Contacts on the top face.
  for (const dz of [-0.008, 0, 0.008])
    chip(g, [cx + 0.02, 0.0024, dz], [0.006, 0.0008, 0.004], m.accent);
  // Cooling ribs all round.
  for (let i = 0; i < 6; i++) {
    const y = -0.08 - i * 0.0048;
    g.add(shell([body(y + 0.0007, 1.075), body(y - 0.0007, 1.075)]), m.metal);
  }
  // Rubber base with a pull handle.
  g.add(
    shell([
      body(-0.1115, 1.02),
      body(-0.112, 1.05),
      body(-0.122, 1.05),
      body(-0.1235, 1.0),
      body(-0.124, 0.9),
    ]),
    m.rubber,
  );
  slab(
    g,
    m.rubber,
    [
      [cx - 0.019, -0.122, 0.002],
      [cx + 0.019, -0.122, 0.002],
      [cx + 0.014, -0.135, 0.006],
      [cx - 0.014, -0.135, 0.006],
    ],
    0.009,
    0,
    0.0015,
    [
      [
        [cx - 0.011, -0.1255],
        [cx + 0.011, -0.1255],
        [cx + 0.0085, -0.131],
        [cx - 0.0085, -0.131],
      ],
    ],
    0.002,
  );
  // Charge window on the left: bezel and five segments.
  const wy = [-0.072, -0.054];
  slab(
    g,
    m.rubber,
    [
      [cx - 0.024, wy[0]],
      [cx + 0.014, wy[0]],
      [cx + 0.014, wy[1]],
      [cx - 0.024, wy[1]],
    ],
    0.0018,
    hz + 0.0005,
    0,
    [
      [
        [cx - 0.0225, wy[0] + 0.0028],
        [cx + 0.0125, wy[0] + 0.0028],
        [cx + 0.0125, wy[1] - 0.0028],
        [cx - 0.0225, wy[1] - 0.0028],
      ],
    ],
    0.002,
  );
  for (let i = 0; i < 5; i++)
    chip(
      g,
      [cx - 0.0185 + i * 0.0068, (wy[0] + wy[1]) / 2, hz + 0.0002],
      [0.0048, 0.0105, 0.0008],
      i < 3 ? m.light : m.rubber,
    );
  // Latch lever on the rear face, hooking the well's lip.
  slab(
    g,
    m.metal,
    band(
      [
        [cx - hx - 0.0012, -0.046],
        [cx - hx - 0.0024, -0.056],
        [cx - hx - 0.0026, -0.066],
        [cx - hx - 0.0052, -0.072],
      ],
      0.0018,
      16,
    ),
    0.011,
    0,
    0,
    [],
    0,
  );
  g.cylinder(
    [cx - hx - 0.0008, -0.067, 0],
    0.0019,
    0.016,
    m.steel,
    "z",
    0.0019,
    10,
  );
}

/** Bench stock: the extension tube, a swept strut to the toe, a cheek pad on
 * the tube and a skeleton butt plate with its rubber pad. */
function benchStock(g: WeaponGeometry, m: WeaponFinish) {
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
    0,
    16,
  );
  lathe(
    g,
    m.metal,
    [
      [-0.196, 0],
      [-0.196, 0.0128],
      [-0.0095, 0.0128],
      [-0.0095, 0],
    ],
    0,
    0,
    16,
  );
  // Collar with the length-of-pull knob.
  lathe(
    g,
    m.steel,
    [
      [-0.064, 0],
      [-0.064, 0.0136],
      [-0.0625, 0.0146],
      [-0.0505, 0.0146],
      [-0.049, 0.0136],
      [-0.049, 0],
    ],
    0,
    0,
    16,
  );
  latheAlong(
    g,
    m.rubber,
    [
      [0, 0],
      [0, 0.0045],
      [0.0058, 0.0045],
      [0.0066, 0.0036],
      [0.0066, 0],
    ],
    [-0.0565, -0.0135, 0],
    new T.Vector3(0, -1, 0),
    10,
  );
  // Strut: swept tube from the collar down to the butt plate's toe.
  const strut = route([
    [-0.0565, -0.0185, 0],
    [-0.09, -0.04, 0],
    [-0.145, -0.074, 0],
    [-0.186, -0.096, 0],
  ]);
  g.add(sweep(strut, 0.0055, 18, 8), m.metal);
  latheAlong(
    g,
    m.steel,
    [
      [-0.004, 0],
      [-0.004, 0.0068],
      [0.004, 0.0068],
      [0.004, 0],
    ],
    strut.getPointAt(0.97).toArray(),
    strut.getTangentAt(0.97),
    10,
  );
  // Cheek pad riding on the tube.
  slab(
    g,
    m.rubber,
    [
      [-0.07, 0.011, 0.004],
      [-0.178, 0.011, 0.004],
      [-0.182, 0.024, 0.006],
      [-0.166, 0.0315, 0.01],
      [-0.1, 0.0305, 0.02],
      [-0.074, 0.022, 0.006],
    ],
    0.03,
    0,
    0.003,
  );
  // Butt plate: graphite skeleton, rubber pad.
  slab(
    g,
    m.metal,
    [
      [-0.19, 0.028, 0.004],
      [-0.2005, 0.028, 0.003],
      [-0.2005, -0.104, 0.003],
      [-0.19, -0.104, 0.004],
    ],
    0.034,
    0,
    0.0014,
    [
      [
        [-0.193, -0.032, 0.002],
        [-0.1975, -0.032, 0.002],
        [-0.1975, -0.07, 0.002],
        [-0.193, -0.07, 0.002],
      ],
    ],
  );
  slab(
    g,
    m.rubber,
    [
      [-0.2, 0.03, 0.005],
      [-0.2125, 0.0285, 0.006],
      [-0.2145, -0.04, 0.05],
      [-0.2155, -0.097, 0.006],
      [-0.2085, -0.1075, 0.005],
      [-0.2, -0.106, 0.004],
    ],
    0.04,
    0,
    0.0025,
  );
  for (const y of [0.018, -0.094]) screw(g, -0.1955, y, 0.0172, m, 0.0022);
  g.ring([-0.188, -0.104, 0], 0.0058, 0.0012, m.steel, "z");
}
