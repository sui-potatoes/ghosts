// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Parked vehicles: original generic shapes, no makes or badges, blank
 * plates. Front is +z; cars run along their cells. Wheels, glass and lamps
 * share materials and geometry across every vehicle; paint is seeded (white,
 * silver and black dominate, one muted colour), and one look in four has its
 * hazards on. Static props for now: no wrecked state.
 */
import * as T from "three";
import type { Build } from "./kit.ts";

interface Body { paint: T.Material; trim: T.Material; glass: T.Material }

function materials(b: Build, muted: number, fixed?: number): Body {
  const colors = [0xe6e6e2, 0xa9adb0, 0x1e2124, muted];
  return {
    paint: b.kit.material(fixed ?? colors[b.variant % 4], 0.45, 0.32),
    trim: b.kit.material(0x22262a, 0.2, 0.7),
    glass: b.kit.material(0x2a3842, 0.85, 0.1),
  };
}

/**
 * The cabin: a band of dark glass all round under a painted roof on four
 * slim pillars, so the beltline and roof read from the tactical camera.
 */
function greenhouse(b: Build, { paint, glass }: Body, w: number, y0: number, y1: number, z0: number, z1: number, rake = 0) {
  b.box(0, (y0 + y1) / 2, (z0 + z1) / 2 - rake / 2, w, y1 - y0, z1 - z0 - rake, glass);
  if (rake) b.box(0, (y0 + y1) / 2, z1 - rake / 2 - 0.02, w - 0.04, Math.hypot(y1 - y0, rake), 0.04, glass).rotation.x = -Math.atan2(rake, y1 - y0);
  b.box(0, y1 + 0.03, (z0 + z1) / 2 - rake / 2, w + 0.02, 0.06, z1 - z0 - rake - 0.06, paint);
  for (const sx of [-1, 1]) for (const z of [z0 + 0.06, z1 - rake - 0.04]) b.box(sx * (w / 2 - 0.02), (y0 + y1) / 2, z, 0.05, y1 - y0, 0.07, paint);
}

function wheel(b: Build, x: number, z: number, r: number, width: number, g: T.Object3D = b.root) {
  b.cyl(x, r, z, r, width, b.kit.material(0x161718, 0, 0.9), 16, g).rotation.z = Math.PI / 2;
  b.cyl(x + Math.sign(x) * 0.006, r, z, r * 0.55, width, b.kit.material(0x9aa0a4, 0.7, 0.35), 12, g).rotation.z = Math.PI / 2;
}

/** Lamps off, plates blank; hazards on in one look of four. */
function lamps(b: Build, w: number, front: number, rear: number, y: number, frontY = y) {
  const hazards = b.variant === 3;
  const head = b.kit.material(0xcfd3cc, 0.2, 0.25), tail = b.kit.material(0x5a1a18, 0.1, 0.4);
  const amber = hazards ? b.kit.material(0xffb24a, 0, 0.4, 1.4, 0xff9a2a) : b.kit.material(0x8a5a1a, 0.1, 0.4);
  const plate = b.kit.material(0xe8e6dc, 0.1, 0.5);
  for (const s of [-1, 1]) {
    b.box(s * (w / 2 - 0.16), frontY, front, 0.24, 0.1, 0.03, head);
    b.box(s * (w / 2 - 0.04), frontY, front - 0.01, 0.05, 0.06, 0.03, amber);
    b.box(s * (w / 2 - 0.1), y, rear, 0.14, 0.18, 0.03, tail);
    b.box(s * (w / 2 - 0.1), y - 0.13, rear, 0.1, 0.05, 0.03, amber);
  }
  for (const [z, s] of [[front, 1], [rear, -1]] as const) {
    b.box(0, 0.42, z + s * 0.012, 0.33, 0.165, 0.01, plate);
    for (const x of [-0.08, 0.06]) b.box(x, 0.43, z + s * 0.018, 0.08, 0.05, 0.004, b.dark);
  }
}

function mirrors(b: Build, w: number, z: number, y: number, m: T.Material) {
  for (const s of [-1, 1]) b.box(s * (w / 2 + 0.06), y, z, 0.1, 0.08, 0.05, m);
}

/** The tall boxy mini, about 3.4 × 1.42 × 1.72 m. */
export function keiCar(b: Build) {
  const { paint, trim, glass } = materials(b, 0x7d8a6a), w = 1.42;
  b.box(0, 0.5, 0, w, 0.6, 3.3, paint);
  b.box(0, 0.86, 1.4, w - 0.04, 0.14, 0.5, paint);
  b.box(0, 0.86, -0.25, w, 0.14, 2.6, paint);
  greenhouse(b, { paint, trim, glass }, w - 0.08, 0.93, 1.64, -1.55, 1.1, 0.22);
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.005), 0.62, 0.15, 0.004, 0.01, 1.6, trim);
  for (const z of [1.68, -1.66]) b.box(0, 0.36, z, w + 0.02, 0.2, 0.08, trim);
  for (const s of [-1, 1]) for (const z of [-1.12, 1.24]) { b.box(s * (w / 2 - 0.02), 0.36, z, 0.06, 0.3, 0.7, trim); wheel(b, s * (w / 2 - 0.1), z, 0.28, 0.17); }
  mirrors(b, w, 0.95, 1.05, paint);
  lamps(b, w, 1.66, -1.66, 0.85, 0.82);
}

/** A compact hatchback, about 4.0 × 1.7 × 1.5 m. */
export function hatchback(b: Build, taxi = false) {
  const { paint, trim, glass } = materials(b, 0x5b2f2f, taxi ? 0x2f3e4d : undefined), w = 1.7;
  b.box(0, 0.52, 0, w, 0.62, 3.9, paint);
  b.box(0, 0.88, 1.35, w - 0.06, 0.12, 1.1, paint);
  greenhouse(b, { paint, trim, glass }, w - 0.2, 0.86, 1.4, -1.55, 0.95, 0.5);
  b.box(0, 1.12, -1.62, w - 0.32, 0.46, 0.04, glass).rotation.x = 0.55;
  for (const s of [-1, 1]) b.box(s * (w / 2 + 0.002), 0.62, 0.0, 0.004, 0.01, 2.4, trim);
  for (const z of [1.98, -1.98]) b.box(0, 0.36, z, w + 0.02, 0.2, 0.08, trim);
  for (const s of [-1, 1]) for (const z of [-1.3, 1.3]) { b.box(s * (w / 2 - 0.02), 0.38, z, 0.06, 0.32, 0.76, trim); wheel(b, s * (w / 2 - 0.12), z, 0.31, 0.2); }
  mirrors(b, w - 0.12, 0.75, 1.0, paint);
  lamps(b, w, 1.96, -1.96, 0.8, 0.72);
  if (taxi) {
    const cream = b.kit.material(0xe8dcc0, 0.2, 0.5);
    for (const s of [-1, 1]) b.box(s * (w / 2 + 0.003), 0.72, 0, 0.004, 0.06, 3.6, cream);
    const lamp = b.variant % 2 ? b.kit.material(0xf2e6c8, 0, 0.4, 1.1, 0xffe0a0) : cream;
    b.box(0, 1.52, -0.25, 0.36, 0.13, 0.16, lamp);
    b.box(0, 1.465, -0.25, 0.4, 0.02, 0.2, trim);
  }
}

/** The kei truck: a tiny cab and a flat bed with low drop sides. */
export function keiTruck(b: Build) {
  const { paint, trim, glass } = materials(b, 0xe6e6e2), w = 1.42;
  b.box(0, 0.42, 1.12, w, 0.5, 1.1, paint);
  b.box(0, 0.83, 1.12, w, 0.32, 1.1, paint);
  greenhouse(b, { paint, trim, glass }, w - 0.06, 0.99, 1.7, 0.6, 1.66, 0.12);
  b.box(0, 0.42, -0.6, 1.2, 0.18, 2.3, trim);
  b.box(0, 0.68, -0.6, w, 0.05, 2.25, paint);
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.02), 0.86, -0.6, 0.04, 0.32, 2.25, paint);
  b.box(0, 0.86, -1.71, w, 0.32, 0.04, paint);
  b.box(0, 1.15, 0.54, w - 0.1, 0.9, 0.04, trim);
  for (let x = -0.5; x <= 0.5; x += 0.25) b.box(x, 1.15, 0.52, 0.03, 0.9, 0.03, b.steel);
  if (b.variant % 2) for (let i = 0; i < 3; i++) b.item("box", 0x9c8160, -0.35 + i * 0.35, 0.705, -0.9 + (i % 2) * 0.5, 0.32, 0.26, 0.4);
  for (const z of [1.69, -1.72]) b.box(0, 0.32, z, w + 0.02, 0.16, 0.06, trim);
  for (const s of [-1, 1]) for (const z of [-1.1, 1.2]) wheel(b, s * (w / 2 - 0.12), z, 0.27, 0.16);
  mirrors(b, w, 1.55, 1.15, trim);
  lamps(b, w, 1.67, -1.74, 0.62, 0.72);
}

/** A one-box delivery van, about 4.0 × 1.7 × 1.95 m, the rear panels blind. */
export function van(b: Build) {
  const { paint, trim, glass } = materials(b, 0xe6e6e2), w = 1.7;
  b.box(0, 1.06, -0.1, w, 1.66, 3.75, paint);
  b.box(0, 0.62, 1.84, w - 0.02, 0.56, 0.26, paint);
  b.box(0, 1.42, 1.78, w - 0.16, 0.66, 0.04, glass).rotation.x = -0.32;
  for (const s of [-1, 1]) {
    b.box(s * (w / 2 + 0.002), 1.45, 1.2, 0.012, 0.5, 0.75, glass);
    b.box(s * (w / 2 + 0.003), 1.1, -0.05, 0.004, 1.3, 0.01, trim);
    b.box(s * (w / 2 + 0.006), 1.15, -0.25, 0.012, 0.02, 1.0, trim);
  }
  b.box(0, 1.45, -1.985, w - 0.3, 0.42, 0.02, glass);
  for (const z of [1.97, -1.97]) b.box(0, 0.34, z, w + 0.02, 0.18, 0.06, trim);
  for (const s of [-1, 1]) for (const z of [-1.25, 1.35]) { b.box(s * (w / 2 - 0.02), 0.36, z, 0.06, 0.3, 0.76, trim); wheel(b, s * (w / 2 - 0.12), z, 0.3, 0.2); }
  mirrors(b, w, 1.6, 1.3, trim);
  lamps(b, w, 1.975, -1.985, 0.75, 0.7);
}

export function scooter(b: Build) {
  const { paint, trim } = materials(b, 0x6a7f4a);
  for (const z of [-0.58, 0.6]) wheel(b, 0, z, 0.2, 0.1);
  b.box(0, 0.32, 0.02, 0.34, 0.06, 0.7, paint);
  b.box(0, 0.62, 0.52, 0.36, 0.6, 0.1, paint).rotation.x = 0.2;
  b.box(0, 0.5, -0.4, 0.34, 0.34, 0.55, paint);
  b.box(0, 0.73, -0.35, 0.3, 0.09, 0.56, trim);
  b.box(0, 1.0, 0.6, 0.62, 0.04, 0.05, trim);
  b.box(0, 0.94, 0.66, 0.14, 0.1, 0.06, b.kit.material(0xcfd3cc, 0.2, 0.25));
  b.box(0, 0.78, -0.72, 0.36, 0.05, 0.3, trim);
}

/** The city bicycle: step-through frame, front basket, rear rack, chain guard, two-leg stand. */
export function mamachari(b: Build) {
  const { paint } = materials(b, 0x6a7f4a, [0xc9cbc6, 0xe6e6e2, 0x1e2124, 0x5e7a6a][b.variant % 4]);
  const tyre = b.kit.material(0x161718, 0, 0.9), steel = b.steel, v = (y: number, z: number) => new T.Vector3(0, y, z);
  for (const z of [-0.55, 0.55]) {
    b.ring(0, 0.33, z, 0.31, 0.025, tyre, b.root, 18).rotation.y = Math.PI / 2;
    b.tube(v(0.33, z - 0.29), v(0.33, z + 0.29), 0.006, steel);
  }
  for (const [a, c] of [[v(0.33, -0.55), v(0.3, -0.05)], [v(0.3, -0.05), v(0.88, 0.4)], [v(0.3, -0.05), v(0.85, -0.2)],
    [v(0.33, -0.55), v(0.85, -0.2)], [v(0.88, 0.4), v(0.33, 0.55)], [v(0.85, -0.2), v(0.98, -0.24)]] as const)
    b.tube(a, c, 0.02, paint);
  b.box(0, 1.0, -0.25, 0.17, 0.06, 0.26, b.dark);
  b.tube(v(0.88, 0.4), v(1.05, 0.38), 0.018, steel);
  b.cyl(0, 1.05, 0.36, 0.015, 0.56, steel, 6).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) b.cyl(s * 0.3, 1.05, 0.34, 0.02, 0.1, b.dark, 6).rotation.z = Math.PI / 2;
  // Wire basket over the front wheel, a rear rack, a chain guard.
  const basket = b.frame(0, 0, 0.62);
  b.box(0, 0.86, 0, 0.36, 0.01, 0.26, steel, basket);
  for (const x of [-0.18, 0.18]) b.box(x, 0.97, 0, 0.008, 0.22, 0.26, steel, basket);
  for (const z of [-0.13, 0.13]) b.box(0, 0.97, z, 0.36, 0.22, 0.008, steel, basket);
  for (let y = 0.9; y < 1.08; y += 0.05) b.box(0, y, 0.131, 0.36, 0.004, 0.004, steel, basket);
  b.box(0, 0.72, -0.62, 0.16, 0.02, 0.36, steel);
  b.box(0.06, 0.38, -0.3, 0.02, 0.1, 0.5, paint);
  for (const s of [-1, 1]) b.tube(v(0.3, -0.6).setX(s * 0.08), v(0.02, -0.7).setX(s * 0.1), 0.008, steel);
}
