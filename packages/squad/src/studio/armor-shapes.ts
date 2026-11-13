// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import {
  mergeGeometries,
  toCreasedNormals,
} from "three/addons/utils/BufferGeometryUtils.js";
import { ARMOR_BODY, type BodyScan, type LimbScan } from "./armor-body.ts";

/** Shape helpers for the armor preview sets (light, medium, heavy): body-fitted
 * surfaces from the measured native bodies, walled plates with rolled edges
 * and crisp facets, straps, inlaid light lines and small hardware.
 *
 * Preview only: nothing in the game imports these yet. */

// ---------------------------------------------------------------------------
// Axis convention (every armor builder uses it).
//
// The native body's rest (bind) space in metres: +Y up, +Z the character's
// front, +X the character's LEFT. Builders author left-side pieces and get the
// right side with `mirrorPiece`, which negates x, re-winds triangles and swaps
// Left/Right bone names. Each piece is rigid on one bone of the native rig:
// the plate is one `_RIGID_FIT` assembly, exactly like the shipped NYX
// shells. Straps and the suit-side soft parts sit on the same bone for the
// preview; at integration they can take nearest-skin weights instead.
//
// Angles: torso θ and sphere yaw are measured from the front (+Z) toward the
// left (+X); limb φ from the limb's `front` toward its outer `side`.

export type Sex = "male" | "female";
export type Detail = "high" | "low";
export type ArmorMaterial = "plate" | "suit" | "metal" | "glow";
export type ArmorSlot =
  | "mask"
  | "helmet"
  | "torso"
  | "back"
  | "shoulders"
  | "arms"
  | "waist"
  | "legs";

export interface ArmorPiece {
  name: string;
  slot: ArmorSlot;
  /** Native rig bone the piece is rigid on, without the `mixamorig` prefix. */
  bone: string;
  parts: Partial<Record<ArmorMaterial, T.BufferGeometry>>;
}

export interface ArmorSet {
  tier: "light" | "medium" | "heavy";
  sex: Sex;
  pieces: ArmorPiece[];
}

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

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Measured fields

/** A grid of radii with cubic (Catmull-Rom) interpolation, periodic in u. */
class Field {
  readonly values: number[][];
  readonly periodicU: boolean;
  constructor(values: number[][], periodicU = true) {
    this.values = values;
    this.periodicU = periodicU;
  }
  get rows() {
    return this.values.length;
  }
  get cols() {
    return this.values[0].length;
  }
  private cell(i: number, j: number) {
    const r = Math.min(this.rows - 1, Math.max(0, i));
    const c = this.periodicU
      ? ((j % this.cols) + this.cols) % this.cols
      : Math.min(this.cols - 1, Math.max(0, j));
    return this.values[r][c];
  }
  /** fi in rows, fj in columns (fractional). */
  sample(fi: number, fj: number) {
    const i = Math.floor(fi),
      j = Math.floor(fj),
      s = fi - i,
      t = fj - j;
    const cr = (a: number, b: number, c: number, d: number, x: number) =>
      b +
      0.5 *
        x *
        (c - a + x * (2 * a - 5 * b + 4 * c - d + x * (3 * (b - c) + d - a)));
    const row = (k: number) =>
      cr(
        this.cell(k, j - 1),
        this.cell(k, j),
        this.cell(k, j + 1),
        this.cell(k, j + 2),
        t,
      );
    return cr(row(i - 1), row(i), row(i + 1), row(i + 2), s);
  }
}

/** Polar convex hull of one ring of radii (angles evenly spaced from 0). */
function convexRing(radii: number[]) {
  const n = radii.length;
  const pts = radii.map((r, j) => {
    const a = (2 * Math.PI * j) / n;
    return new T.Vector2(Math.sin(a) * r, Math.cos(a) * r);
  });
  // Monotone chain.
  const sorted = [...pts].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: T.Vector2, a: T.Vector2, b: T.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: T.Vector2[] = [],
    upper: T.Vector2[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return radii.map((r, j) => {
    const a = (2 * Math.PI * j) / n,
      d = new T.Vector2(Math.sin(a), Math.cos(a));
    let best = r;
    for (let k = 0; k < hull.length; k++) {
      const p = hull[k],
        q = hull[(k + 1) % hull.length],
        e = q.clone().sub(p);
      const den = d.x * e.y - d.y * e.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = (p.x * e.y - p.y * e.x) / den,
        s = (p.x * d.y - p.y * d.x) / den;
      if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
    }
    return best;
  });
}

/** Upper convex hull of r over a run of rows: bridges concavities (waist under
 * a chest, the small of the back) the way a rigid plate does. */
function convexColumn(values: number[], from: number, to: number) {
  const out = values.slice();
  const idx: number[] = [];
  for (let i = from; i <= to; i++) {
    while (idx.length >= 2) {
      const a = idx[idx.length - 2],
        b = idx[idx.length - 1];
      // Remove b if it lies below the chord a→i.
      const chord = values[a] + ((values[i] - values[a]) * (b - a)) / (i - a);
      if (values[b] <= chord) idx.pop();
      else break;
    }
    idx.push(i);
  }
  for (let k = 0; k + 1 < idx.length; k++) {
    const a = idx[k],
      b = idx[k + 1];
    for (let i = a; i <= b; i++)
      out[i] = Math.max(
        values[i],
        values[a] + ((values[b] - values[a]) * (i - a)) / (b - a),
      );
  }
  return out;
}

function blur(values: number[][], passes: number, periodic = true) {
  let v = values.map((r) => r.slice());
  for (let p = 0; p < passes; p++) {
    v = v.map((row, i) =>
      row.map((x, j) => {
        const n = row.length;
        const l = periodic ? row[(j - 1 + n) % n] : row[Math.max(0, j - 1)];
        const r = periodic ? row[(j + 1) % n] : row[Math.min(n - 1, j + 1)];
        const u = v[Math.max(0, i - 1)][j],
          d = v[Math.min(v.length - 1, i + 1)][j];
        return x * 0.4 + (l + r) * 0.2 + (u + d) * 0.1;
      }),
    );
  }
  return v;
}

/** A body-fitted surface: `at(u, v)` and the outward direction used to orient
 * its normal. Units of u and v depend on the surface (radians, metres, t). */
export interface Surface {
  at(u: number, v: number): T.Vector3;
  out(u: number, v: number): T.Vector3;
}

/** Numeric outward normal of a surface. */
export function normalAt(
  s: Surface,
  u: number,
  v: number,
  du = 1e-3,
  dv = 1e-3,
) {
  const a = s.at(u + du, v).sub(s.at(u - du, v));
  const b = s.at(u, v + dv).sub(s.at(u, v - dv));
  const n = new T.Vector3().crossVectors(a, b);
  if (n.lengthSq() < 1e-16) return s.out(u, v).normalize();
  n.normalize();
  if (n.dot(s.out(u, v)) < 0) n.negate();
  return n;
}

export interface FitOptions {
  /** Clearance above the (hulled) skin, metres. */
  offset: number;
  /** Bridge concavities across each ring (default true). */
  hull?: boolean;
  /** Bridge vertical concavities between these heights (torso, metres). */
  hullY?: [number, number];
  /** Smoothing passes (default 2). */
  blur?: number;
  /** Per-point extra radius (u, v) → metres, e.g. to clear a belt or a chest. */
  extra?: (u: number, v: number) => number;
}

/** Measurements and fitted surfaces of one native body. */
export class BodyFit {
  readonly scan: BodyScan;
  readonly sex: Sex;
  constructor(sex: Sex) {
    this.sex = sex;
    this.scan = ARMOR_BODY[sex];
  }
  /** Rest position of a bone; Right* names mirror the measured left. */
  bone(name: string) {
    const right = name.startsWith("Right");
    const p = this.scan.bones[right ? "Left" + name.slice(5) : name];
    if (!p) throw Error(`Unmeasured bone ${name}`);
    return V(right ? -p[0] : p[0], p[1], p[2]);
  }
  get top() {
    return this.scan.top;
  }
  /** Torso surface over (θ radians, y metres). */
  torso(o: FitOptions): Surface {
    const t = this.scan.torso;
    let rows = t.rows.map((r) => r.map((v) => v / 1000));
    if (o.hull ?? true) rows = rows.map(convexRing);
    if (o.hullY) {
      const n = rows.length,
        i0 = Math.max(
          0,
          Math.floor(((o.hullY[0] - t.y0) / (t.y1 - t.y0)) * (n - 1)),
        ),
        i1 = Math.min(
          n - 1,
          Math.ceil(((o.hullY[1] - t.y0) / (t.y1 - t.y0)) * (n - 1)),
        );
      for (let j = 0; j < rows[0].length; j++) {
        const col = convexColumn(
          rows.map((r) => r[j]),
          i0,
          i1,
        );
        rows.forEach((r, i) => (r[j] = col[i]));
      }
    }
    rows = blur(rows, o.blur ?? 2);
    const field = new Field(rows),
      centres = new Field([t.centres], false);
    const fi = (y: number) => ((y - t.y0) / (t.y1 - t.y0)) * (field.rows - 1);
    const fj = (a: number) => (a / (2 * Math.PI)) * field.cols;
    const extra = o.extra ?? (() => 0);
    return {
      at: (a, y) => {
        const r = field.sample(fi(y), fj(a)) + o.offset + extra(a, y);
        const zc = centres.sample(0, fi(y));
        return V(Math.sin(a) * r, y, zc + Math.cos(a) * r);
      },
      out: (a) => V(Math.sin(a), 0, Math.cos(a)),
    };
  }
  /** Limb frame (left side): origin, unit axis, length, front and side. */
  limbFrame(name: keyof BodyScan["limbs"]) {
    const l: LimbScan = this.scan.limbs[name];
    const A = this.bone(l.from),
      B = this.bone(l.to);
    const axis = B.clone().sub(A);
    const length = axis.length();
    axis.normalize();
    return {
      origin: A,
      axis,
      length,
      front: V(...(l.front as [number, number, number])),
      side: V(...(l.side as [number, number, number])),
      /** Point on the bone axis at parameter t (0 joint, 1 next joint). */
      point: (t: number) => A.clone().addScaledVector(axis, t * length),
      bone: l.from,
    };
  }
  /** Limb surface over (φ radians, t along the bone), left side. */
  limb(name: keyof BodyScan["limbs"], o: FitOptions): Surface {
    const l = this.scan.limbs[name],
      f = this.limbFrame(name);
    let rows = l.rows.map((r) => r.map((v) => v / 1000));
    if (o.hull ?? true) rows = rows.map(convexRing);
    rows = blur(rows, o.blur ?? 2);
    const field = new Field(rows);
    const fi = (t: number) => ((t - l.t0) / (l.t1 - l.t0)) * (field.rows - 1);
    const extra = o.extra ?? (() => 0);
    const dir = (phi: number) =>
      f.front
        .clone()
        .multiplyScalar(Math.cos(phi))
        .addScaledVector(f.side, Math.sin(phi));
    return {
      at: (phi, t) =>
        f
          .point(t)
          .addScaledVector(
            dir(phi),
            field.sample(fi(t), (phi / (2 * Math.PI)) * field.cols) +
              o.offset +
              extra(phi, t),
          ),
      out: (phi) => dir(phi),
    };
  }
  private sphere(scan: BodyScan["skull"], o: FitOptions): Surface {
    let rows = scan.rows.map((r) => r.map((v) => v / 1000));
    if (o.hull ?? true) rows = rows.map(convexRing);
    rows = blur(rows, o.blur ?? 2);
    const field = new Field(rows),
      c = V(...(scan.centre as [number, number, number]));
    const extra = o.extra ?? (() => 0);
    const dir = (yaw: number, pitch: number) =>
      V(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
    return {
      at: (yaw, pitch) =>
        c
          .clone()
          .addScaledVector(
            dir(yaw, pitch),
            field.sample(
              ((pitch / DEG + 80) / 170) * (field.rows - 1),
              (yaw / (2 * Math.PI)) * field.cols,
            ) +
              o.offset +
              extra(yaw, pitch),
          ),
      out: dir,
    };
  }
  /** Head surface over (yaw, pitch) radians about the skull centre. */
  skull(o: FitOptions) {
    return this.sphere(this.scan.skull, o);
  }
  /** Left deltoid surface over (yaw, pitch) about the shoulder joint. */
  deltoid(o: FitOptions) {
    return this.sphere(this.scan.deltoid, o);
  }
  get skullCentre() {
    return V(...(this.scan.skull.centre as [number, number, number]));
  }
}

// ---------------------------------------------------------------------------
// Plates

export interface PlateOptions {
  /** (a, b) ∈ [0, 1]² → surface (u, v). a runs across, b along. */
  map: (a: number, b: number) => [number, number];
  /** Grid segments across and along at "high" (halved at "low"). */
  cols: number;
  rows: number;
  /** Wall thickness, metres. */
  thickness?: number;
  /** Extra outward shaping (crown, ridges, steps) at (a, b), metres. */
  lift?: (a: number, b: number) => number;
  /** Width of the rolled edge as a fraction of the grid (default 0.06). */
  roll?: number;
  /** Knots in a (and b) between which the surface is flattened into facets. */
  facetsA?: number[];
  facetsB?: number[];
  /** Crease angle for normals (default 34°). */
  crease?: number;
  /** Leave the inner face and walls off (decals, inlays). */
  skin?: boolean;
  /** Close the a direction into a ring (a = 0 and a = 1 coincide). */
  ringA?: boolean;
}

/** Edge-biased samples: one extra row in the rolled band at each end.
 * With facet knots, only the knots (and their midpoints) are sampled: a
 * facet is planar, so more columns across it add triangles and nothing else. */
function samples(n: number, roll: number, ring = false, knots?: number[]) {
  const out: number[] = [];
  if (ring && !knots) {
    for (let i = 0; i <= n; i++) out.push(i / n);
    return out;
  }
  if (knots) {
    const k = [...knots].sort((x, y) => x - y);
    const inner: number[] = [];
    for (let i = 0; i + 1 < k.length; i++) {
      inner.push(k[i]);
      if (!isLow()) inner.push((k[i] + k[i + 1]) / 2);
    }
    inner.push(k[k.length - 1]);
    const body = inner.filter((t) =>
      ring ? true : t > roll * 1.5 && t < 1 - roll * 1.5,
    );
    return ring ? body : [0, roll, ...body, 1 - roll, 1];
  }
  out.push(0, roll);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t > roll * 1.5 && t < 1 - roll * 1.5) out.push(t);
  }
  out.push(1 - roll, 1);
  return out;
}

/** Piecewise-linear in a between knots: planar facets with crisp creases. */
function facetPoint(
  s: Surface,
  map: PlateOptions["map"],
  knots: number[] | undefined,
  a: number,
  b: number,
) {
  if (!knots || knots.length < 2) {
    const [u, v] = map(a, b);
    return s.at(u, v);
  }
  let k = 0;
  while (k < knots.length - 2 && a > knots[k + 1]) k++;
  const a0 = knots[k],
    a1 = knots[k + 1],
    t = Math.min(1, Math.max(0, (a - a0) / (a1 - a0)));
  const [u0, v0] = map(a0, b),
    [u1, v1] = map(a1, b);
  return s.at(u0, v0).lerp(s.at(u1, v1), t);
}

/** A walled, body-fitted plate. The surface is its inner face; the outer face
 * stands `thickness` + `lift` off it and rolls down to the inner face over
 * the edge band, so every plate shows a real thickness and a finished edge. */
export function plate(s: Surface, o: PlateOptions) {
  const roll = o.roll ?? 0.06,
    thick = o.thickness ?? 0.006,
    lift = o.lift ?? (() => 0);
  const as = samples(
    seg(o.cols, Math.max(3, Math.ceil(o.cols / 2))),
    roll,
    o.ringA,
    o.facetsA,
  );
  const bs = samples(seg(o.rows, Math.max(3, Math.ceil(o.rows / 2))), roll);
  const A = as.length,
    B = bs.length;
  const outer: T.Vector3[] = [],
    inner: T.Vector3[] = [],
    uvs: number[][] = [];
  const edgeFactor = (x: number) => (x <= 0 || x >= 1 ? 0.3 : 1);
  for (let j = 0; j < B; j++)
    for (let i = 0; i < A; i++) {
      const a = as[i],
        b = bs[j];
      const base = facetPoint(s, o.map, o.facetsA, a, b);
      // Normal from the faceted surface itself so facets stay planar.
      const da = 0.004,
        db = 0.004;
      const pa = facetPoint(s, o.map, o.facetsA, Math.min(1, a + da), b).sub(
        facetPoint(s, o.map, o.facetsA, Math.max(0, a - da), b),
      );
      const pb = facetPoint(s, o.map, o.facetsA, a, Math.min(1, b + db)).sub(
        facetPoint(s, o.map, o.facetsA, a, Math.max(0, b - db)),
      );
      const n = new T.Vector3().crossVectors(pa, pb);
      const [u, v] = o.map(a, b);
      if (n.lengthSq() < 1e-14) n.copy(s.out(u, v));
      n.normalize();
      if (n.dot(s.out(u, v)) < 0) n.negate();
      const f = o.ringA
        ? edgeFactor(b)
        : Math.min(edgeFactor(a), edgeFactor(b));
      outer.push(base.clone().addScaledVector(n, (thick + lift(a, b)) * f));
      inner.push(base);
      uvs.push([a, b]);
    }
  // Texture space in metres: arc length along the middle row and column.
  const midRow = Math.floor(B / 2),
    midCol = Math.floor(A / 2);
  const uLen: number[] = [0],
    vLen: number[] = [0];
  for (let i = 1; i < A; i++)
    uLen.push(
      uLen[i - 1] + outer[midRow * A + i].distanceTo(outer[midRow * A + i - 1]),
    );
  for (let j = 1; j < B; j++)
    vLen.push(
      vLen[j - 1] +
        outer[j * A + midCol].distanceTo(outer[(j - 1) * A + midCol]),
    );
  const pos: number[] = [],
    uv: number[] = [];
  const push = (p: T.Vector3, i: number, j: number) => {
    pos.push(p.x, p.y, p.z);
    uv.push(uLen[i], vLen[j]);
  };
  // Each quad is wound so its face points along `want`.
  const quad = (p: T.Vector3[], ij: [number, number][], want: T.Vector3) => {
    const n = new T.Vector3().crossVectors(
      p[1].clone().sub(p[0]),
      p[2].clone().sub(p[0]),
    );
    const m = new T.Vector3().crossVectors(
      p[2].clone().sub(p[0]),
      p[3].clone().sub(p[0]),
    );
    const flip = n.add(m).dot(want) < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const k of order) push(p[k], ij[k][0], ij[k][1]);
  };
  const id = (i: number, j: number) => j * A + i;
  const mid = (ps: T.Vector3[]) =>
    ps.reduce((s, q) => s.add(q), new T.Vector3()).divideScalar(ps.length);
  for (let j = 0; j + 1 < B; j++)
    for (let i = 0; i + 1 < A; i++) {
      const ij: [number, number][] = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      const po = ij.map(([x, y]) => outer[id(x, y)]),
        pi = ij.map(([x, y]) => inner[id(x, y)]);
      const out = mid(po).sub(mid(pi));
      if (out.lengthSq() < 1e-14) out.copy(s.out(...o.map(as[i], bs[j])));
      quad(po, ij, out);
      if (!o.skin) quad(pi, ij, out.clone().negate());
    }
  if (!o.skin) {
    // Walls around the boundary; each faces away from its interior neighbour.
    const wall = (
      i0: number,
      j0: number,
      i1: number,
      j1: number,
      ni: number,
      nj: number,
    ) => {
      const p = [
        outer[id(i0, j0)],
        outer[id(i1, j1)],
        inner[id(i1, j1)],
        inner[id(i0, j0)],
      ];
      const inside = mid([outer[id(ni, nj)], inner[id(ni, nj)]]);
      quad(
        p,
        [
          [i0, j0],
          [i1, j1],
          [i1, j1],
          [i0, j0],
        ],
        mid(p).sub(inside),
      );
    };
    for (let i = 0; i + 1 < A; i++) {
      wall(i, 0, i + 1, 0, i, 1);
      wall(i, B - 1, i + 1, B - 1, i, B - 2);
    }
    if (!o.ringA)
      for (let j = 0; j + 1 < B; j++) {
        wall(0, j, 0, j + 1, 1, j);
        wall(A - 1, j, A - 1, j + 1, A - 2, j);
      }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  return creased(geo, o.crease ?? 34);
}

/** Normals with hard edges above `angle` degrees (facets, rolled rims). */
export function creased(geo: T.BufferGeometry, angle = 34) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  return toCreasedNormals(g, angle * DEG);
}

/** Point at t ∈ [0, 1] along a polyline, each segment an equal share of t,
 * so a grid with a multiple of (points - 1) columns lands on every corner. */
export function along(poly: number[][], t: number): [number, number] {
  const n = poly.length - 1,
    x = Math.min(n - 1e-9, Math.max(0, t * n)),
    k = Math.floor(x),
    f = x - k;
  return [
    lerp(poly[k][0], poly[k + 1][0], f),
    lerp(poly[k][1], poly[k + 1][1], f),
  ];
}

/** Coons patch through four boundary polylines in surface (u, v): bottom and
 * top run left→right, left and right run bottom→top; corners are shared.
 * Lets a plate take any four-sided outline: chevrons, notched collars, points. */
export function coons(
  bottom: number[][],
  top: number[][],
  left: number[][],
  right: number[][],
) {
  const c00 = bottom[0],
    c10 = bottom[bottom.length - 1],
    c01 = top[0],
    c11 = top[top.length - 1];
  return (a: number, b: number): [number, number] => {
    const B = along(bottom, a),
      U = along(top, a),
      L = along(left, b),
      R = along(right, b);
    const out: [number, number] = [0, 0];
    for (let k = 0; k < 2; k++)
      out[k] =
        (1 - b) * B[k] +
        b * U[k] +
        (1 - a) * L[k] +
        a * R[k] -
        ((1 - a) * (1 - b) * c00[k] +
          a * (1 - b) * c10[k] +
          (1 - a) * b * c01[k] +
          a * b * c11[k]);
    return out;
  };
}

/** Mirror-symmetric outline about u = 0 from its right half (u ≥ 0), given as
 * bottom (centre → corner), side (bottom corner → top corner) and top
 * (centre → corner) polylines. */
export function symmetric(
  bottom: number[][],
  side: number[][],
  top: number[][],
) {
  const flip = (p: number[][]) => p.map(([u, v]) => [-u, v]);
  const b = [...flip(bottom).reverse(), ...bottom.slice(1)];
  const t = [...flip(top).reverse(), ...top.slice(1)];
  return coons(b, t, flip(side), side);
}

/** Lift helpers. */
export const crown = (height: number) => (a: number, b: number) =>
  height * Math.sin(Math.PI * a) * Math.sin(Math.PI * b);
/** A sharp V ridge along a = at (a crease, for faceted plates). */
export const ridge =
  (at: number, width: number, height: number) => (a: number) =>
    height * Math.max(0, 1 - Math.abs(a - at) / width);
/** A narrow groove across b = at. */
export const groove =
  (at: number, width: number, depth: number) => (_a: number, b: number) =>
    -depth * Math.max(0, 1 - Math.abs(b - at) / width);
export const sum =
  (...fs: ((a: number, b: number) => number)[]) =>
  (a: number, b: number) =>
    fs.reduce((s, f) => s + f(a, b), 0);

/** An inlaid strip along a path on a surface: light lines, seams, piping. */
export function inlay(
  s: Surface,
  path: (t: number) => [number, number],
  width: number,
  height: number,
  segments: number,
) {
  // Strip coordinates: a across (width), b along the path.
  const map = (a: number, b: number): [number, number] => {
    const [u, v] = path(b);
    const [u1, v1] = path(Math.min(1, b + 0.01)),
      [u0, v0] = path(Math.max(0, b - 0.01));
    // Offset sideways in parameter space, scaled to metres by the local
    // metric of the surface.
    const p = s.at(u, v),
      du =
        s
          .at(u + 1e-3, v)
          .sub(p)
          .length() / 1e-3,
      dv =
        s
          .at(u, v + 1e-3)
          .sub(p)
          .length() / 1e-3;
    const tu = (u1 - u0) * du,
      tv = (v1 - v0) * dv,
      len = Math.hypot(tu, tv) || 1;
    const w = (a - 0.5) * width;
    return [u + ((-tv / len) * w) / du, v + ((tu / len) * w) / dv];
  };
  return plate(s, {
    map,
    cols: 1,
    rows: segments,
    thickness: height,
    roll: 0.02,
    crease: 50,
  });
}

// ---------------------------------------------------------------------------
// Loose parts: profiles, lathes, tubes, frames on a surface

/** Closed polygon with a fillet arc at every corner (third value overrides). */
export function fillet(points: number[][], radius = 0.0015): T.Vector2[] {
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
    const steps = isLow() ? 1 : Math.max(2, Math.ceil(turn / 0.4));
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

/** Filleted profile in (x, y), extruded ±depth/2 along z with a small bevel. */
export function extrude(
  points: number[][],
  depth: number,
  radius = 0.0015,
  bevel = 0.0008,
) {
  const b = isLow() ? 0 : Math.min(bevel, depth * 0.3);
  const geo = new T.ExtrudeGeometry(new T.Shape(fillet(points, radius)), {
    depth: depth - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -(depth - 2 * b) / 2);
  return geo;
}

/** Revolved profile [axial, radius] around +Y. */
export function lathe(profile: number[][], segments = 16) {
  return new T.LatheGeometry(
    profile.map(([h, r]) => new T.Vector2(Math.max(r, 1e-5), h)),
    seg(segments, Math.max(6, Math.ceil(segments / 2))),
  );
}

/** Tube swept along points (cables, piping, wraps). */
export function tube(
  points: T.Vector3[],
  radius: number,
  radial = 6,
  closed = false,
) {
  const curve = new T.CatmullRomCurve3(points, closed, "centripetal");
  const n = seg(Math.max(4, points.length * 3), Math.max(3, points.length * 2));
  return new T.TubeGeometry(
    curve,
    n,
    radius,
    seg(radial, Math.max(4, radial - 2)),
    closed,
  );
}

/** Flat strap swept along points: a width × thickness section whose face
 * turns toward `outward(p)` (away from the body). Ends are capped. */
export function ribbon(
  points: T.Vector3[],
  width: number,
  thickness: number,
  outward: (p: T.Vector3) => T.Vector3,
  closed = false,
) {
  const curve = new T.CatmullRomCurve3(points, closed, "centripetal");
  const n = seg(Math.max(6, points.length * 4), Math.max(4, points.length * 2));
  const pos: number[] = [];
  const rings: T.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      p = curve.getPointAt(t),
      d = curve.getTangentAt(t);
    const o = outward(p).normalize();
    const side = new T.Vector3().crossVectors(d, o).normalize();
    const up = new T.Vector3().crossVectors(side, d).normalize();
    const w = width / 2;
    rings.push([
      p.clone().addScaledVector(side, -w),
      p.clone().addScaledVector(side, w),
      p.clone().addScaledVector(side, w).addScaledVector(up, thickness),
      p.clone().addScaledVector(side, -w).addScaledVector(up, thickness),
    ]);
  }
  const quad = (a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3) =>
    pos.push(
      ...a.toArray(),
      ...b.toArray(),
      ...c.toArray(),
      ...a.toArray(),
      ...c.toArray(),
      ...d.toArray(),
    );
  for (let i = 0; i < n; i++) {
    const r = rings[i],
      q = rings[i + 1];
    for (let k = 0; k < 4; k++)
      quad(r[k], q[k], q[(k + 1) % 4], r[(k + 1) % 4]);
  }
  if (!closed) {
    const [a, b] = [rings[0], rings[n]];
    quad(a[3], a[2], a[1], a[0]);
    quad(b[0], b[1], b[2], b[3]);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  // Strap UVs: length along u, width along v (metres).
  const uv: number[] = [];
  const len = curve.getLength();
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 4; k++) {
      const u0 = (i / n) * len,
        u1 = ((i + 1) / n) * len,
        v0 = k * width * 0.5,
        v1 = (k + 1) * width * 0.5;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  if (!closed) for (let k = 0; k < 12; k++) uv.push(0, 0);
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  return creased(geo, 40);
}

/** Frame at a surface point: x along u, y along v, z out of the surface. */
export function frameAt(s: Surface, u: number, v: number, lift = 0) {
  const p = s.at(u, v);
  const n = normalAt(s, u, v);
  const tu = s
    .at(u + 1e-3, v)
    .sub(s.at(u - 1e-3, v))
    .normalize();
  const tv = new T.Vector3().crossVectors(n, tu).normalize();
  tu.crossVectors(tv, n).normalize();
  const m = new T.Matrix4().makeBasis(tu, tv, n);
  m.setPosition(p.addScaledVector(n, lift));
  return m;
}

/** Places a geometry authored in a local frame (z out of the surface). */
export function placed(geo: T.BufferGeometry, m: T.Matrix4) {
  geo.applyMatrix4(m);
  return geo;
}

/** A captive hex fastener: head and recessed socket, z up. */
export function fastener(radius = 0.0035) {
  const geo = lathe(
    [
      [0, radius],
      [0.0012, radius],
      [0.0018, radius * 0.8],
      [0.0018, radius * 0.45],
      [0.0011, radius * 0.4],
      [0.0011, 0],
    ],
    6,
  );
  return geo.rotateX(Math.PI / 2);
}

/** A sensor node: bezel ring with a domed lens (lens drawn separately in glow). */
export function sensor(radius: number) {
  const bezel = lathe(
    [
      [0, radius * 1.25],
      [radius * 0.25, radius * 1.3],
      [radius * 0.55, radius * 1.15],
      [radius * 0.5, radius * 0.95],
      [radius * 0.2, radius * 0.9],
      [radius * 0.2, 0],
    ],
    14,
  ).rotateX(Math.PI / 2);
  const lens = lathe(
    [
      [radius * 0.2, radius * 0.92],
      [radius * 0.45, radius * 0.7],
      [radius * 0.55, 0],
    ],
    12,
  ).rotateX(Math.PI / 2);
  return { bezel, lens };
}

/** A tension buckle: frame with a slot and a centre bar, in the strap plane. */
export function buckle(width: number, height: number, depth = 0.004) {
  const w = width / 2,
    h = height / 2,
    t = Math.min(w, h) * 0.32;
  const frame = new T.Shape(
    fillet(
      [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ],
      t * 0.8,
    ),
  );
  frame.holes.push(
    new T.Path(
      fillet(
        [
          [-w + t, -h + t],
          [w - t, -h + t],
          [w - t, -t * 0.4],
          [-w + t, -t * 0.4],
        ],
        t * 0.3,
      ),
    ),
  );
  frame.holes.push(
    new T.Path(
      fillet(
        [
          [-w + t, t * 0.4],
          [w - t, t * 0.4],
          [w - t, h - t],
          [-w + t, h - t],
        ],
        t * 0.3,
      ),
    ),
  );
  const geo = new T.ExtrudeGeometry(frame, {
    depth,
    bevelEnabled: !isLow(),
    bevelThickness: 0.0006,
    bevelSize: 0.0006,
    bevelSegments: 1,
    curveSegments: 2,
  });
  return geo;
}

// ---------------------------------------------------------------------------
// Pieces

/** Collects geometry per material for one rigid piece. */
export class Piece {
  private parts = new Map<ArmorMaterial, T.BufferGeometry[]>();
  readonly name: string;
  readonly slot: ArmorSlot;
  readonly bone: string;
  constructor(name: string, slot: ArmorSlot, bone: string) {
    this.name = name;
    this.slot = slot;
    this.bone = bone;
  }
  add(m: ArmorMaterial, geo: T.BufferGeometry) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) {
      g.setAttribute(
        "uv",
        new T.Float32BufferAttribute(
          boxUV(g.attributes.position as T.BufferAttribute),
          2,
        ),
      );
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    // Only the three attributes every part carries can merge.
    const clean = new T.BufferGeometry();
    for (const k of ["position", "normal", "uv"])
      clean.setAttribute(k, g.attributes[k]);
    g = clean;
    const list = this.parts.get(m) ?? [];
    list.push(g);
    this.parts.set(m, list);
    return this;
  }
  finish(): ArmorPiece {
    const parts: ArmorPiece["parts"] = {};
    for (const [m, list] of this.parts) parts[m] = mergeGeometries(list)!;
    return { name: this.name, slot: this.slot, bone: this.bone, parts };
  }
}

/** Metre-scaled box projection for small parts that have no authored UVs. */
function boxUV(p: T.BufferAttribute) {
  const uv = new Float32Array(p.count * 2);
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax =
      Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z)
        ? 0
        : Math.abs(n.y) > Math.abs(n.z)
          ? 1
          : 2;
    for (let k = 0; k < 3; k++) {
      const q = [a, b, c][k];
      const [x, y] = ax === 0 ? [q.z, q.y] : ax === 1 ? [q.x, q.z] : [q.x, q.y];
      uv[(i + k) * 2] = x;
      uv[(i + k) * 2 + 1] = y;
    }
  }
  return uv;
}

/** Right-side copy of a left piece: x mirrored, triangles re-wound. */
export function mirrorPiece(p: ArmorPiece): ArmorPiece {
  const parts: ArmorPiece["parts"] = {};
  for (const [m, g] of Object.entries(p.parts) as [
    ArmorMaterial,
    T.BufferGeometry,
  ][]) {
    const c = g.clone();
    c.scale(-1, 1, 1);
    for (const attr of Object.values(c.attributes)) {
      const a = attr as T.BufferAttribute,
        n = a.itemSize;
      for (let t = 0; t + 2 < a.count; t += 3)
        for (let k = 0; k < n; k++) {
          const i = (t + 1) * n + k,
            j = (t + 2) * n + k;
          [a.array[i], a.array[j]] = [a.array[j], a.array[i]];
        }
    }
    parts[m] = c;
  }
  const swap = (s: string) =>
    s.replace(
      /Left|Right|left|right/g,
      (w) =>
        ({ Left: "Right", Right: "Left", left: "right", right: "left" })[w]!,
    );
  return { name: swap(p.name), slot: p.slot, bone: swap(p.bone), parts };
}

/** Left piece and its mirror. */
export const pair = (p: ArmorPiece) => [p, mirrorPiece(p)];

export function triangles(set: ArmorSet | ArmorPiece[]) {
  const pieces = Array.isArray(set) ? set : set.pieces;
  let n = 0;
  for (const p of pieces)
    for (const g of Object.values(p.parts))
      n += (g as T.BufferGeometry).attributes.position.count / 3;
  return n;
}

/** Preview materials. Names follow `paintArmor`'s matching, so the shipped
 * finishes recolour them: plate = primary, metal = secondary, glow = accent. */
export function armorMaterials(): Record<
  ArmorMaterial,
  T.MeshStandardMaterial
> {
  return {
    plate: new T.MeshStandardMaterial({
      name: "Armor / plate ceramic",
      color: 0x1a1d20,
      metalness: 0.15,
      roughness: 0.46,
    }),
    suit: new T.MeshStandardMaterial({
      name: "Armor / suit weave",
      color: 0x101214,
      metalness: 0,
      roughness: 0.9,
    }),
    metal: new T.MeshStandardMaterial({
      name: "Armor / titanium and markings",
      color: 0x3a4146,
      metalness: 0.75,
      roughness: 0.34,
    }),
    glow: new T.MeshStandardMaterial({
      name: "Armor / identification glow",
      color: 0x7fe3ef,
      emissive: 0x7fe3ef,
      emissiveIntensity: 1.2,
      metalness: 0.1,
      roughness: 0.3,
    }),
  };
}

/** Three.js group of a set in rest space, one mesh per piece and material,
 * each tagged with its bone and slot (for previews and for later skinning). */
export function armorGroup(set: ArmorSet, materials = armorMaterials()) {
  const root = new T.Group();
  root.name = `armor-${set.tier}-${set.sex}`;
  for (const p of set.pieces)
    for (const [m, g] of Object.entries(p.parts) as [
      ArmorMaterial,
      T.BufferGeometry,
    ][]) {
      const mesh = new T.Mesh(g, materials[m]);
      mesh.name = `${p.name} / ${m}`;
      mesh.userData = {
        armorBone: p.bone,
        armorSlot: p.slot,
        armorPiece: p.name,
      };
      root.add(mesh);
    }
  return root;
}

// ---------------------------------------------------------------------------
// Shared assemblies

/** (u, v) in degrees → radians, for sphere and limb outlines. */
export const deg =
  (map: (a: number, b: number) => [number, number], du = 0, angleV = true) =>
  (a: number, b: number): [number, number] => {
    const [u, v] = map(a, b);
    return [(u + du) * DEG, angleV ? v * DEG : v];
  };

/** Strap from a front point over the trapezius to a back point. */
export function overShoulder(
  fit: BodyFit,
  front: T.Vector3,
  back: T.Vector3,
  side: number,
) {
  const neck = fit.bone("Neck"),
    shoulder = fit.bone(side > 0 ? "LeftShoulder" : "RightShoulder");
  const top = V(
    lerp(neck.x, shoulder.x, 0.5) + side * 0.045,
    neck.y + 0.012,
    neck.z - 0.005,
  );
  const pts = [
    front,
    front
      .clone()
      .lerp(top, 0.55)
      .add(V(0, 0.012, 0.02)),
    top,
    back
      .clone()
      .lerp(top, 0.55)
      .add(V(0, 0.012, -0.02)),
    back,
  ];
  const centre = V(neck.x, neck.y - 0.12, neck.z);
  return ribbon(pts, 0.032, 0.004, (q) => q.clone().sub(centre));
}

/** Diagonal cloth wraps: tilted overlapping bands, like a bound limb. */
export function wraps(
  p: Piece,
  s: Surface,
  t0: number,
  t1: number,
  count: number,
) {
  const step = (t1 - t0) / count;
  for (let k = 0; k < count; k++) {
    const t = t0 + step * (k + 0.5);
    p.add(
      "suit",
      plate(s, {
        map: (a, b) => [
          a * 2 * Math.PI,
          t + (b - 0.5) * step * 1.2 + step * 0.35 * Math.sin(a * 2 * Math.PI),
        ],
        cols: 12,
        rows: 2,
        skin: true,
        thickness: 0.0035 + 0.0006 * (k % 2),
        ringA: true,
        roll: 0.2,
      }),
    );
  }
}

export { V };
