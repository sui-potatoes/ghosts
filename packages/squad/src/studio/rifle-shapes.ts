// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { gearFinish } from "./gear-geometry.ts";
import {
  WeaponGeometry,
  weaponFinish,
  type WeaponFinish,
} from "./weapon-finish.ts";

/** Shape helpers shared by the AR-family rifles (service carbine, marksman):
 * filleted profiles, extrusions, lathes, lofted and walled shells. */

// ---------------------------------------------------------------------------
// Axis convention (the one place it is stated for every builder in this set:
// service rifle, marksman, plasma, pistol, rail and furniture upgrades).
//
// Authoring frame: metres, +X muzzle, +Y up, +Z the shooter's LEFT. Builder
// code, its comments ("left flank", "right: magazine release") and the
// authoring tables below each gun use this frame.
//
// Weapon frame: what a builder hands back in `g`, and what `WEAPON_BASIS`
// rotates into the hand socket. It is right-handed with +X muzzle and +Y up,
// so forward × up = +Z is the shooter's RIGHT. The authoring frame is its
// mirror image, and `WEAPON_BASIS` is a pure rotation that cannot undo that.
//
// The crossing happens once: every exported builder draws through
// `inAuthoringFrame`, which mirrors z and re-winds the triangles. Points a
// builder exports for others to place things at (mount tables) cross with
// `toWeaponFrame`. Nothing else in the builders should negate z for handedness.

/** Runs `build` against a scratch geometry in the authoring frame, then adds
 * what it drew to `g` in the weapon frame: mirrored across z = 0, every
 * triangle re-wound so faces stay outward (normals mirror with the points). */
export function inAuthoringFrame<R>(
  g: WeaponGeometry,
  build: (g: WeaponGeometry) => R,
): R {
  const h = new WeaponGeometry();
  const result = build(h);
  for (const mesh of h.finish("authoring").children) {
    if (!(mesh instanceof T.Mesh)) continue;
    const merged = mesh.geometry as T.BufferGeometry;
    const geo = merged.index ? merged.toNonIndexed() : merged;
    geo.scale(1, 1, -1);
    // Triangle soup: swapping corners 1 and 2 reverses each face's winding.
    for (const attr of Object.values(geo.attributes)) {
      const a = attr as T.BufferAttribute,
        n = a.itemSize;
      for (let t = 0; t + 2 < a.count; t += 3)
        for (let k = 0; k < n; k++) {
          const i = (t + 1) * n + k,
            j = (t + 2) * n + k;
          [a.array[i], a.array[j]] = [a.array[j], a.array[i]];
        }
    }
    g.add(geo, mesh.material as T.Material);
  }
  return result;
}

type Point3 = [number, number, number];

/** Authoring-frame points (+Z left) to the weapon frame (+Z right). */
export function toWeaponFrame<K extends string>(
  points: Record<K, Point3>,
): Record<K, Point3> {
  const out = {} as Record<K, Point3>;
  for (const k in points) {
    const [x, y, z] = points[k];
    out[k] = [x, y, z ? -z : 0];
  }
  return out;
}

/** Preview finish of the AR-family redesign: dark shell, phosphate-dark barrel
 * and small parts. The shipped rifle keeps `weaponFinish("rifle")`. */
export function familyFinish(): WeaponFinish {
  return {
    ...weaponFinish("rifle"),
    shell: gearFinish("01_Cerakote", 0x2e3133, 0.45, 0.38, 0.018),
    steel: gearFinish("03_Titanium", 0x4b5256, 0.8, 0.36, 0.008),
  };
}

export type P2 = [number, number] | [number, number, number];

/** Level of detail a builder runs at. "high" is the authored model (and the
 * bake source); "low" is the game mesh that carries a normal map baked from
 * it: no edge bevels, small fillets left sharp, fewer segments, and parts
 * under a few millimetres (`bakeOnly`) left to the bake. */
export type Detail = "high" | "low";
let detail: Detail = "high";

/** Runs a builder at the given detail; the helpers below follow it. */
export function withDetail<R>(level: Detail, build: () => R): R {
  const previous = detail;
  detail = level;
  try {
    return build();
  } finally {
    detail = previous;
  }
}

export const isLow = () => detail === "low";

/** Segment count for the current detail. */
export const seg = (high: number, low: number) => (isLow() ? low : high);

/** A part that only exists in the high model; at "low" it comes from the bake. */
export function bakeOnly(build: () => void) {
  if (!isLow()) build();
}

/** Revolution segments for a low-detail part of the given largest radius. */
export function lowSegments(radius: number) {
  return radius <= 0.0025
    ? 6
    : radius <= 0.006
      ? 10
      : radius <= 0.011
        ? 16
        : 20;
}

/** Douglas-Peucker on a lathe profile: at "low", steps and chamfers smaller
 * than `tolerance` are dropped (the bake restores them). */
export function simplifyProfile(profile: number[][], tolerance = 0.0006) {
  if (!isLow() || profile.length < 3) return profile;
  const keep = new Array(profile.length).fill(false);
  keep[0] = keep[profile.length - 1] = true;
  const walk = (a: number, b: number) => {
    const [ax, ay] = profile[a],
      [bx, by] = profile[b];
    const dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy) || 1;
    let worst = -1,
      at = -1;
    for (let i = a + 1; i < b; i++) {
      const d =
        Math.abs((profile[i][0] - ax) * dy - (profile[i][1] - ay) * dx) / len;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = true;
      walk(a, at);
      walk(at, b);
    }
  };
  walk(0, profile.length - 1);
  return profile.filter((_, i) => keep[i]);
}

/** Closed polygon with a fillet arc at every corner (third value overrides the radius).
 * At "low", radii under 2.5 mm stay sharp and the rest get coarser arcs. */
export function fillet(points: P2[], radius = 0.0015): T.Vector2[] {
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
    if (r <= 0 || turn < 0.02 || (isLow() && r < 0.0025)) {
      out.push(p);
      continue;
    }
    const t = Math.min(r * Math.tan(turn / 2), la * 0.48, lb * 0.48);
    const s = p.clone().addScaledVector(da, -t),
      e = p.clone().addScaledVector(db, t);
    const steps = isLow()
      ? r < 0.004
        ? 1
        : Math.max(1, Math.ceil(turn / 0.6))
      : Math.max(2, Math.ceil(turn / 0.28));
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

/** Profile extruded symmetrically about z = 0 with a rounded (3-segment) edge bevel. */
export function extrude(
  points: P2[],
  width: number,
  bevel = 0.0012,
  holes: P2[][] = [],
  radius = 0.0015,
) {
  const shape = new T.Shape(fillet(points, radius));
  for (const hole of holes) shape.holes.push(new T.Path(fillet(hole, radius)));
  const b = isLow() ? 0 : Math.min(bevel, width * 0.3);
  const depth = width - 2 * b;
  const geo = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 3,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Side profile (x, y) extruded across the width, centred on z. */
export function slab(
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

/** Top-view profile (x, z) extruded vertically, centred on y. */
export function plate(
  g: WeaponGeometry,
  m: T.Material,
  points: P2[],
  thickness: number,
  y: number,
  bevel = 0.001,
) {
  const geo = extrude(points, thickness, bevel);
  geo.rotateX(Math.PI / 2);
  g.add(geo, m, [0, y, 0]);
}

/** Cross-section (z, y) extruded along +X from x0 to x1. */
export function prism(
  section: P2[],
  x0: number,
  x1: number,
  bevel = 0,
  radius = 0,
) {
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

/** Revolved profile [axial, radius] along an arbitrary direction from an origin. */
export function latheAlong(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  origin: number[],
  direction: T.Vector3,
  segments = 20,
) {
  const geo = new T.LatheGeometry(
    simplifyProfile(profile).map(
      ([h, r]) => new T.Vector2(Math.max(r, 1e-5), h),
    ),
    isLow() ? lowSegments(Math.max(...profile.map((p) => p[1]))) : segments,
  );
  geo.applyQuaternion(
    new T.Quaternion().setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      direction.clone().normalize(),
    ),
  );
  g.add(geo, m, origin);
}

/** Thin curved band along a spline centreline, as a closed (x, y) profile with round ends. */
export function band(center: number[][], half: number, samples = 28): P2[] {
  const curve = new T.SplineCurve(center.map(([x, y]) => new T.Vector2(x, y)));
  const pts = curve.getSpacedPoints(samples);
  const left: P2[] = [],
    right: P2[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    left.push([p.x - t.y * half, p.y + t.x * half, 0]);
    right.push([p.x + t.y * half, p.y - t.x * half, 0]);
  });
  const r = half * 0.95;
  left[0][2] = left[left.length - 1][2] = r;
  right[0][2] = right[right.length - 1][2] = r;
  return [...left, ...right.reverse()];
}

/** Rounded superellipse ring; U is the "front" axis, V the "left" axis. */
export function superRing(
  c: T.Vector3,
  U: T.Vector3,
  V: T.Vector3,
  front: number,
  back: number,
  left: number,
  right: number,
  n: number,
  N: number,
  phase = 0,
) {
  const out: T.Vector3[] = [],
    p = 2 / n;
  for (let k = 0; k < N; k++) {
    const a = phase + (k / N) * Math.PI * 2,
      ca = Math.cos(a),
      sa = Math.sin(a);
    const u = Math.sign(ca) * Math.abs(ca) ** p * (ca >= 0 ? front : back);
    const v = Math.sign(sa) * Math.abs(sa) ** p * (sa >= 0 ? left : right);
    out.push(c.clone().addScaledVector(U, u).addScaledVector(V, v));
  }
  return out;
}

/** Closed surface through rings of equal vertex count. With `inner` rings it is a
 * walled shell: `hole` removes cells (real openings with side walls) and `open`
 * leaves an end as an annulus instead of a cap. Faces are oriented away from
 * the material, so winding never depends on authoring order. */
export function shell(
  outer: T.Vector3[][],
  options: {
    inner?: T.Vector3[][];
    hole?: (c: T.Vector3) => boolean;
    open?: [boolean, boolean];
  } = {},
) {
  const { inner, hole } = options,
    open = options.open ?? [false, false];
  const S = outer.length,
    N = outer[0].length;
  const pos: number[] = [];
  const centroid = (ring: T.Vector3[]) =>
    ring.reduce((s, p) => s.add(p), new T.Vector3()).divideScalar(ring.length);
  const center = outer.map(centroid);
  const innerCenter = inner?.map(centroid);
  const poly = (pts: T.Vector3[], want: T.Vector3) => {
    const n = new T.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      n.x += (p.y - q.y) * (p.z + q.z);
      n.y += (p.z - q.z) * (p.x + q.x);
      n.z += (p.x - q.x) * (p.y + q.y);
    }
    if (n.dot(want) < 0) pts = [...pts].reverse();
    for (let i = 1; i + 1 < pts.length; i++)
      pos.push(
        ...pts[0].toArray(),
        ...pts[i].toArray(),
        ...pts[i + 1].toArray(),
      );
  };
  const wrap = (j: number) => (j + N) % N;
  const mid = (i: number, j: number) =>
    outer[i][wrap(j)]
      .clone()
      .add(outer[i + 1][wrap(j)])
      .add(outer[i + 1][wrap(j + 1)])
      .add(outer[i][wrap(j + 1)])
      .multiplyScalar(0.25);
  const solid = (i: number, j: number) =>
    i >= 0 && i < S - 1 && !(inner && hole && hole(mid(i, j)));
  const axis = (i: number) =>
    center[i]
      .clone()
      .add(center[i + 1])
      .multiplyScalar(0.5);
  for (let i = 0; i < S - 1; i++)
    for (let j = 0; j < N; j++) {
      if (!solid(i, j)) continue;
      const jn = wrap(j + 1),
        c = mid(i, j);
      poly(
        [outer[i][j], outer[i + 1][j], outer[i + 1][jn], outer[i][jn]],
        c.clone().sub(axis(i)),
      );
      if (!inner) continue;
      const ic = innerCenter![i]
        .clone()
        .add(innerCenter![i + 1])
        .multiplyScalar(0.5);
      poly(
        [inner[i][j], inner[i + 1][j], inner[i + 1][jn], inner[i][jn]],
        ic.sub(c),
      );
      const wallJ = (k: number, other: number) =>
        poly(
          [outer[i][k], outer[i + 1][k], inner[i + 1][k], inner[i][k]],
          mid(i, other).sub(c),
        );
      if (!solid(i, j - 1)) wallJ(j, j - 1);
      if (!solid(i, j + 1)) wallJ(jn, j + 1);
      const wallI = (s: number, want: T.Vector3) =>
        poly([outer[s][j], outer[s][jn], inner[s][jn], inner[s][j]], want);
      if (i === 0) {
        if (open[0]) wallI(0, center[0].clone().sub(center[1]));
      } else if (!solid(i - 1, j)) wallI(i, mid(i - 1, j).sub(c));
      if (i === S - 2) {
        if (open[1]) wallI(S - 1, center[S - 1].clone().sub(center[S - 2]));
      } else if (!solid(i + 1, j)) wallI(i + 1, mid(i + 1, j).sub(c));
    }
  const cap = (rings: T.Vector3[][], s: number, want: T.Vector3) => {
    const c = centroid(rings[s]);
    for (let j = 0; j < N; j++)
      poly([c, rings[s][j], rings[s][wrap(j + 1)]], want);
  };
  const ends: [number, number][] = [
    [0, 1],
    [S - 1, S - 2],
  ];
  ends.forEach(([s, t], k) => {
    if (inner && open[k]) return;
    const out = center[s].clone().sub(center[t]);
    cap(outer, s, out);
    if (inner) cap(inner, s, out.clone().negate());
  });
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    "uv",
    new T.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  geo.computeVertexNormals();
  return geo;
}

export const X = new T.Vector3(1, 0, 0),
  Y = new T.Vector3(0, 1, 0),
  Z = new T.Vector3(0, 0, 1);
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const bump = (x: number, at: number, width: number) =>
  Math.exp(-(((x - at) / width) ** 2));

export const GRIP_RAKE = Math.tan((17 * Math.PI) / 180);

/** Ergonomic pistol grip lofted from horizontal slices: raked 17°, beavertail
 * over the web, rounded backstrap, palm swell and one finger ridge. */
export function pistolGrip(g: WeaponGeometry, m: WeaponFinish) {
  const xc = (y: number) => -0.1224 + (y + 0.017) * GRIP_RAKE;
  const back = (y: number) =>
    0.0235 + 0.0015 * bump(y, -0.07, 0.02) + 0.0165 * smooth(-0.028, -0.018, y);
  const front = (y: number) => 0.0215 + 0.0022 * bump(y, -0.064, 0.0055);
  const half = (y: number) =>
    0.0108 + 0.005 * bump(y, -0.066, 0.03) + 0.0014 * smooth(-0.085, -0.105, y);
  const ys = [
    -0.006, -0.0075, -0.0095, -0.013, -0.017, -0.021, -0.025, -0.028, -0.032,
  ];
  for (let y = -0.037; y >= -0.1035; y -= 0.0045) ys.push(y);
  ys.push(-0.106, -0.1078, -0.109, -0.1097);
  // Low: the web, the finger ridge and the base keep their slices; the bake
  // restores the rounded edges.
  if (isLow())
    ys.splice(
      0,
      ys.length,
      -0.006,
      -0.0095,
      -0.017,
      -0.025,
      -0.032,
      -0.043,
      -0.055,
      -0.0625,
      -0.0685,
      -0.078,
      -0.091,
      -0.1035,
      -0.1078,
      -0.1097,
    );
  const scale = (y: number) =>
    ({
      [-0.006]: 0.72,
      [-0.0075]: 0.9,
      [-0.0095]: 0.97,
      [-0.1078]: 0.92,
      [-0.109]: 0.74,
      [-0.1097]: 0.45,
    })[y] ?? 1;
  const rings = ys.map((y) => {
    const s = scale(y);
    return superRing(
      new T.Vector3(xc(y), y, 0),
      X,
      Z,
      front(y) * s,
      back(y) * s,
      half(y) * s,
      half(y) * s,
      2.4,
      seg(40, 28),
    );
  });
  g.add(shell(rings), m.rubber);
}

// ---------------------------------------------------------------------------
// Receiver internals shared by the AR-family uppers.

/** Revolved profile [axial, radius] about the X axis through (y, z). */
export function latheAt(
  g: WeaponGeometry,
  m: T.Material,
  profile: number[][],
  y: number,
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

/** Flat-top upper section (z, y) about the bore: `top` above, `bottom` below
 * (negative), `half` the flank half-width. `flank` adds vertices on the flanks
 * so a port can be cut between them. */
export function upperSection(
  top: number,
  bottom: number,
  half: number,
  flank: number[] = [],
): P2[] {
  const levels = [top - 0.008, ...flank, bottom + 0.0125]
    .sort((a, b) => b - a)
    .map((y) => [half, y, 0] as P2);
  const h: P2[] = [
    [half * 0.625, top, 0.001],
    [half * 0.988, top - 0.006, 0.0025],
    ...levels,
    [half * 0.976, bottom + 0.0085, 0.004],
    [half * 0.726, bottom, 0.004],
  ];
  return [
    [0, top, 0],
    ...h,
    [0, bottom, 0],
    ...h.map(([z, y, r]) => [-z, y, r] as P2).reverse(),
  ];
}

export interface Breech {
  /** Bore axis height. */
  bore: number;
  /** Carrier radius. */
  r: number;
  /** Ejection port [rear, front] in x and [low, high] about the bore. */
  port: [number, number];
  portY: [number, number];
  /** Rear end of the carrier (inside the receiver extension ring). */
  rear: number;
  /** Front face of the upper, where the barrel extension ends. */
  face: number;
  /** Half-width of the upper's flank, for the dust cover and hinge. */
  flank: number;
}

/** Bolt carrier in battery, bolt lugs locked into the barrel extension, the
 * open dust cover hanging on its hinge below the port. */
export function breech(g: WeaponGeometry, m: WeaponFinish, b: Breech) {
  const { bore, r, port, rear, face } = b;
  const extRear = port[1] - 0.002,
    lugs = extRear - 0.005,
    carrierFront = lugs - 0.006;
  // Barrel extension: chamfered rear face just inside the port's front edge.
  latheAt(
    g,
    m.steel,
    [
      [extRear, 0],
      [extRear, r * 0.62],
      [extRear + 0.0015, r * 0.8],
      [extRear + 0.0015, r * 0.96],
      [extRear + 0.003, r],
      [face, r],
      [face, 0],
    ],
    bore,
    0,
    24,
  );
  // Bolt: lug ring against the extension, slimmer neck back to the carrier.
  latheAt(
    g,
    m.steel,
    [
      [carrierFront - 0.001, 0],
      [carrierFront - 0.001, r * 0.56],
      [lugs, r * 0.56],
      [lugs, r * 0.78],
      [extRear + 0.0004, r * 0.78],
      [extRear + 0.0004, 0],
    ],
    bore,
    0,
    16,
  );
  for (let k = 0; k < seg(7, 0); k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    g.add(
      new T.BoxGeometry(extRear - lugs - 0.0006, r * 0.2, r * 0.22),
      m.steel,
      [
        (lugs + extRear) / 2,
        bore + Math.cos(a) * r * 0.82,
        Math.sin(a) * r * 0.82,
      ],
      new T.Euler(a, 0, 0),
    );
  }
  // Carrier: round section with the flat cut on the ejection side.
  const flat = -r * 0.84;
  const section: P2[] = [];
  const n = seg(28, 10);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const z = Math.sin(a) * r,
      y = Math.cos(a) * r;
    section.push([Math.max(z, flat), y, 0]);
  }
  g.add(prism(section, rear, carrierFront), m.steel, [0, bore, 0]);
  // Bolt-carrier detail from here on is bake-only at low detail.
  if (isLow()) return breechCover(g, m, b);
  // Forward-assist serrations on the flat, at the rear of the port.
  const teeth: P2[] = [[port[0] + 0.004, flat + 0.0002, 0]];
  for (let x = port[0] + 0.004; x < port[0] + 0.024; x += 0.002)
    teeth.push(
      [x, flat - 0.0006, 0],
      [x + 0.001, flat - 0.0006, 0],
      [x + 0.001, flat, 0],
    );
  teeth.push([port[0] + 0.024, flat + 0.0002, 0]);
  plate(g, m.steel, teeth, r * 0.7, bore, 0);
  // Gas key on top with its two screws, cam pin head ahead of it.
  g.add(
    prism(
      [
        [-0.004, r - 0.001],
        [0.004, r - 0.001],
        [0.004, r + 0.0042],
        [-0.004, r + 0.0042],
      ],
      carrierFront - 0.032,
      carrierFront - 0.004,
    ),
    m.steel,
    [0, bore, 0],
  );
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0032],
      [r * 0.25, 0.0032],
      [r * 0.25, 0],
    ],
    [carrierFront - 0.012, bore + r * 0.82, r * 0.35],
    new T.Vector3(0, 1, 0.4),
    12,
  );
  breechCover(g, m, b);
}

function breechCover(g: WeaponGeometry, m: WeaponFinish, b: Breech) {
  const { bore, port, portY, flank } = b;
  // Open dust cover: hinged on a rod at the port's lower edge, hanging down
  // against the receiver, its latch detent now at the bottom edge.
  const hingeY = bore + portY[0] - 0.0016,
    hingeZ = -flank - 0.0011,
    height = portY[1] - portY[0] + 0.0006;
  const cover = extrude(
    [
      [port[0] + 0.0005, 0],
      [port[1] - 0.0005, 0],
      [port[1] - 0.0005, -height],
      [port[0] + 0.0005, -height],
    ],
    0.0011,
    0.0003,
    [],
    0.0012,
  );
  const rib = extrude(
    [
      [port[0] + 0.006, -height * 0.42],
      [port[1] - 0.008, -height * 0.42],
      [port[1] - 0.008, -height * 0.56],
      [port[0] + 0.006, -height * 0.56],
    ],
    0.0008,
    0.0002,
    [],
    0.0008,
  );
  rib.translate(0, 0, -0.0009);
  const detent = new T.CylinderGeometry(0.0013, 0.0013, 0.0011, 12);
  detent.rotateX(Math.PI / 2);
  detent.translate(port[0] + 0.012, -height + 0.0028, -0.0009);
  for (const part of isLow() ? [cover] : [cover, rib, detent]) {
    part.rotateX(-0.2);
    g.add(part, m.metal, [0, hingeY, hingeZ]);
  }
  g.cylinder(
    [(port[0] + port[1]) / 2, hingeY, hingeZ],
    0.0011,
    port[1] - port[0] + 0.006,
    m.steel,
    "x",
    0.0011,
    seg(10, 6),
  );
  for (const x of isLow() ? [] : [port[0] - 0.0015, port[1] + 0.0015])
    g.cylinder(
      [x, hingeY, hingeZ + 0.0004],
      0.0021,
      0.0026,
      m.shell,
      "x",
      0.0021,
      12,
    );
}

// ---------------------------------------------------------------------------
// Swept parts: cables, hoses, windings, clips and finned stacks.

/** Tube swept along a 3D curve with rotation-minimising frames. `radius` may
 * vary along the length (u in 0..1). Open ends: finish them with ferrules. */
export function sweep(
  curve: T.Curve<T.Vector3>,
  radius: number | ((u: number) => number),
  segments: number,
  radial = 6,
) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos: number[] = [],
    index: number[] = [];
  const r = typeof radius === "number" ? () => radius : radius;
  const p = new T.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, p);
    const N = frames.normals[i],
      Bn = frames.binormals[i],
      ri = r(u);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      pos.push(
        p.x + ri * (Math.cos(a) * N.x + Math.sin(a) * Bn.x),
        p.y + ri * (Math.cos(a) * N.y + Math.sin(a) * Bn.y),
        p.z + ri * (Math.cos(a) * N.z + Math.sin(a) * Bn.z),
      );
    }
  }
  for (let i = 0; i < segments; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k,
        b = i * radial + ((k + 1) % radial),
        c = a + radial,
        d = b + radial;
      index.push(a, c, b, b, c, d);
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    "uv",
    new T.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Smooth centre line through control points (centripetal Catmull-Rom). */
export const route = (points: number[][]) =>
  new T.CatmullRomCurve3(
    points.map((p) => new T.Vector3(p[0], p[1], p[2])),
    false,
    "centripetal",
  );

/** Helix about an axis parallel to X: `turns` turns from x0 to x1. */
export function helix(
  x0: number,
  x1: number,
  radius: number,
  turns: number,
  y: number,
  z = 0,
  phase = 0,
) {
  return new PathCurve((t, target) => {
    const a = phase + t * turns * Math.PI * 2;
    return target.set(
      x0 + (x1 - x0) * t,
      y + Math.cos(a) * radius,
      z + Math.sin(a) * radius,
    );
  });
}

/** Curve given by a parametric function of t in 0..1. */
class PathCurve extends T.Curve<T.Vector3> {
  at: (t: number, target: T.Vector3) => T.Vector3;
  constructor(at: (t: number, target: T.Vector3) => T.Vector3) {
    super();
    this.at = at;
  }
  override getPoint(t: number, target = new T.Vector3()) {
    return this.at(t, target);
  }
}

/** Corrugated hose: a swept tube whose radius ripples with the given pitch. */
export function hose(
  curve: T.Curve<T.Vector3>,
  radius: number,
  pitch = 0.004,
  radial = 8,
  samples = 2,
) {
  const length = curve.getLength(),
    ribs = Math.max(1, Math.round(length / pitch));
  return sweep(
    curve,
    (u) =>
      radius * (0.9 + 0.1 * Math.cos(u * ribs * Math.PI * 2)) -
      radius * 0.1 * (1 - smooth(0, 0.015, u * length)) -
      radius * 0.1 * (1 - smooth(0, 0.015, (1 - u) * length)),
    ribs * samples,
    radial,
  );
}

/** Rotation taking +Y to `direction`. */
export const towards = (direction: T.Vector3) =>
  new T.Euler().setFromQuaternion(
    new T.Quaternion().setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      direction.clone().normalize(),
    ),
  );

/** P-clip: a strap loop around a tube of radius `r` (axis `tangent` through
 * `at`) whose flat tab lies on the mounting surface in direction `foot`, held
 * by a screw. The tube rides on that surface. */
export function pClip(
  g: WeaponGeometry,
  m: WeaponFinish,
  at: T.Vector3,
  tangent: T.Vector3,
  r: number,
  foot: T.Vector3,
) {
  const t = tangent.clone().normalize();
  const f = foot.clone().addScaledVector(t, -foot.dot(t)).normalize();
  const side = new T.Vector3().crossVectors(f, t).normalize();
  const w = Math.max(0.0035, r * 0.9),
    th = 0.0007;
  latheAlong(
    g,
    m.steel,
    [
      [-w / 2, r],
      [-w / 2, r + th],
      [w / 2, r + th],
      [w / 2, r],
      [-w / 2, r],
    ],
    at.toArray(),
    t,
    10,
  );
  // Doubled tab from under the loop out along the surface, screw at its end.
  const len = r + 0.0055;
  const tab = extrude(
    [
      [0, -w / 2],
      [len, -w / 2],
      [len, w / 2],
      [0, w / 2],
    ],
    th * 2,
    0,
    [],
    0,
  );
  tab.applyMatrix4(
    new T.Matrix4()
      .makeBasis(side, t, f)
      .setPosition(at.clone().addScaledVector(f, r + th)),
  );
  g.add(tab, m.steel);
  latheAlong(
    g,
    m.steel,
    [
      [0, 0],
      [0, 0.0021],
      [0.0008, 0.0021],
      [0.0013, 0.0013],
      [0.0013, 0],
    ],
    at
      .clone()
      .addScaledVector(f, r)
      .addScaledVector(side, r + 0.0032)
      .toArray(),
    f.clone().negate(),
    8,
  );
}

/** Stack of thin fins: a (z, y) section extruded along X at each station. */
export function fins(
  g: WeaponGeometry,
  m: T.Material,
  section: P2[],
  xs: number[],
  thickness: number,
  y = 0,
  radius = 0.0015,
) {
  for (const x of xs)
    g.add(prism(section, x, x + thickness, 0, radius), m, [0, y, 0]);
}
