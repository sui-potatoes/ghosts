// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { gearFinish } from "./gear-geometry.ts";
import { WeaponGeometry, type WeaponFinish } from "./weapon-finish.ts";
import {
  Y,
  extrude,
  familyFinish,
  isLow,
  seg,
  simplifyProfile,
  withDetail,
  type Detail,
  type P2,
} from "./rifle-shapes.ts";

/**
 * Frag Grenade: a standalone preview model. Nothing in the game loads it yet.
 *
 * A two-piece composite body (moulded halves bonded at the seam above the
 * yellow band) over a pre-formed fragmentation liner: the 16 x 6 grid of
 * flat tiles on the outside follows the notched liner, so the body breaks
 * along the grooves. An electro-mechanical fuze screws into the neck and is
 * locked by a hex jam ring. A pressed-steel lever lies over the fuze top,
 * hooks under the hinge lug on the far side and runs down the body under
 * the thrower's fingers; a split pin through the fuze ears and the lever's
 * side flanges holds it down, a polymer keeper holds the pull ring flat.
 * The selector ring sets delay or impact; the window shows the arming state.
 * The stud under the base clicks into a keyhole holder on the vest.
 *
 * Release: keeper up, pin out along +Z (ring with it). The striker under the
 * lever top pushes the lever up; the lever rolls on its hook tip against the
 * lug's underside, swings up and out over the ears and falls clear.
 *
 * About 59 mm across, 107 mm from stud to lever, ~400 g.
 */

// ---------------------------------------------------------------------------
// Axis convention (this file only; it is not a gun and does not use the
// authoring/weapon frames of rifle-shapes.ts):
//
// Metres, real size (`WEAPON_SCALE` not applied: scale it with the guns when
// placing it next to them). +Y up the fuze axis, +X the lever side, +Z the
// side the pull ring hangs on. Origin on the axis at the body's equator,
// about the centre of mass, so a throw can spin it about the origin.
// Revolved parts put angle a at (cos a, 0, sin a): a = 0 is +X, 90° is +Z.

/** Equator radius of the body. */
const R = 0.0295;
/** Top of the body's neck: the fuze's thread shank stands on it. */
const NECK = 0.037;
/** Pin axis (parallel to Z) through the ears and the lever's flanges. */
const PIN: [number, number] = [0.0153, 0.0545];
const PIN_R = 0.00085;
/** The pull ring lies in the plane z = RING_Z; its top passes through the pin's eye. */
const RING_Z = 0.0178;
const RING_R = 0.0105;
/** Hook tip of the lever under the hinge lug: what the lever rolls on when released. */
const HOOK: [number, number] = [-0.0122, 0.0554];
/** Under-face of the lever over the fuze top (also the striker's top). */
const LEVER_TOP = 0.062;
const SHEET = 0.0008;

/** Body radius at height y: superellipse ovoid, fuller below the equator. */
export function fragBodyRadius(y: number) {
  const h = y < 0 ? 0.0405 : 0.043,
    n = y < 0 ? 2.6 : 2.2;
  const t = Math.min(1, Math.abs(y) / h);
  return R * Math.max(0, 1 - t ** n) ** (1 / n);
}

/** Points other code may want, in the grenade frame. */
export const FRAG_GRENADE_POINTS = {
  /** Lever-release pivot (the hook tip), z = 0. */
  leverPivot: [HOOK[0], HOOK[1], 0] as [number, number, number],
  /** Pin axis centre: the pin pulls out along +Z from here. */
  pin: [PIN[0], PIN[1], 0] as [number, number, number],
  /** Palm centre for a throwing hand (lever under the fingers on +X). */
  grip: [0.0, 0.004, 0] as [number, number, number],
  /** Bottom of the carry stud (the keyhole holder's seat). */
  carry: [0, -0.0435, 0] as [number, number, number],
};

/** Labels for a stencil/decal pass: on the band they wrap the body (`r`
 * radius, `angle` the centre in degrees, reading clockwise seen from above);
 * on the fuze they sit flat on its tangent plane. `size` is the cap height
 * band of the text in metres. */
export const FRAG_GRENADE_STENCILS: {
  text: string;
  angle: number;
  y: number;
  r: number;
  size: number;
  tone: "dark" | "light";
  flat?: boolean;
}[] = [
  {
    text: "FRAG / 61   HE",
    angle: 90,
    y: -0.001,
    r: R,
    size: 0.0042,
    tone: "dark",
  },
  {
    text: "LOT 0417-22   GHOST SYSTEMS",
    angle: 270,
    y: -0.001,
    r: R,
    size: 0.0034,
    tone: "dark",
  },
  {
    text: "DLY",
    angle: 158,
    y: 0.0517,
    r: 0.0128,
    size: 0.0019,
    tone: "light",
    flat: true,
  },
  {
    text: "IMP",
    angle: 202,
    y: 0.0517,
    r: 0.0128,
    size: 0.0019,
    tone: "light",
    flat: true,
  },
];

/** The guns' slots, with the band in hazard yellow (slot `05_Copper` keeps
 * its name so skins and tooling address it the same way). */
export function fragGrenadeFinish(base: WeaponFinish = familyFinish()) {
  return {
    ...base,
    accent: gearFinish("05_Copper", 0xc9a23c, 0.15, 0.5, 0.02),
  };
}

// ---------------------------------------------------------------------------
// Revolved surfaces with real grooves.

interface Ring {
  y: number;
  /** Base radius. */
  r: number;
  /** "groove": the whole ring is cut; "edge": only the groove columns are. */
  cut?: "groove" | "edge";
}
interface Strip {
  m: T.Material;
  /** Flat facets (tiles, groove walls) instead of the smooth profile normal. */
  flat: boolean;
}
type Rect = [number, number, number, number];

/**
 * Surface of revolution through `rings` (ordered along the profile, bottom
 * up) at the given column angles. A column flagged in `grooves` sinks by
 * `depth` on "edge" rings; "groove" rings sink everywhere. Strip k (rings k
 * and k + 1) takes `strip(k)`. UVs: u around, v along the profile length,
 * packed into `rect`.
 */
function revolve(
  g: WeaponGeometry,
  rings: Ring[],
  columns: number[],
  grooves: boolean[],
  depth: number,
  strip: (k: number) => Strip,
  rect: Rect,
) {
  const N = columns.length;
  const radius = (ring: Ring, j: number) =>
    ring.cut === "groove" || (ring.cut === "edge" && grooves[j % N])
      ? ring.r - depth
      : ring.r;
  // Profile length for v; profile normal (radial, axial) per ring for smooth strips.
  const len = [0];
  for (let i = 1; i < rings.length; i++)
    len.push(
      len[i - 1] +
        Math.hypot(rings[i].r - rings[i - 1].r, rings[i].y - rings[i - 1].y),
    );
  const total = len[len.length - 1] || 1;
  const normal = rings.map((_, i) => {
    const a = rings[Math.max(0, i - 1)],
      b = rings[Math.min(rings.length - 1, i + 1)];
    const dr = b.r - a.r,
      dy = b.y - a.y,
      l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  const out = new Map<T.Material, { p: number[]; n: number[]; uv: number[] }>();
  const angle = (j: number) =>
    j === N ? columns[0] + Math.PI * 2 : columns[j];
  const vertex = (i: number, j: number) => {
    const a = angle(j),
      r = radius(rings[i], j);
    return new T.Vector3(r * Math.cos(a), rings[i].y, r * Math.sin(a));
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const { m, flat } = strip(i);
    const buf = out.get(m) ?? { p: [], n: [], uv: [] };
    out.set(m, buf);
    for (let j = 0; j < N; j++) {
      const q = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ] as const;
      const v = q.map(([a, b]) => vertex(a, b));
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const [A, B, C] = tri.map((k) => v[k]);
        const fn = B.clone().sub(A).cross(C.clone().sub(A));
        if (fn.lengthSq() < 1e-16) continue;
        fn.normalize();
        for (const k of tri) {
          const [ri, cj] = q[k];
          buf.p.push(v[k].x, v[k].y, v[k].z);
          if (flat) buf.n.push(fn.x, fn.y, fn.z);
          else {
            const a = angle(cj),
              [nr, ny] = normal[ri];
            buf.n.push(nr * Math.cos(a), ny, nr * Math.sin(a));
          }
          buf.uv.push(
            rect[0] + (rect[2] - rect[0]) * (cj / N),
            rect[1] + (rect[3] - rect[1]) * (len[ri] / total),
          );
        }
      }
    }
  }
  for (const [m, { p, n, uv }] of out) {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(p, 3));
    geo.setAttribute("normal", new T.Float32BufferAttribute(n, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.add(geo, m);
  }
}

/** Rescales a part's UVs into an atlas rectangle. */
function pack(geo: T.BufferGeometry, rect: Rect) {
  const uv = geo.getAttribute("uv") as T.BufferAttribute | undefined;
  if (!uv) return geo;
  let u0 = Infinity,
    v0 = Infinity,
    u1 = -Infinity,
    v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    u0 = Math.min(u0, uv.getX(i));
    u1 = Math.max(u1, uv.getX(i));
    v0 = Math.min(v0, uv.getY(i));
    v1 = Math.max(v1, uv.getY(i));
  }
  const su = (rect[2] - rect[0]) / (u1 - u0 || 1),
    sv = (rect[3] - rect[1]) / (v1 - v0 || 1);
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      rect[0] + (uv.getX(i) - u0) * su,
      rect[1] + (uv.getY(i) - v0) * sv,
    );
  return geo;
}

// UV atlas: one island per part family, shared by both details.
const UV = {
  body: [0, 0, 1, 0.56] as Rect,
  fuze: [0, 0.58, 0.5, 0.86] as Rect,
  selector: [0, 0.88, 0.5, 1] as Rect,
  lever: [0.52, 0.58, 0.72, 1] as Rect,
  flange: [0.74, 0.58, 0.86, 0.78] as Rect,
  hardware: [0.74, 0.8, 0.86, 1] as Rect,
  pin: [0.88, 0.58, 1, 1] as Rect,
};

/** Revolved profile [y, r] about +Y, UVs packed. */
function lathe(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  segments: number,
  rect: Rect,
  origin = [0, 0, 0],
  direction = Y,
) {
  const geo = new T.LatheGeometry(
    simplifyProfile(profile).map(
      ([h, r]) => new T.Vector2(Math.max(r, 1e-5), h),
    ),
    segments,
  );
  geo.applyQuaternion(
    new T.Quaternion().setFromUnitVectors(Y, direction.clone().normalize()),
  );
  g.add(pack(geo, rect), m, origin);
}

// ---------------------------------------------------------------------------
// Body

function body(g: WeaponGeometry, m: WeaponFinish) {
  if (isLow()) {
    // Smooth ovoid; the tiles come from the bake. The band keeps its own
    // rings so its colour has edges. No end caps: the stud and the fuze
    // shank cover the axis.
    const ys = [-0.0335, -0.024, -0.011, 0.012, 0.024, 0.032];
    const prof = (y: number) => [y, fragBodyRadius(y)];
    lathe(
      g,
      m.shell,
      [
        [-0.039, 0.009],
        [-0.039, 0.0118],
        ...ys.slice(0, 3).map(prof),
        prof(-0.0055),
      ],
      16,
      [0, 0, 1, 0.25],
    );
    lathe(g, m.accent, [prof(-0.0055), prof(0.0035)], 16, [0, 0.25, 1, 0.3]);
    lathe(
      g,
      m.shell,
      [prof(0.0035), ...ys.slice(3).map(prof), [NECK, 0.0166], [NECK, 0.0134]],
      16,
      [0, 0.3, 1, 0.56],
    );
    return;
  }
  // 16 tile columns; the tile centred on +X carries the lever.
  const P = (Math.PI * 2) / 16,
    gw = 0.0007 / R,
    columns: number[] = [],
    grooves: boolean[] = [];
  for (let k = 0; k < 16; k++) {
    const base = (k + 0.5) * P;
    columns.push(base, base + gw, base + P - gw);
    grooves.push(true, false, false);
  }
  const rings: Ring[] = [];
  const kinds: ("smooth" | "flat" | "band")[] = [];
  const push = (
    y: number,
    kind: "smooth" | "flat" | "band",
    cut?: Ring["cut"],
    r = fragBodyRadius(y),
  ) => {
    rings.push({ y, r, cut });
    kinds.push(kind); // kind of the strip that starts at this ring
  };
  /** Rows of tiles between two smooth rings at y0 and y1 (groove centres
   * evenly spaced, V grooves 1.8 mm wide, 0.7 mm deep). */
  const tiles = (
    y0: number,
    y1: number,
    rows: number,
    after: "smooth" | "band" = "smooth",
  ) => {
    const w = 0.0007,
      step = (y1 - y0 - 2 * w) / rows;
    if (rings[rings.length - 1].y !== y0) push(y0, "flat");
    else
      kinds[kinds.length - 1] =
        kinds[kinds.length - 1] === "band" ? "band" : "flat";
    for (let i = 0; i <= rows; i++) {
      const c = y0 + w + i * step;
      push(c, "flat", "groove");
      if (i < rows) {
        push(c + w, "flat", "edge");
        push(c + step - w, "flat", "edge");
      }
    }
    push(y1, after);
  };
  // Flat bottom (the carry stud's seat), rounded heel.
  push(-0.039, "smooth", undefined, 0);
  push(-0.039, "smooth", undefined, 0.0104);
  push(-0.0384, "smooth");
  tiles(-0.0336, -0.0055, 3, "band");
  // Hazard band; the upper zone's first groove is the half-shell seam.
  tiles(0.0035, 0.031, 3);
  // Shoulder up to the neck lip; the socket face around the fuze shank.
  push(0.0352, "smooth");
  push(0.0367, "smooth", undefined, 0.0168);
  push(NECK, "flat", undefined, 0.0158);
  push(NECK, "flat", undefined, 0.0141);
  push(NECK, "flat", undefined, 0);
  revolve(
    g,
    rings,
    columns,
    grooves,
    0.0005,
    (k) => ({
      m: kinds[k] === "band" ? m.accent : m.shell,
      flat: kinds[k] !== "smooth" && kinds[k] !== "band",
    }),
    UV.body,
  );
}

/** Carry stud under the base: a mushroom head for the vest's keyhole holder. */
function stud(g: WeaponGeometry, m: WeaponFinish) {
  lathe(
    g,
    m.rubber,
    [
      [-0.0388, 0.0094],
      [-0.0399, 0.0088],
      [-0.0403, 0.0056],
      [-0.0416, 0.0056],
      [-0.0419, 0.0082],
      [-0.0431, 0.0082],
      [-0.0435, 0.007],
      [-0.0435, 0],
    ],
    seg(16, 6),
    UV.hardware,
  );
}

// ---------------------------------------------------------------------------
// Fuze

function fuze(g: WeaponGeometry, m: WeaponFinish) {
  const y0 = NECK;
  // Thread shank between the body's neck lip and the jam ring: three crests
  // show; the rest of the thread is inside the neck.
  const shank: number[][] = [[y0 - 0.001, 0.0136]];
  for (let k = 0; k < 3; k++)
    shank.push(
      [y0 + 0.0003 + k * 0.001, 0.0136],
      [y0 + 0.0008 + k * 0.001, 0.0128],
    );
  shank.push([y0 + 0.0032, 0.0136]);
  lathe(g, m.metal, shank, seg(20, 8), UV.fuze);

  // Hex jam ring (flats facing +X): wrench-tightened against the neck.
  const hex = [Math.PI / 6];
  for (let k = 1; k < 6; k++) hex.push(Math.PI / 6 + (k * Math.PI) / 3);
  const c = 1 / Math.cos(Math.PI / 6);
  revolve(
    g,
    isLow()
      ? [
          { y: y0 + 0.0032, r: 0.0136 },
          { y: y0 + 0.0032, r: 0.0152 * c },
          { y: y0 + 0.0072, r: 0.0152 * c },
          { y: y0 + 0.0072, r: 0.0128 },
        ]
      : [
          { y: y0 + 0.0032, r: 0.0136 },
          { y: y0 + 0.0032, r: 0.0143 * c },
          { y: y0 + 0.0037, r: 0.0152 * c },
          { y: y0 + 0.0067, r: 0.0152 * c },
          { y: y0 + 0.0072, r: 0.0143 * c },
          { y: y0 + 0.0072, r: 0.0128 },
        ],
    hex,
    hex.map(() => false),
    0,
    () => ({ m: m.metal, flat: true }),
    UV.fuze,
  );

  // Fuze housing: electronics can; the striker boss stands under the lever.
  lathe(
    g,
    m.metal,
    [
      [y0 + 0.0072, 0.0128],
      [y0 + 0.0228, 0.0128],
      [y0 + 0.0238, 0.0124],
      [y0 + 0.0245, 0.0116],
      [y0 + 0.0245, 0.0068],
      [LEVER_TOP - 0.0003, 0.0062],
      [LEVER_TOP, 0.0055],
      [LEVER_TOP, 0],
    ],
    seg(24, 10),
    UV.fuze,
  );

  // Selector ring: 24 grip ribs, pointer nib at 180° between DLY and IMP.
  const ribs = seg(16, 0),
    sc: number[] = [],
    sg: boolean[] = [];
  if (ribs) {
    for (let k = 0; k < ribs; k++) {
      const a = (k / ribs) * Math.PI * 2;
      sc.push(a, a + 0.07, a + (Math.PI * 2) / ribs - 0.07);
      sg.push(true, false, false);
    }
    revolve(
      g,
      [
        { y: y0 + 0.0085, r: 0.0128 },
        { y: y0 + 0.0088, r: 0.0147, cut: "edge" },
        { y: y0 + 0.0127, r: 0.0147, cut: "edge" },
        { y: y0 + 0.013, r: 0.0128 },
      ],
      sc,
      sg,
      0.0006,
      () => ({ m: m.rubber, flat: true }),
      UV.selector,
    );
    const nib = extrude(
      [
        [0, -0.0012],
        [0.0018, 0],
        [0, 0.0012],
      ],
      0.0028,
      0,
      [],
      0,
    );
    nib.rotateX(Math.PI / 2);
    nib.translate(0.0145, 0, 0);
    nib.rotateY(Math.PI);
    g.add(pack(nib, UV.selector), m.rubber, [0, y0 + 0.0108, 0]);
  } else
    lathe(
      g,
      m.rubber,
      [
        [y0 + 0.0085, 0.0128],
        [y0 + 0.0085, 0.0145],
        [y0 + 0.013, 0.0145],
        [y0 + 0.013, 0.0128],
      ],
      10,
      UV.selector,
    );

  // Ears: two plates either side of the lever's flanges, bored for the pin.
  const hole = (r: number): P2[] =>
    Array.from({ length: seg(8, 6) }, (_, k) => {
      const a = (k / seg(8, 6)) * Math.PI * 2;
      return [PIN[0] + Math.cos(a) * r, PIN[1] + Math.sin(a) * r, 0];
    });
  const ear: P2[] = [
    [0.0105, 0.0503, 0],
    [0.0164, 0.0508, 0.0016],
    [0.0172, 0.0545, 0.003],
    [0.0164, 0.0582, 0.0016],
    [0.0105, 0.0587, 0],
  ];
  for (const z of [-0.0055, 0.0055])
    g.add(
      pack(
        extrude(ear, 0.0018, 0, isLow() ? [] : [hole(0.001)], 0.001),
        UV.hardware,
      ),
      m.metal,
      [0, 0, z],
    );

  // Hinge lug on the far side (-X): the lever's hook tip bears on its underside.
  g.add(
    pack(
      extrude(
        [
          [-0.0105, 0.0555, 0],
          [-0.0145, 0.0555, 0.0004],
          [-0.0145, y0 + 0.0245, 0.0008],
          [-0.0105, y0 + 0.0245, 0],
        ],
        0.0078,
        0,
        [],
        0.0004,
      ),
      UV.hardware,
    ),
    m.metal,
  );

  // Arming window at 135° (towards -X, +Z): reads from the ring side.
  if (!isLow()) {
    const dir = new T.Vector3(
      Math.cos((3 * Math.PI) / 4),
      0,
      Math.sin((3 * Math.PI) / 4),
    );
    lathe(
      g,
      m.metal,
      [
        [0, 0.0024],
        [0.0007, 0.0024],
        [0.0009, 0.0021],
        [0.0009, 0.0016],
        [0.0004, 0.0016],
      ],
      12,
      UV.hardware,
      dir
        .clone()
        .multiplyScalar(0.0124)
        .add(new T.Vector3(0, 0.0573, 0))
        .toArray(),
      dir,
    );
    lathe(
      g,
      m.light,
      [
        [0.0004, 0.0016],
        [0.0006, 0.0015],
        [0.0006, 0],
      ],
      12,
      UV.hardware,
      dir
        .clone()
        .multiplyScalar(0.0124)
        .add(new T.Vector3(0, 0.0573, 0))
        .toArray(),
      dir,
    );
  }
}

// ---------------------------------------------------------------------------
// Lever: one pressed sheet, swept along its inner-face line in the XY plane.

/** Inner-face line from the hook tip, over the fuze top, down the +X side. */
function leverLine(): { at: [number, number]; width: number; dish: number }[] {
  const pts: { at: [number, number]; width: number; dish: number }[] = [
    { at: HOOK, width: 0.0075, dish: 0 },
    { at: [-0.0139, 0.0554], width: 0.0075, dish: 0 },
    { at: [-0.0146, 0.0562], width: 0.0075, dish: 0 },
    { at: [-0.0146, 0.0607], width: 0.0078, dish: 0 },
    { at: [-0.0139, 0.0618], width: 0.009, dish: 0 },
    { at: [-0.009, LEVER_TOP + 0.0001], width: 0.012, dish: 0 },
    { at: [0.003, LEVER_TOP + 0.0003], width: 0.0146, dish: 0 },
    { at: [0.0128, LEVER_TOP + 0.0001], width: 0.0146, dish: 0 },
    { at: [0.0168, 0.0607], width: 0.0146, dish: 0 },
    { at: [0.0182, 0.0585], width: 0.0146, dish: 0 },
    { at: [0.0184, 0.051], width: 0.0146, dish: 0 },
    { at: [0.0189, 0.0455], width: 0.0136, dish: 0.3 },
  ];
  // Down the body, 1 mm off the tile tops, narrowing to a rounded tail.
  const ys = [0.039, 0.034, 0.028, 0.021, 0.013, 0.004, -0.004, -0.0105];
  ys.forEach((y, i) => {
    pts.push({
      at: [Math.max(0.0197, fragBodyRadius(y) + 0.001), y],
      width: 0.0118 - i * 0.00016,
      dish: 1,
    });
  });
  pts.push({
    at: [fragBodyRadius(-0.0135) + 0.0011, -0.0135],
    width: 0.0086,
    dish: 1,
  });
  pts.push({
    at: [fragBodyRadius(-0.0148) + 0.0012, -0.0148],
    width: 0.0042,
    dish: 1,
  });
  return pts;
}

/** Open grid surface rows[s][k] with smooth normals, wound so they face `want(s)`. */
function surface(rows: T.Vector3[][], want: (s: number) => T.Vector3) {
  const K = rows[0].length;
  const pos: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  rows.forEach((row, s) =>
    row.forEach((p, k) => {
      pos.push(p.x, p.y, p.z);
      uv.push(k / (K - 1), s / (rows.length - 1));
    }),
  );
  for (let s = 0; s + 1 < rows.length; s++)
    for (let k = 0; k + 1 < K; k++) {
      const a = s * K + k,
        b = a + K;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const n = new T.Vector3().fromBufferAttribute(
    geo.getAttribute("normal") as T.BufferAttribute,
    Math.floor(rows.length / 2) * K + Math.floor(K / 2),
  );
  if (n.dot(want(Math.floor(rows.length / 2))) < 0) {
    for (let i = 0; i < index.length; i += 3)
      [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  return geo;
}

/** Flat fan over a closed ring, facing `want`. */
function cap(ring: T.Vector3[], want: T.Vector3) {
  const c = ring
    .reduce((a, p) => a.add(p), new T.Vector3())
    .divideScalar(ring.length);
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const flip = b.clone().sub(c).cross(a.clone().sub(c)).dot(want) > 0;
    for (const p of flip ? [c, b, a] : [c, a, b]) pos.push(p.x, p.y, p.z);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    "uv",
    new T.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  geo.computeVertexNormals();
  return geo;
}

function lever(g: WeaponGeometry, m: WeaponFinish) {
  const ctrl = leverLine();
  const curve = new T.CatmullRomCurve3(
    ctrl.map((c) => new T.Vector3(c.at[0], c.at[1], 0)),
    false,
    "centripetal",
  );
  const last = ctrl.length - 1;
  // High: four samples per span. Low: the control points that carry a bend.
  const ts = isLow()
    ? [0, 3, 5, 7, 9, 10, 11, 15, 19, 21].map((i) => i / last)
    : Array.from({ length: last + 1 }, (_, i) => i).flatMap((i) =>
        i === last ? [1] : i < 12 ? [i / last, (i + 0.5) / last] : [i / last],
      );
  const across = seg(4, 2);
  const outers: T.Vector3[][] = [],
    inners: T.Vector3[][] = [],
    normals: T.Vector3[] = [];
  for (const t of ts) {
    const ci = Math.min(last - 1, Math.floor(t * last)),
      f = t * last - ci;
    const lerp = (k: "width" | "dish") =>
      ctrl[ci][k] + (ctrl[ci + 1][k] - ctrl[ci][k]) * f;
    const p = curve.getPoint(t);
    const tan = curve
      .getPoint(Math.min(1, t + 1e-3))
      .sub(curve.getPoint(Math.max(0, t - 1e-3)))
      .normalize();
    const n = new T.Vector3(-tan.y, tan.x, 0); // outward, away from the fuze/body
    const w = lerp("width"),
      dish = lerp("dish");
    const outer: T.Vector3[] = [],
      inner: T.Vector3[] = [];
    for (let k = 0; k <= across; k++) {
      const z = -w / 2 + (w * k) / across;
      // Dished to the body's curve along the side (edges toward the body).
      const c = (-dish * z * z) / (2 * R);
      inner.push(p.clone().addScaledVector(n, c).setZ(z));
      outer.push(
        p
          .clone()
          .addScaledVector(n, c + SHEET)
          .setZ(z),
      );
    }
    outers.push(outer);
    inners.push(inner);
    normals.push(n);
  }
  // Smooth faces and edges, flat end caps: a sheet, not a faceted tube.
  const S = outers.length;
  const edge = (k: number) => outers.map((o, s) => [o[k], inners[s][k]]);
  const side = (k: number, sign: number) =>
    new T.Vector3(0, 0, sign * (k === 0 ? -1 : 1));
  g.add(
    pack(
      surface(outers, (s) => normals[s]),
      UV.lever,
    ),
    m.steel,
  );
  g.add(
    pack(
      surface(inners, (s) => normals[s].clone().negate()),
      UV.lever,
    ),
    m.steel,
  );
  for (const k of [0, across])
    g.add(
      pack(
        surface(edge(k), () => side(k, 1)),
        UV.lever,
      ),
      m.steel,
    );
  const tangent = (s: number) =>
    outers[Math.min(S - 1, s + 1)][0]
      .clone()
      .sub(outers[Math.max(0, s - 1)][0]);
  g.add(
    pack(
      cap([...outers[0], ...inners[0].slice().reverse()], tangent(0).negate()),
      UV.lever,
    ),
    m.steel,
  );
  g.add(
    pack(
      cap(
        [...outers[S - 1], ...inners[S - 1].slice().reverse()],
        tangent(S - 1),
      ),
      UV.lever,
    ),
    m.steel,
  );
  // Side flanges, pressed down from the top either side of the ears; the pin
  // passes through both.
  const hole: P2[] = Array.from({ length: seg(8, 6) }, (_, k) => {
    const a = (k / seg(8, 6)) * Math.PI * 2;
    return [PIN[0] + Math.cos(a) * 0.001, PIN[1] + Math.sin(a) * 0.001, 0];
  });
  const flange: P2[] = [
    [0.0187, 0.0508, 0.0012],
    [0.0187, 0.0585, 0],
    [0.0176, 0.0599, 0],
    [0.0165, 0.061, 0],
    [0.0128, LEVER_TOP + 0.0003, 0],
    [0.0112, LEVER_TOP + 0.0003, 0],
    [0.0112, 0.0588, 0.0018],
    [0.0128, 0.0514, 0.0018],
  ];
  for (const z of [-0.0068, 0.0068])
    g.add(
      pack(extrude(flange, SHEET, 0, isLow() ? [] : [hole], 0.0012), UV.flange),
      m.steel,
      [0, 0, z],
    );
}

// ---------------------------------------------------------------------------
// Pin, ring, keeper

function pin(g: WeaponGeometry, m: WeaponFinish) {
  const [px, py] = PIN;
  const z0 = isLow() ? -0.0078 : -0.0076;
  // Shank through both ears and flanges; the eye in the YZ plane holds the ring.
  const shank = new T.CylinderGeometry(
    PIN_R,
    PIN_R,
    RING_Z - 0.002 - z0,
    seg(10, 5),
    1,
    isLow(),
  );
  shank.rotateX(Math.PI / 2);
  g.add(pack(shank, UV.pin), m.steel, [px, py, (RING_Z - 0.002 + z0) / 2]);
  if (!isLow()) {
    const eye = new T.TorusGeometry(0.0021, PIN_R, 4, 10);
    eye.rotateY(Math.PI / 2);
    g.add(pack(eye, UV.pin), m.steel, [px, py, RING_Z]);
    // Split legs, spread past the far ear so the pin cannot fall out.
    for (const s of [-1, 1]) {
      const leg = new T.TubeGeometry(
        new T.QuadraticBezierCurve3(
          new T.Vector3(px, py, z0 + 0.0004),
          new T.Vector3(px, py + s * 0.0004, z0 - 0.0016),
          new T.Vector3(px, py + s * 0.0022, z0 - 0.0026),
        ),
        5,
        PIN_R * 0.55,
        4,
        false,
      );
      g.add(pack(leg, UV.pin), m.steel);
    }
  }
  const ring = new T.TorusGeometry(RING_R, 0.0009, seg(5, 3), seg(24, 8));
  g.add(pack(ring, UV.pin), m.steel, [px, py - RING_R, RING_Z]);
}

/** Polymer keeper on the jam ring: a C-clip that snaps over the pull ring's
 * inboard edge so it cannot snag. Thumb it off before pulling. */
function keeper(g: WeaponGeometry, m: WeaponFinish) {
  // Too small to matter on a belt or in flight: the low model has none.
  if (isLow()) return;
  // Ring wire where the keeper holds it: its inboard edge, running along Y.
  const cx = PIN[0] - RING_R,
    cz = RING_Z,
    y = PIN[1] - RING_R - 0.0004;
  // C section in (x, z), open outboard (+Z) so the wire pops out that way.
  const outline: P2[] = [];
  const n = seg(10, 4),
    arc = (r: number, k: number): P2 => {
      const a = ((125 + (290 * k) / n) * Math.PI) / 180;
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0];
    };
  for (let k = 0; k <= n; k++) outline.push(arc(0.0018, k));
  for (let k = n; k >= 0; k--) outline.push(arc(0.00097, k));
  const clip = extrude(outline, 0.0028, 0, [], 0);
  clip.rotateX(Math.PI / 2); // shape y -> +z, extruded along y
  g.add(pack(clip, UV.hardware), m.rubber, [0, y, 0]);
  // Stem down to the jam ring's flat.
  const stem = extrude(
    [
      [cx - 0.0011, cz - 0.0014],
      [cx + 0.0011, cz - 0.0014],
      [cx + 0.0011, 0.0148],
      [cx - 0.0011, 0.0148],
    ],
    0.0028,
    0,
    [],
    0,
  );
  stem.rotateX(Math.PI / 2);
  g.add(pack(stem, UV.hardware), m.rubber, [0, y, 0]);
}

// ---------------------------------------------------------------------------

/** Named parts of the model, all children of the returned group:
 * `body` (body, band, fuze, stud: static), `lever` (origin on the release
 * pivot, rotate +Z to release), `pin` (pin and ring, origin on the pin axis,
 * translate +Z to pull), `keeper` (the ring keeper, origin where it grips the
 * ring). Hide `pin` + `keeper` for "pin pulled", and `lever` once thrown. */
export type FragGrenadePart = "body" | "lever" | "pin" | "keeper";

/**
 * Builds the Frag Grenade. "high": the authored model, one mesh per finish
 * slot per part. "low": the belt and in-flight mesh, no tiles (bake them),
 * no window, one material with the slot colours in vertex colours and the
 * same UV atlas.
 */
export function createFragGrenade(
  options: { detail?: Detail; finish?: WeaponFinish } = {},
): T.Group {
  const detail = options.detail ?? "high";
  const m = options.finish ?? fragGrenadeFinish();
  const root = new T.Group();
  root.name = "FragGrenade";
  root.userData.detail = detail;
  const low = detail === "low" ? lowMaterial() : null;
  const part = (
    name: FragGrenadePart,
    origin: [number, number, number],
    build: (g: WeaponGeometry) => void,
  ) => {
    const g = new WeaponGeometry();
    g.offset.set(-origin[0], -origin[1], -origin[2]);
    withDetail(detail, () => build(g));
    const group = g.finish(name);
    group.position.fromArray(origin);
    root.add(low ? collapse(group, low) : group);
  };
  part("body", [0, 0, 0], (g) => {
    body(g, m);
    stud(g, m);
    fuze(g, m);
  });
  part("lever", FRAG_GRENADE_POINTS.leverPivot, (g) => lever(g, m));
  part("pin", FRAG_GRENADE_POINTS.pin, (g) => pin(g, m));
  part("keeper", [PIN[0] - RING_R, PIN[1] - RING_R, RING_Z], (g) =>
    keeper(g, m),
  );
  return root;
}

function lowMaterial() {
  return new T.MeshStandardMaterial({
    name: "00_Baked",
    vertexColors: true,
    metalness: 0.3,
    roughness: 0.55,
  });
}

/** One mesh per part: the slot colours go into vertex colours. */
function collapse(group: T.Group, material: T.Material) {
  const parts: T.BufferGeometry[] = [];
  for (const mesh of group.children) {
    if (!(mesh instanceof T.Mesh)) continue;
    const geo = mesh.geometry as T.BufferGeometry;
    const c = (mesh.material as T.MeshStandardMaterial).color;
    const n = geo.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute("color", new T.BufferAttribute(col, 3));
    parts.push(geo);
  }
  const out = new T.Group();
  out.name = group.name;
  out.position.copy(group.position);
  const geometry = parts.length ? mergeGeometries(parts) : null;
  parts.forEach((p) => p.dispose());
  if (geometry) {
    const mesh = new T.Mesh(geometry, material);
    mesh.name = group.name;
    out.add(mesh);
  }
  return out;
}
