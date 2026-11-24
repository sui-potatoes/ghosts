// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What lies beyond a level's grid, so it does not float in fog: per side, a
 * street running on (asphalt, raised pavements, lane paint, poles and
 * cables) and a row of narrow buildings with lit windows, or just the row;
 * a few distant towers behind everything. No gameplay and no shadows; every
 * side is merged into a handful of meshes (one per material).
 */
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { propRandom } from "../environment.ts";
import { drawFront, drawUpper, FRONT, GLOWS, pickFront, type Brush, type FrontKind } from "./fronts.ts";
import { SignAtlas } from "./signs.ts";

export type SurroundSide = "street" | "buildings" | "none";
export interface Surroundings {
  north?: SurroundSide; south?: SurroundSide; east?: SurroundSide; west?: SurroundSide;
  seed?: number;
}
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

const tones = [0xc8bfae, 0x7c7f7a, 0x8a6a52, 0x9aa49a, 0x6e6a64, 0xa8a196, 0x5e5a56];

/** Where the level’s own roadway meets a side, as world ranges along that edge: the street beyond opens there. */
export type RoadMouths = Partial<Record<"north" | "south" | "east" | "west", [from: number, to: number][]>>;

/** The row buildings of a built surroundings group, each with its bounds: what a view cuts away in front of the camera. */
export const surroundingBuildings = (surroundings: T.Group) =>
  (surroundings.userData.buildings ?? []) as { group: T.Group; bounds: T.Box3 }[];

/** Builds the surroundings into a group; dispose its geometries and materials with it. */
export function buildSurroundings(bounds: Bounds, sides: Surroundings, mouths: RoadMouths = {}): T.Group {
  const random = propRandom(sides.seed ?? 11);
  const parts = new Map<number, T.BufferGeometry[]>();
  // A building in a row collects its own boxes: it stands as one group, so the view can cut it away.
  let building: Map<number, T.BufferGeometry[]> | null = null;
  // Its lettering planes, by ink.
  let lettering: Map<number, T.BufferGeometry[]> | null = null;
  const MATTE = -1, tint = new T.Color();
  // Everything in a row building that does not glow is one vertex-coloured material: one draw call for all its paint, not one per colour.
  const add = (color: number, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const g = new T.BoxGeometry(w, h, d).translate(x, y, z), into = building ?? parts;
    let key = color;
    if (building && !GLOWS.has(color)) {
      key = MATTE;
      tint.setHex(color);
      const n = g.getAttribute("position").count, colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) tint.toArray(colors, i * 3);
      g.setAttribute("color", new T.BufferAttribute(colors, 3));
    }
    (into.get(key) ?? into.set(key, []).get(key)!).push(g);
  };
  const LIT = FRONT.lit, COLD = FRONT.cold, DARK = FRONT.dark;
  const materials = new Map<number, T.MeshStandardMaterial>();
  const material = (color: number) => {
    if (color === MATTE) return materials.get(MATTE) ?? materials.set(MATTE, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })).get(MATTE)!;
    const lit = GLOWS.has(color);
    return materials.get(color) ?? materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.9, ...(lit ? { emissive: color, emissiveIntensity: 0.8 } : {}) })).get(color)!;
  };
  let atlas: SignAtlas | undefined;
  const merged = (color: number, geometries: T.BufferGeometry[], m: T.Material = material(color)) => {
    const geometry = mergeGeometries(geometries);
    for (const g of geometries) g.dispose();
    const mesh = new T.Mesh(geometry, m);
    mesh.receiveShadow = false; mesh.castShadow = false;
    return mesh;
  };
  const group = new T.Group();
  group.name = "surroundings";
  const buildings: { group: T.Group; bounds: T.Box3 }[] = [];
  group.userData.buildings = buildings;
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = { x: (bounds.maxX - bounds.minX) / 2, z: (bounds.maxZ - bounds.minZ) / 2 };
  const lines: number[] = [];
  /** A side as a local frame: u runs along the edge, v outward from it. */
  const side = (name: keyof Surroundings, kind: SurroundSide | undefined) => {
    if (!kind || kind === "none") return;
    const along = name === "north" || name === "south" ? "x" : "z";
    const out = name === "north" || name === "west" ? -1 : 1;
    const length = (along === "x" ? half.x : half.z) * 2 + 60;
    const edge = along === "x" ? (out < 0 ? bounds.minZ : bounds.maxZ) : (out < 0 ? bounds.minX : bounds.maxX);
    const put = (color: number, u: number, y: number, v: number, w: number, h: number, d: number) => {
      const at = edge + out * v, c = along === "x" ? cx : cz;
      if (along === "x") add(color, c + u, y, at, w, h, d);
      else add(color, at, y, c + u, d, h, w);
    };
    // The face's frame for a frontage: its x runs with u on the north and east sides, against it on the others (so lettering reads left to right from outside).
    const sign = along === "x" ? -out : out, turn = along === "x" ? (out > 0 ? Math.PI : 0) : -out * Math.PI / 2;
    const brush = (u0: number, face: number): Brush => ({
      box: (c, x, y, z, w, h, d) => put(c, u0 + sign * x, y, face - z, w, h, d),
      glyph: (id, ink, x, y, z, w, h, yaw = 0) => {
        atlas ??= new SignAtlas();
        const [gw, gh] = atlas.fit(id, w, h), g = atlas.plane(id, gw, gh).clone().rotateY(turn + yaw);
        const at = edge + out * (face - z), c = (along === "x" ? cx : cz) + u0 + sign * x;
        if (along === "x") g.translate(c, y, at); else g.translate(at, y, c);
        (lettering!.get(ink) ?? lettering!.set(ink, []).get(ink)!).push(g);
      },
    });
    let previous: FrontKind | undefined;
    let v = 0.5;
    if (kind === "street") {
      // The near pavement, broken where the level’s roadway runs out into this street: a junction, not a kerb across the road.
      const c0 = along === "x" ? cx : cz;
      const open = (mouths[name as keyof RoadMouths] ?? []).map(([a, b]): readonly [number, number] => [a - c0, b - c0]).sort((p, q) => p[0] - q[0]);
      const inMouth = (u: number) => open.some(([a, b]) => u > a - 0.6 && u < b + 0.6);
      let from = -length / 2;
      for (const [a, b] of [...open, [length / 2, length / 2] as readonly [number, number]]) {
        if (a > from) put(0x6a6c68, (from + a) / 2, 0.08, v + 1.5, a - from, 0.16, 3);
        if (b > a) put(0x24272b, (a + b) / 2, -0.005, v + 1.5 - 0.25, b - a, 0.01, 3.5);
        from = Math.max(from, b);
      }
      put(0x24272b, 0, -0.005, v + 3 + 4.5, length, 0.01, 9);
      for (let u = -length / 2; u < length / 2; u += 6) put(0xb8b5a2, u, 0.004, v + 7.5, 3, 0.01, 0.15);
      put(0x6a6c68, 0, 0.08, v + 13.5, length, 0.16, 3);
      for (let u = -length / 2 + 4; u < length / 2; u += 22) {
        if (inMouth(u)) continue;
        put(0x9a9890, u, 4.3, v + 2.6, 0.24, 8.6, 0.24);
        put(0x4a4e52, u, 7.25, v + 2.6, 1.3, 0.1, 0.1);
      }
      // Overhead lines between the poles.
      for (let u = -length / 2 + 4; u + 22 < length / 2; u += 22) for (const dv of [-0.45, 0, 0.45]) for (let k = 0; k < 10; k++) {
        for (const t of [k / 10, (k + 1) / 10]) {
          const uu = u + 22 * t, vv = edge + out * (v + 2.6 + dv), y = 7.25 - 1.2 * 4 * t * (1 - t);
          const c = along === "x" ? cx : cz;
          if (along === "x") lines.push(c + uu, y, vv); else lines.push(vv, y, c + uu);
        }
      }
      v += 15;
    }
    // A row of narrow buildings, two to four tiles wide, two to six storeys, small gaps between.
    // The camera starts south-east of the field looking north-west: the south and east rows stay low so they never wall it off.
    const tallest = name === "south" || name === "east" ? 2 : 6;
    const [lo, hi] = along === "x" ? (["west", "east"] as const) : (["north", "south"] as const);
    const reach = along === "x" ? half.x : half.z;
    // The north and south rows own the corners; an east or west row stops at the grid’s ends when a side is built there.
    const taken = (s: SurroundSide | undefined) => !!s && s !== "none";
    const crossed = (a: number, z: number) => along === "z"
      ? (taken(sides[lo]) && a < -reach) || (taken(sides[hi]) && z > reach)
      : (sides[lo] === "street" && z > -reach - 15.5 && a < -reach) || (sides[hi] === "street" && a < reach + 15.5 && z > reach);
    for (let u = -length / 2; u < length / 2;) {
      const w = 2.7 + random() * 3, h = (2 + Math.floor(random() * (tallest - 1))) * 3, d = 8 + random() * 4;
      // A street on a neighbouring side runs across this row: leave it clear, kerb to kerb.
      if (crossed(u - 0.5, u + w + 0.5)) { u += w + 0.15; continue; }
      building = new Map(); lettering = new Map();
      put(tones[Math.floor(random() * tones.length)], u + w / 2, h / 2, v + d / 2, w, h, d);
      put(0x2a2c2f, u + w / 2, h + 0.05, v + d / 2, w, 0.1, d);
      for (let f = 1; f < h / 3; f++) for (let x = u + 0.6; x < u + w - 0.5; x += 1.1) {
        const on = random();
        put(on < 0.22 ? LIT : on < 0.32 ? COLD : DARK, x + 0.3, f * 3 + 1.5, v - 0.02, 0.6, 1.1, 0.04);
      }
      // A ground floor with a human door in it, never the same front as its neighbour; a little on the floors above.
      const draw = brush(u + w / 2, v);
      previous = pickFront(random, w, previous);
      drawFront(previous, draw, w, random, 0.3, h >= 6 && random() < 0.4);
      for (let f = 1; f < h / 3; f++) if (random() < 0.12) drawUpper(draw, sign * (u + 0.9 + Math.floor(random() * Math.max(1, w - 1.6)) - (u + w / 2)), f * 3, random);
      const block = new T.Group();
      block.name = "surrounding building";
      for (const [color, geometries] of building) block.add(merged(color, geometries));
      for (const [ink, geometries] of lettering) block.add(merged(ink, geometries, atlas!.glyphs(ink, "print")));
      building = null; lettering = null;
      group.add(block);
      buildings.push({ group: block, bounds: new T.Box3().setFromObject(block) });
      u += w + 0.15 + random() * 0.4;
    }
  };
  for (const name of ["north", "south", "east", "west"] as const) side(name, sides[name]);
  // Distant towers on the skyline, a few lit windows each.
  for (let i = 0; i < 9; i++) {
    const a = random() * Math.PI * 2, r = 80 + random() * 60, w = 10 + random() * 14, h = 30 + random() * 50;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    add(0x2e3238, x, h / 2, z, w, h, w);
    for (let k = 0; k < 14; k++) add(random() < 0.6 ? LIT : COLD, x + (random() - 0.5) * w, 4 + random() * (h - 6), z + (z > cz ? -1 : 1) * (w / 2 + 0.05), 1.2, 1.6, 0.1);
  }
  for (const [color, geometries] of parts) group.add(merged(color, geometries));
  if (lines.length) group.add(new T.LineSegments(new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(lines, 3)),
    new T.LineBasicMaterial({ color: 0x0c0d0f })));
  return group;
}
