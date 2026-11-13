// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WEAPON_SCALE,
  WeaponGeometry,
  sizeWeapon,
  type WeaponFinish,
} from "./weapon-finish.ts";
import {
  X,
  Y,
  Z,
  bakeOnly,
  familyFinish,
  fillet,
  inAuthoringFrame,
  isLow,
  latheAlong,
  latheAt,
  route,
  seg,
  shell,
  superRing,
  sweep,
  withDetail,
  type Detail,
  type P2,
} from "./rifle-shapes.ts";

/** Rail-mounted upgrades (three scopes, three laser sights) for the AR-family
 * preview rifles. Drawn in the guns' authoring frame (metres, +X muzzle, +Y up,
 * +Z the shooter's left; see rifle-shapes.ts) and handed back mirrored into
 * the weapon frame like the guns, so they seat on the guns' weapon-frame
 * mounts.
 *
 * Origins follow the shipped fittings so a swap is a file replacement:
 * - scope: on the top rail's tooth tops, on the centre line, at `mount_scope`.
 * - laser: 2.2 mm proud of the left side rail's tooth tops, at the rail's
 *   centre (`mount_laser`); the side rail faces +Z.
 * Real-size authoring; `createRailUpgrade` bakes the shared 0.9 `sizeWeapon`
 * factor exactly like the guns, so fitting and rifle stay at one scale.
 *
 * Every clamp bears on the rail's lower 45° flanks with a fixed jaw and a
 * drawn jaw; the cross-bolt runs through a rail slot. Slot phase: scope bolts
 * at x = 0.0019 + 10k (slots of the carbine and marksman top rails), laser
 * bolts at x = 0.0036 (slots of the marksman and plasma side rails). */

/** Optical axis above the rail's tooth tops (absolute co-witness height). */
export const OPTIC_AXIS = 0.039;
/** Laser origin sits this far proud of the side rail's tooth tops. */
const LASER_STANDOFF = 0.0022;
const SCOPE_BOLT = 0.0019;
const LASER_BOLT = 0.0036;

const deg = Math.PI / 180;
const A = OPTIC_AXIS;

// ---------------------------------------------------------------------------
// Local helpers: coarser fillets and two-step bevels than the rifle helpers,
// so small fittings stay inside their triangle budgets.

/** Closed polygon with fillet arcs (one segment per ~30°). At "low" it
 * follows the shared rules: small radii sharp, coarse arcs. */
function fil(points: P2[], radius = 0): T.Vector2[] {
  if (isLow()) return fillet(points, radius);
  const out: T.Vector2[] = [];
  const n = points.length;
  const v = (i: number) => {
    const p = points[(i + n) % n];
    return new T.Vector2(p[0], p[1]);
  };
  for (let i = 0; i < n; i++) {
    const p = v(i),
      r = points[i][2] ?? radius;
    const da = p.clone().sub(v(i - 1)),
      db = v(i + 1).sub(p);
    const la = da.length(),
      lb = db.length();
    if (la < 1e-9 || lb < 1e-9) continue;
    da.divideScalar(la);
    db.divideScalar(lb);
    const turn = Math.acos(Math.min(1, Math.max(-1, da.dot(db))));
    if (r <= 0 || turn < 0.02) {
      out.push(p);
      continue;
    }
    const t = Math.min(r * Math.tan(turn / 2), la * 0.48, lb * 0.48);
    const s = p.clone().addScaledVector(da, -t),
      e = p.clone().addScaledVector(db, t);
    const steps = Math.max(1, Math.ceil(turn / 0.55));
    for (let k = 0; k <= steps; k++) {
      const u = k / steps,
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

/** (x, y) profile extruded symmetrically about z = 0, optional two-step bevel. */
function ext(
  points: P2[],
  width: number,
  bevel = 0,
  holes: P2[][] = [],
  radius = 0,
) {
  const shape = new T.Shape(fil(points, radius));
  for (const hole of holes) shape.holes.push(new T.Path(fil(hole, radius)));
  const b = isLow() ? 0 : Math.min(bevel, width * 0.3);
  const depth = width - 2 * b;
  const geo = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 2,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Side profile (x, y) extruded across Z, centred on z. */
function side(
  g: WeaponGeometry,
  m: T.Material,
  points: P2[],
  width: number,
  z = 0,
  bevel = 0,
  holes: P2[][] = [],
  radius = 0,
) {
  g.add(ext(points, width, bevel, holes, radius), m, [0, 0, z]);
}

/** Cross-section (z, y) extruded along +X from x0 to x1. */
function bar(section: P2[], x0: number, x1: number, bevel = 0, radius = 0) {
  const geo = ext(
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

/** Builds parts in a temporary frame, then rotates and places them in `g`. */
function inFrame(
  g: WeaponGeometry,
  rotation: T.Euler,
  offset: number[],
  build: (h: WeaponGeometry) => void,
) {
  const h = new WeaponGeometry();
  build(h);
  for (const child of h.finish("frame").children)
    if (child instanceof T.Mesh)
      g.add(child.geometry, child.material as T.Material, offset, rotation);
}

/** Geometry built along +Z, turned to `dir` and placed at `at`. */
function placeAlong(
  g: WeaponGeometry,
  m: T.Material,
  geo: T.BufferGeometry,
  at: number[],
  dir: T.Vector3,
) {
  geo.applyQuaternion(
    new T.Quaternion().setFromUnitVectors(Z, dir.clone().normalize()),
  );
  g.add(geo, m, at);
}

const offsetAlong = (at: number[], dir: T.Vector3, h: number) => [
  at[0] + dir.x * h,
  at[1] + dir.y * h,
  at[2] + dir.z * h,
];

/** Fluted grip band of outer radius `r` from `at` along `dir` for `h`. At
 * low detail the bake carries the flutes. */
function flutes(
  g: WeaponGeometry,
  m: T.Material,
  at: number[],
  dir: T.Vector3,
  r: number,
  h: number,
  count: number,
  depth = 0.0006,
  bore = 0,
) {
  if (isLow()) {
    latheAlong(
      g,
      m,
      [
        [0, bore],
        [0, r - depth * 0.5],
        [h, r - depth * 0.5],
        [h, bore],
        [0, bore],
      ],
      at,
      dir,
    );
    return;
  }
  const pts: P2[] = [];
  const w = (Math.PI * 2) / count;
  for (let k = 0; k < count; k++)
    for (const [t, rr] of [
      [0.1, r],
      [0.5, r],
      [0.78, r - depth],
    ])
      pts.push([Math.cos(k * w + t * w) * rr, Math.sin(k * w + t * w) * rr, 0]);
  const geo = ext(pts, h, 0, bore > 0 ? [circle(0, 0, bore, 24)] : []);
  geo.translate(0, 0, h / 2);
  placeAlong(g, m, geo, at, dir);
}

/** Thin flat mark (index line, coin slot) lying on a face whose normal is `dir`. */
function mark(
  g: WeaponGeometry,
  m: T.Material,
  at: number[],
  dir: T.Vector3,
  hx: number,
  hy: number,
  spin = 0,
  depth = 0.0003,
) {
  const geo = ext(
    [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ],
    depth,
  );
  geo.rotateZ(spin);
  geo.translate(0, 0, depth / 2);
  placeAlong(g, m, geo, at, dir);
}

/** Socket-head cap screw seated at `at`, head standing out along `dir`. */
function capScrew(
  g: WeaponGeometry,
  m: WeaponFinish,
  at: number[],
  dir: T.Vector3,
  r = 0.0021,
  segments = 10,
) {
  const h = r * 0.8;
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, r],
      [h, r * 0.88],
      [h, 0],
    ],
    at,
    dir,
    seg(segments, 8),
  );
  bakeOnly(() => {
    const hex: P2[] = [];
    for (let k = 0; k < 6; k++)
      hex.push([
        Math.cos(k * 60 * deg) * r * 0.5,
        Math.sin(k * 60 * deg) * r * 0.5,
      ]);
    const geo = ext(hex, 0.0003);
    geo.translate(0, 0, h);
    placeAlong(g, m.rubber, geo, at, dir);
  });
}

/** Hex nut extruded along `dir` from `at`. */
function hexNut(
  g: WeaponGeometry,
  m: T.Material,
  at: number[],
  dir: T.Vector3,
  r: number,
  h: number,
) {
  const pts: P2[] = [];
  for (let k = 0; k < 6; k++)
    pts.push([Math.cos(k * 60 * deg) * r, Math.sin(k * 60 * deg) * r, r * 0.1]);
  const geo = ext(pts, h);
  geo.translate(0, 0, h / 2);
  placeAlong(g, m, geo, at, dir);
}

/** Rounded rectangle centred on (cx, cy). */
const roundRect = (
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  r: number,
): P2[] => [
  [cx - hx, cy - hy, r],
  [cx + hx, cy - hy, r],
  [cx + hx, cy + hy, r],
  [cx - hx, cy + hy, r],
];

const circle = (cx: number, cy: number, r: number, n: number): P2[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0] as P2;
  });

/** Lens at axial station `x` of an X-axis through (y, z), domed toward `dir`. */
function lens(
  g: WeaponGeometry,
  m: WeaponFinish,
  x: number,
  r: number,
  y: number,
  z: number,
  dir: 1 | -1,
  dome: number,
  segments: number,
) {
  const p = [
    [x - dir * 0.0003, 0],
    [x - dir * 0.0003, r],
    [x + dir * dome * 0.55, r * 0.72],
    [x + dir * dome, 0],
  ];
  latheAt(g, m.glass, dir > 0 ? p : p.reverse(), y, z, seg(segments, 12));
}

/** Half-turn of a lathe about X through (y, z): `top` true for the upper half. */
function halfLathe(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  y: number,
  z: number,
  top: boolean,
  segments: number,
) {
  const geo = new T.LatheGeometry(
    profile.map(([x, r]) => new T.Vector2(r, x)),
    seg(segments, Math.max(4, segments >> 1)),
    top ? Math.PI : 0,
    Math.PI,
  );
  geo.rotateZ(-Math.PI / 2);
  g.add(geo, m, [0, y, z]);
}

/** Texture-slot economy for the 0.6 MB GLB budget: the shipped bake packs a
 * 256² roughness + normal pair (~186 KB) for every textured slot (01–05), and
 * each high-detail triangle costs ~63 bytes. Slots not kept fold into
 * 02_Graphite (06–08 carry no maps and are free). */
function slots(
  m: WeaponFinish,
  keep: { hardware?: boolean; rubber?: boolean },
): WeaponFinish {
  return {
    ...m,
    steel: keep.hardware ? m.steel : m.metal,
    rubber: keep.rubber ? m.rubber : m.metal,
  };
}

// ---------------------------------------------------------------------------
// Rail clamp

interface Clamp {
  x0: number;
  x1: number;
  /** Height of the clamp's top face above the tooth tops. */
  top: number;
  bolts: number[];
  nut: "hex" | "knob" | "lever";
  /** Side of the drawn jaw and its nut: -1 right (-Z), +1 left (+Z). */
  side: 1 | -1;
}

/** Clamp body in the rail frame (tooth tops at y = 0, rail along X). The fixed
 * jaw and the drawn jaw hook under the rail's lower 45° flanks; a cross-bolt
 * through a rail slot pulls the drawn jaw in. Bolt head on the fixed side;
 * hex nut, knurled thumb nut or cam lever on the drawn side. */
function railClamp(g: WeaponGeometry, m: WeaponFinish, c: Clamp) {
  const { x0, x1, top } = c;
  const k = -c.side;
  const W = 0.0128,
    J = 0.0112;
  const mirror = (pts: P2[]) =>
    pts.map(([z, y, r]) => [z * k, y, r ?? 0] as P2);
  // Fixed body: full top, fixed jaw on the far side, relieved over the drawn jaw.
  const body = mirror([
    [W, top, 0.0022],
    [W, -0.0062, 0.0007],
    [0.0086, -0.0062],
    [0.0084, -0.0056],
    [0.0108, -0.0032],
    [0.0109, -0.0027],
    [0.0081, 0.0003],
    [-0.0081, 0.0003],
    [-0.0109, -0.0027],
    [-J, -0.0027],
    [-J, top - 0.0016],
    [-W, top - 0.0016],
    [-W, top, 0.0022],
  ]);
  g.add(bar(body, x0, x1, 0.0007), m.metal);
  const jaw = mirror([
    [-J - 0.00025, top - 0.0019],
    [-J - 0.00025, -0.0029],
    [-0.0109, -0.0033],
    [-0.0084, -0.0057],
    [-0.0086, -0.0062],
    [-0.0143, -0.0062, 0.0008],
    [-0.0143, top - 0.0019, 0.0008],
  ]);
  g.add(bar(jaw, x0 + 0.0015, x1 - 0.0015), m.metal);
  const inn = new T.Vector3(0, 0, -k);
  const out = new T.Vector3(0, 0, k);
  for (const bx of c.bolts) {
    const by = -0.0016;
    capScrew(g, m, [bx, by, W * k], out, 0.0027);
    const face = -0.0143 * k;
    if (c.nut === "hex") {
      hexNut(g, m.steel, [bx, by, face], inn, 0.0041, 0.0033);
      latheAlong(
        g,
        m.steel,
        [
          [0, 0],
          [0, 0.0016],
          [0.0049, 0.0016],
          [0.0051, 0],
        ],
        [bx, by, face],
        inn,
        seg(10, 6),
      );
    } else if (c.nut === "knob") {
      latheAlong(
        g,
        m.steel,
        [
          [0, 0],
          [0, 0.005],
          [0.0016, 0.006],
          [0.0063, 0.006],
          [0.0069, 0.0052],
          [0.0069, 0],
        ],
        [bx, by, face],
        inn,
        seg(18, 10),
      );
      flutes(
        g,
        m.steel,
        offsetAlong([bx, by, face], inn, 0.0018),
        inn,
        0.0066,
        0.0042,
        12,
        0.0008,
      );
    } else {
      // Cam lever: barrel on the bolt, arm folded back along the jaw.
      latheAlong(
        g,
        m.steel,
        [
          [0, 0],
          [0, 0.0042],
          [0.0046, 0.0042],
          [0.0052, 0.0033],
          [0.0052, 0],
        ],
        [bx, by, face],
        inn,
        seg(12, 8),
      );
      // Arm folds toward the clamp's longer side and stays within its length.
      const back = bx - x0 > x1 - bx ? 1 : -1;
      const L = Math.min(0.0285, (back > 0 ? bx - x0 : x1 - bx) - 0.0015);
      const sx = (x: number) => (x < 0 ? (x * L) / 0.0285 : x) * back;
      const armPts: P2[] = [
        [0.0038, -0.0033, 0.003],
        [0.0041, 0.0031, 0.003],
        [-0.013, 0.0037],
        [-0.0265, 0.0031, 0.002],
        [-0.0285, 0.0008, 0.002],
        [-0.0272, -0.0036, 0.002],
        [-0.014, -0.0026],
      ].map(([x, y, r]) => [sx(x), y, r ?? 0] as P2);
      const arm = ext(armPts, 0.0026);
      arm.translate(bx, by + 0.0008, face - 0.0041 * k);
      g.add(arm, m.steel);
      latheAlong(
        g,
        m.metal,
        [
          [0, 0],
          [0, 0.0014],
          [0.0058, 0.0014],
          [0.0058, 0],
        ],
        [bx, by, face],
        inn,
        seg(8, 6),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Scopes

/** Basic Scope: compact tube reflex sight on a cast low riser. 30 mm body,
 * 25 mm objective hood, guard wings either side of the elevation cap,
 * windage on the right, brightness dial with the battery cap on the left. */
export function scopeBasic(
  g: WeaponGeometry,
  finish: WeaponFinish,
  detail: Detail = "high",
) {
  const m = slots(finish, { hardware: true });
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      railClamp(g, m, {
        x0: -0.021,
        x1: 0.021,
        top: 0.0045,
        bolts: [SCOPE_BOLT],
        nut: "hex",
        side: -1,
      });
      // Riser: lofted horizontal slices, wide at the clamp, waisted, flaring
      // into the body's foot.
      const slices: [number, number, number][] = [
        [0.0042, 0.0195, 0.0122],
        [0.0088, 0.0176, 0.0101],
        [0.0138, 0.0158, 0.0078],
        [0.0188, 0.0163, 0.0082],
        [0.0238, 0.0188, 0.0101],
        [0.0285, 0.0198, 0.0106],
      ];
      g.add(
        shell(
          slices.map(([y, hl, hw]) =>
            superRing(
              new T.Vector3(-0.001, y, 0),
              X,
              Z,
              hl,
              hl,
              hw,
              hw,
              3.4,
              seg(24, 16),
            ),
          ),
        ),
        m.metal,
      );
      // Body tube with both lens hoods: lenses 6.6 mm (front) and 5.4 mm
      // (rear) inside the rims.
      latheAt(
        g,
        m.metal,
        [
          [-0.0282, 0],
          [-0.0282, 0.0112],
          [-0.0332, 0.0119],
          [-0.0343, 0.0133],
          [-0.0335, 0.0151],
          [-0.0262, 0.0151],
          [-0.0254, 0.0145],
          [-0.024, 0.015],
          [0.0155, 0.015],
          [0.0195, 0.0157],
          [0.0345, 0.0163],
          [0.0358, 0.0151],
          [0.0351, 0.0132],
          [0.0292, 0.0124],
          [0.0292, 0],
        ],
        A,
        0,
        seg(28, 16),
      );
      lens(g, m, 0.0292, 0.0124, A, 0, 1, 0.0012, 24);
      lens(g, m, -0.0282, 0.0112, A, 0, -1, 0.0008, 24);
      // Elevation (top) and windage (right): capped adjusters on low bosses.
      for (const dir of [Y, Z.clone().negate()]) {
        const at = offsetAlong([0.005, A, 0], dir, 0.0125);
        latheAlong(
          g,
          m.metal,
          [
            [0, 0],
            [0, 0.0074],
            [0.0049, 0.0074],
            [0.0049, 0.006],
            [0.0092, 0.006],
            [0.0098, 0.0053],
            [0.0098, 0],
          ],
          at,
          dir,
          seg(18, 12),
        );
        flutes(
          g,
          m.metal,
          offsetAlong(at, dir, 0.0051),
          dir,
          0.0063,
          0.0033,
          14,
        );
      }
      // Guard wings: cast ears either side of the elevation cap, taller than it.
      for (const s of [-1, 1])
        side(
          g,
          m.metal,
          [
            [-0.006, A + 0.008],
            [0.019, A + 0.008],
            [0.0175, A + 0.0165, 0.003],
            [0.0115, A + 0.0236, 0.002],
            [-0.0005, A + 0.0236, 0.002],
            [-0.004, A + 0.016, 0.004],
          ],
          0.0028,
          s * 0.0098,
          0.0006,
        );
      // Brightness dial on the left, battery cap inside it with a coin slot.
      const dial = [-0.0115, A, 0.0118];
      latheAlong(
        g,
        m.metal,
        [
          [0, 0],
          [0, 0.0094],
          [0.0034, 0.0094],
          [0.0034, 0.0068],
          [0.0096, 0.0068],
          [0.0102, 0.006],
          [0.0102, 0],
        ],
        dial,
        Z,
        seg(22, 12),
      );
      flutes(
        g,
        m.metal,
        offsetAlong(dial, Z, 0.0034),
        Z,
        0.0098,
        0.0052,
        18,
        0.0007,
      );
      bakeOnly(() =>
        mark(g, m.rubber, offsetAlong(dial, Z, 0.0102), Z, 0.0045, 0.0006),
      );
      // Index dot on the dial rim, detent ticks on the body behind it.
      mark(g, m.marking, offsetAlong(dial, Z, 0.0086), Z, 0.0005, 0.0005, 0);
      for (const dx of [-0.0036, 0, 0.0036])
        mark(
          g,
          m.marking,
          [
            dial[0] + dx,
            A + 0.0151 * Math.sin(50 * deg),
            0.0151 * Math.cos(50 * deg),
          ],
          new T.Vector3(0, Math.sin(50 * deg), Math.cos(50 * deg)),
          0.0004,
          0.0012,
        );
    }),
  );
}

/** Advanced Scope: fixed low-power prism sight. Squared-off prism housing
 * between a round eyepiece and an objective bell; capped elevation and
 * windage turrets; integral two-clamp mount; rear notch and front fibre
 * post on top as a backup. */
export function scopeAdvanced(
  g: WeaponGeometry,
  finish: WeaponFinish,
  detail: Detail = "high",
) {
  const m = slots(finish, {});
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      railClamp(g, m, {
        x0: -0.039,
        x1: 0.035,
        top: 0.005,
        bolts: [SCOPE_BOLT - 0.03, SCOPE_BOLT + 0.02],
        nut: "knob",
        side: -1,
      });
      // Integral mount: tapered web with a lightening window, rising into the
      // housing.
      side(
        g,
        m.metal,
        [
          [-0.037, 0.0045],
          [0.033, 0.0045],
          [0.03, 0.011, 0.004],
          [0.023, A - 0.011, 0.004],
          [-0.03, A - 0.011, 0.004],
          [-0.035, 0.011, 0.004],
        ],
        0.0168,
        0,
        0.001,
        [
          [
            [-0.019, 0.0105, 0.003],
            [0.015, 0.0105, 0.003],
            [0.0115, 0.02, 0.003],
            [-0.0155, 0.02, 0.003],
          ],
        ],
      );
      // Prism housing: squared loft between round ends.
      const stations: [number, number, number, number, number][] = [
        [-0.038, 0.0158, 0.0158, 0.0158, 2],
        [-0.032, 0.0185, 0.0172, 0.0172, 2.8],
        [-0.024, 0.0212, 0.019, 0.0183, 3.6],
        [0.012, 0.0212, 0.019, 0.0183, 3.6],
        [0.022, 0.0192, 0.0178, 0.0176, 3],
        [0.03, 0.0168, 0.0166, 0.0166, 2],
      ];
      g.add(
        shell(
          stations.map(([x, up, down, half, n]) =>
            superRing(
              new T.Vector3(x, A, 0),
              Y,
              Z,
              up,
              down,
              half,
              half,
              n,
              seg(36, 20),
            ),
          ),
        ),
        m.metal,
      );
      // Eyepiece: metal barrel, rubber eyeguard, ocular lens recessed in it.
      latheAt(
        g,
        m.metal,
        [
          [-0.0525, 0],
          [-0.0525, 0.0139],
          [-0.0505, 0.0146],
          [-0.0495, 0.0154],
          [-0.034, 0.0158],
          [-0.034, 0],
        ],
        A,
        0,
        seg(30, 16),
      );
      latheAt(
        g,
        m.rubber,
        [
          [-0.0522, 0.0138],
          [-0.0592, 0.0127],
          [-0.0606, 0.0145],
          [-0.0596, 0.0166],
          [-0.0505, 0.0164],
          [-0.0522, 0.0138],
        ],
        A,
        0,
        seg(30, 16),
      );
      lens(g, m, -0.0525, 0.0121, A, 0, -1, 0.001, 24);
      // Objective bell with two grip grooves, lens recessed 7 mm.
      latheAt(
        g,
        m.metal,
        [
          [0.026, 0],
          [0.026, 0.0166],
          [0.036, 0.0184],
          [0.0405, 0.0187],
          [0.041, 0.0181],
          [0.0425, 0.0181],
          [0.043, 0.0189],
          [0.0565, 0.0192],
          [0.0585, 0.0184],
          [0.0576, 0.0164],
          [0.0515, 0.0158],
          [0.0515, 0],
        ],
        A,
        0,
        seg(32, 18),
      );
      lens(g, m, 0.0515, 0.0158, A, 0, 1, 0.0016, 28);
      // Capped turrets: elevation on top, windage on the right.
      for (const [dir, base] of [
        [Y, 0.0198],
        [Z.clone().negate(), 0.0172],
      ] as [T.Vector3, number][]) {
        const at = offsetAlong([-0.005, A, 0], dir, base - 0.002);
        latheAlong(
          g,
          m.metal,
          [
            [0, 0],
            [0, 0.0098],
            [0.0034, 0.0098],
            [0.0034, 0.0088],
            [0.009, 0.0088],
            [0.0096, 0.0081],
            [0.0096, 0],
          ],
          at,
          dir,
          seg(22, 12),
        );
        flutes(
          g,
          m.metal,
          offsetAlong(at, dir, 0.0038),
          dir,
          0.009,
          0.0034,
          16,
        );
        bakeOnly(() =>
          mark(g, m.rubber, offsetAlong(at, dir, 0.0096), dir, 0.0052, 0.0006),
        );
      }
      // Backup sight: rear notch blade over the eyepiece, front fibre post on
      // the bell; the sight line passes over the elevation cap.
      const sightTop = A + 0.03;
      g.add(
        bar(
          [
            [-0.0068, A + 0.0145],
            [0.0068, A + 0.0145],
            [0.0062, sightTop, 0.0008],
            [0.0016, sightTop],
            [0.0008, sightTop - 0.0028],
            [-0.0008, sightTop - 0.0028],
            [-0.0016, sightTop],
            [-0.0062, sightTop, 0.0008],
          ],
          -0.0395,
          -0.0335,
          0.0005,
        ),
        m.metal,
      );
      side(
        g,
        m.metal,
        [
          [0.03, A + 0.0145],
          [0.05, A + 0.0165],
          [0.05, sightTop - 0.001, 0.0015],
          [0.046, sightTop + 0.0008, 0.001],
          [0.034, sightTop - 0.0016, 0.003],
        ],
        0.0062,
        0,
        0.0006,
      );
      // Fibre: light-gathering rod in a groove along the post's top.
      latheAt(
        g,
        m.light,
        [
          [0.0335, 0],
          [0.0335, 0.00095],
          [0.049, 0.00095],
          [0.049, 0],
        ],
        sightTop - 0.0001,
        0,
        seg(8, 6),
      );
    }),
  );
}

/** Superior Scope: 1-8x variable riflescope, 30 mm tube, in a one-piece
 * cantilever mount with two split rings. Eyepiece with diopter ring,
 * magnification ring and throw lever; elevation and windage turrets; side
 * parallax/illumination turret on the left. */
export function scopeSuperior(
  g: WeaponGeometry,
  finish: WeaponFinish,
  detail: Detail = "high",
) {
  const m = slots(finish, {});
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      const R = 0.015;
      const RINGS = [0.018, 0.104];
      railClamp(g, m, {
        x0: -0.038,
        x1: 0.054,
        top: 0.0052,
        bolts: [SCOPE_BOLT - 0.03, SCOPE_BOLT + 0.04],
        nut: "lever",
        side: -1,
      });
      // One-piece cantilever: a deep spine from the clamp up under both rings,
      // the front ring carried forward of the clamp on the arm.
      const foot = A - 0.0175;
      side(
        g,
        m.metal,
        [
          [-0.036, 0.0048],
          [0.052, 0.0048],
          [0.064, 0.009, 0.01],
          [0.1, 0.0128, 0.006],
          [0.1125, 0.0138, 0.003],
          [0.1125, foot + 0.005],
          [0.0955, foot + 0.005],
          [0.086, foot + 0.0012, 0.006],
          [0.036, foot + 0.0012, 0.006],
          [0.0265, foot + 0.005],
          [0.0095, foot + 0.005],
          [0.0005, foot - 0.002, 0.006],
          [-0.036, 0.0108, 0.004],
        ],
        0.014,
        0,
        0.001,
        [
          [
            [0.044, 0.0138, 0.003],
            [0.068, 0.0146, 0.003],
            [0.072, foot - 0.0042, 0.003],
            [0.047, foot - 0.0042, 0.003],
          ],
        ],
      );
      side(
        g,
        m.metal,
        [
          [-0.036, 0.0046],
          [0.052, 0.0046],
          [0.05, 0.0084, 0.002],
          [-0.034, 0.0084, 0.002],
        ],
        0.0176,
        0,
        0.0006,
      );
      // Split rings: lower halves on the mount, caps on top, two screws a side.
      const ringProfile = [
        [-0.0068, R],
        [-0.0068, 0.0193],
        [-0.0056, 0.0203],
        [0.0056, 0.0203],
        [0.0068, 0.0193],
        [0.0068, R],
      ];
      for (const rx of RINGS) {
        for (const top of [true, false])
          halfLathe(
            g,
            m.metal,
            ringProfile.map(([x, r]) => [rx + x, r - (top ? 0 : 0.0002)]),
            A + (top ? 0.0003 : -0.0003),
            0,
            top,
            12,
          );
        for (const s of [-1, 1]) {
          for (const [y0, y1] of [
            [A + 0.0003, A + 0.0042],
            [A - 0.0052, A - 0.0003],
          ])
            g.add(
              bar(
                [
                  [s * 0.0176, y0],
                  [s * 0.0244, y0, 0.0007],
                  [s * 0.0244, y1, 0.0012],
                  [s * 0.0176, y1 + (y1 > A ? 0.0024 : 0)],
                ],
                rx - 0.0068,
                rx + 0.0068,
              ),
              m.metal,
            );
          for (const dx of [-0.0034, 0.0034])
            capScrew(g, m, [rx + dx, A + 0.0042, s * 0.021], Y, 0.0018, 8);
        }
      }
      // Scope body: eyepiece, tube, objective bell in one lathe.
      latheAt(
        g,
        m.metal,
        [
          [-0.0745, 0],
          [-0.0745, 0.0158],
          [-0.0782, 0.0174],
          [-0.0772, 0.0204],
          [-0.064, 0.0204],
          [-0.0628, 0.0199],
          [-0.0385, 0.0184],
          [-0.0195, 0.0182],
          [-0.009, R],
          [0.134, R],
          [0.158, 0.0184],
          [0.1835, 0.0192],
          [0.1855, 0.0182],
          [0.1845, 0.0168],
          [0.1775, 0.0164],
          [0.1775, 0],
        ],
        A,
        0,
        seg(30, 20),
      );
      lens(g, m, 0.1775, 0.0164, A, 0, 1, 0.0018, 24);
      lens(g, m, -0.0745, 0.0158, A, 0, -1, 0.0012, 24);
      // Diopter ring (fine flutes) and magnification ring (rubber ribs).
      flutes(
        g,
        m.metal,
        [-0.0762, A, 0],
        X,
        0.0207,
        0.0105,
        22,
        0.0007,
        0.0166,
      );
      flutes(g, m.rubber, [-0.0368, A, 0], X, 0.0191, 0.0158, 14, 0.0011);
      // Throw lever on the magnification ring, at 4 o'clock on the right.
      {
        const lever = ext(
          [
            [-0.0048, 0],
            [0.0048, 0],
            [0.0034, 0.0118, 0.0025],
            [0.0016, 0.0128, 0.0012],
            [-0.0016, 0.0128, 0.0012],
            [-0.0034, 0.0118, 0.0025],
          ],
          0.0034,
          0.0006,
        );
        lever.rotateY(Math.PI / 2);
        lever.rotateX(-(90 + 30) * deg);
        const dir = new T.Vector3(0, -Math.sin(30 * deg), -Math.cos(30 * deg));
        lever.translate(
          -0.029 + dir.x * 0.017,
          A + dir.y * 0.017,
          dir.z * 0.017,
        );
        g.add(lever, m.metal);
      }
      // Turret saddle: squared loft around the erector housing.
      const sx = [0.04, 0.045, 0.08, 0.085];
      g.add(
        shell(
          sx.map((x, i) => {
            const end = i % 3 === 0;
            return superRing(
              new T.Vector3(x, A, 0),
              Y,
              Z,
              end ? 0.0158 : 0.0172,
              end ? 0.0158 : 0.0165,
              end ? 0.0158 : 0.0186,
              end ? 0.0158 : 0.0186,
              end ? 2 : 3.2,
              seg(32, 20),
            );
          }),
        ),
        m.metal,
      );
      const TX = 0.0625;
      // Elevation (top) and windage (right): exposed knobs with a zero ring.
      for (const [dir, base, tall] of [
        [Y, 0.017, 0.0118],
        [Z.clone().negate(), 0.0182, 0.0098],
      ] as [T.Vector3, number, number][]) {
        const at = offsetAlong([TX, A, 0], dir, base - 0.0015);
        latheAlong(
          g,
          m.metal,
          [
            [0, 0],
            [0, 0.0108],
            [0.0037, 0.0108],
            [0.0037, 0.0122],
            [0.0037 + tall - 0.0012, 0.0122],
            [0.0037 + tall, 0.011],
            [0.0037 + tall, 0],
          ],
          at,
          dir,
          seg(20, 14),
        );
        flutes(
          g,
          m.metal,
          offsetAlong(at, dir, 0.0049),
          dir,
          0.0127,
          tall - 0.0062,
          20,
          0.0008,
        );
        mark(
          g,
          m.marking,
          offsetAlong(at, dir, 0.0037 + tall),
          dir,
          0.0003,
          0.0035,
          0,
        );
      }
      // Side turret on the left: large parallax dial, illumination knob on it.
      latheAlong(
        g,
        m.metal,
        [
          [0, 0],
          [0, 0.0128],
          [0.005, 0.0128],
          [0.005, 0.0142],
          [0.0118, 0.0142],
          [0.0125, 0.0134],
          [0.0125, 0],
        ],
        [TX, A, 0.0172],
        Z,
        seg(22, 14),
      );
      flutes(g, m.metal, [TX, A, 0.0228], Z, 0.0146, 0.0052, 18, 0.0008);
      latheAlong(
        g,
        m.rubber,
        [
          [0, 0],
          [0, 0.0078],
          [0.0062, 0.0078],
          [0.007, 0.007],
          [0.007, 0],
        ],
        [TX, A, 0.0297],
        Z,
        seg(20, 10),
      );
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        mark(
          g,
          m.marking,
          [TX + Math.cos(a) * 0.011, A + Math.sin(a) * 0.011, 0.0297],
          Z,
          0.0005,
          0.0005,
          a,
        );
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Laser sights: gun frame about `mount_laser`; the side rail's tooth tops at
// z = -LASER_STANDOFF, rail along X, facing +Z.

const railTop = -LASER_STANDOFF;

/** Clamp on the side rail: the rail frame turned so its "up" is +Z, drawn jaw
 * and nut underneath (gun -Y). */
function sideClamp(g: WeaponGeometry, m: WeaponFinish, c: Omit<Clamp, "side">) {
  inFrame(g, new T.Euler(Math.PI / 2, 0, 0), [0, 0, railTop], (h) =>
    railClamp(h, m, { ...c, side: 1 }),
  );
}

/** Basic Laser Sight: 19 mm visible-laser module in a two-band saddle.
 * Emitter behind a recessed window, battery cap with the activation button
 * at the rear, elevation (top) and windage (outboard) set screws. */
export function laserBasic(
  g: WeaponGeometry,
  finish: WeaponFinish,
  detail: Detail = "high",
) {
  const m = slots(finish, { rubber: true });
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      const top = railTop + 0.0045;
      sideClamp(g, m, {
        x0: -0.0125,
        x1: 0.0125,
        top: 0.0045,
        bolts: [LASER_BOLT],
        nut: "hex",
      });
      const r = 0.0095,
        zc = top + 0.0012 + r;
      // Saddle: cradle section, wider at the clamp.
      const cradle: P2[] = [[top - 0.0003, -0.0068, 0.0006]];
      for (let k = 0; k <= 4; k++) {
        const y = 0.0058 - (k / 4) * 0.0116;
        cradle.push([zc - Math.sqrt(r * r - y * y) + 0.0002, y]);
      }
      cradle.push([top - 0.0003, 0.0068, 0.0006]);
      g.add(bar(cradle, -0.0135, 0.0115), m.metal);
      for (const x of [-0.0105, 0.0085])
        latheAt(
          g,
          m.metal,
          [
            [x - 0.0025, r - 0.0002],
            [x - 0.0025, r + 0.0014],
            [x - 0.0012, r + 0.0018],
            [x + 0.0025, r + 0.0018],
            [x + 0.0025, r - 0.0002],
          ],
          0,
          zc,
          seg(16, 12),
        );
      // Module: battery cap at the rear, front bezel with the window.
      latheAt(
        g,
        m.metal,
        [
          [-0.0255, 0],
          [-0.0255, 0.0078],
          [-0.0244, 0.009],
          [-0.0152, 0.009],
          [-0.0142, r],
          [0.012, r],
          [0.0128, 0.0099],
          [0.0222, 0.0099],
          [0.0222, 0.0067],
          [0.0188, 0.0057],
          [0.0188, 0],
        ],
        0,
        zc,
        seg(18, 12),
      );
      flutes(g, m.metal, [-0.0238, 0, zc], X, 0.0093, 0.0072, 14, 0.0006);
      lens(g, m, 0.0188, 0.0057, 0, zc, 1, 0.0005, 16);
      latheAt(
        g,
        m.light,
        [
          [0.0189, 0],
          [0.0189, 0.0017],
          [0.0197, 0],
        ],
        0,
        zc,
        seg(10, 8),
      );
      // Activation button: rubber dome in the cap.
      latheAt(
        g,
        m.rubber,
        [
          [-0.025, 0],
          [-0.025, 0.0058],
          [-0.0262, 0.0048],
          [-0.0272, 0.003],
          [-0.0276, 0],
        ],
        0,
        zc,
        seg(14, 8),
      );
      // Set screws: elevation on top, windage outboard, in raised bosses.
      for (const dir of [Y, Z]) {
        const at = offsetAlong([0.0025, 0, zc], dir, r - 0.0006);
        latheAlong(
          g,
          m.metal,
          [
            [0, 0],
            [0, 0.0032],
            [0.0016, 0.0028],
            [0.0016, 0],
          ],
          at,
          dir,
          seg(10, 8),
        );
        capScrew(g, m, offsetAlong(at, dir, 0.0012), dir, 0.0017);
      }
    }),
  );
}

/** Advanced Laser Sight: rounded-box dual-aperture unit (visible laser above,
 * illuminator below), mode dial on top, battery cap outboard. A short lead
 * runs from the rear socket down to a pressure pad on a bracket off the
 * clamp's lower jaw: self-contained, so it fits all three rifles without a
 * gun-specific route. */
export function laserAdvanced(
  g: WeaponGeometry,
  finish: WeaponFinish,
  detail: Detail = "high",
) {
  const m = slots(finish, { rubber: true });
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      const top = railTop + 0.0045;
      sideClamp(g, m, {
        x0: -0.0125,
        x1: 0.0125,
        top: 0.0045,
        bolts: [LASER_BOLT],
        nut: "hex",
      });
      const zc = top + 0.0135,
        yc = 0.002,
        up = 0.0165,
        down = 0.0165,
        half = 0.0135;
      const stations: [number, number][] = [
        [-0.0285, 0.86],
        [-0.0276, 0.95],
        [-0.0255, 1],
        [0.0235, 1],
        [0.0262, 0.96],
        [0.0272, 0.9],
      ];
      g.add(
        shell(
          stations.map(([x, s]) =>
            superRing(
              new T.Vector3(x, yc, zc),
              Y,
              Z,
              up * s,
              down * s,
              half * s,
              half * s,
              4,
              seg(28, 20),
            ),
          ),
        ),
        m.metal,
      );
      // Apertures: laser window over the illuminator lens, in protruding hoods.
      const apertures: [number, number, number, number, number, number][] = [
        // y, z, outer, inner, length, segments
        [yc + 0.0088, zc + 0.001, 0.005, 0.0036, 0.0052, 14],
        [yc - 0.0052, zc, 0.0089, 0.0072, 0.0068, 18],
      ];
      for (const [y, z, ro, ri, len, n] of apertures) {
        const x1 = 0.0272 + len,
          seat = x1 - len * 0.55;
        latheAt(
          g,
          m.metal,
          [
            [0.024, 0],
            [0.024, ro],
            [x1 - 0.0008, ro],
            [x1, ri + 0.0004],
            [seat, ri],
            [seat, 0],
          ],
          y,
          z,
          seg(n, 10),
        );
        lens(g, m, seat, ri, y, z, 1, ri > 0.005 ? 0.0012 : 0.0004, n);
      }
      latheAt(
        g,
        m.light,
        [
          [0.0297, 0],
          [0.0297, 0.0016],
          [0.0305, 0],
        ],
        yc + 0.0088,
        zc + 0.001,
        seg(10, 8),
      );
      // Mode dial on top, rear, with pointer and three detent marks.
      const dial = [-0.0145, yc + up - 0.0006, zc + 0.001];
      latheAlong(
        g,
        m.metal,
        [
          [0, 0],
          [0, 0.0078],
          [0.0022, 0.0078],
          [0.0022, 0.0066],
          [0.0064, 0.0066],
          [0.007, 0.0058],
          [0.007, 0],
        ],
        dial,
        Y,
        seg(16, 12),
      );
      flutes(g, m.metal, offsetAlong(dial, Y, 0.0026), Y, 0.0068, 0.0028, 14);
      mark(g, m.marking, offsetAlong(dial, Y, 0.007), Y, 0.0006, 0.0028, 0);
      for (const a of [-35, 0, 35]) {
        const t = (a + 90) * deg;
        mark(
          g,
          m.marking,
          [
            dial[0] + Math.sin(t) * 0.0098,
            yc + up - 0.0003,
            dial[2] + Math.cos(t) * 0.0098,
          ],
          Y,
          0.0005,
          0.0005,
        );
      }
      // Battery cap outboard: knurled screw cap in a raised collar.
      const cap = [0.006, yc + 0.001, zc + half - 0.0006];
      latheAlong(
        g,
        m.metal,
        [
          [0, 0],
          [0, 0.0092],
          [0.002, 0.0092],
          [0.002, 0.0076],
          [0.0048, 0.0076],
          [0.0054, 0.0068],
          [0.0054, 0],
        ],
        cap,
        Z,
        seg(20, 12),
      );
      flutes(g, m.metal, offsetAlong(cap, Z, 0.002), Z, 0.0079, 0.0026, 16);
      bakeOnly(() =>
        mark(g, m.rubber, offsetAlong(cap, Z, 0.0054), Z, 0.0045, 0.0006),
      );
      // Rear socket and strain-relief boot.
      const sock = [yc - 0.0085, zc - 0.002];
      latheAt(
        g,
        m.metal,
        [
          [-0.0275, 0],
          [-0.0275, 0.0043],
          [-0.032, 0.0043],
          [-0.0325, 0.0036],
          [-0.0325, 0],
        ],
        sock[0],
        sock[1],
        seg(12, 8),
      );
      latheAt(
        g,
        m.rubber,
        [
          [-0.0325, 0],
          [-0.0325, 0.0032],
          [-0.0385, 0.0019],
          [-0.0385, 0],
        ],
        sock[0],
        sock[1],
        seg(10, 8),
      );
      // Pad bracket off the lower jaw, running back under the unit.
      const jawY = -0.0143,
        bz = railTop - 0.0062 + 0.0019;
      side(
        g,
        m.metal,
        [
          [-0.009, jawY + 0.002],
          [0.009, jawY + 0.002],
          [0.008, jawY - 0.005, 0.003],
          [-0.02, jawY - 0.0112, 0.006],
          [-0.05, jawY - 0.0112, 0.003],
          [-0.05, jawY - 0.0008, 0.003],
          [-0.022, jawY - 0.0008, 0.004],
          [-0.012, jawY + 0.002],
        ],
        0.0026,
        bz,
        0.0005,
      );
      capScrew(g, m, [-0.0035, jawY - 0.0016, bz + 0.0013], Z, 0.0017);
      // Pad: rubber switch on the bracket's outboard face, two raised ribs.
      const padZ = bz + 0.0013;
      const pad = ext(
        roundRect(-0.0335, jawY - 0.006, 0.0148, 0.0047, 0.0032),
        0.0036,
        0.0011,
      );
      pad.translate(0, 0, padZ + 0.0018);
      g.add(pad, m.rubber);
      for (const x of [-0.041, -0.0265])
        g.add(
          bar(
            [
              [padZ + 0.0034, jawY - 0.0094],
              [padZ + 0.0046, jawY - 0.009, 0.0004],
              [padZ + 0.0046, jawY - 0.003, 0.0004],
              [padZ + 0.0034, jawY - 0.0026],
            ],
            x - 0.0018,
            x + 0.0018,
            0.0003,
          ),
          m.rubber,
        );
      // Lead: boot down the rear of the clamp, clipped to the bracket, into the
      // pad's rear end.
      const lead = route([
        [-0.0385, sock[0], sock[1]],
        [-0.0418, sock[0] - 0.0025, sock[1] - 0.0028],
        [-0.0438, jawY + 0.0035, padZ + 0.0055],
        [-0.0462, jawY - 0.0016, padZ + 0.0042],
        [-0.0478, jawY - 0.0052, padZ + 0.0026],
      ]);
      g.add(sweep(lead, 0.0015, seg(22, 10), seg(6, 5)), m.rubber);
      latheAlong(
        g,
        m.steel,
        [
          [-0.0017, 0.0015],
          [-0.0017, 0.0022],
          [0.0017, 0.0022],
          [0.0017, 0.0015],
          [-0.0017, 0.0015],
        ],
        lead.getPointAt(0.62).toArray(),
        lead.getTangentAt(0.62),
        seg(10, 8),
      );
    }),
  );
}

/** Sniper Laser Sight: precision aiming/ranging module. Three apertures of
 * different sizes behind a front plate (receiver lens, laser emitter,
 * illuminator), capped elevation/windage turret pair, rear status display,
 * battery tube underneath, cam-lever clamp. */
export function laserSniper(
  g: WeaponGeometry,
  finish: WeaponFinish,
  detail: Detail = "high",
) {
  const m = slots(finish, {});
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      const top = railTop + 0.005;
      sideClamp(g, m, {
        x0: -0.0135,
        x1: 0.0135,
        top: 0.005,
        bolts: [LASER_BOLT],
        nut: "lever",
      });
      const zc = top + 0.0158,
        yc = 0.004,
        up = 0.0195,
        down = 0.0165,
        half = 0.0158;
      const stations: [number, number, number][] = [
        [-0.034, 0.87, 3],
        [-0.0328, 0.95, 3.8],
        [-0.03, 1, 4.6],
        [0.034, 1, 4.6],
        [0.037, 0.97, 4],
        [0.0385, 0.93, 3.6],
      ];
      g.add(
        shell(
          stations.map(([x, s, n]) =>
            superRing(
              new T.Vector3(x, yc, zc),
              Y,
              Z,
              up * s,
              down * s,
              half * s,
              half * s,
              n,
              seg(36, 20),
            ),
          ),
        ),
        m.metal,
      );
      // Front plate with three real apertures.
      const holes: [number, number, number, number][] = [
        // y, z, radius, segments
        [yc + 0.0062, zc - 0.0005, 0.0102, 24],
        [yc - 0.0108, zc - 0.0072, 0.0038, 12],
        [yc - 0.0104, zc + 0.0068, 0.0055, 14],
      ];
      {
        const plateGeo = ext(
          roundRect(
            0,
            (up - down) / 2,
            half * 0.97,
            (up + down) * 0.485,
            0.008,
          ).map(([z, y, r]) => [-z, y, r] as P2),
          0.006,
          0,
          holes.map(([y, z, r, n]) => circle(-(z - zc), y - yc, r + 0.0011, n)),
        );
        plateGeo.rotateY(Math.PI / 2);
        g.add(plateGeo, m.metal, [0.0412, yc, zc]);
      }
      for (const [y, z, r, n] of holes) {
        const x1 = 0.0428,
          depth = r > 0.008 ? 0.0055 : 0.0038;
        latheAt(
          g,
          m.metal,
          [
            [0.034, 0],
            [0.034, r + 0.0011],
            [x1, r + 0.0011],
            [x1, r],
            [x1 - depth, r],
            [x1 - depth, 0],
          ],
          y,
          z,
          seg(n, 10),
        );
        lens(g, m, x1 - depth, r, y, z, 1, r > 0.008 ? 0.0016 : 0.0005, n);
      }
      {
        const [y, z] = holes[1];
        latheAt(
          g,
          m.light,
          [
            [0.039, 0],
            [0.039, 0.0015],
            [0.0399, 0],
          ],
          y,
          z,
          seg(10, 8),
        );
      }
      // Longitudinal grip ribs on the outboard face.
      for (const dy of [-0.008, 0, 0.008])
        g.add(
          bar(
            [
              [zc + half - 0.0006, yc + dy - 0.0021],
              [zc + half + 0.0014, yc + dy - 0.0014, 0.0006],
              [zc + half + 0.0014, yc + dy + 0.0014, 0.0006],
              [zc + half - 0.0006, yc + dy + 0.0021],
            ],
            -0.024,
            -0.002,
            0.0006,
          ),
          m.rubber,
        );
      // Turret pair: elevation on top, windage outboard, capped.
      for (const [dir, base] of [
        [Y, up],
        [Z, half],
      ] as [T.Vector3, number][]) {
        const at = offsetAlong([0.017, yc, zc], dir, base - 0.0008);
        latheAlong(
          g,
          m.metal,
          [
            [0, 0],
            [0, 0.0088],
            [0.0033, 0.0088],
            [0.0033, 0.0078],
            [0.0088, 0.0078],
            [0.0095, 0.007],
            [0.0095, 0],
          ],
          at,
          dir,
          seg(20, 12),
        );
        flutes(
          g,
          m.metal,
          offsetAlong(at, dir, 0.0037),
          dir,
          0.008,
          0.0034,
          16,
        );
        bakeOnly(() =>
          mark(g, m.rubber, offsetAlong(at, dir, 0.0095), dir, 0.0046, 0.0006),
        );
      }
      // Rear status display in a rubber bezel, two buttons beneath it.
      {
        const bezel = ext(roundRect(0, 0, 0.0105, 0.0072, 0.003), 0.0024, 0, [
          roundRect(0, 0, 0.0082, 0.005, 0.0016),
        ]);
        bezel.rotateY(-Math.PI / 2);
        g.add(bezel, m.rubber, [-0.0344, yc + 0.0062, zc + 0.0005]);
        const screen = ext(roundRect(0, 0, 0.0084, 0.0052, 0.0016), 0.0006);
        screen.rotateY(-Math.PI / 2);
        g.add(screen, m.light, [-0.0341, yc + 0.0062, zc + 0.0005]);
        for (const dz of [-0.0055, 0.0055])
          latheAlong(
            g,
            m.rubber,
            [
              [0, 0],
              [0, 0.0028],
              [0.0012, 0.0025],
              [0.0019, 0],
            ],
            [-0.0332, yc - 0.0078, zc + dz],
            X.clone().negate(),
            seg(12, 8),
          );
      }
      // Battery tube under the housing, knurled cap at the rear.
      const by = yc - down - 0.0042,
        bz = zc + 0.0035;
      latheAt(
        g,
        m.metal,
        [
          [-0.0352, 0],
          [-0.0352, 0.0066],
          [-0.0344, 0.0074],
          [0.0285, 0.0074],
          [0.031, 0.0062],
          [0.031, 0],
        ],
        by,
        bz,
        seg(20, 12),
      );
      flutes(g, m.metal, [-0.0346, by, bz], X, 0.0077, 0.0074, 16);
      side(
        g,
        m.metal,
        [
          [-0.024, by],
          [0.028, by],
          [0.03, yc - down + 0.003, 0.003],
          [-0.026, yc - down + 0.003, 0.003],
        ],
        0.0072,
        bz,
        0.0005,
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Laser trace: a short red beam leaving the emitter, so a fitted laser reads
// from the side the sight does not face. Not part of the builders above (it is
// not gun finish); the Armory adds it as its own unlit mesh.

/** Emitter aperture per tier, authoring frame about `mount_laser`: [x, y, z]
 * just ahead of the lit emitter disc (see the builders above). */
const LASER_APERTURE: Record<1 | 2 | 3, [number, number, number]> = {
  1: [0.0224, 0, railTop + 0.0045 + 0.0012 + 0.0095],
  2: [0.0326, 0.002 + 0.0088, railTop + 0.0045 + 0.0135 + 0.001],
  3: [0.043, 0.004 - 0.0108, railTop + 0.005 + 0.0158 - 0.0072],
};

/** Soft radial falloff: alpha and a hot-white core, sampled along v for the
 * beam's width and over both axes for the glow dot. */
function traceTexture() {
  const n = 64,
    data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5) * 2;
      const core = Math.exp(-((r / 0.14) ** 2));
      const halo = 0.5 * Math.exp(-((r / 0.5) ** 2));
      const a = Math.max(0, Math.min(1, core + halo)) * (r < 1 ? 1 : 0);
      const k = (j * n + i) * 4;
      data[k] = 255;
      data[k + 1] = Math.round(40 + 215 * core);
      data[k + 2] = Math.round(30 + 200 * core);
      data[k + 3] = Math.round(255 * a);
    }
  const tex = new T.DataTexture(data, n, n, T.RGBAFormat);
  tex.minFilter = tex.magFilter = T.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Laser beam for tier `tier` as an unlit mesh in the weapon frame (the frame
 * `seat` in armory-weapons puts fittings in, already at the stage's scale).
 * `mount` is the gun's laser mount (weapon frame, unscaled); `endX` the gun-
 * frame x where the beam has faded out; `holdX` where it starts to fade (the
 * muzzle). Two crossed ribbons along the bore and a three-plane glow dot, about
 * 30 triangles. Owns its material and texture: dispose both with the mesh. */
export function createLaserTrace(
  tier: 1 | 2 | 3,
  mount: readonly number[],
  endX: number,
  holdX = endX,
  width = 0.011,
) {
  const [ax, ay, az] = LASER_APERTURE[tier];
  // Weapon frame about the mount: x forward, y up, z the shooter's right.
  const x0 = ax,
    x1 = endX - mount[0],
    y = ay,
    z = -az;
  const hold = Math.min(0.98, Math.max(0, (holdX - mount[0] - x0) / (x1 - x0)));
  const pos: number[] = [],
    uv: number[] = [],
    col: number[] = [],
    index: number[] = [];
  const vert = (
    x: number,
    yy: number,
    zz: number,
    u: number,
    v: number,
    a: number,
  ) => {
    pos.push(x, yy, zz);
    uv.push(u, v);
    col.push(1, 1, 1, a);
    return pos.length / 3 - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) =>
    index.push(a, b, c, a, c, d);
  // Stations along the beam with their alpha: hold, then an eased fade.
  const stations: [number, number][] = [[0, 0.9]];
  stations.push([hold * 0.5, 0.85], [hold, 0.8]);
  const fade = 6;
  for (let k = 1; k <= fade; k++) {
    const s = k / fade,
      e = s * s * (3 - 2 * s);
    stations.push([hold + (1 - hold) * s, 0.8 * (1 - e) ** 1.6]);
  }
  const h = width / 2;
  for (const [dy, dz] of [
    [h, 0],
    [0, h],
  ]) {
    let prev: [number, number] | undefined;
    for (const [t, a] of stations) {
      const x = x0 + (x1 - x0) * t;
      const lo = vert(x, y - dy, z - dz, 0.5, 0, a),
        hi = vert(x, y + dy, z + dz, 0.5, 1, a);
      if (prev) quad(prev[0], lo, hi, prev[1]);
      prev = [lo, hi];
    }
  }
  // Glow dot at the aperture: two planes through the axis, one across it.
  const d = width * 1.1;
  for (const [ex, ey, ez, fx, fy, fz] of [
    [0, d, 0, 0, 0, d],
    [0, d, 0, d, 0, 0],
    [0, 0, d, d, 0, 0],
  ]) {
    const c = [x0 + 0.0004, y, z];
    quad(
      vert(c[0] - ex - fx, c[1] - ey - fy, c[2] - ez - fz, 0, 0, 1),
      vert(c[0] + ex - fx, c[1] + ey - fy, c[2] + ez - fz, 0, 1, 1),
      vert(c[0] + ex + fx, c[1] + ey + fy, c[2] + ez + fz, 1, 1, 1),
      vert(c[0] - ex + fx, c[1] - ey + fy, c[2] - ez + fz, 1, 0, 1),
    );
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new T.Float32BufferAttribute(col, 4));
  geo.setIndex(index);
  geo.translate(mount[0], mount[1], mount[2]);
  geo.scale(WEAPON_SCALE, WEAPON_SCALE, WEAPON_SCALE);
  const material = new T.MeshBasicMaterial({
    name: "laser-trace",
    map: traceTexture(),
    vertexColors: true,
    transparent: true,
    // Additive in colour; alpha accumulates too, so it also reads over the
    // preview's transparent canvas.
    blending: T.CustomBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.SrcAlphaFactor,
    blendDst: T.OneFactor,
    blendSrcAlpha: T.OneFactor,
    blendDstAlpha: T.OneFactor,
    side: T.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const mesh = new T.Mesh(geo, material);
  mesh.name = "laser-trace";
  mesh.renderOrder = 10;
  mesh.userData.laserTrace = true;
  mesh.raycast = () => {};
  return mesh;
}

// ---------------------------------------------------------------------------
// Assembly

type Builder = (g: WeaponGeometry, m: WeaponFinish, detail?: Detail) => void;

export const RAIL_UPGRADES: Record<
  "scope" | "laser",
  [Builder, Builder, Builder]
> = {
  scope: [scopeBasic, scopeAdvanced, scopeSuperior],
  laser: [laserBasic, laserAdvanced, laserSniper],
};

/** Sized fitting root, the same contract as `createWeaponAttachment`. */
export function createRailUpgrade(
  slot: "scope" | "laser",
  tier: 1 | 2 | 3,
  detail: Detail = "high",
  finish: WeaponFinish = familyFinish(),
) {
  const g = new WeaponGeometry();
  RAIL_UPGRADES[slot][tier - 1](g, finish, detail);
  const root = g.finish(`${slot}-${tier}`, WEAPON_BASIS);
  root.userData.attachmentSlot = slot;
  root.userData.tier = tier;
  root.userData.interface = `ghosts:${slot}:v1`;
  return sizeWeapon(root);
}
