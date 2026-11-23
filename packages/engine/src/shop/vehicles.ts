// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Parked vehicles: original generic shapes, no makes or badges, blank
 * plates. The nose is +z for every vehicle (headlamps, windscreen): at turn
 * 0 a car faces south, down its cells; turn 2 faces north. Cars run along
 * their cells. Wheels, glass and lamps
 * share materials and geometry across every vehicle; paint is seeded (white,
 * silver and black dominate, one muted colour), and one look in four has its
 * hazards on. Static props for now: no wrecked state.
 */
import * as T from "three";
import type { Build } from "./kit.ts";

interface Body { paint: T.Material; trim: T.Material; glass: T.Material }

/** Tokyo street colours: pearl white, silver and black dominate, then a few muted ones. */
const paints = [0xe8e8e4, 0xa9adb0, 0x1b1d20, 0xe8e8e4, 0xa9adb0, 0x5a6b7a, 0x1b1d20, 0xc8c0a8, 0xe8e8e4, 0x6a2a2a];

function materials(b: Build, muted: number, fixed?: number): Body {
  const pool = [...paints, muted];
  return {
    paint: b.kit.material(fixed ?? pool[(b.variant * 3 + Math.floor(b.random() * 3)) % pool.length], 0.45, 0.32),
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

/** A round tyre with a rim and hubcap, set in a dark wheel arch cut into the body side. */
function wheel(b: Build, x: number, z: number, r: number, width: number, g: T.Object3D = b.root) {
  const s = Math.sign(x);
  b.cyl(x - s * 0.04, r + 0.02, z, r + 0.015, width * 0.6, b.kit.material(0x0d0e10, 0, 0.95), 20, g).rotation.z = Math.PI / 2;
  b.cyl(x, r, z, r, width, b.kit.material(0x161718, 0, 0.9), 22, g).rotation.z = Math.PI / 2;
  b.cyl(x + s * 0.008, r, z, r * 0.62, width, b.kit.material(0x9aa0a4, 0.7, 0.35), 16, g).rotation.z = Math.PI / 2;
  b.cyl(x + s * 0.014, r, z, r * 0.2, width, b.kit.material(0x55585c, 0.6, 0.4), 10, g).rotation.z = Math.PI / 2;
}

/** Door shut lines and handles on both sides, at the given z positions. */
function doors(b: Build, w: number, cuts: number[], y0: number, y1: number, trim: T.Material) {
  for (const s of [-1, 1]) for (const z of cuts) {
    b.box(s * (w / 2 + 0.002), (y0 + y1) / 2, z, 0.004, y1 - y0, 0.008, trim);
    b.box(s * (w / 2 + 0.006), y1 - 0.12, z - 0.18, 0.012, 0.025, 0.12, trim);
  }
}

/** Lamps with a little depth and a faint tint (parked, off), plates blank; hazards on in one look of four. */
function lamps(b: Build, w: number, front: number, rear: number, y: number, frontY = y) {
  const hazards = b.variant === 3;
  const head = b.kit.material(0xdfe6e8, 0.3, 0.15, 0.25, 0xcfe0ff), tail = b.kit.material(0x8a1e1a, 0.1, 0.3, 0.35, 0xc0201a);
  const amber = hazards ? b.kit.material(0xffb24a, 0, 0.4, 1.4, 0xff9a2a) : b.kit.material(0xa86a1a, 0.1, 0.4, 0.2, 0xa86a1a);
  const plate = b.kit.material(0xe8e6dc, 0.1, 0.5), housing = b.kit.material(0x15181b, 0.3, 0.5);
  for (const s of [-1, 1]) {
    b.box(s * (w / 2 - 0.17), frontY, front - 0.02, 0.3, 0.13, 0.08, housing);
    b.box(s * (w / 2 - 0.17), frontY, front + 0.022, 0.26, 0.1, 0.01, head);
    b.box(s * (w / 2 - 0.04), frontY - 0.08, front + 0.01, 0.06, 0.05, 0.04, amber);
    b.box(s * (w / 2 - 0.1), y, rear + 0.02, 0.16, 0.22, 0.08, housing);
    b.box(s * (w / 2 - 0.1), y, rear - 0.022, 0.13, 0.19, 0.01, tail);
    b.box(s * (w / 2 - 0.1), y - 0.15, rear - 0.015, 0.1, 0.05, 0.02, amber);
  }
  for (const [z, s] of [[front, 1], [rear, -1]] as const) {
    b.box(0, 0.42, z + s * 0.012, 0.36, 0.19, 0.02, housing);
    b.box(0, 0.42, z + s * 0.024, 0.33, 0.165, 0.006, plate);
    for (const x of [-0.08, 0.06]) b.box(x, 0.43, z + s * 0.028, 0.08, 0.05, 0.004, b.dark);
  }
}

function mirrors(b: Build, w: number, z: number, y: number, m: T.Material) {
  for (const s of [-1, 1]) b.box(s * (w / 2 + 0.06), y, z, 0.1, 0.08, 0.05, m);
}

/** The tall boxy mini, about 3.4 × 1.42 × 1.72 m. */
export function keiCar(b: Build) {
  const { paint, trim, glass } = materials(b, 0x7d8a6a), w = 1.42;
  b.box(0, 0.5, 0, w, 0.6, 3.3, paint);
  b.box(0, 0.84, 1.45, w - 0.04, 0.1, 0.4, paint);
  b.box(0, 0.86, -0.25, w, 0.14, 2.6, paint);
  greenhouse(b, { paint, trim, glass }, w - 0.08, 0.93, 1.74, -1.6, 1.22, 0.3);
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.005), 0.62, 0.15, 0.004, 0.01, 1.6, trim);
  for (const z of [1.68, -1.66]) b.box(0, 0.36, z, w + 0.02, 0.2, 0.08, trim);
  for (const s of [-1, 1]) for (const z of [-1.12, 1.24]) wheel(b, s * (w / 2 - 0.06), z, 0.28, 0.17);
  doors(b, w, [0.95, -0.2], 0.3, 0.9, trim);
  mirrors(b, w, 0.95, 1.05, paint);
  lamps(b, w, 1.66, -1.66, 0.85, 0.82);
  if (b.variant === 1) for (const x of [-0.5, 0.5]) b.box(x, 1.72, -0.25, 0.04, 0.04, 2.0, trim);
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
  for (const s of [-1, 1]) for (const z of [-1.3, 1.3]) wheel(b, s * (w / 2 - 0.08), z, 0.31, 0.2);
  doors(b, w, [0.85, -0.35], 0.32, 0.86, trim);
  mirrors(b, w - 0.12, 0.75, 1.0, paint);
  if (b.variant === 1 && !taxi) for (const x of [-0.55, 0.55]) b.box(x, 1.47, -0.4, 0.04, 0.05, 1.8, trim);
  lamps(b, w, 1.96, -1.96, 0.8, 0.72);
  if (taxi) {
    const cream = b.kit.material(0xe8dcc0, 0.2, 0.5);
    for (const s of [-1, 1]) b.box(s * (w / 2 + 0.003), 0.72, 0, 0.004, 0.06, 3.6, cream);
    const lamp = b.variant % 2 ? b.kit.material(0xf2e6c8, 0, 0.4, 1.1, 0xffe0a0) : cream;
    b.box(0, 1.52, -0.25, 0.36, 0.13, 0.16, lamp);
    b.box(0, 1.465, -0.25, 0.4, 0.02, 0.2, trim);
  }
}

/** A taxi: a three-box sedan (bonnet, cabin, boot) in a fleet's two tones, a roof lamp lit when free. */
export function taxi(b: Build) {
  const fleet = [[0x1f2a24, 0xd8c8a0], [0x2a3442, 0xe8e4d8], [0x5a2228, 0xe0d4b8], [0x23272b, 0xd9a52b]][b.variant % 4];
  const paint = b.kit.material(fleet[0], 0.45, 0.32), band = b.kit.material(fleet[1], 0.3, 0.45);
  const { trim, glass } = materials(b, 0, fleet[0]), body = { paint, trim, glass }, w = 1.7;
  b.box(0, 0.52, 0, w, 0.62, 3.95, paint);
  b.box(0, 0.88, 1.38, w - 0.06, 0.12, 1.05, paint);
  b.box(0, 0.88, -1.6, w - 0.06, 0.12, 0.75, paint);
  greenhouse(b, body, w - 0.2, 0.86, 1.36, -1.15, 0.8, 0.5);
  b.box(0, 1.12, -1.28, w - 0.32, 0.4, 0.04, glass).rotation.x = 0.85;
  for (const s of [-1, 1]) b.box(s * (w / 2 + 0.003), 0.66, 0, 0.004, 0.1, 3.7, band);
  for (const z of [1.98, -1.98]) b.box(0, 0.36, z, w + 0.02, 0.2, 0.08, trim);
  for (const s of [-1, 1]) for (const z of [-1.3, 1.3]) wheel(b, s * (w / 2 - 0.08), z, 0.31, 0.2);
  doors(b, w, [0.8, -0.3], 0.32, 0.86, trim);
  mirrors(b, w - 0.12, 0.72, 1.0, paint);
  lamps(b, w, 1.96, -1.96, 0.8, 0.72);
  const lit = b.variant % 2 === 0;
  b.box(0, 1.52, -0.2, 0.36, 0.13, 0.16, lit ? b.kit.material(0xf2e6c8, 0, 0.4, 1.1, 0xffe0a0) : band);
  b.box(0, 1.465, -0.2, 0.4, 0.02, 0.2, trim);
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
  for (const s of [-1, 1]) for (const z of [-1.25, 1.35]) wheel(b, s * (w / 2 - 0.08), z, 0.3, 0.2);
  if (b.variant === 2) {
    b.box(0, 1.95, -0.2, w - 0.2, 0.05, 3.0, trim);
    for (const z of [-1.4, 0, 1.0]) b.box(0, 1.92, z, w - 0.1, 0.04, 0.05, trim);
  }
  mirrors(b, w, 1.6, 1.3, trim);
  lamps(b, w, 1.975, -1.985, 0.75, 0.7);
}

/**
 * A commuter / delivery scooter, nose +z, on its side stand: step-through
 * body with leg shield, round wheels under fenders, headlamp, mirrors, seat,
 * a rear carrier with a delivery box on half the looks.
 */
export function scooter(b: Build) {
  const { paint, trim } = materials(b, 0x6a7f4a);
  const g = b.frame(0); g.rotation.z = 0.06;
  const tyre = b.kit.material(0x161718, 0, 0.9), rim = b.kit.material(0x9aa0a4, 0.7, 0.35);
  for (const z of [-0.55, 0.58]) {
    b.cyl(0, 0.22, z, 0.22, 0.1, tyre, 22, g).rotation.z = Math.PI / 2;
    b.cyl(0.006, 0.22, z, 0.14, 0.104, rim, 16, g).rotation.z = Math.PI / 2;
    b.box(0, 0.47, z, 0.14, 0.04, 0.42, paint, g);
  }
  b.box(0, 0.32, 0.02, 0.3, 0.06, 0.6, trim, g);
  b.box(0, 0.66, 0.46, 0.38, 0.62, 0.08, paint, g).rotation.x = 0.22;
  b.box(0, 0.52, -0.38, 0.34, 0.32, 0.55, paint, g);
  b.box(0, 0.72, -0.33, 0.28, 0.08, 0.5, b.kit.material(0x1a1a1a, 0, 0.7), g);
  b.box(0, 1.0, 0.62, 0.6, 0.035, 0.035, trim, g);
  for (const s of [-1, 1]) {
    b.box(s * 0.31, 1.0, 0.62, 0.05, 0.035, 0.08, b.kit.material(0x1a1a1a, 0, 0.7), g);
    b.box(s * 0.2, 1.18, 0.6, 0.015, 0.2, 0.015, trim, g);
    b.box(s * 0.22, 1.29, 0.6, 0.08, 0.05, 0.02, b.chrome, g);
  }
  b.box(0, 0.95, 0.7, 0.16, 0.12, 0.08, paint, g);
  b.box(0, 0.95, 0.745, 0.12, 0.08, 0.01, b.kit.material(0xcfd3cc, 0.2, 0.25), g);
  b.box(0, 0.78, -0.75, 0.3, 0.03, 0.32, trim, g);
  if (b.variant % 2) {
    b.box(0, 1.0, -0.75, 0.42, 0.42, 0.4, b.kit.material(b.pick([0xb8322a, 0xe8e6de, 0x2f6fa8]), 0.1, 0.5), g);
    b.box(0, 1.0, -0.54, 0.3, 0.08, 0.004, b.kit.material(0xe8e6de, 0, 0.6), g);
  }
  b.box(-0.12, 0.12, -0.05, 0.03, 0.24, 0.03, trim).rotation.z = -0.5;
}

/** The city bicycle, front +z: spoked round wheels, step-through frame, front basket, rear rack (a child seat on half the looks), chain guard, bell, two-leg stand. */
export function mamachari(b: Build) {
  const { paint } = materials(b, 0x6a7f4a, [0xc9cbc6, 0xe6e6e2, 0x1e2124, 0x5e7a6a][b.variant % 4]);
  const tyre = b.kit.material(0x161718, 0, 0.9), steel = b.steel, v = (y: number, z: number) => new T.Vector3(0, y, z);
  for (const z of [-0.55, 0.55]) {
    b.ring(0, 0.33, z, 0.31, 0.025, tyre, b.root, 22).rotation.y = Math.PI / 2;
    b.ring(0, 0.33, z, 0.285, 0.008, steel, b.root, 22).rotation.y = Math.PI / 2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      b.tube(v(0.33 + Math.sin(a) * 0.28, z + Math.cos(a) * 0.28), v(0.33 - Math.sin(a) * 0.28, z - Math.cos(a) * 0.28), 0.003, steel);
    }
    b.cyl(0, 0.33, z, 0.03, 0.1, steel, 8).rotation.z = Math.PI / 2;
  }
  b.cyl(0.12, 1.04, 0.34, 0.022, 0.02, b.chrome, 10);
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
  // A child seat on the rear rack on half the looks.
  if (b.variant % 2) {
    b.box(0, 0.86, -0.64, 0.3, 0.26, 0.3, b.kit.material(0x2a2d30, 0, 0.7));
    b.box(0, 1.02, -0.78, 0.3, 0.22, 0.04, b.kit.material(0x2a2d30, 0, 0.7));
  }
  b.box(0.06, 0.38, -0.3, 0.02, 0.1, 0.5, paint);
  for (const s of [-1, 1]) b.tube(v(0.3, -0.6).setX(s * 0.08), v(0.02, -0.7).setX(s * 0.1), 0.008, steel);
}
