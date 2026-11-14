// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import "./extrude.ts";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WeaponGeometry,
  sizeWeapon,
  weaponFinish,
  type WeaponFinish,
} from "./weapon-finish.ts";
import {
  X,
  Y,
  Z,
  band,
  bakeOnly,
  familyFinish,
  inAuthoringFrame,
  isLow,
  latheAlong,
  prism,
  route,
  seg,
  shell,
  smooth,
  superRing,
  sweep,
  helix,
  withDetail,
  type Detail,
  type P2,
} from "./rifle-shapes.ts";

/** Furniture upgrades for the redesigned long guns (standalone previews, not
 * linked into the catalog): expanded magazines / power cells per gun, and
 * stocks per stock interface. Same conventions as `createWeaponAttachment`:
 * the guns' authoring frame (metres, +X muzzle, +Y up, +Z the shooter's left;
 * see rifle-shapes.ts), local origin at the gun's clip or stock mount,
 * mirrored into the weapon frame, `WEAPON_BASIS`, then `sizeWeapon` (0.9
 * about the mount). Clips are authored in the gun's own coordinates and shifted by the
 * mount (`g.offset`), so the well datums below are the guns' own.
 *
 * Interfaces:
 * - clip: per gun (service / marksman magazine wells, plasma cell well).
 * - stock "tube": the service and marksman receiver extensions (castle nut at
 *   the mount, tube coaxial with the bore). Ø29.0 vs Ø29.6, comb height
 *   (rail top above the axis) 30.0 vs 36.5: one design per tier, parametrised.
 * - stock "plasma": its own interface (Ø25.6 extension, sight line 43 above
 *   the axis), strut-built in that gun's prototype language. */

export type FurnitureGun = "rifle" | "marksman" | "plasma";
type V = T.Vector3;
const v3 = (x: number, y: number, z = 0) => new T.Vector3(x, y, z);

export function createFurnitureUpgrade(
  kind: "clip" | "stock",
  gun: FurnitureGun,
  tier: 1 | 2 | 3,
  detail: Detail = "high",
  finish: WeaponFinish = gun === "plasma"
    ? weaponFinish("plasma")
    : familyFinish(),
) {
  const g = new WeaponGeometry(),
    m = finish;
  inAuthoringFrame(g, (g) =>
    withDetail(detail, () => {
      if (kind === "clip") {
        if (gun === "rifle") serviceClip(g, m, tier);
        else if (gun === "marksman") marksmanClip(g, m, tier);
        else plasmaCell(g, m, tier);
      } else if (gun === "plasma") plasmaStock(g, m, tier);
      else tubeStock(g, m, tier, TUBE[gun]);
    }),
  );
  const id =
    kind === "clip" || gun === "plasma"
      ? `${kind}-${gun}-${tier}`
      : `stock-tube-${tier}-${gun}`;
  const root = g.finish(id, WEAPON_BASIS);
  root.userData.attachmentSlot = kind;
  root.userData.tier = tier;
  root.userData.gun = gun;
  root.userData.interface = `ghosts:${kind}:v1`;
  root.userData.stockInterface =
    kind === "stock" ? (gun === "plasma" ? "plasma" : "tube") : undefined;
  return sizeWeapon(root);
}

// ---------------------------------------------------------------------------
// Small shared parts

/** Light fillet: arcs of ~30° steps; at "low", radii under 2.5 mm stay sharp. */
function lightFillet(points: P2[], radius: number): T.Vector2[] {
  const out: T.Vector2[] = [];
  const n = points.length;
  const at = (i: number) => {
    const q = points[(i + n) % n];
    return new T.Vector2(q[0], q[1]);
  };
  for (let i = 0; i < n; i++) {
    const p = at(i),
      r = points[i][2] ?? radius;
    const da = p.clone().sub(at(i - 1)),
      db = at(i + 1).sub(p);
    const la = da.length(),
      lb = db.length();
    if (la < 1e-9 || lb < 1e-9) continue;
    da.divideScalar(la);
    db.divideScalar(lb);
    const turn = Math.acos(Math.min(1, Math.max(-1, da.dot(db))));
    if (r <= 0 || turn < 0.02 || (isLow() && r < 0.0025)) {
      out.push(p);
      continue;
    }
    const t = Math.min(r * Math.tan(turn / 2), la * 0.48, lb * 0.48);
    const s = p.clone().addScaledVector(da, -t),
      e = p.clone().addScaledVector(db, t);
    const steps = isLow()
      ? 1
      : Math.max(1, Math.ceil(turn / (r < 0.003 ? 0.8 : 0.5)));
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

/** Side profile (x, y) extruded across Z with a single chamfer-like bevel:
 * the furniture's lean counterpart of the family `slab`. */
function slab(
  g: WeaponGeometry,
  mat: T.Material,
  points: P2[],
  width: number,
  z = 0,
  bevel = 0.0012,
  holes: P2[][] = [],
  radius = 0.0015,
) {
  const shape = new T.Shape(lightFillet(points, radius));
  for (const hole of holes)
    shape.holes.push(new T.Path(lightFillet(hole, radius)));
  const b = isLow() ? 0 : Math.min(bevel, width * 0.3);
  const depth = width - 2 * b;
  const geo = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: b > 0.0015 ? 2 : 1,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  g.add(geo, mat, [0, 0, z]);
}

function screw(g: WeaponGeometry, m: WeaponFinish, p: number[], r = 0.0022) {
  const side = Math.sign(p[2]) || 1;
  g.cylinder(p, r, 0.0018, m.steel, "z", r, seg(8, 6));
  g.cylinder(
    [p[0], p[1], p[2] + side * 0.0009],
    r * 0.48,
    0.0003,
    m.rubber,
    "z",
    r * 0.48,
    6,
  );
}

/** Knurled wheel revolved about `axis` through `at`: `r` outer radius, `w` width. */
function thumbwheel(
  g: WeaponGeometry,
  mat: T.Material,
  at: number[],
  axis: V,
  r: number,
  w: number,
  ridges = 3,
) {
  const p: number[][] = [
    [0, 0],
    [0, r * 0.85],
  ];
  if (isLow()) p.push([w * 0.1, r], [w * 0.9, r]);
  else
    for (let k = 0; k < ridges; k++) {
      const a = w * (0.12 + (0.76 * k) / ridges),
        b = w * (0.12 + (0.76 * (k + 0.5)) / ridges);
      p.push([a, r], [b, r * 0.93]);
    }
  p.push([w * 0.9, r], [w, r * 0.85], [w, 0]);
  latheAlong(g, mat, p, at, axis, seg(16, 10));
}

/** Flush QD sling socket, axis along ±Z. */
function qdCup(g: WeaponGeometry, m: WeaponFinish, at: number[], side: number) {
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0064],
      [0.0018, 0.0064],
      [0.0024, 0.0054],
      [0.0024, 0.0031],
      [0.0008, 0.0031],
      [0.0008, 0],
    ],
    at,
    v3(0, 0, side),
    seg(12, 8),
  );
}

/** Castle nut and receiver-extension tube, `x1` long behind the mount. */
function extension(
  g: WeaponGeometry,
  m: WeaponFinish,
  nutR: number,
  tubeR: number,
  x1: number,
) {
  latheAlong(
    g,
    m.metal,
    [
      [0, 0],
      [0, nutR - 0.0012],
      [0.0012, nutR],
      [0.0083, nutR],
      [0.0095, nutR - 0.0012],
      [0.0095, 0],
    ],
    [0, 0, 0],
    v3(-1, 0, 0),
    seg(24, 12),
  );
  bakeOnly(() => {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 6;
      g.add(
        new T.BoxGeometry(0.0045, 0.0026, 0.0026),
        m.rubber,
        [-0.002, Math.cos(a) * (nutR - 0.0002), Math.sin(a) * (nutR - 0.0002)],
        new T.Euler(a, 0, 0),
      );
    }
  });
  latheAlong(
    g,
    m.metal,
    [
      [0.0095, 0],
      [0.0095, tubeR],
      [x1 - 0.0015, tubeR],
      [x1, tubeR - 0.0015],
      [x1, 0],
    ],
    [0, 0, 0],
    v3(-1, 0, 0),
    seg(28, 16),
  );
}

/** Body lofted along X: stations [x, top, bottom, half-width, roundness?]. */
function loft(
  g: WeaponGeometry,
  mat: T.Material,
  stations: number[][],
  n = 3.2,
  N = seg(28, 16),
) {
  g.add(
    shell(
      stations.map(([x, t, b, h, k]) =>
        superRing(
          v3(x, (t + b) / 2),
          Y,
          Z,
          (t - b) / 2,
          (t - b) / 2,
          h,
          h,
          k ?? n,
          N,
        ),
      ),
    ),
    mat,
  );
}

/** Rounded ends for a loft: the first/last station shrunk to a soft edge. */
function softEnds(st: number[][], r = 0.003) {
  const [a, b] = [st[0], st[st.length - 1]];
  const shrink = (s: number[], dx: number, k: number) => [
    s[0] + dx,
    s[1] - r * k,
    s[2] + r * k,
    s[3] - r * k,
    s[4] ?? 3.2,
  ];
  const sa = Math.sign(a[0] - st[1][0]) || 1,
    sb = Math.sign(b[0] - st[st.length - 2][0]) || -1;
  return isLow()
    ? st
    : [
        shrink(a, sa * r * 0.6, 1),
        shrink(a, sa * r * 0.2, 0.35),
        ...st,
        shrink(b, sb * r * 0.2, 0.35),
        shrink(b, sb * r * 0.6, 1),
      ].sort((p, q) => q[0] - p[0]);
}

// ---------------------------------------------------------------------------
// Box magazines (service and marksman)

interface Well {
  /** Gun coordinates of the clip mount (well mouth). */
  mount: [number, number];
  /** Rake datum: x of the well centre at y = top, and dx/dy rake. */
  center: number;
  top: number;
  rake: number;
  /** Body half-section in the well. */
  hx: number;
  hz: number;
  /** Cartridge: radius and overall length. */
  round: [number, number];
}

const SERVICE_WELL: Well = {
  mount: [-0.01225 + (0.0085 + 0.05) * 0.087, -0.05],
  center: -0.01225,
  top: 0.0085,
  rake: 0.087,
  hx: 0.031,
  hz: 0.0115,
  round: [0.0046, 0.055],
};
const MARKSMAN_WELL: Well = {
  mount: [-0.0069 + (0.00792 + 0.056) * 0.05, -0.056],
  center: -0.0069,
  top: 0.00792,
  rake: 0.05,
  hx: 0.0358,
  hz: 0.0127,
  round: [0.0057, 0.068],
};

interface Spine {
  p: V;
  U: V;
  D: V;
}
/** Magazine centre line: straight in the well, then a constant forward curve. */
function spine(w: Well, straight: number, radius: number) {
  const top = v3(w.center + (w.top - 0.004) * w.rake, 0.004);
  const a0 = w.rake;
  const along = (a: number) => v3(Math.sin(a), -Math.cos(a));
  return (s: number): Spine => {
    const p = top.clone();
    if (s <= straight) p.addScaledVector(along(a0), s);
    else {
      p.addScaledVector(along(a0), straight);
      const t = (s - straight) / radius;
      const c0 = v3(Math.cos(a0), Math.sin(a0)).multiplyScalar(radius);
      const rot = v3(
        c0.x * Math.cos(t) - c0.y * Math.sin(t),
        c0.x * Math.sin(t) + c0.y * Math.cos(t),
      );
      p.add(c0).sub(rot);
    }
    const a = a0 + Math.max(0, s - straight) / radius;
    return { p, U: v3(Math.cos(a), Math.sin(a)), D: along(a) };
  };
}

interface BoxSpec {
  straight: number;
  radius: number;
  length: number;
  /** Half-width (z) along the body; default the well's. */
  hz?: (s: number) => number;
  /** Fore/aft half-lengths along the body. */
  hx?: (s: number) => [number, number];
  ribs?: number[];
  window?: [number, number];
  /** Arc length of the catch notch on the left flank (service AR pattern). */
  catch?: number;
  /** Floorplate: thickness, overhang and a reinforcing collar; none on a
   * feed tower. */
  plate?: { t: number; lip: number; collar?: boolean; sleeve?: number };
  pitch?: number;
  /** Extra body stations (e.g. through a flare). */
  stations?: number[];
}

/** Ring of the magazine section at arc length s. */
function magRing(
  f: (s: number) => Spine,
  w: Well,
  b: BoxSpec,
  s: number,
  k = 1,
  extra = 0,
) {
  const { p, U } = f(s);
  const [front, back] = b.hx?.(s) ?? [w.hx, w.hx];
  const hz = b.hz?.(s) ?? w.hz;
  return superRing(
    p,
    U,
    Z,
    front * k + extra,
    back * k + extra,
    hz * k + extra,
    hz * k + extra,
    6,
    seg(32, 16),
  );
}

/** Polymer box magazine: feed lips with the top round, body along the spine,
 * pressed ribs, optional witness window, floorplate. */
function boxMagazine(g: WeaponGeometry, m: WeaponFinish, w: Well, b: BoxSpec) {
  g.offset.set(-w.mount[0], -w.mount[1], 0);
  const f = spine(w, b.straight, b.radius);
  const ss: number[] = [0, ...(b.stations ?? [])];
  const pitch = b.pitch ?? seg(0.018, 0.028);
  ss.push(Math.min(b.straight, b.length) - 0.001);
  for (let s = b.straight + pitch; s < b.length - 0.004; s += pitch) ss.push(s);
  ss.push(b.length);
  ss.sort((p, q) => p - q);
  // Feed lips: the top 4 mm closes in over the round.
  const lips: [number, number][] = isLow()
    ? [[-0.004, 0.8]]
    : [
        [-0.0042, 0.72],
        [-0.0036, 0.86],
        [-0.0022, 0.96],
      ];
  g.add(
    shell([
      ...lips.map(([s, k]) => {
        const { p, U } = f(0);
        const q = p.clone().addScaledVector(U, 0).addScaledVector(f(0).D, s);
        const [front, back] = b.hx?.(0) ?? [w.hx, w.hx];
        return superRing(
          q,
          U,
          Z,
          front * (0.5 + 0.5 * k),
          back * (0.6 + 0.4 * k),
          w.hz * k,
          w.hz * k,
          6,
          seg(32, 16),
        );
      }),
      ...ss.map((s) => magRing(f, w, b, s)),
    ]),
    m.metal,
  );
  // Top round between the lips, bullet forward; staggered to the left.
  const [rr, oal] = w.round;
  const t0 = f(0);
  const base = t0.p
    .clone()
    .addScaledVector(t0.D, -0.0022 - rr * 0.3)
    .addScaledVector(t0.U, -w.hx + 0.003)
    .add(v3(0, 0, w.hz * 0.22));
  latheAlong(
    g,
    m.accent,
    [
      [0, 0],
      [0, rr * 0.92],
      [0.0012, rr],
      [oal * 0.58, rr * 0.94],
      [oal * 0.64, rr * 0.62],
      [oal * 0.7, rr * 0.6],
      [oal * 0.8, rr * 0.55],
      [oal * 0.92, rr * 0.33],
      [oal, rr * 0.08],
      [oal, 0],
    ],
    base.toArray(),
    t0.U,
    seg(12, 8),
  );
  // Pressed ribs along the body flanks.
  for (const side of isLow() ? [] : [-1, 1])
    for (const u of b.ribs ?? [-0.6, 0.45]) {
      const rings: V[][] = [];
      // From the curve's start, or just below the well on a straight box.
      const s0 = Math.min(b.straight, 0.066) + 0.004,
        s1 = b.length - 0.012;
      for (let s = s0; s <= s1 + 1e-6; s += (s1 - s0) / 7) {
        const { p, U } = f(s);
        const [front, back] = b.hx?.(s) ?? [w.hx, w.hx];
        const hz = b.hz?.(s) ?? w.hz;
        const c = p
          .clone()
          .addScaledVector(U, u * (u > 0 ? front : back))
          .addScaledVector(Z, side * (hz - 0.0003));
        const k = s < s0 + 0.004 || s > s1 - 0.004 ? 0.55 : 1;
        rings.push(
          superRing(
            c,
            U,
            Z.clone().multiplyScalar(side),
            0.0019 * k,
            0.0019 * k,
            0.001 * k,
            0.0008,
            3,
            8,
          ),
        );
      }
      g.add(shell(rings), m.metal);
    }
  // Witness window: a glass strip in a raised frame, both flanks.
  if (b.window)
    for (const side of [-1, 1]) {
      const frame: V[][] = [],
        glass: V[][] = [];
      const [s0, s1] = b.window;
      const n = 4;
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        const { p, U } = f(s);
        const back = (b.hx?.(s) ?? [w.hx, w.hx])[1];
        const hz = b.hz?.(s) ?? w.hz;
        const c = p
          .clone()
          .addScaledVector(U, -back * 0.18)
          .addScaledVector(Z, side * (hz - 0.0004));
        const k = i === 0 || i === n ? 0.7 : 1;
        frame.push(
          superRing(c, U, Z.clone().multiplyScalar(side), 0.0062 * k, 0.0062 * k, 0.0011 * k, 0.0006, 4, 10),
        );
        glass.push(
          superRing(
            c.clone().addScaledVector(Z, side * 0.0007),
            U,
            Z.clone().multiplyScalar(side),
            0.0042 * k,
            0.0042 * k,
            0.00075,
            0.0004,
            4,
            8,
          ),
        );
      }
      g.add(shell(frame), m.rubber);
      g.add(shell(glass), m.glass);
      // Count marks beside the window.
      bakeOnly(() => {
        for (let i = 1; i < 5; i++) {
          const s = s0 + ((s1 - s0) * i) / 5;
          const { p, U } = f(s);
          const hz = b.hz?.(s) ?? w.hz;
          const c = p
            .clone()
            .addScaledVector(U, -(b.hx?.(s) ?? [w.hx, w.hx])[1] * 0.18 + 0.0078)
            .addScaledVector(Z, side * (hz + 0.0002));
          g.add(
            new T.BoxGeometry(0.0028, 0.0007, 0.0005),
            m.marking,
            c.toArray(),
            new T.Euler(0, 0, Math.atan2(U.y, U.x)),
          );
        }
      });
    }
  // Catch notch on the left flank, where the catch driven by the right-side
  // release button bears: a moulded boss round a real opening.
  if (b.catch !== undefined) {
    const { p, U, D } = f(b.catch);
    const hz = b.hz?.(b.catch) ?? w.hz;
    const at = (u: number, d: number): P2 => {
      const q = p.clone().addScaledVector(U, u).addScaledVector(D, d);
      return [q.x, q.y];
    };
    const rect = (u0: number, u1: number, d0: number, d1: number) => [
      at(u0, d0),
      at(u1, d0),
      at(u1, d1),
      at(u0, d1),
    ];
    slab(g, m.metal, rect(-0.0195, -0.0025, -0.005, 0.006), 0.0012, hz + 0.0004, 0.0003, [rect(-0.0165, -0.0055, -0.002, 0.003)], 0.0008);
    slab(g, m.rubber, rect(-0.017, -0.005, -0.0025, 0.0035), 0.0006, hz + 0.0001, 0, [], 0);
  }
  if (!b.plate) return f;
  // Floorplate: overhanging, a forward lip, optional reinforcing collar.
  const L = b.length,
    { t, lip, collar } = b.plate;
  const plate = (s: number, k: number, front = 0) => {
    const { p, U } = f(s);
    const [fr, bk] = b.hx?.(L) ?? [w.hx, w.hx];
    const hz = b.hz?.(L) ?? w.hz;
    return superRing(
      p,
      U,
      Z,
      (fr + lip + front) * k,
      (bk + lip) * k,
      (hz + lip * 0.6) * k,
      (hz + lip * 0.6) * k,
      7,
      seg(32, 16),
    );
  };
  const sl = b.plate.sleeve ?? 0;
  const rings: [number, number, number][] = sl
    ? [
        [L - sl - 0.002, 0.93, 0],
        [L - sl, 1, 0],
        [L - sl + 0.002, 1, 0],
        [L - sl + 0.0028, 0.97, 0],
        [L - sl + 0.0036, 1, 0],
        [L + t - 0.0025, 1, 0.002],
        [L + t - 0.0008, 0.95, 0.002],
        [L + t, 0.82, 0.002],
      ]
    : collar
    ? [
        [L - 0.012, 0.93, 0],
        [L - 0.0105, 1, 0],
        [L - 0.0052, 0.975, 0],
        [L - 0.0036, 1, 0],
        [L + t - 0.0025, 1, 0.002],
        [L + t - 0.0008, 0.95, 0.002],
        [L + t, 0.82, 0.002],
      ]
    : [
        [L - 0.0015, 0.93, 0],
        [L, 1, 0],
        [L + t - 0.0025, 1, 0.002],
        [L + t - 0.0008, 0.95, 0.002],
        [L + t, 0.82, 0.002],
      ];
  g.add(shell(rings.map(([s, k, fr]) => plate(s, k, fr))), m.rubber);
  return f;
}

/** Raised bands round a box body at arc lengths `at`: a coupler or grip bands. */
function bands(
  g: WeaponGeometry,
  mat: T.Material,
  f: (s: number) => Spine,
  w: Well,
  b: BoxSpec,
  at: number[],
  half: number,
  rise: number,
) {
  for (const s of at)
    g.add(
      shell([
        magRing(f, w, b, s - half, 1, -0.0002),
        magRing(f, w, b, s - half + 0.0012, 1, rise),
        magRing(f, w, b, s + half - 0.0012, 1, rise),
        magRing(f, w, b, s + half, 1, -0.0002),
      ]),
      mat,
    );
}

/** 60-round AR drum, D-60 / X-15 pattern. A magazine top (feed lips, top
 * round, catch notch) leaves the well as a short feed tower and flares into
 * one drum whose axis runs with the bore, centred on the gun's centre line
 * with the tower entering its top dead centre. From behind a closed 108 disc:
 * rim with six fasteners, a recessed panel with a pressed ring and radial
 * ribs, a round-count indicator slot, the centre hub with the folded loading
 * lever and the ratchet knob; from the side a 68-deep cylinder seen edge-on.
 * Its top sits 11 below the well mouth, clear of the trigger guard front. */
function arDrum(g: WeaponGeometry, m: WeaponFinish, w: Well) {
  // Arc length from the feed lips to the drum top (y -0.061; mouth -0.050).
  const tower = 0.065,
    R = 0.054,
    L = 0.068;
  const spec: BoxSpec = {
    straight: 1,
    radius: 1,
    length: tower + 0.014,
    ribs: [],
    catch: 0.02,
  };
  const f = boxMagazine(g, m, w, spec);
  const t = f(tower);
  // Drum axis level with the bore, centred fore-aft under the tower foot.
  const c = v3(t.p.x, t.p.y - R, 0);
  const x0 = c.x - L / 2;
  const at = [x0, c.y, c.z];
  // Shell: closed rear cover (rim, recessed panel with a pressed ring), the
  // cover seam, rolled edges, front face with its hub boss.
  latheAlong(
    g,
    m.metal,
    [
      [0.0025, 0],
      [0.0025, 0.029],
      [0.0013, 0.0305],
      [0.0013, 0.0335],
      [0.0025, 0.035],
      [0.0025, R - 0.0095],
      [0.0012, R - 0.009],
      [0, R - 0.0075],
      [0, R - 0.0035],
      [0.0012, R - 0.001],
      [0.0035, R],
      [0.011, R],
      [0.0115, R - 0.0012],
      [0.0135, R - 0.0012],
      [0.014, R],
      [L - 0.0035, R],
      [L - 0.0012, R - 0.001],
      [L, R - 0.0035],
      [L, R * 0.42],
      [L + 0.0025, R * 0.38],
      [L + 0.0035, R * 0.3],
      [L + 0.0035, 0],
    ],
    at,
    X,
    seg(32, 20),
  );
  const radial = (a: number, r0: number, r1: number, h: number): P2[] => {
    const d = [Math.cos(a), Math.sin(a)],
      n = [-d[1], d[0]];
    const p = (r: number, k: number): P2 => [
      d[0] * r + n[0] * k,
      d[1] * r + n[1] * k,
    ];
    return [p(r0, -h), p(r1, -h), p(r1, h), p(r0, h)];
  };
  // Rear panel: radial ribs pressed outside the ring, fasteners on the rim.
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    g.add(
      prism(radial(a, 0.037, R - 0.0112, 0.0011), x0 + 0.0012, x0 + 0.0027),
      m.metal,
      [0, c.y, c.z],
    );
    const b = a + Math.PI / 6;
    g.cylinder(
      [x0 - 0.0004, c.y + Math.sin(b) * (R - 0.0055), Math.cos(b) * (R - 0.0055)],
      0.0019,
      0.0012,
      m.steel,
      "x",
      0.0019,
      seg(10, 6),
    );
  }
  // Round-count indicator: a closed slot pad at upper left with its pip.
  const slot = 2.2;
  g.add(
    prism(radial(slot, 0.036, 0.0465, 0.0032), x0 + 0.0006, x0 + 0.0026, 0, 0.0012),
    m.rubber,
    [0, c.y, c.z],
  );
  g.cylinder(
    [x0 + 0.0002, c.y + Math.sin(slot) * 0.0425, Math.cos(slot) * 0.0425],
    0.0017,
    0.0012,
    m.steel,
    "x",
    0.0017,
    seg(10, 6),
  );
  // Hub, the loading lever folded down to the right, the ratchet knob on top.
  latheAlong(
    g,
    m.rubber,
    [
      [-0.003, 0],
      [-0.003, 0.0135],
      [-0.0015, 0.0158],
      [0.0035, 0.0165],
      [0.0035, 0],
    ],
    at,
    X,
    seg(32, 16),
  );
  const lever = -2.35,
    reach = R - 0.017;
  const d = [Math.cos(lever), Math.sin(lever)],
    n = [-d[1], d[0]];
  const lp = (u: number, k: number, r?: number): P2 => {
    const x = d[0] * u + n[0] * k,
      y = d[1] * u + n[1] * k;
    return r === undefined ? [x, y] : [x, y, r];
  };
  g.add(
    prism(
      [
        lp(-0.0065, -0.0055, 0.004),
        lp(reach - 0.01, -0.0034),
        lp(reach - 0.0085, -0.0052),
        lp(reach, -0.0046, 0.002),
        lp(reach, 0.0046, 0.002),
        lp(reach - 0.0085, 0.0052),
        lp(reach - 0.01, 0.0034),
        lp(-0.0065, 0.0055, 0.004),
      ],
      x0 - 0.0055,
      x0 - 0.003,
      0.0004,
      0.0012,
    ),
    m.steel,
    [0, c.y, c.z],
  );
  thumbwheel(g, m.rubber, [x0 - 0.0055, c.y, c.z], v3(-1, 0, 0), 0.0092, 0.0045, 4);
  // Front face: radial stiffening ribs round the boss.
  for (let k = 0; k < 6; k++)
    g.add(
      prism(radial((k * Math.PI) / 3 + Math.PI / 6, R * 0.44, R - 0.0065, 0.0012), x0 + L - 0.0004, x0 + L + 0.0016),
      m.metal,
      [0, c.y, c.z],
    );
  // Grip ribs along the drum's lower three quarters.
  bakeOnly(() => {
    for (let k = 0; k < 9; k++) {
      const b = -Math.PI / 2 + ((k - 4) * Math.PI) / 6;
      latheAlong(
        g,
        m.metal,
        [
          [0, 0],
          [0, 0.0014],
          [L - 0.024, 0.0014],
          [L - 0.024, 0],
        ],
        [x0 + 0.017, c.y + Math.sin(b) * (R - 0.0006), Math.cos(b) * (R - 0.0006)],
        X,
        6,
      );
    }
  });
  // Tower foot flaring symmetrically into the drum top, starting just below
  // the well mouth.
  const foot = [tower - 0.009, tower - 0.005, tower, tower + 0.006, tower + 0.012];
  g.add(
    shell(
      foot.map((s) => {
        const e = smooth(tower - 0.009, tower + 0.002, s),
          q = f(s);
        return superRing(
          q.p,
          q.U,
          Z,
          w.hx + 0.0004 + 0.0028 * e,
          w.hx + 0.0004 + 0.0028 * e,
          w.hz + 0.0004 + 0.008 * e,
          w.hz + 0.0004 + 0.008 * e,
          6,
          seg(32, 16),
        );
      }),
    ),
    m.metal,
  );
}

/** Service rifle: standard 30-round curve is straight 56 + R480 to 151. The
 * three tiers read apart from the side: 40 is the standard curve carried on
 * with a window, 50 a straight, deeper quad-stack box with a coupler and grip
 * bands, 60 the drum. */
function serviceClip(g: WeaponGeometry, m: WeaponFinish, tier: number) {
  const w = SERVICE_WELL;
  if (tier === 1)
    // 40 rounds: the same curve carried 38 mm further, collar base, window.
    boxMagazine(g, m, w, {
      straight: 0.056,
      radius: 0.48,
      length: 0.188,
      window: [0.07, 0.17],
      catch: 0.02,
      plate: { t: 0.0125, lip: 0.0022, collar: true },
    });
  else if (tier === 2) {
    // 50 rounds, quad stack: straight; below a coupler band the double-stack
    // tower steps out to a four-column body, deeper fore and aft and wider.
    const flare = (s: number) => smooth(0.068, 0.086, s);
    const spec: BoxSpec = {
      straight: 1,
      radius: 1,
      length: 0.166,
      hz: (s) => w.hz + 0.0095 * flare(s),
      hx: (s) => [w.hx + 0.0045 * flare(s), w.hx + 0.003 * flare(s)],
      ribs: [],
      stations: [0.064, 0.072, 0.08, 0.088],
      catch: 0.02,
      plate: { t: 0.016, lip: 0.0026, sleeve: 0.022 },
    };
    const f = boxMagazine(g, m, w, spec);
    bands(g, m.rubber, f, w, spec, [0.064], 0.004, 0.0014);
    bands(g, m.rubber, f, w, spec, [0.104, 0.118, 0.132], 0.0035, 0.0009);
  } else arDrum(g, m, w);
}

/** Marksman: the standard 10-round box is straight to 92. The tiers are
 * longer large-calibre boxes, near-straight, each ~28 longer than the last:
 * 15 plain with ribs, 20 with a slight curve and a window, 25 curved a little
 * more with grip bands and an extended base. */
function marksmanClip(g: WeaponGeometry, m: WeaponFinish, tier: number) {
  const w = MARKSMAN_WELL;
  const taper = (s: number): [number, number] => [w.hx, w.hx - 0.0012 * smooth(0.06, 0.2, s)];
  if (tier === 1)
    // 15 rounds: straight, pressed ribs, plain floorplate.
    boxMagazine(g, m, w, {
      straight: 1,
      radius: 1,
      length: 0.12,
      hx: taper,
      ribs: [-0.62, 0.45],
      plate: { t: 0.012, lip: 0.0024 },
    });
  else if (tier === 2)
    // 20 rounds: a slight curve below the well, witness window, collar base.
    boxMagazine(g, m, w, {
      straight: 0.07,
      radius: 1.6,
      length: 0.148,
      hx: taper,
      ribs: [0.5],
      window: [0.074, 0.134],
      plate: { t: 0.0125, lip: 0.0024, collar: true },
    });
  else {
    // 25 rounds: a touch more curve, grip bands, extended base sleeve.
    const spec: BoxSpec = {
      straight: 0.07,
      radius: 0.95,
      length: 0.176,
      hx: taper,
      ribs: [-0.62, 0.45],
      plate: { t: 0.016, lip: 0.0026, sleeve: 0.03 },
    };
    const f = boxMagazine(g, m, w, spec);
    bands(g, m.rubber, f, w, spec, [0.078, 0.091, 0.104], 0.0035, 0.001);
  }
}

// ---------------------------------------------------------------------------
// Plasma power cells

const CELL_WELL = { x: -0.0075, bottom: -0.048, hx: 0.041 - 0.0055, hz: 0.0225 - 0.004 };
/** Underside of the gun's terminal box (front face of the well, right side). */
const TERMINAL = { x: 0.0372, y: -0.042, z: -0.0135 };

function cellRing(cx: number, y: number, hx: number, hz: number, k = 1, dz = 0) {
  return superRing(v3(cx, y, dz), X, Z, hx * k, hx * k, hz * k, hz * k, 7, seg(28, 16));
}

/** A cell body column from yTop to yBot with fin bands and a charge window. */
function cellColumn(
  g: WeaponGeometry,
  m: WeaponFinish,
  o: {
    cx: number;
    hx: number;
    hz: number;
    top: number;
    bot: number;
    fins: [number, number, number][];
    window?: { y: [number, number]; x: [number, number]; n: number; lit: number };
  },
) {
  const { cx, hx, hz } = o;
  const ys = [o.top + 0.002, o.top + 0.0015, o.top, o.bot];
  g.add(
    shell(ys.map((y, i) => cellRing(cx, y, hx, hz, i === 0 ? 0.95 : i === 1 ? 0.985 : 1))),
    m.metal,
  );
  for (const [y0, n, k] of o.fins)
    for (let i = 0; i < n; i++) {
      const y = y0 - i * 0.0048;
      g.add(
        shell([
          superRing(v3(cx, y + 0.0007), X, Z, hx * k, hx * k, hz * k, hz * k, 7, seg(20, 12)),
          superRing(v3(cx, y - 0.0007), X, Z, hx * k, hx * k, hz * k, hz * k, 7, seg(20, 12)),
        ]),
        m.metal,
      );
    }
  const win = o.window;
  if (win)
    for (const side of [1]) {
      const [x0, x1] = win.x,
        [y0, y1] = win.y;
      slab(
        g,
        m.rubber,
        [
          [x0, y0, 0.002],
          [x1, y0, 0.002],
          [x1, y1, 0.002],
          [x0, y1, 0.002],
        ],
        0.0018,
        side * (hz + 0.0005),
        0,
        [
          [
            [x0 + 0.0016, y0 + 0.0026],
            [x1 - 0.0016, y0 + 0.0026],
            [x1 - 0.0016, y1 - 0.0026],
            [x0 + 0.0016, y1 - 0.0026],
          ],
        ],
        0.0015,
      );
      const step = (x1 - x0 - 0.0045) / win.n;
      for (let i = 0; i < win.n; i++)
        g.add(
          new T.BoxGeometry(step - 0.0016, y1 - y0 - 0.0068, 0.0008),
          i < win.lit ? m.light : m.rubber,
          [x0 + 0.00225 + step * (i + 0.5), (y0 + y1) / 2, side * (hz + 0.0002)],
        );
    }
}

/** Rubber base cradle under one or more columns, with a pull handle. */
function cellBase(
  g: WeaponGeometry,
  m: WeaponFinish,
  x0: number,
  x1: number,
  hz: number,
  y: number,
) {
  const cx = (x0 + x1) / 2,
    hx = (x1 - x0) / 2;
  g.add(
    shell([
      cellRing(cx, y + 0.0005, hx, hz, 1.02),
      cellRing(cx, y, hx + 0.001, hz, 1.05),
      cellRing(cx, y - 0.01, hx + 0.001, hz, 1.05),
      cellRing(cx, y - 0.0115, hx + 0.001, hz, 1.0),
      cellRing(cx, y - 0.012, hx + 0.001, hz, 0.9),
    ]),
    m.rubber,
  );
  const hy = y - 0.01;
  slab(
    g,
    m.rubber,
    [
      [cx - 0.021, hy, 0.002],
      [cx + 0.021, hy, 0.002],
      [cx + 0.016, hy - 0.013, 0.006],
      [cx - 0.016, hy - 0.013, 0.006],
    ],
    0.01,
    0,
    0.0015,
    [
      [
        [cx - 0.0125, hy - 0.0035],
        [cx + 0.0125, hy - 0.0035],
        [cx + 0.0095, hy - 0.009],
        [cx - 0.0095, hy - 0.009],
      ],
    ],
    0.002,
  );
}

/** Rear latch hooking the well's lip (as on the standard cell). */
function cellLatch(g: WeaponGeometry, m: WeaponFinish, cx: number, hx: number) {
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
      seg(16, 8),
    ),
    0.011,
    0,
    0,
    [],
    0,
  );
  g.cylinder([cx - hx - 0.0008, -0.067, 0], 0.0019, 0.016, m.steel, "z", 0.0019, seg(10, 6));
}

/** Copper bus bar across two columns on one flank, bolted at both ends. */
function busBar(g: WeaponGeometry, m: WeaponFinish, x0: number, x1: number, y: number, z: number) {
  const side = Math.sign(z);
  slab(
    g,
    m.accent,
    [
      [x0, y - 0.0045, 0.002],
      [x1, y - 0.0045, 0.002],
      [x1, y + 0.0045, 0.002],
      [x0, y + 0.0045, 0.002],
    ],
    0.002,
    z + side * 0.001,
    0.0005,
  );
  for (const x of [x0 + 0.0045, x1 - 0.0045]) screw(g, m, [x, y, z + side * 0.0028], 0.0021);
}

/** Electrolytic-style capacitor can standing on a face, sleeve and vent cap. */
function capacitor(g: WeaponGeometry, m: WeaponFinish, at: number[], dir: V, r: number, h: number) {
  latheAlong(
    g,
    m.metal,
    [
      [0, 0],
      [0, r * 1.15],
      [0.0014, r],
      [h * 0.86, r],
      [h * 0.88, r * 0.94],
      [h - 0.0008, r],
      [h, r - 0.0008],
      [h, 0],
    ],
    at,
    dir,
    seg(10, 8),
  );
  latheAlong(
    g,
    m.accent,
    [
      [h - 0.0002, 0],
      [h - 0.0002, r * 0.55],
      [h + 0.0008, r * 0.5],
      [h + 0.0008, 0],
    ],
    at,
    dir,
    seg(10, 6),
  );
}

function plasmaCell(g: WeaponGeometry, m: WeaponFinish, tier: number) {
  g.offset.set(-CELL_WELL.x, -CELL_WELL.bottom, 0);
  const { x: cx, hx, hz } = CELL_WELL;
  // Contacts on the top face (as the standard cell: same terminal pattern).
  for (const dz of [-0.008, 0, 0.008])
    g.add(new T.BoxGeometry(0.006, 0.0008, 0.004), m.accent, [cx + 0.02, 0.0024, dz]);
  cellLatch(g, m, cx, hx);
  const front = { x0: cx + hx + 0.0035, hx: 0.0215 };
  const fcx = front.x0 + front.hx;
  if (tier === 1) {
    // Taller cell: the standard fin band plus a second, deeper cooling section.
    cellColumn(g, m, {
      cx, hx, hz, top: 0, bot: -0.131,
      fins: [[-0.083, 5, 1.075], [-0.108, 5, 1.1]],
      window: { y: [-0.078, -0.052], x: [cx - 0.027, cx + 0.02], n: 7, lit: 5 },
    });
    // Collar between the fin sections.
    g.add(shell([cellRing(cx, -0.1015, hx, hz, 1.03), cellRing(cx, -0.1045, hx, hz, 1.06), cellRing(cx, -0.1075, hx, hz, 1.03)]), m.steel);
    cellBase(g, m, cx - hx, cx + hx, hz, -0.1305);
  } else {
    const bot = tier === 2 ? -0.124 : -0.134;
    cellColumn(g, m, {
      cx, hx, hz, top: 0, bot,
      fins: [[-0.088, 5, 1.075]],
      window: { y: [-0.078, -0.052], x: [cx - 0.027, cx + 0.02], n: 7, lit: tier === 2 ? 6 : 7 },
    });
    // Second cell in front of the well, its top 8 mm under the mouth.
    cellColumn(g, m, {
      cx: fcx, hx: front.hx, hz, top: -0.056, bot,
      fins: [[-0.1, 3, 1.08]],
      window: { y: [-0.083, -0.064], x: [fcx - 0.016, fcx + 0.016], n: 4, lit: 3 },
    });
    // Bridging bus bars on both flanks, a clamp plate across the front.
    for (const side of [-1, 1]) busBar(g, m, cx + 0.012, fcx + 0.01, -0.07, side * hz);
    slab(
      g,
      m.steel,
      [
        [cx + hx - 0.004, -0.0565, 0.002],
        [front.x0 + 0.004, -0.0565, 0.002],
        [front.x0 + 0.004, -0.0605, 0.002],
        [cx + hx - 0.004, -0.0605, 0.002],
      ],
      2 * hz - 0.004,
      0,
      0.0006,
    );
    cellBase(g, m, cx - hx, fcx + front.hx, hz, bot + 0.0005);
    // Capacitor caps on the front cell's top.
    for (const [x, z] of [
      [fcx + 0.004, 0.009],
      [fcx + 0.004, -0.009],
    ])
      capacitor(g, m, [x, -0.0562, z], Y, 0.0055, 0.0095);
    if (tier === 3) auxBank(g, m, cx, hx, hz, fcx);
  }
}

/** Side-saddle capacitor bank on the right flank, and the jumper to the
 * terminal box (a plug seated on the box's underside). */
function auxBank(g: WeaponGeometry, m: WeaponFinish, cx: number, hx: number, hz: number, fcx: number) {
  const z0 = -hz - 0.001,
    zc = z0 - 0.0105;
  // Saddle tray: a filleted cradle bolted to the main cell's flank.
  slab(
    g,
    m.metal,
    [
      [cx - hx + 0.004, -0.06, 0.004],
      [cx + hx + 0.006, -0.06, 0.004],
      [cx + hx + 0.006, -0.112, 0.006],
      [cx - hx + 0.004, -0.112, 0.006],
    ],
    0.003,
    z0 - 0.0015,
    0.0008,
  );
  for (const y of [-0.071, -0.101]) {
    // Three cans along X in two straps.
    capacitor(g, m, [cx - hx + 0.006, y, zc], X, 0.0075, 0.06);
  }
  capacitor(g, m, [cx - hx + 0.006, -0.086, zc + 0.002], X, 0.0062, 0.056);
  for (const x of [cx - 0.016, cx + 0.018]) {
    // Strap over the cans.
    slab(
      g,
      m.steel,
      [
        [x - 0.0035, -0.0625, 0.001],
        [x + 0.0035, -0.0625, 0.001],
        [x + 0.0035, -0.1095, 0.001],
        [x - 0.0035, -0.1095, 0.001],
      ],
      0.0012,
      zc - 0.0083,
      0.0003,
    );
    for (const y of [-0.0625, -0.1095]) bakeOnly(() => screw(g, m, [x, y + (y > -0.08 ? 0.002 : -0.002), z0 - 0.003], 0.0015));
  }
  // Busbar from the bank to the front cell (right flank) and the bank's output.
  slab(
    g,
    m.accent,
    [
      [cx + hx - 0.004, -0.06, 0.0015],
      [fcx - 0.002, -0.06, 0.0015],
      [fcx - 0.002, -0.0655, 0.0015],
      [cx + hx - 0.004, -0.0655, 0.0015],
    ],
    0.0016,
    z0 - 0.0006,
    0.0004,
  );
  // Output terminal block at the bank's front top, with the jumper's plug.
  const out = v3(cx + hx + 0.002, -0.058, zc);
  slab(
    g,
    m.metal,
    [
      [out.x - 0.006, out.y - 0.004, 0.0015],
      [out.x + 0.006, out.y - 0.004, 0.0015],
      [out.x + 0.006, out.y + 0.004, 0.0015],
      [out.x - 0.006, out.y + 0.004, 0.0015],
    ],
    0.012,
    zc,
    0.0006,
  );
  const plugA = out.clone().add(v3(0, 0.004));
  const plugB = v3(TERMINAL.x, TERMINAL.y, TERMINAL.z);
  // Plugs: knurled shell over a strain-relief boot, both along the cable.
  const plug = (at: V, dir: V) => {
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0042],
        [0.004, 0.0042],
        [0.0045, 0.0036],
        [0.0075, 0.0033],
        [0.0075, 0],
      ],
      at.toArray(),
      dir,
      seg(16, 8),
    );
    return at.clone().addScaledVector(dir, 0.0075);
  };
  const a = plug(plugA, Y);
  const b = plug(plugB, Y.clone().negate());
  const curve = route([
    a.toArray(),
    [a.x + 0.002, a.y + 0.004, a.z + 0.001],
    [(a.x + b.x) / 2 + 0.004, (a.y + b.y) / 2 + 0.0, (a.z + b.z) / 2 - 0.004],
    [b.x, b.y - 0.006, b.z],
    b.toArray(),
  ]);
  g.add(sweep(curve, 0.0026, seg(16, 8), seg(8, 6)), m.rubber);
}

// ---------------------------------------------------------------------------
// Tube-interface stocks (service carbine and marksman)

interface TubeSpec {
  tubeR: number;
  nutR: number;
  /** Rail top above the extension axis: the cheek-weld line. */
  comb: number;
}
const TUBE: Record<"rifle" | "marksman", TubeSpec> = {
  rifle: { tubeR: 0.0145, nutR: 0.0174, comb: 0.03 },
  marksman: { tubeR: 0.0148, nutR: 0.0178, comb: 0.0365 },
};

function buttPad(
  g: WeaponGeometry,
  m: WeaponFinish,
  x: number,
  top: number,
  toe: number,
  w: number,
  t: number,
  ribs = true,
) {
  // Slightly convex rubber pad, a heel radius at the top and a rounded toe.
  slab(
    g,
    m.rubber,
    [
      [x + 0.001, top, 0.004],
      [x - t + 0.002, top - 0.0005, 0.005],
      [x - t, (top + toe) / 2, 0.08],
      [x - t + 0.001, toe + 0.003, 0.006],
      [x - t * 0.3, toe, 0.004],
      [x + 0.001, toe + 0.001, 0.002],
    ],
    w,
    0,
    0.0028,
  );
  void ribs;
}

function tubeStock(g: WeaponGeometry, m: WeaponFinish, tier: number, s: TubeSpec) {
  const h = s.comb;
  if (tier === 1) throw new Error("tube stock tier 1 has no model yet");
  if (tier === 2) combatStock(g, m, s, h);
  else sniperStock(g, m, s, h);
}

/** Advanced: adjustable combat stock sliding on the tube, cheek riser on two
 * posts, friction-lock cam lever, QD cups, a wide pad. */
function combatStock(g: WeaponGeometry, m: WeaponFinish, s: TubeSpec, h: number) {
  const front = -0.058,
    end = -0.236;
  extension(g, m, s.nutR, s.tubeR, 0.2);
  // Adjustment rib under the tube, with the position detents.
  slab(
    g,
    m.metal,
    [
      [-0.012, -s.tubeR + 0.0015],
      [-0.2, -s.tubeR + 0.0015],
      [-0.2, -s.tubeR - 0.0042, 0.001],
      [-0.014, -s.tubeR - 0.0042, 0.001],
    ],
    0.0065,
    0,
    0.0006,
  );
  for (let i = 0; i < seg(5, 0); i++)
    g.cylinder([-0.02 - i * 0.008, -s.tubeR - 0.0042, 0], 0.0015, 0.0012, m.rubber, "y", 0.0015, 10);
  const top = (x: number) => s.tubeR + 0.0052 + 0.002 * smooth(front, end, x);
  const belly = (x: number) => -s.tubeR - 0.007 - 0.072 * smooth(front - 0.04, end, x) ** 1.1;
  const half = (x: number) => 0.019 + 0.004 * smooth(front, end, x);
  const xs = isLow()
    ? [front, -0.1, -0.15, -0.2, end]
    : [front, -0.07, -0.09, -0.115, -0.14, -0.165, -0.19, -0.215, end];
  loft(g, m.shell, softEnds(xs.map((x) => [x, top(x), belly(x), half(x)]), 0.004), 3.3);
  // Recessed grip panels on both flanks (elastomer inlays).
  for (const side of [-1, 1])
    slab(
      g,
      m.rubber,
      [
        [-0.135, -0.03, 0.006],
        [-0.214, -0.04, 0.006],
        [-0.214, -0.074, 0.008],
        [-0.165, -0.06, 0.012],
      ],
      0.0016,
      side * (half(-0.18) - 0.0002),
      0.0005,
    );
  // Cheek riser on two posts, comb at the sight line.
  const r0 = -0.095,
    r1 = -0.225;
  for (const x of [r0 - 0.02, r1 + 0.026])
    latheAlong(
      g,
      m.steel,
      [
        [0, 0],
        [0, 0.0034],
        [h - top(x) - 0.003, 0.0034],
        [h - top(x) - 0.003, 0],
      ],
      [x, top(x) - 0.002, 0],
      Y,
      14,
    );
  const rise = (x: number) => h + 0.002 - 0.006 * smooth(r0 - 0.04, r0, x);
  loft(
    g,
    m.rubber,
    softEnds(
      (isLow() ? [r0, -0.16, r1] : [r0, -0.11, -0.13, -0.16, -0.19, -0.21, r1]).map((x) => [
        x,
        rise(x),
        h - 0.0115,
        half(x) - 0.002,
        4,
      ]),
      0.003,
    ),
  );
  // Riser lock knob, left side.
  thumbwheel(g, m.metal, [-0.205, h - 0.007, half(-0.205) - 0.004], Z, 0.0058, 0.008, 3);
  // Friction lock: cam lever along the left flank, pivot at the front.
  slab(
    g,
    m.metal,
    band(
      [
        [-0.066, -0.006],
        [-0.085, -0.0085],
        [-0.106, -0.0105],
        [-0.118, -0.0095],
      ],
      0.0028,
      seg(14, 6),
    ),
    0.003,
    half(-0.09) + 0.0014,
    0.0008,
    [],
    0,
  );
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0045],
      [0.003, 0.0045],
      [0.0036, 0.0036],
      [0.0036, 0],
    ],
    [-0.066, -0.006, half(-0.07) - 0.001],
    Z,
    16,
  );
  // Release latch lever under the front.
  slab(
    g,
    m.metal,
    band(
      [
        [front - 0.002, belly(front) - 0.0005],
        [front - 0.014, belly(front) - 0.0035],
        [front - 0.026, belly(front) - 0.0042],
      ],
      0.0019,
      seg(12, 6),
    ),
    0.009,
    0,
    0.0006,
    [],
    0,
  );
  // QD sockets: front and rear, both flanks.
  for (const side of [-1, 1])
    for (const [x, y] of [
      [-0.072, 0.0005],
      [-0.212, -0.084],
    ])
      qdCup(g, m, [x, y, side * (half(x) - 0.0016)], side);
  // Butt plate and the wide pad.
  slab(
    g,
    m.metal,
    [
      [end + 0.002, top(end) + 0.0005, 0.003],
      [end - 0.0045, top(end) + 0.0005, 0.003],
      [end - 0.0045, belly(end) - 0.0005, 0.003],
      [end + 0.002, belly(end) - 0.0005, 0.003],
    ],
    2 * half(end) + 0.002,
    0,
    0.001,
  );
  buttPad(g, m, end - 0.0045, h - 0.004, belly(end) - 0.004, 0.05, 0.016);
}

/** Sniper: precision chassis stock. A clamped collar, a short housing beam,
 * cheek piece on a vertical dovetail with a thumbwheel, length of pull on a
 * horizontal dovetail with spacers and a thumbwheel, a deep support-hand hook,
 * an angled monopod spike housing at the toe and a bag-rider runner. */
function sniperStock(g: WeaponGeometry, m: WeaponFinish, s: TubeSpec, h: number) {
  extension(g, m, s.nutR, s.tubeR, 0.07);
  const W = 0.024;
  // Clamp collar with two cross bolts.
  latheAlong(
    g,
    m.metal,
    [
      [0, 0],
      [0, s.tubeR + 0.001],
      [0.002, s.tubeR + 0.0028],
      [0.024, s.tubeR + 0.0028],
      [0.026, s.tubeR + 0.001],
      [0.026, 0],
    ],
    [-0.036, 0, 0],
    v3(-1, 0, 0),
    seg(28, 14),
  );
  for (const x of [-0.042, -0.055]) screw(g, m, [x, -0.0105, -(s.tubeR + 0.0018)], 0.0022);
  // Beam over the tube: lofted housing to the LOP rail.
  const bt = s.tubeR + 0.004,
    bend = -0.215;
  loft(
    g,
    m.shell,
    softEnds(
      (isLow() ? [-0.06, -0.13, bend] : [-0.06, -0.08, -0.11, -0.14, -0.17, -0.2, bend]).map((x) => [
        x,
        bt,
        -bt - 0.002,
        0.0175 + 0.0015 * smooth(-0.06, bend, x),
      ]),
      0.0035,
    ),
    3.6,
  );
  // Chassis below the beam: two separate members with open space between,
  // a support-hand hook at the front (opening rearward) and the toe block.
  const toe = -0.098;
  const hook: P2[] = [
    [-0.064, -0.012, 0.004],
    [-0.124, -0.012, 0.004],
    [-0.117, -0.032, 0.02],
    [-0.113, -0.058, 0.02],
    [-0.118, -0.08, 0.012],
    [-0.132, -0.094, 0.004],
    [-0.13, -0.103, 0.004],
    [-0.116, -0.107, 0.01],
    [-0.1, -0.1, 0.012],
    [-0.092, -0.08, 0.012],
    [-0.09, -0.056, 0.02],
    [-0.082, -0.033, 0.016],
    [-0.07, -0.018, 0.006],
  ];
  slab(g, m.shell, hook, W, 0, 0.0025);
  // Elastomer overmould inside the hook, where the fingers wrap.
  slab(
    g,
    m.rubber,
    band(
      [
        [-0.1205, -0.022],
        [-0.1155, -0.044],
        [-0.1135, -0.064],
        [-0.119, -0.082],
        [-0.131, -0.095],
      ],
      0.0022,
      seg(16, 8),
    ),
    W + 0.002,
    0,
    0.0008,
    [],
    0,
  );
  slab(
    g,
    m.shell,
    [
      [-0.16, -0.012, 0.004],
      [bend - 0.002, -0.012, 0.004],
      [bend - 0.002, toe + 0.004, 0.006],
      [-0.188, toe, 0.006],
      [-0.158, toe, 0.006],
      [-0.152, -0.064, 0.02],
      [-0.156, -0.03, 0.012],
    ],
    W,
    0,
    0.0025,
    [
      [
        [-0.174, -0.03, 0.006],
        [-0.204, -0.03, 0.006],
        [-0.204, -0.062, 0.006],
        [-0.178, -0.07, 0.006],
      ],
    ],
  );
  // Bag-rider runner under the toe block.
  slab(
    g,
    m.rubber,
    [
      [-0.158, toe + 0.001, 0.002],
      [bend - 0.001, toe + 0.001, 0.002],
      [bend - 0.001, toe - 0.006, 0.003],
      [-0.161, toe - 0.006, 0.003],
    ],
    W + 0.008,
    0,
    0.0012,
  );
  // Monopod spike housing: angled tube at the toe, knurled lock collar, foot.
  const mdir = v3(0.42, -1).normalize();
  const mp = v3(-0.172, toe - 0.002);
  latheAlong(
    g,
    m.metal,
    [
      [-0.024, 0],
      [-0.024, 0.0068],
      [0.004, 0.0068],
      [0.0055, 0.0058],
      [0.0055, 0],
    ],
    mp.toArray(),
    mdir,
    seg(20, 10),
  );
  thumbwheel(g, m.steel, mp.clone().addScaledVector(mdir, 0.0055).toArray(), mdir, 0.0078, 0.008, 4);
  latheAlong(
    g,
    m.steel,
    [
      [0.013, 0],
      [0.013, 0.0035],
      [0.03, 0.0035],
      [0.03, 0],
    ],
    mp.toArray(),
    mdir,
    seg(14, 8),
  );
  latheAlong(
    g,
    m.rubber,
    [
      [0.029, 0],
      [0.029, 0.0062],
      [0.033, 0.0068],
      [0.036, 0.005],
      [0.0375, 0],
    ],
    mp.toArray(),
    mdir,
    seg(18, 10),
  );
  // Cheek piece: vertical dovetail rail rising from the beam, thumbwheel.
  const cx = -0.15;
  for (const x of [cx + 0.03, cx - 0.04]) {
    slab(
      g,
      m.metal,
      [
        [x - 0.006, bt - 0.002, 0.001],
        [x + 0.006, bt - 0.002, 0.001],
        [x + 0.006, h - 0.006, 0.001],
        [x - 0.006, h - 0.006, 0.001],
      ],
      0.0075,
      0,
      0.0007,
    );
    bakeOnly(() => {
      for (let y = bt + 0.002; y < h - 0.008; y += 0.003)
        g.add(new T.BoxGeometry(0.0004, 0.0012, 0.0076), m.marking, [x + 0.0058, y, 0]);
    });
  }
  thumbwheel(g, m.metal, [cx - 0.005, bt + 0.0055, -0.016], Z, 0.0085, 0.032, 4);
  const cheek = (x: number) => h + 0.004 - 0.008 * smooth(-0.1, -0.084, x);
  loft(
    g,
    m.rubber,
    softEnds(
      (isLow() ? [-0.085, -0.15, -0.205] : [-0.085, -0.097, -0.125, -0.16, -0.19, -0.205]).map((x) => [
        x,
        cheek(x),
        h - 0.0105,
        0.0185,
        4.2,
      ]),
      0.003,
    ),
  );
  // Cheek lock levers on the right.
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0045],
      [0.0035, 0.0045],
      [0.0042, 0.003],
      [0.0042, 0],
    ],
    [cx - 0.04, h - 0.007, -0.0185],
    Z.clone().negate(),
    14,
  );
  // Length of pull: horizontal dovetail rail out of the frame's rear, three
  // spacer plates, thumbwheel on a lead screw, butt plate with vertical slot.
  const lop = [bend - 0.002, -0.249];
  slab(
    g,
    m.metal,
    [
      [lop[0] + 0.004, -0.004, 0.001],
      [lop[1], -0.004, 0.001],
      [lop[1], -0.016, 0.001],
      [lop[0] + 0.004, -0.016, 0.001],
    ],
    0.014,
    0,
    0.0007,
  );
  for (let i = 0; i < 3; i++) {
    const x = bend - 0.003 - i * 0.0062;
    slab(
      g,
      i % 2 ? m.metal : m.shell,
      [
        [x, bt + 0.001, 0.003],
        [x - 0.0058, bt + 0.001, 0.003],
        [x - 0.0058, toe + 0.004, 0.003],
        [x, toe + 0.004, 0.003],
      ],
      W + 0.002,
      0,
      0.0008,
      [
        [
          [x - 0.0015, -0.03],
          [x - 0.0043, -0.03],
          [x - 0.0043, -0.075],
          [x - 0.0015, -0.075],
        ],
      ],
    );
  }
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0028],
      [0.03, 0.0028],
      [0.03, 0],
    ],
    [bend - 0.019, -0.062, 0],
    v3(-1, 0, 0),
    12,
  );
  thumbwheel(g, m.metal, [bend - 0.02, -0.062, 0], v3(-1, 0, 0), 0.0105, 0.009, 4);
  const plateX = -0.249;
  slab(
    g,
    m.metal,
    [
      [plateX, h + 0.002, 0.004],
      [plateX - 0.007, h + 0.002, 0.003],
      [plateX - 0.007, -0.106, 0.003],
      [plateX, -0.106, 0.004],
    ],
    0.04,
    0,
    0.0015,
    [
      [
        [plateX - 0.002, -0.022, 0.0013],
        [plateX - 0.005, -0.022, 0.0013],
        [plateX - 0.005, -0.05, 0.0013],
        [plateX - 0.002, -0.05, 0.0013],
      ],
    ],
  );
  for (const y of [-0.026, -0.046]) screw(g, m, [plateX - 0.0035, y, 0.0205], 0.0024);
  buttPad(g, m, plateX - 0.007, h + 0.004, -0.11, 0.044, 0.016);
}

// ---------------------------------------------------------------------------
// Plasma stocks: strut construction on the plasma's Ø25.6 extension

const PLASMA_TUBE = { tubeR: 0.0128, nutR: 0.0174, comb: 0.043 };

function plasmaStock(g: WeaponGeometry, m: WeaponFinish, tier: number) {
  const { tubeR, nutR, comb } = PLASMA_TUBE;
  const end = tier === 1 ? -0.2 : -0.216;
  const tubeEnd = tier === 1 ? -0.193 : -0.15;
  extension(g, m, nutR, tubeR, -tubeEnd);
  // Front collar: lower strut yoke and the length-of-pull knob.
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, tubeR + 0.0008],
      [0.0012, tubeR + 0.002],
      [0.0148, tubeR + 0.002],
      [0.016, tubeR + 0.0008],
      [0.016, 0],
    ],
    [-0.048, 0, 0],
    v3(-1, 0, 0),
    seg(24, 12),
  );
  slab(
    g,
    m.metal,
    [
      [-0.048, -0.004, 0.002],
      [-0.064, -0.004, 0.002],
      [-0.068, -0.025, 0.004],
      [-0.054, -0.027, 0.004],
    ],
    0.022,
    0,
    0.001,
  );
  for (const side of [-1, 1]) screw(g, m, [-0.058, -0.017, side * 0.012], 0.002);
  // Butt plate: graphite skeleton with three lightening holes, rubber pad.
  const toe = -0.106,
    top = comb - 0.002;
  const plateX = end + 0.0105;
  slab(
    g,
    m.metal,
    [
      [plateX, top - 0.002, 0.004],
      [plateX - 0.0105, top - 0.002, 0.003],
      [plateX - 0.0105, toe, 0.003],
      [plateX, toe, 0.004],
    ],
    0.036,
    0,
    0.0014,
    [
      [plateX - 0.003, 0.026, 0.002],
      [plateX - 0.003, -0.022, 0.002],
      [plateX - 0.003, -0.07, 0.002],
    ].map(([x, y]) => [
      [x, y + 0.012, 0.002],
      [x - 0.0045, y + 0.012, 0.002],
      [x - 0.0045, y - 0.012, 0.002],
      [x, y - 0.012, 0.002],
    ]) as P2[][],
  );
  for (const y of [top - 0.008, toe + 0.006]) screw(g, m, [plateX - 0.005, y, 0.0188], 0.0021);
  // Shoulder pad: contoured, thicker at the toe.
  slab(
    g,
    m.rubber,
    [
      [end + 0.0005, top + 0.002, 0.005],
      [end - 0.012, top + 0.0005, 0.006],
      [end - 0.0145, (top + toe) / 2, 0.06],
      [end - 0.0155, toe + 0.006, 0.006],
      [end - 0.008, toe - 0.002, 0.005],
      [end + 0.0005, toe - 0.0005, 0.004],
    ],
    tier === 1 ? 0.042 : 0.046,
    0,
    0.0025,
  );
  // Lower struts: a pair from the yoke to the toe, a cross tube between them.
  const toeP = v3(plateX - 0.004, toe + 0.008);
  const a = v3(-0.061, -0.024);
  for (const side of [-1, 1]) {
    const c = route([
      [a.x, a.y, side * 0.0075],
      [-0.1, -0.05, side * 0.0105],
      [-0.15, -0.08, side * 0.0125],
      [toeP.x, toeP.y, side * 0.013],
    ]);
    g.add(sweep(c, 0.0045, seg(14, 8), 6), m.metal);
    const tip = c.getPointAt(1),
      tn = c.getTangentAt(0.97);
    latheAlong(g, m.steel, [[-0.006, 0], [-0.006, 0.006], [0.003, 0.006], [0.003, 0]], tip.toArray(), tn, 10);
  }
  // Struts tie into the plate through a clevis block.
  slab(
    g,
    m.metal,
    [
      [plateX + 0.003, toe + 0.002, 0.002],
      [plateX - 0.002, toe + 0.002, 0.002],
      [plateX - 0.002, toe + 0.016, 0.002],
      [plateX + 0.009, toe + 0.016, 0.003],
    ],
    0.034,
    0,
    0.0008,
  );
  g.cylinder([-0.12, -0.062, 0], 0.0034, 0.024, m.steel, "z", 0.0034, seg(12, 8));
  // Perforated web between the tube and the struts (the pack takes its place at tier 3).
  if (tier < 3) {
    const hole = (x: number, y: number, r: number): P2[] =>
      Array.from({ length: seg(8, 6) }, (_, k) => {
        const t = (k / seg(8, 6)) * Math.PI * 2;
        return [x + Math.cos(t) * r, y + Math.sin(t) * r, 0] as P2;
      });
    slab(
      g,
      m.metal,
      [
        [-0.066, -tubeR + 0.002, 0.003],
        [-0.158, -tubeR + 0.002, 0.004],
        [-0.158, -0.081, 0.006],
        [-0.1, -0.047, 0.01],
        [-0.068, -0.026, 0.004],
      ],
      0.005,
      0,
      0.0008,
      [hole(-0.087, -0.026, 0.0075), hole(-0.115, -0.034, 0.01), hole(-0.143, -0.043, 0.0115)],
    );
  }
  // Cheek pad on a clamp bracket riding the tube; comb at the sight line.
  const c0 = -0.072,
    c1 = tier === 1 ? -0.178 : -0.186;
  slab(
    g,
    m.metal,
    [
      [c0 - 0.006, tubeR - 0.002, 0.002],
      [c1 + 0.006, tubeR - 0.002, 0.002],
      [c1 + 0.01, comb - 0.014, 0.003],
      [c0 - 0.012, comb - 0.014, 0.003],
    ],
    0.012,
    0,
    0.0008,
    isLow()
      ? []
      : [
          [
            [c0 - 0.03, tubeR + 0.002, 0.003],
            [c1 + 0.04, tubeR + 0.002, 0.003],
            [c1 + 0.04, comb - 0.018, 0.003],
            [c0 - 0.03, comb - 0.018, 0.003],
          ],
        ],
  );
  const ch = (x: number) => comb - 0.001 - 0.008 * smooth(c0 - 0.016, c0, x);
  loft(
    g,
    m.rubber,
    softEnds(
      (isLow() ? [c0, -0.13, c1] : [c0, -0.088, -0.13, -0.165, c1]).map((x) => [
        x,
        ch(x),
        comb - 0.0155,
        0.0155,
        4,
      ]),
      0.003,
    ),
  );
  for (const x of [c0 - 0.012, c1 + 0.014]) screw(g, m, [x, tubeR + 0.003, 0.0068], 0.0018);
  if (tier === 1) return;
  // Tier 2+: recoil/vibration damper between the tube and the butt plate:
  // cylinder body, exposed coil spring round the piston rod, elastomer stop.
  const d0 = tubeEnd,
    d1 = -0.178;
  latheAlong(
    g,
    m.metal,
    [
      [0, 0],
      [0, 0.0158],
      [0.0016, 0.0168],
      [0.008, 0.0168],
      [0.0086, 0.0158],
      [0.0104, 0.0158],
      [0.011, 0.0168],
      [0.0175, 0.0168],
      [0.0181, 0.0158],
      [0.0199, 0.0158],
      [0.0205, 0.0168],
      [d0 - d1 - 0.0016, 0.0168],
      [d0 - d1, 0.0158],
      [d0 - d1, 0],
    ],
    [d0, 0, 0],
    v3(-1, 0, 0),
    seg(16, 12),
  );
  latheAlong(g, m.steel, [[0, 0], [0, 0.0045], [d1 - plateX, 0.0045], [d1 - plateX, 0]], [d1, 0, 0], v3(-1, 0, 0), 14);
  g.add(sweep(helix(d1 - 0.001, plateX + 0.003, 0.0098, 6, 0), 0.0014, seg(40, 24), 5), m.accent);
  latheAlong(g, m.rubber, [[0, 0], [0, 0.012], [0.004, 0.012], [0.0048, 0.0105], [0.0048, 0]], [plateX + 0.0048, 0, 0], v3(-1, 0, 0), seg(20, 10));
  // Lower strut tie through an elastomer bushing.
  latheAlong(g, m.rubber, [[-0.008, 0], [-0.008, 0.0075], [0.008, 0.0075], [0.008, 0]], [toeP.x + 0.006, toeP.y + 0.001, 0], Z, seg(16, 8));
  // QD socket on the damper body.
  for (const side of [-1, 1]) qdCup(g, m, [d1 + 0.012, -0.004, side * 0.0155], side);
  // Cheek pad lock knob.
  thumbwheel(g, m.metal, [-0.165, comb - 0.016, 0.006], Z, 0.006, 0.008, 2);
  if (tier === 2) return;
  // Tier 3: balance pack hung in the truss under the tube, cable forward to
  // a junction on the front collar (the stock's own receptacle).
  const px = -0.135,
    py = -0.038,
    phx = 0.034,
    phy = 0.0135,
    phz = 0.0105;
  const ring = (x: number, k: number) =>
    superRing(v3(x, py), Y, Z, phy * k, phy * k, phz * k, phz * k, 5, seg(28, 14));
  const pxs = isLow()
    ? [[px + phx, 0.8], [px + phx - 0.004, 1], [px - phx + 0.004, 1], [px - phx, 0.8]]
    : [
        [px + phx, 0.7],
        [px + phx - 0.0012, 0.92],
        [px + phx - 0.004, 1],
        [px - phx + 0.004, 1],
        [px - phx + 0.0012, 0.92],
        [px - phx, 0.7],
      ];
  g.add(shell(pxs.map(([x, k]) => ring(x, k))), m.metal);
  for (let i = 0; i < seg(4, 2); i++) {
    const x = px + 0.019 - i * 0.0105;
    g.add(shell([ring(x + 0.0008, 1.09), ring(x - 0.0008, 1.09)]), m.metal);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++)
      g.add(new T.BoxGeometry(0.0055, 0.004, 0.0008), i < 3 ? m.light : m.rubber, [px - 0.026 + i * 0.0072, py + 0.006, side * (phz + 0.0002)]);
  }
  // Hanger straps from the tube.
  for (const x of [px + 0.024, px - 0.024])
    slab(
      g,
      m.steel,
      [
        [x - 0.003, py + phy - 0.003, 0.001],
        [x + 0.003, py + phy - 0.003, 0.001],
        [x + 0.003, tubeR - 0.002, 0.001],
        [x - 0.003, tubeR - 0.002, 0.001],
      ],
      2 * phz + 0.003,
      0,
      0.0003,
    );
  // Junction block on the front collar, right side, and the cable.
  slab(
    g,
    m.metal,
    [
      [-0.046, 0.002, 0.002],
      [-0.066, 0.002, 0.002],
      [-0.066, -0.012, 0.002],
      [-0.046, -0.012, 0.002],
    ],
    0.009,
    -(tubeR + 0.0055),
    0.0008,
  );
  g.add(new T.BoxGeometry(0.004, 0.003, 0.0008), m.light, [-0.05, -0.002, -(tubeR + 0.0102)]);
  const jack = v3(-0.066, -0.005, -(tubeR + 0.0055));
  const out = v3(px + phx, py + 0.002, -0.004);
  latheAlong(g, m.steel, [[0, 0], [0, 0.0034], [0.006, 0.0034], [0.0065, 0.0028], [0.009, 0.0026], [0.009, 0]], jack.toArray(), v3(-1, 0, 0), seg(14, 8));
  latheAlong(g, m.steel, [[0, 0], [0, 0.0034], [0.006, 0.0034], [0.0065, 0.0028], [0.009, 0.0026], [0.009, 0]], out.toArray(), v3(1, 0, 0), seg(14, 8));
  const cab = route([
    [jack.x - 0.009, jack.y, jack.z],
    [jack.x - 0.02, jack.y - 0.004, jack.z - 0.001],
    [out.x + 0.016, out.y + 0.004, out.z - 0.004],
    [out.x + 0.009, out.y, out.z],
  ]);
  g.add(sweep(cab, 0.0024, seg(20, 8), seg(8, 6)), m.rubber);
}
