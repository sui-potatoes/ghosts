// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { WeaponGeometry, WeaponFinish } from "./weapon-finish.ts";
import {
  X,
  Z,
  bump,
  inAuthoringFrame,
  latheAt,
  shell,
  smooth,
  superRing,
  toWeaponFrame,
  type P2,
} from "./rifle-shapes.ts";

/** K-12 service pistol: generic full-size, locked-breech, striker-fired,
 * polymer frame. Authored at real size in metres, +X muzzle, +Y up, +Z the
 * shooter's left (the authoring frame in rifle-shapes.ts), in the current sidearm's frame (same origin; the grip web stays where the
 * current sidearm has it). Like the current sidearm, no sizing is applied.
 * Not linked into the equipment assets yet. */
export const PISTOL_BORE = 0.026;
const B = PISTOL_BORE;
/** Slide/frame parting line; the bore sits 18 above it. */
const SPLIT = 0.008;
const SLIDE = {
  rear: -0.099,
  front: 0.087,
  top: 0.04,
  half: 0.0142,
  wall: 0.0022,
};
/** Ejection port [rear, front]; it opens from PORT_Y on the right flank up
 * over the top to PORT_Z, left of centre. The breech face is its rear wall. */
const PORT: [number, number] = [-0.0285, 0.0015];
const PORT_Y = 0.028;
const PORT_Z = 0.0025;
const MUZZLE = 0.0862;
/** Crown centre; on the centre line, so the same in either frame. */
export const PISTOL_MUZZLE = [MUZZLE, B, 0] as const;
/** Recoil-spring guide rod axis. */
const GUIDE = B - 0.0115;
/** Nose plate (bored for barrel and guide rod) starts here. */
const NOSE = 0.0838;
/** Serration groove depth. */
const SERRATION = 0.0008;
/** Dust-cover underside. */
const DUST = -0.0045;
const FRAME_HALF = 0.0125;
/** Deepest point of the web between beavertail and backstrap. */
export const PISTOL_WEB = [-0.0915, 0.003] as const;
const WEB = PISTOL_WEB;
const deg = Math.PI / 180;
const K_BACK = Math.tan(16 * deg);
/** Front strap and magazine rake, 20° from vertical. */
const K_RAKE = Math.tan(20 * deg);
const GRIP_FLOOR = -0.0845;
const BASE_FLOOR = -0.092;
/** Trigger blade face at finger-pad height, ~72 from the backstrap. */
export const PISTOL_TRIGGER = [-0.0236, -0.0115] as const;
const RAIL = { x0: 0.032, x1: 0.066, y: -0.0083 };

/** Mount points in the weapon frame: a light/laser rail under the dust
 * cover, and the crown. */
export const PISTOL_MOUNTS = toWeaponFrame({
  rail: [(RAIL.x0 + RAIL.x1) / 2, RAIL.y, 0],
  muzzle: [MUZZLE, B, 0],
});

const gripBack = (y: number) =>
  WEB[0] + (y - WEB[1]) * K_BACK - 0.0011 * bump(y, -0.05, 0.018);
const gripFront = (y: number) => -0.0435 + (y + 0.004) * K_RAKE;
const gripHalf = (y: number) =>
  0.0127 + 0.003 * smooth(0, -0.017, y) + 0.001 * bump(y, -0.04, 0.02);
const flare = (y: number) => smooth(-0.073, GRIP_FLOOR, y);
/** Magazine centre line: 34 fore-aft, its top under the breech. */
const magCenter = (y: number) => -0.0606 + (y - 0.004) * K_RAKE;

export function servicePistol(g: WeaponGeometry, m: WeaponFinish) {
  inAuthoringFrame(g, (g) => {
    slide(g, m);
    barrel(g, m);
    sights(g, m);
    frame(g, m);
    grip(g, m);
    magazine(g, m);
    controls(g, m);
  });
}

// ---------------------------------------------------------------------------
// Local shape helpers (low segment counts: a pistol is small on screen).

/** Polygon rounded at every corner with r > 0 by a fixed number of points,
 * so sections of different sizes keep identical topology for lofting. */
function corners(points: P2[], segs = 2): T.Vector2[] {
  const out: T.Vector2[] = [];
  const n = points.length;
  const at = (i: number) => {
    const p = points[(i + n) % n];
    return new T.Vector2(p[0], p[1]);
  };
  for (let i = 0; i < n; i++) {
    const p = at(i),
      r = points[i][2] ?? 0;
    if (r <= 0) {
      out.push(p);
      continue;
    }
    const da = p.clone().sub(at(i - 1)),
      db = at(i + 1).sub(p);
    const la = da.length(),
      lb = db.length();
    da.divideScalar(la);
    db.divideScalar(lb);
    const turn = Math.acos(Math.min(1, Math.max(-1, da.dot(db))));
    const t = Math.min(r * Math.tan(turn / 2), la * 0.48, lb * 0.48);
    const s = p.clone().addScaledVector(da, -t),
      e = p.clone().addScaledVector(db, t);
    for (let k = 0; k <= segs; k++) {
      const u = k / segs,
        a = (1 - u) ** 2,
        b = 2 * (1 - u) * u,
        c = u * u;
      out.push(
        new T.Vector2(a * s.x + b * p.x + c * e.x, a * s.y + b * p.y + c * e.y),
      );
    }
  }
  return out;
}

const circle = (cz: number, cy: number, r: number, n = 20): P2[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return [cz + Math.cos(a) * r, cy + Math.sin(a) * r, 0] as P2;
  });

/** Outline extruded `depth` along local z, centred, with a rounded edge. */
function plateGeo(
  points: P2[],
  depth: number,
  bevel: number,
  segs = 1,
  holes: P2[][] = [],
  bevelSegs = 1,
) {
  const shape = new T.Shape(corners(points, segs));
  for (const h of holes) shape.holes.push(new T.Path(corners(h, segs)));
  const b = Math.min(bevel, depth * 0.3);
  const geo = new T.ExtrudeGeometry(shape, {
    depth: depth - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: bevelSegs,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -(depth - 2 * b) / 2);
  return geo;
}

/** Side profile (x, y) extruded across the width, centred on z. */
function side(
  g: WeaponGeometry,
  m: T.Material,
  points: P2[],
  width: number,
  z = 0,
  bevel = 0.0004,
  segs = 1,
  bevelSegs = 1,
) {
  g.add(plateGeo(points, width, bevel, segs, [], bevelSegs), m, [0, 0, z]);
}

/** Cross-section (z, y), optionally with holes, extruded along +X. */
function along(
  section: P2[],
  x0: number,
  x1: number,
  bevel = 0,
  segs = 1,
  holes: P2[][] = [],
  bevelSegs = 1,
) {
  const flip = (p: P2) => [-p[0], p[1], p[2] ?? 0] as P2;
  const geo = plateGeo(
    section.map(flip),
    x1 - x0,
    bevel,
    segs,
    holes.map((h) => h.map(flip)),
    bevelSegs,
  );
  geo.rotateY(Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// Slide

/** Serrated band on the flanks: grooves run from SER_Y[0] to SER_Y[1]. */
const SER_Y: [number, number] = [SPLIT + 0.0028, SLIDE.top - 0.0082];
/** Extractor slot height on the right flank, directly under the port. */
const EXTRACTOR_Y: [number, number] = [PORT_Y - 0.0042, PORT_Y];
const EXTRACTOR_X: [number, number] = [PORT[0] - 0.018, PORT[0]];

/** Slide section (z, y): flat flanks, radiused shoulders, a flat sighting
 * plane. One section for the whole slide; `recess` sinks only the serrated
 * band of the flanks. Mirrored about z = 0, with vertices on the port,
 * extractor-slot and serration edges so those cut cleanly. */
function slideSection(
  flank: number,
  top: number,
  bottom: number,
  inner: boolean,
  recess = 0,
): P2[] {
  const sunk = flank - recess;
  const [y0, y1] = SER_Y;
  const half: P2[] = [
    [PORT_Z, top, 0],
    inner ? [0.0066, top, 0.0008] : [0.0075, top, 0.001],
    inner ? [0.01, top - 0.0018, 0.0025] : [0.0115, top - 0.002, 0.003],
    inner ? [flank, top - 0.0055, 0.002] : [flank, top - 0.0065, 0.0025],
    [flank, y1 + 0.0003, 0],
    [sunk, y1, 0],
    [sunk, PORT_Y, 0],
    [sunk, EXTRACTOR_Y[0], 0],
    [sunk, y0, 0],
    [flank, y0 - 0.0003, 0],
    [flank, bottom, inner ? 0.0006 : 0.0008],
  ];
  return [
    [0, top, 0],
    ...half,
    [0, bottom, 0],
    ...half.map(([z, y, r]) => [-z, y, r] as P2).reverse(),
  ];
}

/** Outer slide section with rear round-off `d`, serration recess `r` and a
 * slight flank taper `f` at the nose (the sighting plane stays level). */
const outerSection = (d = 0, r = 0, f = 0) =>
  slideSection(SLIDE.half - d - f, SLIDE.top - d, SPLIT + d * 0.3, false, r);
const innerSection = () =>
  slideSection(
    SLIDE.half - SLIDE.wall,
    SLIDE.top - SLIDE.wall,
    SPLIT + SLIDE.wall,
    true,
  );

/** Skin through rings of equal vertex count with cells removed by `hole`;
 * every hole gets side walls down to the matching `inner` ring, so cuts have
 * real depth without a hidden inner surface. The rear end is capped. */
function skin(
  outer: T.Vector3[][],
  inner: T.Vector3[][],
  hole: (c: T.Vector3) => boolean,
) {
  const S = outer.length,
    N = outer[0].length,
    pos: number[] = [];
  const centroid = (ring: T.Vector3[]) =>
    ring.reduce((s, p) => s.add(p), new T.Vector3()).divideScalar(ring.length);
  const center = outer.map(centroid);
  const poly = (pts: T.Vector3[], want: T.Vector3) => {
    const n = new T.Vector3()
      .subVectors(pts[1], pts[0])
      .cross(new T.Vector3().subVectors(pts[2], pts[0]));
    if (n.lengthSq() < 1e-18 && pts.length > 3)
      n.subVectors(pts[2], pts[1]).cross(
        new T.Vector3().subVectors(pts[3], pts[1]),
      );
    if (n.dot(want) < 0) pts = [...pts].reverse();
    for (let k = 1; k + 1 < pts.length; k++)
      pos.push(
        ...pts[0].toArray(),
        ...pts[k].toArray(),
        ...pts[k + 1].toArray(),
      );
  };
  const w = (j: number) => (j + N) % N;
  const mid = (i: number, j: number) =>
    outer[i][w(j)]
      .clone()
      .add(outer[i + 1][w(j)])
      .add(outer[i + 1][w(j + 1)])
      .add(outer[i][w(j + 1)])
      .multiplyScalar(0.25);
  const solid = (i: number, j: number) =>
    i < 0 || i >= S - 1 || !hole(mid(i, j));
  for (let i = 0; i < S - 1; i++)
    for (let j = 0; j < N; j++) {
      if (!solid(i, j)) continue;
      const jn = w(j + 1),
        c = mid(i, j);
      const axis = center[i]
        .clone()
        .add(center[i + 1])
        .multiplyScalar(0.5);
      poly(
        [outer[i][j], outer[i + 1][j], outer[i + 1][jn], outer[i][jn]],
        c.clone().sub(axis),
      );
      if (!solid(i, j - 1))
        poly(
          [outer[i][j], outer[i + 1][j], inner[i + 1][j], inner[i][j]],
          mid(i, j - 1).sub(c),
        );
      if (!solid(i, j + 1))
        poly(
          [outer[i][jn], outer[i + 1][jn], inner[i + 1][jn], inner[i][jn]],
          mid(i, j + 1).sub(c),
        );
      if (!solid(i - 1, j))
        poly(
          [outer[i][j], outer[i][jn], inner[i][jn], inner[i][j]],
          mid(i - 1, j).sub(c),
        );
      if (!solid(i + 1, j))
        poly(
          [
            outer[i + 1][j],
            outer[i + 1][jn],
            inner[i + 1][jn],
            inner[i + 1][j],
          ],
          mid(i + 1, j).sub(c),
        );
    }
  const back = center[0].clone().sub(center[1]);
  for (let j = 0; j < N; j++)
    poly([center[0], outer[0][j], outer[0][w(j + 1)]], back);
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    "uv",
    new T.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  geo.computeVertexNormals();
  return geo;
}

function slide(g: WeaponGeometry, m: WeaponFinish) {
  const { rear, front, top, half, wall } = SLIDE;
  const R = SERRATION;
  const ring = (x: number, section: P2[]) =>
    corners(section).map((p) => new T.Vector3(x, p.y, p.x));
  // One body, one section: [x, rear round-off, serration recess, nose taper].
  const stations: [number, number, number, number][] = [
    [rear, 0.0007, 0, 0],
    [rear + 0.0009, 0, 0, 0],
    [-0.0937, 0, 0, 0],
    [-0.0934, 0, R, 0],
    [-0.0666, 0, R, 0],
    [-0.0663, 0, 0, 0],
    [EXTRACTOR_X[0], 0, 0, 0],
    [PORT[0], 0, 0, 0],
    [PORT[1], 0, 0, 0],
    [0.0438, 0, 0, 0],
    [0.0441, 0, R, 0],
    [0.0662, 0, R, 0],
    [0.0665, 0, 0, 0],
    [0.074, 0, 0, 0],
    [NOSE, 0, 0, 0.0012],
  ];
  const inside = innerSection();
  const inPort = (c: T.Vector3) =>
    c.x > PORT[0] && c.x < PORT[1] && c.z < PORT_Z && c.y > PORT_Y;
  const inSlot = (c: T.Vector3) =>
    c.x > EXTRACTOR_X[0] &&
    c.x < EXTRACTOR_X[1] &&
    c.z < -half + 0.001 &&
    c.y > EXTRACTOR_Y[0] &&
    c.y < EXTRACTOR_Y[1];
  g.add(
    skin(
      stations.map(([x, d, r, f]) => ring(x, outerSection(d, r, f))),
      stations.map(([x]) => ring(x, inside)),
      (c) => inPort(c) || inSlot(c),
    ),
    m.metal,
  );
  // Nose plate bored for the barrel (with clearance) and the guide rod.
  g.add(
    along(
      // 0.1 inside the skin where they overlap, so no coplanar faces.
      slideSection(
        SLIDE.half - 0.0013,
        SLIDE.top - 0.0001,
        SPLIT + 0.0001,
        false,
      ),
      NOSE - 0.0015,
      front,
      0.0005,
      2,
      [circle(0, B, 0.0071, 20), circle(0, GUIDE, 0.0041, 14)],
      2,
    ),
    m.metal,
  );
  // Breech block inside the slide: its face closes the port's rear and backs
  // the extractor slot. The cover plate sits flush in the rear face.
  const grown = (k: number) =>
    inside.map(
      ([z, y, r]) =>
        [z * k, (top + SPLIT) / 2 + (y - (top + SPLIT) / 2) * k, r] as P2,
    );
  g.add(along(grown(1.01), rear + 0.0012, PORT[0], 0), m.metal);
  g.add(along(grown(0.84), rear - 0.00005, rear + 0.0013, 0.0002), m.shell);
  latheAt(
    g,
    m.steel,
    [
      [rear - 0.0006, 0],
      [rear - 0.0006, 0.0011],
      [rear - 0.0003, 0.0014],
      [rear + 0.0005, 0.0014],
      [rear + 0.0005, 0],
    ],
    B - 0.0045,
    0,
    12,
  );
  // Cocking serrations: angled grooves cut 0.9 into the flanks; the lands
  // between them restore the flank, so the outside stays one surface.
  const serrations = (edge0: number, edge1: number, count: number) => {
    const [y0, y1] = SER_Y,
      lean = (y1 - y0) * Math.tan(9 * deg),
      groove = 0.0013,
      pitch = 0.003;
    const span = (count - 1) * pitch + groove + lean;
    const s = edge0 + (edge1 - edge0 - span) / 2;
    // Lands as [bottom rear, bottom front, top rear, top front].
    const lands: number[][] = [];
    let prev = [edge0, edge0];
    for (let k = 0; k < count; k++) {
      const gx = s + k * pitch;
      lands.push([prev[0], gx, prev[1], gx + lean]);
      prev = [gx + groove, gx + groove + lean];
    }
    lands.push([prev[0], edge1, prev[1], edge1]);
    for (const [b0, b1, t0, t1] of lands)
      for (const z of [-1, 1])
        side(
          g,
          m.metal,
          [
            [b0, y0],
            [b1, y0],
            [t1, y1],
            [t0, y1],
          ],
          R + 0.0002,
          z * (half - (R + 0.0002) / 2),
          0.0002,
        );
  };
  serrations(-0.0934, -0.0666, 8);
  serrations(0.0441, 0.0662, 6);
  // External extractor: a short bar flush in its slot right behind the port,
  // at the case-rim height, claw end at the port's rear edge, pivot pin.
  const gap = 0.0003;
  side(
    g,
    m.steel,
    [
      [EXTRACTOR_X[0] + gap, EXTRACTOR_Y[0] + gap, 0.0012],
      [EXTRACTOR_X[1] - gap, EXTRACTOR_Y[0] + gap, 0.0003],
      [EXTRACTOR_X[1] - gap, EXTRACTOR_Y[1] - gap, 0.0003],
      [EXTRACTOR_X[0] + gap, EXTRACTOR_Y[1] - gap, 0.0012],
    ],
    wall - 0.0004,
    -(half - 0.00005 - (wall - 0.0004) / 2),
    0.00025,
  );
  g.cylinder(
    [EXTRACTOR_X[0] + 0.004, (EXTRACTOR_Y[0] + EXTRACTOR_Y[1]) / 2, -half],
    0.0008,
    0.0003,
    m.metal,
    "z",
    0.0008,
    10,
  );
}

// ---------------------------------------------------------------------------
// Barrel, hood, recoil assembly

function barrel(g: WeaponGeometry, m: WeaponFinish) {
  const rear = PORT[0] + 0.0008;
  latheAt(
    g,
    m.steel,
    [
      [rear, 0],
      [rear, 0.0058],
      [rear + 0.0008, 0.0072],
      [-0.004, 0.0072],
      [-0.0025, 0.0066],
      [MUZZLE - 0.0008, 0.0066],
      [MUZZLE, 0.0059],
      [MUZZLE, 0.0053],
      [MUZZLE - 0.0009, 0.0046],
      [MUZZLE - 0.012, 0.0046],
      [MUZZLE - 0.012, 0],
    ],
    B,
    0,
    20,
  );
  // Chamber block: in battery it fills the port flush with the sighting
  // plane and the right flank, 0.4 clear of every port edge, with a small
  // chamfer and a loaded-chamber witness notch at the rear of the hood.
  const gap = 0.0004,
    { top, half, wall } = SLIDE;
  g.add(
    along(
      [
        [PORT_Z - gap, top - 0.0001],
        [-0.0075, top - 0.0001, 0.001],
        [-0.0115, top - 0.0021, 0.003],
        [-(half - 0.0001), top - 0.0066, 0.0025],
        [-(half - 0.0001), PORT_Y + gap],
        [-(half - wall - 0.0004), PORT_Y + gap],
        [-(half - wall - 0.0004), B - 0.002],
        [PORT_Z - gap, B - 0.002],
      ],
      PORT[0] + gap,
      PORT[1] - gap,
      0.0003,
      2,
    ),
    m.steel,
  );
  g.add(
    along(
      [
        [-0.0032, top - 0.0004],
        [-0.0012, top - 0.0004],
        [-0.0016, top + 0.00004],
        [-0.0028, top + 0.00004],
      ],
      PORT[0] + gap + 0.0004,
      PORT[0] + gap + 0.0026,
    ),
    m.metal,
  );
  // Guide rod with its flanged head and the last spring coil inside the bore.
  latheAt(
    g,
    m.steel,
    [
      [-0.012, 0],
      [-0.012, 0.0024],
      [MUZZLE - 0.0035, 0.0024],
      [MUZZLE - 0.003, 0.003],
      [MUZZLE - 0.0006, 0.003],
      [MUZZLE - 0.0002, 0.0026],
      [MUZZLE - 0.0002, 0],
    ],
    GUIDE,
    0,
    12,
  );
  g.add(
    new T.TorusGeometry(0.0034, 0.00055, 5, 14),
    m.metal,
    [NOSE - 0.0002, GUIDE, 0],
    new T.Euler(0, Math.PI / 2, 0),
  );
}

// ---------------------------------------------------------------------------
// Sights: steel, dovetailed across the slide.

function sights(g: WeaponGeometry, m: WeaponFinish) {
  const top = SLIDE.top;
  // The dovetail's ends show on both chamfers.
  const dovetail = (x0: number, x1: number) =>
    g.add(
      along(
        [
          [-0.0119, top - 0.0021],
          [0.0119, top - 0.0021],
          [0.0074, top + 0.0001],
          [-0.0074, top + 0.0001],
        ],
        x0,
        x1,
        0.0002,
      ),
      m.steel,
    );
  // Rear: square notch, flat rear face, low ramp ahead of it.
  dovetail(-0.0918, -0.0852);
  g.add(
    along(
      [
        [-0.0082, top],
        [0.0082, top],
        [0.0082, top + 0.0047, 0.0008],
        [0.0017, top + 0.0053],
        [0.0017, top + 0.003, 0.0004],
        [-0.0017, top + 0.003, 0.0004],
        [-0.0017, top + 0.0053],
        [-0.0082, top + 0.0047, 0.0008],
      ],
      -0.0925,
      -0.0858,
      0.0003,
    ),
    m.steel,
  );
  side(
    g,
    m.steel,
    [
      [-0.086, top],
      [-0.0825, top],
      [-0.086, top + 0.0026, 0.0006],
    ],
    0.0164,
    0,
    0.0003,
  );
  // Front: ramped post.
  dovetail(0.0768, 0.0812);
  side(
    g,
    m.steel,
    [
      [0.0762, top],
      [0.0822, top],
      [0.0822, top + 0.0014, 0.0008],
      [0.0784, top + 0.0055, 0.0006],
      [0.0762, top + 0.0055, 0.0004],
    ],
    0.0034,
    0,
    0.0003,
  );
  // Witness dots on the rear faces.
  for (const [x, z] of [
    [-0.0925, 0.0047],
    [-0.0925, -0.0047],
    [0.0762, 0],
  ])
    latheAt(
      g,
      m.marking,
      [
        [x - 0.0003, 0],
        [x - 0.0003, 0.0009],
        [x + 0.0002, 0.0009],
        [x + 0.0002, 0],
      ],
      top + 0.0039,
      z,
      10,
    );
}

// ---------------------------------------------------------------------------
// Frame: polymer upper with dust cover and rail, guard bow, grip loft.

function frame(g: WeaponGeometry, m: WeaponFinish) {
  side(
    g,
    m.shell,
    [
      [-0.1035, SPLIT, 0.0012],
      [0.0705, SPLIT, 0.0008],
      [0.0722, 0.002, 0.003],
      [0.0705, DUST, 0.002],
      [-0.003, DUST, 0.001],
      [-0.004, -0.003, 0.001],
      [-0.0386, -0.003, 0.003],
      [-0.0445, -0.003],
      [-0.0465, -0.0105],
      [-0.087, -0.0105],
      [-0.087, -0.003],
      [WEB[0] + 0.0003, WEB[1] + 0.0011, 0.0025],
      [-0.0985, 0.0052, 0.003],
      [-0.1035, 0.0055, 0.002],
    ],
    FRAME_HALF * 2,
    0,
    0.0012,
    2,
    2,
  );
  // Trigger guard, part of the frame: a 5.5 band, 13.5 across, as one
  // filleted side profile around the finger opening. Squared,
  // slightly hooked front filleted into the dust cover; flat floor sweeping
  // up a little; the rear undercut where it blends into the front strap.
  // Outer edge down the front, along the floor and up into the grip, then the
  // finger opening back to the front; open at the top, inside the frame.
  side(
    g,
    m.shell,
    [
      [0.003, 0.004],
      [0.003, -0.0042],
      [-0.0028, -0.0042, 0.003],
      [-0.0028, -0.022],
      [-0.0019, -0.0278, 0.002],
      [-0.0042, -0.032, 0.003],
      [-0.03, -0.031, 0.008],
      [-0.0405, -0.0268, 0.005],
      [-0.0445, -0.0228, 0.004],
      [-0.0497, -0.0195],
      [-0.0482, 0.004],
      [-0.0386, 0.004],
      [-0.0386, -0.019, 0.005],
      [-0.03, -0.0255, 0.005],
      [-0.0083, -0.0265, 0.004],
      [-0.0083, 0.004],
    ],
    0.0135,
    0,
    0.001,
    2,
    1,
  );
  // Accessory rail: four dovetail lugs over a recessed spine.
  g.add(
    along(
      [
        [-0.0072, DUST + 0.0005],
        [0.0072, DUST + 0.0005],
        [0.0072, RAIL.y + 0.0019],
        [-0.0072, RAIL.y + 0.0019],
      ],
      RAIL.x0,
      RAIL.x1,
      0.0003,
    ),
    m.shell,
  );
  const lug: P2[] = [
    [-0.0104, DUST + 0.0005],
    [0.0104, DUST + 0.0005],
    [0.0104, RAIL.y + 0.0023],
    [0.0083, RAIL.y],
    [-0.0083, RAIL.y],
    [-0.0104, RAIL.y + 0.0023],
  ];
  for (let k = 0; k < 4; k++) {
    const x = RAIL.x0 + 0.0015 + k * 0.0085;
    g.add(along(lug, x, x + 0.005, 0.0003), m.shell);
  }
}

/** Point on a superellipse ring at angle `a` (0 = front, +90° = left). */
function superAt(
  c: T.Vector3,
  front: number,
  back: number,
  half: number,
  n: number,
  a: number,
) {
  const ca = Math.cos(a),
    sa = Math.sin(a),
    p = 2 / n;
  return new T.Vector3(
    c.x + Math.sign(ca) * Math.abs(ca) ** p * (ca >= 0 ? front : back),
    c.y,
    c.z + Math.sign(sa) * Math.abs(sa) ** p * half,
  );
}

/** Grip panels by angle around the grip (degrees, 0 = front strap). */
const PANELS: [number, number][] = [
  [-20, 20],
  [50, 130],
  [155, 205],
  [230, 310],
];
const PANEL_Y: [number, number] = [-0.014, -0.066];

/** Grip loft with palm swell, crisp inset texture panels and the flared well. */
function grip(g: WeaponGeometry, m: WeaponFinish) {
  // Columns: every 10°, with a pair straddling each panel edge for a crisp step.
  const edges = PANELS.flat().map((d) => (d + 360) % 360);
  const near = (d: number, w: number) =>
    edges.some((e) => Math.abs(((d - e + 540) % 360) - 180) < w);
  const angles: number[] = [];
  for (let d = 5; d < 360; d += 10) if (!near(d, 2.5)) angles.push(d);
  for (const e of edges) angles.push(e - 1, e + 1);
  angles.sort((a, b) => a - b);
  const panelAt = (d: number) =>
    PANELS.findIndex(([a, b]) => {
      const x = (d - a + 360) % 360;
      return x > 0 && x < b - a;
    });
  // Rows: up to the parting line, with pairs straddling the panel top and bottom.
  const [hi, lo] = PANEL_Y;
  const ys: number[] = [0.0072, 0.0045, 0.0015, -0.0015];
  for (let y = -0.0042; y >= -0.0722; y -= 0.0032)
    if (Math.abs(y - hi) > 0.0012 && Math.abs(y - lo) > 0.0012) ys.push(y);
  ys.push(hi + 0.0004, hi - 0.0004, lo + 0.0004, lo - 0.0004);
  ys.sort((a, b) => b - a);
  const outer = (y: number, f = 0) => {
    const back = gripBack(y) - 0.0012 * f,
      front = gripFront(y) + 0.0012 * f;
    const e = (front - back) / 2,
      h = gripHalf(y) + 0.0009 * f;
    const c = new T.Vector3((front + back) / 2, y, 0);
    return angles.map((d) => superAt(c, e, e, h, 2.5, d * deg));
  };
  const rings = ys.map((y, i) => {
    const c = new T.Vector3((gripBack(y) + gripFront(y)) / 2, y, 0);
    return outer(y).map((p, k) => {
      const panel = panelAt(angles[k]);
      if (panel < 0 || y > hi || y < lo) return p;
      // Inset 0.7; the side panels carry a fine stipple.
      const stipple = panel % 2 ? ((i + k) % 2 ? 0.00024 : -0.0001) : 0;
      const n = p.clone().sub(c).setY(0).normalize();
      return p.clone().addScaledVector(n, -0.0007 + stipple);
    });
  });
  g.add(shell(rings), m.shell);
  // Magazine well: walled, flared, open at the mouth.
  const levels = [ys[ys.length - 1], -0.077, -0.081, -0.0832, GRIP_FLOOR];
  const well = (y: number) => {
    const f = flare(y);
    const e = 0.0178 + 0.0012 * f,
      h = 0.0118 + 0.001 * f;
    const c = new T.Vector3(magCenter(y), y, 0);
    return angles.map((d) => superAt(c, e, e, h, 2.6, d * deg));
  };
  g.add(
    shell(
      levels.map((y) => outer(y, flare(y))),
      { inner: levels.map(well), open: [false, true] },
    ),
    m.shell,
  );
}

function magazine(g: WeaponGeometry, m: WeaponFinish) {
  const body = (y: number) =>
    superRing(
      new T.Vector3(magCenter(y), y, 0),
      X,
      Z,
      0.017,
      0.017,
      0.0112,
      0.0112,
      2.8,
      20,
    );
  g.add(shell([body(0.004), body(GRIP_FLOOR - 0.0008)]), m.metal);
  // Baseplate: rounded, wider than the body, with a forward finger ledge.
  const c = magCenter(-0.088) - 0.001;
  const plates: [number, number, number][] = [
    [GRIP_FLOOR - 0.0006, 0.96, 0.0012],
    [GRIP_FLOOR - 0.0013, 1, 0.002],
    [-0.0878, 1, 0.0016],
    [-0.0904, 0.985, 0.0004],
    [BASE_FLOOR + 0.0006, 0.93, 0],
    [BASE_FLOOR, 0.72, 0],
  ];
  g.add(
    shell(
      plates.map(([y, s, ledge]) =>
        superRing(
          new T.Vector3(c, y, 0),
          X,
          Z,
          (0.0212 + ledge) * s,
          0.0218 * s,
          0.0139 * s,
          0.0139 * s,
          2.6,
          32,
        ),
      ),
    ),
    m.shell,
  );
}

// ---------------------------------------------------------------------------
// Controls and pins

function controls(g: WeaponGeometry, m: WeaponFinish) {
  const zf = FRAME_HALF;
  const pin = (x: number, y: number, r = 0.0016, length = zf * 2 + 0.0004) =>
    g.cylinder([x, y, 0], r, length, m.steel, "z", r, 10);
  pin(-0.002, 0.0028); // locking block
  pin(-0.0305, 0.0026); // trigger
  pin(-0.0868, 0.0042); // trigger housing
  // Lanyard pin across the backstrap heel.
  const ly = -0.0775;
  pin(gripBack(ly) + 0.0055, ly, 0.0017, 2 * gripHalf(ly) * 0.86);
  // Trigger: the finger pulls on the front face, which is concave toward the
  // muzzle; the blade's middle sits rearmost and its rounded tip sweeps
  // forward. The safety blade stands 0.7 proud in the middle of that face.
  side(
    g,
    m.steel,
    [
      [-0.0227, 0.001],
      [-0.0235, -0.005],
      [-0.024, -0.0115],
      [-0.0235, -0.0165],
      [-0.0216, -0.0199],
      [-0.0183, -0.0214, 0.0012],
      [-0.0187, -0.0236, 0.0012],
      [-0.0224, -0.0229],
      [-0.0259, -0.0199],
      [-0.0279, -0.0165],
      [-0.0284, -0.0115],
      [-0.0279, -0.005],
      [-0.0271, 0.001],
    ],
    0.0075,
    0,
    0.0007,
    2,
    2,
  );
  side(
    g,
    m.metal,
    [
      [-0.0236, -0.0055, 0.0005],
      [-0.0233, -0.0115],
      [-0.0236, -0.0165, 0.0005],
      [-0.0246, -0.0165, 0.0005],
      [-0.0248, -0.0115],
      [-0.0246, -0.0055, 0.0005],
    ],
    0.0018,
    0,
    0.0003,
  );
  // Takedown tabs on both sides above the guard.
  for (const z of [-1, 1])
    side(
      g,
      m.steel,
      [
        [0.0035, 0.0002, 0.0012],
        [0.0125, 0.0002, 0.0012],
        [0.0125, 0.0052, 0.0012],
        [0.0035, 0.0052, 0.0012],
      ],
      0.0012,
      z * (zf + 0.0003),
      0.0003,
    );
  // Slide stop on the left: thin lever, its tab just under the slide.
  side(
    g,
    m.steel,
    [
      [-0.0415, 0.0022, 0.0011],
      [-0.0175, 0.0026, 0.0008],
      [-0.0115, 0.0044, 0.0012],
      [-0.0118, 0.0074, 0.0008],
      [-0.0215, 0.0074, 0.0008],
      [-0.0235, 0.005, 0.0012],
      [-0.0415, 0.0047, 0.0011],
    ],
    0.0014,
    zf + 0.0005,
    0.0004,
  );
  // Reversible magazine release behind the guard: button left, blank right.
  const ry = -0.0105,
    rz = gripHalf(ry) * 0.92;
  for (const [z, depth] of [
    [1, 0.0032],
    [-1, 0.0016],
  ] as const)
    side(
      g,
      z > 0 ? m.steel : m.shell,
      [
        [-0.0565, ry + 0.0045, 0.0022],
        [-0.0475, ry + 0.0045, 0.0022],
        [-0.0475, ry - 0.0045, 0.0022],
        [-0.0565, ry - 0.0045, 0.0022],
      ],
      depth,
      z * (rz + depth / 2 - 0.0012),
      0.0005,
      2,
    );
}
