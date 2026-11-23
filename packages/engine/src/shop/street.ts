// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The street side: shopfront props, the coin car park (fence runs, wheel
 * stops, painted bays, a pay station), the no-smoking signs with their
 * smoking-area ashtray, the glazed storefront's automatic door and building
 * masses for blocks nobody enters (the storefront glass and doors are in
 * `storefront.ts`). Fence sections carry a post at
 * both ends, square and centred on the edge's end points, so neighbouring
 * sections and 90° turns share one post exactly instead of doubling up.
 */
import * as T from "three";
import { paintBox } from "../road-paint.ts";
import { C, H, type Build } from "./kit.ts";

const glow = (b: Build, color: number, strength = 1.2) => b.kit.material(color, 0, 0.4, strength, color);

// ---------------------------------------------------------------------------
// Shopfront.

export function aFrame(b: Build) {
  const board = b.kit.material(0x23201d, 0, 0.9), chalk = b.kit.material(0xe8e0cc, 0, 0.9);
  for (const s of [-1, 1]) {
    const leaf = b.frame(s > 0 ? 0 : Math.PI);
    const g = new T.Group(); g.rotation.x = -0.2; g.position.z = 0.0; leaf.add(g);
    b.box(0, 0.45, 0.09, 0.52, 0.9, 0.03, b.wood, g);
    b.box(0, 0.47, 0.106, 0.44, 0.74, 0.004, board, g);
    b.sign("kissaten", -0.12, 0.62, 0.109, 0.11, 0.26, g);
    for (let i = 0; i < 5; i++) b.box(0.08, 0.72 - i * 0.07, 0.109, 0.14 + b.random() * 0.06, 0.012, 0.002, chalk, g);
    b.item("can", 0x9a3a2f, 0.05, 0.25, 0.11, 0.12, 0.002, 0.12, g).rotation.x = Math.PI / 2;
  }
}

export function sampleCase(b: Build) {
  const glass = b.kit.glass(0xd8e6ea, 0.15), plates = [0xe6e1d6, 0x2c3a5a, 0x2c2a28];
  b.box(0, 0.35, 0, 1.2, 0.7, 0.5, b.wood);
  b.box(0, 0.06, 0.02, 1.18, 0.12, 0.48, b.woodTrim);
  b.box(0, 0.705, 0, 1.22, 0.02, 0.52, b.woodTrim);
  for (const x of [-0.6, 0.6]) for (const z of [-0.24, 0.24]) b.box(x, 0.93, z, 0.02, 0.44, 0.02, b.chrome);
  b.box(0, 1.15, 0, 1.22, 0.02, 0.52, b.woodTrim);
  b.box(0, 0.93, 0.245, 1.18, 0.42, 0.006, glass);
  b.box(0, 1.135, 0.12, 1.1, 0.012, 0.05, glow(b, 0xfff0d8, 0.9));
  for (let i = 0; i < 5; i++) for (const z of [-0.1, 0.1]) {
    const x = -0.46 + i * 0.23, kind = b.random();
    b.item("can", b.pick(plates), x, 0.715, z, 0.18, 0.012, 0.18);
    if (kind < 0.35) { b.item("cup", 0x2c2a28, x, 0.727, z, 0.15, 0.07, 0.15); b.item("can", 0xb8743a, x, 0.79, z, 0.13, 0.01, 0.13); }
    else if (kind < 0.65) b.item("box", 0xc48a44, x, 0.727, z, 0.12, 0.03, 0.08);
    else if (kind < 0.85) { b.item("can", 0x8a5a2a, x, 0.727, z, 0.14, 0.02, 0.14); b.item("ball", 0xe6e1d3, x, 0.745, z, 0.07, 0.04, 0.07); }
    else b.item("cup", 0xe8dcc8, x, 0.727, z, 0.07, 0.16, 0.07);
  }
}

// ---------------------------------------------------------------------------
// Car park fences: edge sections, a post on each end.

const galvanised = (b: Build) => b.kit.material(0xa9b2b4, 0.6, 0.42);

function posts(b: Build, height: number, m: T.Material, square = 0) {
  for (const x of [-H, H]) {
    if (square) b.box(x, height / 2, 0, square, height, square, m);
    else { b.cyl(x, height / 2, 0, 0.035, height, m, 8); b.cyl(x, height + 0.01, 0, 0.04, 0.02, m, 8); }
  }
}

export function railGuard(b: Build) {
  const steel = galvanised(b);
  posts(b, 0.8, steel);
  for (const y of [0.45, 0.76]) b.cyl(0, y, 0, 0.024, C, steel, 8).rotation.z = Math.PI / 2;
  b.box(0, 0.62, 0.03, 0.08, 0.05, 0.004, b.kit.material(0xd27a2c, 0.1, 0.5));
}

export function railChain(b: Build) {
  const yellow = b.kit.material(0xd9a52b, 0, 0.6), black = b.kit.material(0x1c1c1c, 0, 0.6);
  for (const x of [-H, H]) {
    b.cyl(x, 0.3, 0, 0.05, 0.6, yellow, 10);
    for (const y of [0.2, 0.42]) b.cyl(x, y, 0, 0.052, 0.06, black, 10);
    b.cyl(x, 0.61, 0, 0.055, 0.03, black, 10);
  }
  const n = 14;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = -H + 0.05 + t * (C - 0.1), y = 0.52 - Math.sin(t * Math.PI) * 0.16;
    const link = b.box(x, y, 0, 0.075, 0.025, 0.012, i % 2 ? yellow : black);
    link.rotation.set(i % 2 ? Math.PI / 2 : 0, 0, Math.cos(t * Math.PI) * 0.45);
  }
}

export function railMesh(b: Build) {
  const green = b.kit.material(0x3e5a4a, 0.3, 0.55);
  posts(b, 1.8, green, 0.06);
  for (const y of [0.08, 1.76]) b.box(0, y, 0, C, 0.04, 0.03, green);
  for (let x = -H + 0.1; x < H - 0.05; x += 0.1) b.box(x, 0.92, 0, 0.006, 1.66, 0.006, green);
  for (let y = 0.25; y < 1.7; y += 0.2) b.box(0, y, 0.004, C, 0.006, 0.006, green);
  b.sign("monthly", 0, 1.3, 0.012, 0.36, 0.12);
}

export const railGap = (b: Build) => { posts(b, 0.8, galvanised(b)); };

export function wheelStop(b: Build) {
  const concrete = b.kit.material(0x9c9a92, 0, 0.92), yellow = b.kit.material(0xd9a52b, 0, 0.7);
  b.box(0, 0.06, -0.42, 0.62, 0.12, 0.15, concrete);
  for (const x of [-0.18, 0.18]) b.box(x, 0.121, -0.42, 0.12, 0.004, 0.14, yellow);
  for (const x of [-0.24, 0.24]) b.cyl(x, 0.123, -0.42, 0.012, 0.006, b.steel, 6);
}

/** Bay paint along the cell's west edge (and its north edge for the bay's end). */
export function bayLine(b: Build, end: boolean) {
  const paint = b.kit.paint(0xe6e3d6), { y, height } = paintBox(0);
  b.box(-H + 0.05, y, 0, 0.1, height, C, paint).castShadow = false;
  if (end) b.box(0.05, y, -H + 0.05, C - 0.1, height, 0.1, paint).castShadow = false;
}

export function payStation(b: Build) {
  const shell = b.kit.material(0x3a4046, 0.4, 0.5), face = b.kit.material(0x5a646c, 0.4, 0.45);
  const screen = b.kit.material(0x183b48, 0.1, 0.5, 0.65);
  b.box(0, 0.03, 0, 0.42, 0.06, 0.34, b.dark);
  b.box(0, 0.64, 0, 0.34, 1.2, 0.26, shell);
  b.box(0, 0.78, 0.131, 0.3, 0.7, 0.004, face);
  b.box(0, 1.0, 0.134, 0.18, 0.1, 0.003, screen);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) b.box(-0.04 + c * 0.04, 0.84 - r * 0.035, 0.136, 0.03, 0.025, 0.006, b.steel);
  b.box(0.1, 0.84, 0.136, 0.05, 0.012, 0.006, b.dark);
  b.box(0, 0.6, 0.134, 0.14, 0.02, 0.006, b.dark);
  b.box(0, 0.36, 0.134, 0.2, 0.12, 0.004, b.dark);
  b.box(0, 1.4, 0, 0.52, 0.22, 0.08, shell);
  b.sign("parking", -0.06, 1.4, 0.042, 0.34, 0.16, b.root, "lit");
  b.sign(b.variant % 3 === 2 ? "full" : "vacant", 0.18, 1.4, 0.042, 0.12, 0.12, b.root, "lit");
}

// ---------------------------------------------------------------------------
// No smoking.

/** The red ring and slash over a cigarette, `r` in radius, facing +z. `paint` lays the film flat. */
function noSmoking(b: Build, parent: T.Object3D, r: number, paint = false) {
  const red = paint ? b.kit.paint(0xc8302a) : b.kit.material(0xc8302a, 0, 0.6);
  const white = paint ? b.kit.paint(0xece9e0) : b.kit.material(0xf2f0ea, 0, 0.6);
  const grey = paint ? b.kit.paint(0x8a8f92) : b.kit.material(0x6a6f72, 0, 0.7);
  const t = paint ? 0.003 : 0.004;
  if (!paint) b.cyl(0, 0, 0, r, t, white, 24, parent).rotation.x = Math.PI / 2;
  const segments = 28;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const seg = b.box(Math.sin(a) * r * 0.88, Math.cos(a) * r * 0.88, t, r * 0.24, r * 0.21, t, red, parent);
    seg.rotation.z = -a;
  }
  b.box(-r * 0.08, -r * 0.08, t * 1.5, r * 1.2, r * 0.16, t, white, parent);
  b.box(r * 0.42, -r * 0.08, t * 1.6, r * 0.22, r * 0.16, t, grey, parent);
  for (let i = 0; i < 3; i++) b.box(r * 0.42 + (i - 1) * 0.04 * r, r * (0.2 + i * 0.12), t * 1.6, r * 0.05, r * 0.1, t, grey, parent).rotation.z = 0.4;
  b.box(0, 0, t * 2.2, r * 1.75, r * 0.18, t, red, parent).rotation.z = -Math.PI / 4;
}

export function noSmokingPlate(b: Build) {
  b.box(0, 0, 0, 0.32, 0.5, 0.012, b.kit.material(0xf2f0ea, 0, 0.6));
  const g = b.frame(0, 0, 0.007); g.position.y = 0.08;
  noSmoking(b, g, 0.12);
  b.sign("no-smoking", 0, -0.15, 0.008, 0.26, 0.1);
}

export function noSmokingPole(b: Build) {
  b.cyl(0, 0.04, 0, 0.2, 0.08, b.kit.material(0x6a6a66, 0, 0.9), 16);
  b.cyl(0, 1.0, 0, 0.03, 1.92, b.steel, 8);
  for (const s of [1, -1]) {
    const g = b.frame(s > 0 ? 0 : Math.PI, 0, s * 0.035); g.position.y = 1.72;
    noSmoking(b, g, 0.2);
    const band = b.sign("street-smoking", 0, 1.38, s * 0.035, 0.48, 0.12);
    if (s < 0) band.rotation.y = Math.PI;
  }
}

export function noSmokingPaint(b: Build) {
  const g = new T.Group(); g.rotation.x = -Math.PI / 2; g.position.set(0, paintBox(0).y + 0.003, -0.12); b.root.add(g);
  noSmoking(b, g, 0.36, true);
  b.sign("street-smoking-paint", 0, 0.008, 0.38, 1.05, 0.2, b.root, "paint");
}

export function ashtrayStand(b: Build) {
  b.cyl(0, 0.33, 0, 0.16, 0.66, b.steel, 14);
  b.cyl(0, 0.67, 0, 0.18, 0.025, b.dark, 14);
  b.cyl(0, 0.685, 0, 0.14, 0.01, b.kit.material(0x8a8478, 0, 0.95), 14);
  for (let i = 0; i < 5; i++) b.item("box", 0xe9e4d5, (b.random() - 0.5) * 0.18, 0.69, (b.random() - 0.5) * 0.18, 0.01, 0.01, 0.035).rotation.y = b.random() * 3;
  b.cyl(0.32, 0.55, -0.1, 0.02, 1.1, b.steel, 6);
  b.sign("smoking-area", 0.32, 1.12, -0.085, 0.36, 0.11);
}

// ---------------------------------------------------------------------------
// Storefront glazing and buildings.

const STOREY = 3;

/**
 * One cell of a building mass, `floors` storeys. Adjacent cells abut on the
 * cell edges with the same window grid (two bays per cell), so a block of
 * them reads as one building; lit windows, AC units and roof clutter are
 * seeded per cell, and the roof has no per-cell parapet to seam.
 */
export function building(b: Build, floors: number) {
  // A block's style comes from its seed (the play view gives every cell of a block the same one),
  // so a row of blocks reads as separate buildings put up at different times.
  const style = b.variant % 4;
  const tile = b.kit.material([0xc8bfae, 0x7c7f7a, 0x8a6a52, 0x9aa49a][style], 0, 0.88), h = floors * STOREY;
  const window = b.kit.material(style % 2 ? 0x1a2228 : 0xb8c4c6, style % 2 ? 0.5 : 0.1, style % 2 ? 0.2 : 0.6);
  const lit = glow(b, 0xe8d6b0, 0.75), litCold = glow(b, 0xc8e4ec, 0.7);
  const ac = b.kit.material(0xc8c6be, 0.2, 0.6), slab = b.kit.material(0x5a5650, 0, 0.9), rail = b.kit.material(0x6a6e72, 0.5, 0.5);
  b.box(0, h / 2, 0, C, h, C, tile);
  for (let f = 0; f < floors; f++) {
    const y = f * STOREY;
    for (const yaw of b.outsideFaces()) {
      const face = b.frame(yaw);
      b.box(0, y + 0.06, H + 0.012, C, 0.12, 0.024, slab, face);
      if (f === 0 && floors > 1) {
        if (style % 2 === 0) {
          // A roll-down shutter.
          b.box(0, 1.2, H + 0.02, C - 0.2, 2.2, 0.03, b.kit.material(0x8a8e90, 0.5, 0.5), face);
          for (let k = 0; k < 10; k++) b.box(0, 0.2 + k * 0.2, H + 0.037, C - 0.2, 0.01, 0.004, b.dark, face);
        } else {
          // A small shop front: dark glass under a coloured awning.
          b.box(0, 1.1, H + 0.01, C - 0.12, 2.0, 0.02, b.kit.material(0x23292d, 0.4, 0.3), face);
          b.box(0, 2.35, H + 0.3, C, 0.06, 0.6, b.kit.material(b.pick([0x7a2a2a, 0x2a4a3a, 0x3a3a5a, 0xa8823a]), 0, 0.7), face).rotation.x = 0.25;
        }
        continue;
      }
      for (const x of [-0.34, 0.34]) {
        const on = b.random() < 0.28;
        b.box(x, y + 1.5, H + 0.008, 0.48, 1.25, 0.016, on ? (b.random() < 0.5 ? lit : litCold) : window, face);
        b.box(x, y + 1.5, H + 0.018, 0.012, 1.25, 0.006, rail, face);
        b.box(x, y + 0.86, H + 0.03, 0.54, 0.04, 0.06, slab, face);
        if (!on && b.random() < 0.18) b.box(x + 0.05, y + 0.72, H + 0.15, 0.4, 0.3, 0.26, ac, face);
      }
      if (style === 0) b.box(0, y + 1.0, H + 0.35, C, 0.04, 0.04, rail, face);
      if (style === 2 && b.random() < 0.5) {
        b.box(0, y + 2.1, H + 0.3, C - 0.1, 0.02, 0.02, rail, face);
        for (let k = 0; k < 3; k++) b.item("box", b.pick([0xe8e6de, 0x5a6b7a, 0xc8b8a0]), -0.4 + k * 0.4, y + 1.6, H + 0.3, 0.3, 0.5, 0.01, face);
      }
    }
  }
  // A quiet dark roof, flush cell to cell, the coping band only along the outside faces.
  // No plant on the roof: the play view sets at most one recognisable object per building.
  const roof = b.kit.material(0x2a2c2f, 0, 0.95), coping = b.kit.material(0x4a4b4c, 0, 0.9);
  b.box(0, h + 0.006, 0, C, 0.012, C, roof);
  for (const yaw of b.outsideFaces()) b.box(0, h - 0.115, H + 0.02, C, 0.22, 0.04, coping, b.frame(yaw));
  if (floors >= 2 && b.variant === 1 && b.faces & 1) {
    const sign = b.frame(0);
    b.sign(b.random() < 0.5 ? "for-rent" : "tenants", 0.5, STOREY + 1.4, H + 0.06, 0.32, 1.4, sign, "lit");
  }
}

// ---------------------------------------------------------------------------
// Street cover: bins, condensers, shelters, a roll cage.

/** The paired street recycling bins: cans and bottles, PET, with their coloured mouths. */
export function recyclingBins(b: Build) {
  const shell = b.kit.material(0x6f7a7c, 0.5, 0.45);
  for (const [x, mouth] of [[-0.25, 0x2f6fa8], [0.25, 0xd9a52b]] as const) {
    b.box(x, 0.45, -0.1, 0.44, 0.9, 0.42, shell);
    b.box(x, 0.905, -0.1, 0.46, 0.02, 0.44, b.dark);
    b.cyl(x, 0.75, 0.115, 0.08, 0.012, b.kit.material(mouth, 0.1, 0.6), 14).rotation.x = Math.PI / 2;
    b.cyl(x, 0.75, 0.118, 0.055, 0.012, b.dark, 14).rotation.x = Math.PI / 2;
    b.box(x, 0.35, 0.112, 0.3, 0.2, 0.004, b.kit.material(mouth, 0.1, 0.6));
  }
  b.box(0, 0.02, -0.1, 0.96, 0.04, 0.46, b.dark);
}

export function dumpster(b: Build) {
  const steel = b.kit.material(b.pick([0x3e5a4a, 0x5a4a3a, 0x3a4a5a]), 0.5, 0.6), rust = b.kit.material(0x6a4a32, 0.2, 0.9);
  b.box(0, 0.58, 0, 1.2, 1.0, 0.82, steel);
  for (const x of [-0.45, 0, 0.45]) b.box(x, 0.58, 0.415, 0.06, 1.0, 0.02, steel);
  const lid = b.part("bin-lid", 0, 1.09, -0.02);
  for (const x of [-0.3, 0.3]) b.box(x, 0, 0, 0.58, 0.05, 0.86, b.dark, lid);
  for (const x of [-0.5, 0.5]) for (const z of [-0.3, 0.3]) b.cyl(x, 0.05, z, 0.05, 0.08, b.dark, 8).rotation.z = Math.PI / 2;
  for (let i = 0; i < 5; i++) b.box((b.random() - 0.5) * 1.0, 0.2 + b.random() * 0.7, 0.42, 0.05 + b.random() * 0.12, 0.03, 0.004, rust);
}

/**
 * Outdoor condensers against the wall on the cell's north edge (turn 0): the
 * long side runs along it a hand's width off, the fan grille faces +z into
 * the cell, the pipes run up the wall.
 */
export function acUnit(b: Build, stacked: boolean) {
  const shell = b.kit.material(0xcfccc2, 0.2, 0.55), grille = b.kit.material(0x3a3e40, 0.4, 0.5), z = -H + 0.26;
  const rack = b.kit.material(0x5a5e60, 0.6, 0.5);
  const one = (y: number) => {
    b.box(0, y + 0.31, z, 0.82, 0.62, 0.3, shell);
    b.cyl(-0.12, y + 0.31, z + 0.152, 0.24, 0.01, grille, 20).rotation.x = Math.PI / 2;
    for (const a of [0, Math.PI / 2]) b.box(-0.12, y + 0.31, z + 0.16, 0.46, 0.018, 0.008, b.steel).rotation.z = a + Math.PI / 4;
    b.box(0.3, y + 0.31, z + 0.152, 0.16, 0.5, 0.006, b.kit.material(0xb8b4aa, 0.2, 0.6));
  };
  b.box(0, 0.06, z, 0.9, 0.12, 0.34, rack);
  one(0.13);
  if (stacked) {
    for (const x of [-0.43, 0.43]) b.box(x, 0.72, z, 0.04, 1.44, 0.04, rack);
    b.box(0, 0.8, z, 0.9, 0.04, 0.34, rack);
    one(0.82);
  }
  // Refrigerant lines up the wall.
  for (const x of [0.36, 0.4]) {
    b.cyl(x, stacked ? 1.95 : 1.5, -H + 0.05, 0.015, stacked ? 1.1 : 1.2, b.kit.material(0xd8d4c8, 0, 0.7), 6);
    b.box(x, stacked ? 1.4 : 0.9, -H + 0.08, 0.03, 0.03, 0.06, b.kit.material(0xd8d4c8, 0, 0.7));
  }
}

/**
 * A shelter module on the edge of its back panel: glass back, roof reaching
 * over the cell in front, a bench. Modules share their square end posts, so
 * a run of them reads as one shelter.
 */
export function shelter(b: Build, taxi: boolean) {
  const frame = b.kit.material(taxi ? 0x2a2a2a : 0x405058, 0.6, 0.45), glass = b.kit.glass(0xa8c8d0, 0.22);
  for (const x of [-H, H]) b.box(x, 1.2, 0, 0.08, 2.4, 0.08, frame);
  b.box(0, 1.2, 0, C - 0.08, 1.9, 0.012, glass);
  for (const y of [0.18, 2.17]) b.box(0, y, 0, C, 0.05, 0.05, frame);
  b.box(0, 2.42, 0.58, C, 0.06, 1.25, frame);
  b.box(0, 2.38, 1.19, C, 0.12, 0.04, frame);
  b.box(0, 2.39, 0.58, C - 0.2, 0.012, 0.06, glow(b, 0xe8f4ff, 0.9));
  b.box(0, 0.45, 0.22, C - 0.2, 0.04, 0.34, b.kit.material(0x8a6646, 0, 0.7));
  for (const x of [-0.45, 0.45]) b.box(x, 0.22, 0.22, 0.04, 0.44, 0.3, frame);
  b.sign(taxi ? "taxi-stand" : "bus-stop", 0, 2.38, 1.212, taxi ? 0.9 : 0.5, 0.11);
}

export function rollCage(b: Build) {
  const wire = b.kit.material(0x9aa0a2, 0.7, 0.4), carton = [0x9c8160, 0xa88c66, 0x8a7052];
  b.box(0, 0.12, 0, 0.8, 0.03, 0.62, wire);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    b.box(x * 0.39, 0.9, z * 0.3, 0.025, 1.6, 0.025, wire);
    b.cyl(x * 0.33, 0.05, z * 0.25, 0.05, 0.05, b.dark, 8).rotation.z = Math.PI / 2;
  }
  for (const x of [-0.39, 0.39]) for (let y = 0.35; y < 1.7; y += 0.25) b.box(x, y, 0, 0.012, 0.012, 0.62, wire);
  for (let y = 0.35; y < 1.7; y += 0.25) b.box(0, y, -0.3, 0.8, 0.012, 0.012, wire);
  let y = 0.14;
  for (let k = 0; k < 4 && y < 1.4; k++) {
    const h = 0.22 + b.random() * 0.12;
    b.item("box", b.pick(carton), (b.random() - 0.5) * 0.08, y, (b.random() - 0.5) * 0.06, 0.66, h, 0.5);
    y += h;
  }
}

// ---------------------------------------------------------------------------
// Building shells: a thin wall on the cell's north edge, the rest of the tile a low built-in.

const SHELL_H = 3;
export type Shell = "store" | "corner" | "partition" | "timber" | "concrete";
/** The wall panel's depth from the north edge; built-in fixtures stand against it. */
export const SHELL_T = 0.075;

/**
 * A wall tile for a building's shell, as a thin wall: a panel on the cell's
 * north edge (the west edge too for `corner`), its outside (-z) tiled in the
 * store's panels with the chain's fascia band, its inside painted, and the
 * rest of the tile a low dark built-in plinth so it never reads as floor.
 * Faces between neighbouring pieces are left out (`b.faces`).
 */
export function shell(b: Build, kind: Shell, plinth = true) {
  const paint = b.kit.material(0xc9c5b8, 0, 0.88), skirting = b.kit.material(0x3a3c3e, 0.1, 0.7);
  const core = kind === "timber" ? b.woodTrim : kind === "concrete" ? b.kit.material(0x7c7d78, 0, 0.92) : paint;
  const coping = b.kit.material(0x55585a, 0.1, 0.85);
  const outside = kind === "store" || kind === "corner";
  for (const yaw of kind === "corner" ? [0, -Math.PI / 2] : [0]) {
    const g = b.frame(yaw);
    b.box(0, SHELL_H / 2, -H + SHELL_T / 2, C, SHELL_H, SHELL_T, core, g);
    b.box(0, SHELL_H + 0.03, -H + SHELL_T / 2, C, 0.06, SHELL_T + 0.04, coping, g);
    // Inside face: paint over a skirting.
    if (kind === "timber") for (let i = 0; i < 9; i++) b.box(-H + 0.075 + i * 0.15, 1.5, -H + SHELL_T + 0.004, 0.142, 2.9, 0.008, b.random() < 0.25 ? b.woodTrim : b.wood, g);
    else b.box(0, 0.05, -H + SHELL_T + 0.006, C, 0.1, 0.012, skirting, g);
    // Outside face (-z): the store's tile panels and fascia, when it looks out of the block.
    if (outside && b.faces & 4) {
      const tile = b.kit.material(0xd2cec2, 0, 0.7), joint = b.kit.material(0x9a968c, 0, 0.8), z = -H - 0.004;
      b.box(0, 1.22, z, C, 2.34, 0.008, tile, g);
      for (let y = 0.35; y < 2.35; y += 0.3) b.box(0, y, z - 0.005, C, 0.008, 0.004, joint, g);
      for (const x of [-0.225, 0.225]) b.box(x, 1.22, z - 0.005, 0.008, 2.3, 0.004, joint, g);
      b.box(0, 0.06, z - 0.004, C, 0.12, 0.02, skirting, g);
      b.box(0, 2.7, z - 0.012, C, 0.56, 0.024, b.header, g);
      b.box(0, 2.47, z - 0.026, C, 0.03, 0.004, b.stripe, g);
    }
  }
  // The rest of the tile: a dark plinth, so a Wall tile never looks like floor you could walk.
  if (plinth) {
    const x0 = kind === "corner" ? -H + SHELL_T : -H;
    b.box((x0 + H) / 2, 0.22, (-H + SHELL_T + H) / 2, H - x0, 0.44, C - SHELL_T, b.kit.material(0x24272a, 0.1, 0.8));
    b.box((x0 + H) / 2, 0.45, (-H + SHELL_T + H) / 2, H - x0 - 0.02, 0.02, C - SHELL_T - 0.02, b.kit.material(0x3a3d40, 0.2, 0.6));
  }
}

// ---------------------------------------------------------------------------
// Vending machines: wall-backed cells, back on the north edge, front (+z) the lit window.

/** `drinks`: a cabinet with three lit rows (blue strip cold, red strip hot). `tobacco`: dark cabinet, a grid of packs. */
export function vending(b: Build, style: "drinks" | "tobacco") {
  const drinks = style === "drinks";
  const body = b.kit.material(drinks ? b.pick([0xe8e8e4, 0x2f5f9a, 0xb8322a]) : 0x3a3530, 0.3, 0.5);
  const window = b.kit.material(0xd8eef0, 0, 0.4, 1.1, 0xc8eeec);
  const w = drinks ? 1.0 : 0.85, d = 0.72, z = -0.6 + d / 2, front = -0.6 + d;
  b.box(0, 0.9, z, w, 1.8, d, body);
  b.box(0, 1.82, z, w + 0.02, 0.04, d + 0.02, b.dark);
  b.box(-0.08, 1.28, front + 0.005, w - 0.3, 0.84, 0.01, window);
  const rows = drinks ? 3 : 5;
  for (let r = 0; r < rows; r++) {
    const y = 0.92 + r * (drinks ? 0.27 : 0.16);
    if (drinks) b.box(-0.08, y - 0.03, front + 0.012, w - 0.32, 0.025, 0.004, b.kit.material(r === 0 ? 0xc8302a : 0x2f6fa8, 0, 0.5));
    for (let x = -0.08 - (w - 0.36) / 2 + 0.05; x < -0.08 + (w - 0.36) / 2; x += drinks ? 0.085 : 0.07)
      b.item(drinks ? "bottle" : "box", b.pick(drinks ? [0x3f6f8a, 0x9c3b32, 0xd9d4c3, 0x6a7f4a, 0x2b2b2b, 0xc89a3e] : [0xe8e4d8, 0x2a3a5a, 0xb8322a, 0x3a5a3a, 0xc8b070]),
        x, y, front - 0.03, drinks ? 0.055 : 0.05, drinks ? 0.16 : 0.08, 0.05);
  }
  const panelX = w / 2 - 0.12;
  b.box(panelX, 1.15, front + 0.006, 0.16, 0.5, 0.012, b.kit.material(0x2a2d30, 0.4, 0.5));
  b.box(panelX, 1.3, front + 0.014, 0.08, 0.05, 0.006, b.kit.material(0x5fbbc6, 0, 0.4, 0.8));
  b.box(panelX, 1.15, front + 0.014, 0.03, 0.06, 0.006, b.chrome);
  b.box(panelX, 1.0, front + 0.014, 0.08, 0.03, 0.006, b.dark);
  b.box(0, 0.25, front + 0.006, w - 0.2, 0.22, 0.02, b.dark);
  b.box(0, 0.25, front + 0.018, w - 0.26, 0.16, 0.004, b.kit.material(0x55585a, 0.4, 0.5));
  if (drinks) {
    // The can bin beside it: a small cylinder with a round mouth.
    b.cyl(w / 2 + 0.17, 0.4, front - 0.2, 0.14, 0.8, b.kit.material(0x2f6fa8, 0.3, 0.5), 14);
    b.cyl(w / 2 + 0.17, 0.62, front - 0.06, 0.05, 0.01, b.dark, 12).rotation.x = Math.PI / 2;
  }
}
