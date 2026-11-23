// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Three small Tokyo interiors: the izakaya (timber walls, lattice screens,
 * noren, red lanterns, menu strips, a wooden counter, tables, crates, a
 * sake cask and its tableware), the kissaten-style coffee shop, and the bar
 * (a standalone soft-drinks fridge, the lit back bar as a wall-backed run,
 * taps and a neon sign). Real proportions: counters 1.02 m with 0.7 m
 * stools, tables 0.7 m, doorways 2.05 m.
 */
import * as T from "three";
import type { RunPiece } from "./catalog.ts";
import { BACK, C, H, tones, type Build } from "./kit.ts";
import { fillRow, wallRun } from "./konbini.ts";

const glow = (b: Build, color: number, strength = 1.2) => b.kit.material(color, 0, 0.4, strength, color);

// ---------------------------------------------------------------------------
// Walls and decor (edges and wall mounts: the mesh straddles or backs onto the edge at z = 0).

export function woodWall(b: Build) {
  b.box(0, 1.35, 0, C - 0.02, 2.62, 0.09, b.woodTrim);
  const n = 9, w = C / n;
  for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
    const worn = b.random() < 0.22;
    b.box(-H + w * (i + 0.5), 1.38, s * 0.055, w - 0.008, 2.5, 0.02, worn ? b.woodTrim : b.wood);
  }
  for (const s of [-1, 1]) {
    b.box(0, 0.06, s * 0.065, C, 0.12, 0.012, b.woodTrim);
    b.box(0, 0.95, s * 0.068, C, 0.05, 0.016, b.woodTrim);
  }
  b.box(0, 2.66, 0, C, 0.08, 0.16, b.woodTrim);
}

export function latticeScreen(b: Build) {
  b.box(0, 0.05, 0, C, 0.1, 0.09, b.woodTrim);
  for (const x of [-H + 0.03, H - 0.03]) b.box(x, 0.58, 0, 0.06, 1.16, 0.07, b.woodTrim);
  b.box(0, 0.28, 0, C - 0.1, 0.36, 0.03, b.wood);
  for (const y of [0.47, 1.12]) b.box(0, y, 0, C - 0.1, 0.04, 0.06, b.woodTrim);
  for (let x = -H + 0.09; x < H - 0.06; x += 0.065) b.box(x, 0.8, 0, 0.022, 0.62, 0.045, b.wood);
  b.box(0, 0.8, 0, C - 0.1, 0.02, 0.05, b.wood);
}

export function noren(b: Build) {
  const dye = b.kit.material(0x2c3a5a, 0, 0.95);
  b.box(0, 2.1, 0, C, 0.12, 0.14, b.woodTrim);
  for (const x of [-H + 0.04, H - 0.04]) b.box(x, 1.05, 0, 0.08, 2.1, 0.12, b.woodTrim);
  b.box(0, 1.99, 0.04, C - 0.1, 0.025, 0.025, b.woodTrim);
  // Split fabric panels, hanging a little unevenly; the mark spans the middle split.
  for (let i = 0; i < 4; i++) {
    const panel = b.box(-0.45 + i * 0.3, 1.64, 0.04, 0.285, 0.7, 0.012, dye);
    panel.rotation.x = (b.random() - 0.5) * 0.05;
  }
  for (const s of [1, -1]) {
    const mark = b.sign("sake", 0, 1.72, 0.04 + s * 0.008, 0.34, 0.34, b.root, "print", false);
    if (s < 0) mark.rotation.y = Math.PI;
  }
}

/**
 * A chōchin: an elongated paper cylinder bellied at the middle, on bamboo
 * ribs, with black lacquered rings at top and bottom and bold brush lettering
 * down the front, softly lit from inside. Red (akachōchin) by default; the
 * white one is `lanternWhite`. It hangs on a short cord from 2.7 m.
 */
export function lantern(b: Build, white = false) {
  const paper = white ? glow(b, 0xece6d8, 0.55) : glow(b, 0xb8352a, 0.7);
  const rib = b.kit.material(white ? 0xb8b0a0 : 0x7a2018, 0, 0.8), lacquer = b.kit.material(0x141210, 0.2, 0.45);
  b.cyl(0, 2.6, 0, 0.005, 0.2, lacquer, 4);
  b.cyl(0, 2.49, 0, 0.11, 0.05, lacquer, 14);
  const profile = [0.12, 0.155, 0.175, 0.18, 0.175, 0.155, 0.12];
  for (let i = 0; i < profile.length - 1; i++) {
    const top = 2.46 - i * 0.1;
    b.cyl(0, top - 0.05, 0, profile[i + 1], 0.1, paper, 16, b.root, profile[i]);
  }
  for (let i = 1; i < 13; i++) {
    const y = 2.46 - i * 0.05, t = (i / 12) * (profile.length - 1), k = Math.min(profile.length - 2, Math.floor(t));
    const r = profile[k] + (profile[k + 1] - profile[k]) * (t - k);
    b.ring(0, y, 0, r + 0.002, 0.0025, rib, b.root, 16).rotation.x = Math.PI / 2;
  }
  b.cyl(0, 1.84, 0, 0.115, 0.05, lacquer, 14);
  const text = b.variant % 2 ? "yakitori" : "izakaya";
  for (const s of [1, -1]) {
    const mark = b.sign(text, 0, 2.15, s * 0.183, 0.15, 0.46, b.root, "print", false);
    if (s < 0) mark.rotation.y = Math.PI;
  }
}

export const lanternWhite = (b: Build) => lantern(b, true);

const strips = ["beer", "skewers", "edamame", "tofu", "karaage", "sashimi", "shochu", "nihonshu"];

export function menuStrips(b: Build) {
  b.box(0, 0.5, -0.005, 1.28, 0.035, 0.03, b.woodTrim);
  b.box(0, -0.02, -0.005, 1.28, 0.025, 0.03, b.woodTrim);
  b.sign("menu", -0.55, 0.24, 0.012, 0.13, 0.52);
  const order = [...strips].sort(() => b.random() - 0.5).slice(0, 7);
  order.forEach((id, i) => {
    const x = -0.38 + i * 0.15;
    b.sign(id, x, 0.25, 0.008 + (i % 2) * 0.002, 0.115, 0.46);
    // The price at the foot: a few illegible brush marks, as on the real boards.
    for (let k = 0; k < 3; k++) b.box(x, 0.06 + k * 0.025, 0.014, 0.05, 0.008, 0.002, b.kit.material(0x9a2a22, 0, 0.8));
  });
}

export function bottleKeep(b: Build) {
  const tag = b.paper, inks = [0x2f3a2c, 0x4a2a1a, 0x7a8a8c, 0x2a3442, 0x5b3d22, 0x9aa79a];
  for (const y of [0, 0.42]) {
    b.box(0, y, 0.1, 1.2, 0.03, 0.22, b.wood);
    for (const x of [-0.5, 0.5]) b.box(x, y - 0.06, 0.03, 0.03, 0.12, 0.1, b.woodTrim);
    for (let x = -0.54; x < 0.54; x += 0.1 + b.random() * 0.03) {
      if (b.random() < 0.15) continue;
      const h = 0.26 + b.random() * 0.06, color = b.pick(inks);
      b.item("bottle", color, x, y + 0.015, 0.1, 0.085, h, 0.085);
      b.item("can", color, x, y + 0.015 + h, 0.1, 0.03, 0.07, 0.03);
      b.box(x + 0.02, y + h * 0.75, 0.15, 0.05, 0.035, 0.003, tag).rotation.z = (b.random() - 0.5) * 0.4;
    }
  }
}

export function coatHooks(b: Build) {
  b.box(0, 0, 0, 1.1, 0.1, 0.025, b.wood);
  for (let i = 0; i < 5; i++) b.box(-0.44 + i * 0.22, 0, 0.04, 0.02, 0.02, 0.06, b.chrome);
  const coats = [0x2a2f3a, 0x4a4a3a, 0x3a2a2a, 0x5a5e60];
  for (const i of [0, 1, 3].filter(() => b.random() < 0.85)) {
    const x = -0.44 + i * 0.22, color = b.pick(coats);
    b.item("box", color, x, -0.2, 0.1, 0.42, 0.14, 0.12);
    b.item("box", color, x, -0.82, 0.1, 0.38, 0.64, 0.1).rotation.z = (b.random() - 0.5) * 0.06;
    b.item("box", 0x1a1a1a, x, -0.1, 0.12, 0.08, 0.08, 0.04);
  }
  b.cyl(0.44, -0.4, 0.06, 0.012, 0.8, b.dark, 6);
  b.cyl(0.44, -0.75, 0.06, 0.05, 0.4, b.kit.material(0x1f2a33, 0, 0.8), 8, b.root, 0.012);
}

export function umbrellaStand(b: Build) {
  const x = 0.42, z = -0.42;
  b.cyl(x, 0.22, z, 0.13, 0.44, b.steel, 12);
  b.cyl(x, 0.445, z, 0.12, 0.01, b.dark, 12);
  const clear = b.kit.glass(0xe6eef0, 0.45);
  [[0x1c2228, -0.04, 0.03], [0x5a1f1f, 0.04, -0.02], [0, 0.0, 0.05]].forEach(([color, dx, dz], i) => {
    const m = color ? b.kit.material(color, 0, 0.7) : clear;
    const u = b.cyl(x + dx, 0.55, z + dz, 0.045, 0.8, m, 8, b.root, 0.012);
    u.rotation.set(dz * 3, 0, -dx * 3 + (i - 1) * 0.08);
    b.box(x + dx * 3, 0.98, z + dz * 3, 0.02, 0.1, 0.02, b.dark);
  });
}

export function wallClock(b: Build) {
  b.cyl(0, 0, 0, 0.17, 0.045, b.woodTrim, 20).rotation.x = Math.PI / 2;
  b.cyl(0, 0, 0.024, 0.15, 0.004, b.ceramic, 20).rotation.x = Math.PI / 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box(Math.sin(a) * 0.125, Math.cos(a) * 0.125, 0.028, 0.008, i % 3 ? 0.012 : 0.024, 0.002, b.dark).rotation.z = -a;
  }
  b.box(0.03, 0.02, 0.031, 0.075, 0.01, 0.003, b.dark).rotation.z = 0.5;
  b.box(-0.01, 0.05, 0.033, 0.008, 0.11, 0.003, b.dark).rotation.z = 0.2;
}

export function calendar(b: Build) {
  b.box(0, 0, 0, 0.3, 0.46, 0.004, b.paper);
  b.item("box", b.pick([0x6f8fa6, 0xa84a3a, 0x5f8a3c]), 0, 0.06, 0.003, 0.26, 0.15, 0.002);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++)
    b.box(-0.12 + c * 0.04, -0.06 - r * 0.03, 0.003, 0.025, 0.012, 0.001, c === 0 ? b.kit.material(0xa8322a, 0, 0.8) : b.dark);
  b.box(0, 0.235, 0.004, 0.31, 0.012, 0.006, b.dark);
}

export function poster(b: Build) {
  b.box(0, 0, 0, 0.52, 0.72, 0.03, b.woodTrim);
  b.box(0, 0, 0.016, 0.46, 0.66, 0.004, b.kit.material(0xd9cfb8, 0, 0.9));
  const ground = b.pick([0x2f4a5a, 0xb0563a, 0x3e5a46, 0xd8c08a]);
  b.item("box", ground, 0, -0.22, 0.018, 0.42, 0.42, 0.002);
  // An abstract travel poster: a sun, a horizon, a mountain wedge.
  b.item("can", b.pick([0xc8392c, 0xf2c14e, 0xe6e1d3]), 0.06, 0.08, 0.02, 0.18, 0.002, 0.18).rotation.x = Math.PI / 2;
  b.item("tri", b.pick([0x1e2a33, 0x5a3a2a, 0xe6e1d3]), -0.05, -0.12, 0.022, 0.34, 0.22, 0.002);
  for (let i = 0; i < 3; i++) b.item("box", 0xe9e4d5, -0.14 + i * 0.1, 0.25, 0.02, 0.07, 0.025, 0.002);
}

// ---------------------------------------------------------------------------
// Izakaya furniture.

/** One wooden counter run, customer side +z: a pale thick top, slatted front, a steel prep bench behind. */
function woodCounterRun(b: Build, g: T.Object3D, x0: number, x1: number, capR: boolean, capL = false) {
  const cx = (x0 + x1) / 2, w = x1 - x0, reach = capR && x1 < H - 0.01 ? 0.04 : 0;
  // A pale hinoki top on the izakaya's stains; the black (bar) stain gets a dark lacquered one.
  const top = b.finish === "black" ? b.kit.material(0x2a211b, 0.1, 0.35) : b.hinoki;
  b.box(cx + reach / 2, 0.995, 0.08, w + reach, 0.05, 0.6, top, g);
  b.box(cx, 0.04, 0.27, w, 0.08, 0.06, b.woodTrim, g);
  b.box(cx, 0.52, 0.32, w, 0.88, 0.03, b.woodTrim, g);
  for (let x = x0 + 0.06; x < x1 - 0.03; x += 0.12) b.box(x, 0.52, 0.338, 0.105, 0.86, 0.012, b.wood, g);
  b.box(cx, 0.15, 0.4, w, 0.03, 0.03, b.chrome, g);
  b.box(cx, 0.86, -0.22, w, 0.03, 0.26, b.steel, g);
  b.box(cx, 0.43, -0.22, w, 0.8, 0.24, b.dark, g);
  for (const [x, s, capped] of [[x0, 1, capL], [x1, -1, capR]] as const)
    b.box(x + s * (capped ? 0.02 : 0.01), 0.5, 0.05, capped ? 0.04 : 0.02, 0.97, 0.6, capped ? b.wood : b.woodTrim, g);
  // Staff-side clutter: a sake bottle, a stack of bowls, a cloth.
  if (b.random() < 0.6) b.item("bottle", 0x2f3a2c, cx + (b.random() - 0.5) * (w - 0.2), 0.875, -0.25, 0.09, 0.3, 0.09, g);
  if (b.random() < 0.6 && w > 0.5) for (let k = 0; k < 3; k++) b.item("cup", 0xe6e1d6, x1 - 0.12, 0.875 + k * 0.04, -0.2, 0.12, 0.04, 0.12, g);
}

export function woodCounter(b: Build, piece: "straight" | "end" | "end-left" | "corner") {
  if (piece === "corner") {
    woodCounterRun(b, b.root, -H, 0.35, true);
    woodCounterRun(b, b.frame(Math.PI / 2), 0.35, H, false);
    return;
  }
  woodCounterRun(b, b.root, -H, H, piece === "end", piece === "end-left");
}

export function stool(b: Build) {
  const vinyl = b.kit.material(b.variant % 2 ? 0x6e2a26 : 0x1f1d1c, 0, 0.5);
  b.cyl(0, 0.68, 0, 0.17, 0.06, vinyl, 14);
  b.cyl(0, 0.645, 0, 0.15, 0.015, b.woodTrim, 12);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const leg = b.tube(new T.Vector3(Math.sin(a) * 0.1, 0.64, Math.cos(a) * 0.1), new T.Vector3(Math.sin(a) * 0.17, 0.012, Math.cos(a) * 0.17), 0.014, b.wood);
    leg.castShadow = true;
  }
  b.ring(0, 0.22, 0, 0.15, 0.008, b.wood, b.root, 12).rotation.x = Math.PI / 2;
}

function chair(b: Build, x: number, z: number, yaw: number) {
  const g = b.frame(yaw, x, z);
  b.box(0, 0.44, 0, 0.38, 0.035, 0.36, b.wood, g);
  for (const sx of [-0.16, 0.16]) for (const sz of [-0.15, 0.15]) b.box(sx, 0.22, sz, 0.03, 0.44, 0.03, b.woodTrim, g);
  for (const sx of [-0.16, 0.16]) b.box(sx, 0.66, -0.165, 0.03, 0.44, 0.03, b.woodTrim, g);
  b.box(0, 0.8, -0.165, 0.36, 0.1, 0.02, b.wood, g);
  b.box(0, 0.62, -0.165, 0.36, 0.05, 0.02, b.wood, g);
}

export function table(b: Build, seats: 2 | 4) {
  const [w, d] = seats === 2 ? [0.62, 0.62] : [0.75, 1.4];
  b.box(0, 0.685, 0, w, 0.03, d, b.wood);
  b.box(0, 0.655, 0, w - 0.06, 0.03, d - 0.06, b.woodTrim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.05), 0.33, sz * (d / 2 - 0.05), 0.045, 0.66, 0.045, b.woodTrim);
  if (seats === 2) { chair(b, 0, -0.47, 0); chair(b, 0, 0.47, Math.PI); return; }
  for (const z of [-0.35, 0.35]) { chair(b, -0.5, z, Math.PI / 2); chair(b, 0.5, z, -Math.PI / 2); }
}

export function beerCrates(b: Build) {
  const colors = [0xd9a52b, 0xa8322a, 0x3d6b45, 0x2f4f7a];
  for (const sx of [-0.25, 0.25]) for (let k = 0; k < 3; k++) {
    if (sx > 0 && k === 2 && b.random() < 0.5) continue;
    const plastic = b.kit.material(b.pick(colors), 0, 0.65), y = k * 0.29;
    const g = b.frame((b.random() - 0.5) * 0.08, sx, (b.random() - 0.5) * 0.04);
    b.box(0, y + 0.015, 0, 0.46, 0.03, 0.36, plastic, g);
    for (const s of [-1, 1]) {
      b.box(0, y + 0.145, s * 0.17, 0.46, 0.26, 0.02, plastic, g);
      b.box(s * 0.22, y + 0.145, 0, 0.02, 0.26, 0.34, plastic, g);
      b.box(s * 0.231, y + 0.22, 0, 0.004, 0.04, 0.12, b.dark, g);
    }
    if (k === 2 || (sx > 0 && k === 1)) for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++)
      b.item("can", 0x3a2a1a, -0.18 + i * 0.09, y + 0.03, -0.12 + j * 0.08, 0.06, 0.25, 0.06, g);
  }
}

export function sakeBarrel(b: Build) {
  const straw = b.kit.material(0xb8a074, 0, 0.95), rope = b.kit.material(0x3a2e22, 0, 0.9);
  b.box(0, 0.1, 0, 0.66, 0.2, 0.66, b.woodTrim);
  b.cyl(0, 0.49, 0, 0.31, 0.58, straw, 14);
  for (const y of [0.24, 0.49, 0.74]) b.cyl(0, y, 0, 0.315, 0.03, rope, 14);
  b.cyl(0, 0.785, 0, 0.29, 0.02, b.hinoki, 14);
  b.sign("nihonshu", 0, 0.49, 0.316, 0.16, 0.42, b.root, "print", false);
}

export function grill(b: Build) {
  const ember = b.kit.material(0x57251a, 0.1, 0.9, 1.6, 0xff6b24);
  b.box(0, 0.09, 0, 0.62, 0.18, 0.24, b.steel);
  b.box(0, 0.175, 0, 0.56, 0.01, 0.18, b.dark);
  for (let i = 0; i < 9; i++) b.box(-0.24 + i * 0.06, 0.185, (b.random() - 0.5) * 0.06, 0.05, 0.02, 0.05, ember);
  for (let i = 0; i < 5; i++) {
    const x = -0.2 + i * 0.1;
    b.box(x, 0.21, 0, 0.006, 0.006, 0.3, b.hinoki);
    for (let k = 0; k < 3; k++) b.item("box", b.pick([0x8a4a2a, 0xa8623a, 0x6a3a22]), x, 0.2, -0.06 + k * 0.05, 0.03, 0.025, 0.035);
  }
  for (const s of [-1, 1]) b.box(0, 0.2, s * 0.12, 0.62, 0.03, 0.01, b.steel);
}

// ---------------------------------------------------------------------------
// Tableware: surface clutter, base on the host's top.

export type Ware = "sake-set" | "beer-bottle" | "shochu" | "whisky" | "plates" | "bowl" | "chopsticks" | "caddy"
  | "napkins" | "towel" | "ashtray" | "menu-card";

export function ware(b: Build, kind: Ware, g: T.Object3D = b.root) {
  const glass = b.kit.glass(0xd8c49a, 0.35);
  switch (kind) {
    case "sake-set":
      b.item("bottle", 0xe6e1d6, 0, 0, 0, 0.08, 0.13, 0.08, g); b.item("can", 0xe6e1d6, 0, 0.13, 0, 0.03, 0.05, 0.03, g);
      for (const x of [0.09, 0.14]) b.item("cup", 0xe6e1d6, x, 0, 0.04, 0.05, 0.035, 0.05, g);
      break;
    case "beer-bottle":
      b.item("bottle", 0x4a2a14, 0, 0, 0, 0.075, 0.2, 0.075, g); b.item("can", 0x4a2a14, 0, 0.2, 0, 0.03, 0.07, 0.03, g);
      b.box(0, 0.11, 0.038, 0.05, 0.06, 0.002, b.paper, g);
      b.cyl(0.1, 0.06, 0.03, 0.035, 0.12, glass, 10, g);
      b.item("can", 0xf2ecd8, 0.1, 0.1, 0.03, 0.068, 0.025, 0.068, g);
      break;
    case "shochu":
      b.item("bottle", 0x2f3a2c, 0, 0, 0, 0.1, 0.27, 0.1, g); b.item("can", 0x2f3a2c, 0, 0.27, 0, 0.035, 0.08, 0.035, g);
      b.box(0, 0.14, 0.051, 0.07, 0.1, 0.002, b.paper, g);
      break;
    case "whisky":
      b.item("box", 0x7a4a1a, 0, 0, 0, 0.08, 0.19, 0.05, g); b.item("can", 0x1a1a1a, 0, 0.19, 0, 0.03, 0.04, 0.03, g);
      b.box(0, 0.09, 0.026, 0.06, 0.06, 0.002, b.paper, g);
      break;
    case "plates":
      for (const [x, z, c] of [[-0.06, 0, 0xe6e1d6], [0.08, 0.05, 0x2c3a5a], [0.02, -0.09, 0xe6e1d6]] as const) {
        b.item("can", c, x, 0, z, 0.15, 0.015, 0.15, g);
        b.item("box", b.pick([0x8a5a35, 0x6d7d3e, 0xc9b48a, 0x9b3a2f]), x, 0.015, z, 0.06, 0.025, 0.05, g);
      }
      break;
    case "bowl":
      b.item("cup", 0x2c2a28, 0, 0, 0, 0.11, 0.06, 0.11, g).rotation.x = Math.PI;
      b.item("cup", 0x2c2a28, 0, 0.0, 0, 0.12, 0.06, 0.12, g);
      b.item("ball", tones.rice, 0, 0.055, 0, 0.1, 0.03, 0.1, g);
      break;
    case "chopsticks":
      b.item("box", 0xc9ab80, 0, 0, 0, 0.03, 0.012, 0.015, g);
      for (const x of [-0.006, 0.006]) b.item("box", 0x3a2a1a, x, 0.01, 0.05, 0.006, 0.006, 0.21, g);
      break;
    case "caddy":
      b.box(0, 0.03, 0, 0.2, 0.06, 0.1, b.wood, g);
      b.item("bottle", 0xf2ecd8, -0.05, 0.06, 0, 0.04, 0.08, 0.04, g); b.item("box", 0xa8322a, -0.05, 0.14, 0, 0.025, 0.02, 0.025, g);
      b.item("can", 0xb8463a, 0.01, 0.06, 0, 0.03, 0.07, 0.03, g);
      b.item("can", 0xc9ab80, 0.06, 0.06, 0, 0.035, 0.06, 0.035, g);
      for (let i = 0; i < 6; i++) b.item("box", 0xc9ab80, 0.07, 0.06, -0.03 + i * 0.005, 0.004, 0.2, 0.004, g);
      break;
    case "napkins":
      b.item("box", 0xe9e4d5, 0, 0, 0, 0.13, 0.065, 0.1, g); b.item("box", 0xffffff, 0, 0.065, 0, 0.04, 0.02, 0.06, g);
      break;
    case "towel":
      b.item("box", 0x6a4a30, 0, 0, 0, 0.1, 0.008, 0.18, g);
      b.item("can", 0xf0ece2, 0, 0.008, 0, 0.04, 0.16, 0.04, g).rotation.x = Math.PI / 2;
      break;
    case "ashtray":
      b.cyl(0, 0.012, 0, 0.055, 0.024, glass, 12, g);
      for (let i = 0; i < 3; i++) b.item("box", 0xe9e4d5, -0.02 + i * 0.02, 0.02, (b.random() - 0.5) * 0.04, 0.008, 0.008, 0.03, g).rotation.y = b.random() * 3;
      break;
    case "menu-card":
      for (const s of [-1, 1]) b.box(0, 0.08, s * 0.025, 0.1, 0.16, 0.003, b.paper, g).rotation.x = s * 0.3;
      b.box(0, 0.1, 0.05, 0.07, 0.008, 0.002, b.kit.material(0x9a2a22, 0, 0.8), g).rotation.x = 0.3;
      break;
  }
}

const sets: Record<string, [Ware, number, number, number][]> = {
  drinks: [["beer-bottle", -0.12, -0.1, 0], ["beer-bottle", 0.14, 0.12, 2], ["plates", 0, 0.02, 0], ["chopsticks", -0.2, 0.15, 0], ["towel", 0.2, -0.15, 1]],
  dinner: [["plates", -0.1, 0, 0], ["bowl", 0.15, -0.12, 0], ["bowl", 0.15, 0.12, 0], ["chopsticks", -0.2, 0.18, 0], ["chopsticks", 0.22, -0.2, 3], ["caddy", 0, -0.2, 0]],
  sake: [["sake-set", 0, 0, 0], ["plates", 0.15, 0.12, 0], ["chopsticks", -0.18, 0.16, 0], ["menu-card", -0.15, -0.18, 0]],
  late: [["beer-bottle", -0.1, -0.12, 1], ["shochu", 0.16, -0.1, 0], ["ashtray", 0.05, 0.12, 0], ["napkins", -0.18, 0.15, 0], ["chopsticks", 0.2, 0.18, 2]],
};

/** A pre-arranged table: one click dresses a two-seat table. */
export function tableSet(b: Build, name: string) {
  for (const [kind, x, z, turn] of sets[name]) {
    const g = b.frame(turn * 0.7 + (b.random() - 0.5) * 0.3, x + (b.random() - 0.5) * 0.03, z);
    ware(b, kind, g);
  }
}

// ---------------------------------------------------------------------------
// Coffee shop.

export function espresso(b: Build) {
  const gauge = b.ceramic;
  b.box(0, 0.2, 0, 0.72, 0.4, 0.48, b.chrome);
  b.box(0, 0.2, 0.0, 0.74, 0.3, 0.46, b.dark);
  b.box(0, 0.405, -0.02, 0.7, 0.012, 0.42, b.steel);
  for (let i = 0; i < 6; i++) b.item("cup", 0xe6e1d6, -0.25 + i * 0.1, 0.411, -0.08 + (i % 2) * 0.1, 0.07, 0.06, 0.07).rotation.x = Math.PI;
  b.box(0, 0.035, 0.29, 0.62, 0.03, 0.12, b.steel);
  for (let x = -0.28; x <= 0.28; x += 0.04) b.box(x, 0.052, 0.29, 0.01, 0.004, 0.1, b.dark);
  for (const x of [-0.17, 0.17]) {
    b.cyl(x, 0.27, 0.27, 0.05, 0.06, b.chrome, 12);
    b.cyl(x, 0.225, 0.27, 0.045, 0.03, b.dark, 12);
    b.box(x, 0.222, 0.36, 0.035, 0.025, 0.14, b.dark).rotation.y = 0.2;
    b.item("cup", 0xe6e1d6, x, 0.05, 0.27, 0.07, 0.06, 0.07);
  }
  for (const x of [-0.08, 0.08]) {
    b.cyl(x, 0.33, 0.245, 0.035, 0.012, b.chrome, 14).rotation.x = Math.PI / 2;
    b.cyl(x, 0.33, 0.252, 0.03, 0.004, gauge, 14).rotation.x = Math.PI / 2;
  }
  for (const s of [-1, 1]) b.tube(new T.Vector3(s * 0.33, 0.3, 0.25), new T.Vector3(s * 0.36, 0.08, 0.32), 0.008, b.chrome);
  for (let i = 0; i < 4; i++) b.box(-0.06 + i * 0.04, 0.37, 0.241, 0.018, 0.012, 0.004, glow(b, 0x9fd7e0, 0.7));
}

export function grinder(b: Build) {
  const beans = b.kit.material(0x3a2416, 0, 0.8), hopper = b.kit.glass(0x8a6a4a, 0.35);
  b.box(0, 0.04, 0.02, 0.18, 0.08, 0.22, b.dark);
  b.box(0, 0.2, -0.02, 0.16, 0.26, 0.16, b.chrome);
  b.cyl(0, 0.43, -0.02, 0.06, 0.15, beans, 10, b.root, 0.075);
  b.cyl(0, 0.44, -0.02, 0.05, 0.2, hopper, 12, b.root, 0.09);
  b.cyl(0, 0.55, -0.02, 0.092, 0.015, b.dark, 12);
  b.box(0, 0.12, 0.08, 0.06, 0.05, 0.06, b.dark);
}

export function pourOver(b: Build) {
  const glass = b.kit.glass(0xd8e0e2, 0.3), coffee = b.kit.material(0x2a1a10, 0, 0.3);
  b.box(0, 0.015, 0, 0.42, 0.03, 0.2, b.wood);
  for (const x of [-0.19, 0.19]) b.box(x, 0.15, 0, 0.03, 0.27, 0.06, b.wood);
  b.box(0, 0.28, 0, 0.42, 0.025, 0.14, b.wood);
  for (const x of [-0.09, 0.09]) {
    b.item("cup", 0xe6e1d6, x, 0.285, 0, 0.12, 0.08, 0.12);
    b.cyl(x, 0.085, 0, 0.05, 0.11, glass, 10);
    b.cyl(x, 0.06, 0, 0.044, 0.05, coffee, 10);
  }
  b.cyl(0.3, 0.07, 0.02, 0.065, 0.14, b.steel, 12);
  b.tube(new T.Vector3(0.25, 0.06, 0.03), new T.Vector3(0.18, 0.17, 0.05), 0.006, b.steel);
  b.box(0.37, 0.09, 0.02, 0.02, 0.11, 0.03, b.dark);
}

export function cups(b: Build) {
  for (const [x, z, n] of [[-0.08, 0, 4], [0.06, 0.02, 3]] as const)
    for (let k = 0; k < n; k++) b.item("can", 0xe6e1d6, x, k * 0.012, z, 0.14, 0.01, 0.14);
  for (const [x, z, n] of [[-0.06, -0.12, 3], [0.09, -0.1, 2]] as const)
    for (let k = 0; k < n; k++) b.item("cup", 0xe6e1d6, x, k * 0.05, z, 0.08, 0.065, 0.08);
}

export function pastryCase(b: Build) {
  const glass = b.kit.glass(0xd8e6ea, 0.18), cakes = [0xe8dcc8, 0xd88e9a, 0x5a3a2a, 0xe1c46a, 0x9a3a2f, 0xf0ece2];
  b.box(0, 0.05, 0, 0.72, 0.1, 0.42, b.wood);
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) b.box(x * 0.35, 0.3, z * 0.2, 0.02, 0.4, 0.02, b.chrome);
  b.box(0, 0.5, 0, 0.72, 0.012, 0.42, glass);
  b.box(0, 0.3, 0.205, 0.7, 0.4, 0.008, glass);
  for (const x of [-1, 1]) b.box(x * 0.355, 0.3, 0, 0.008, 0.4, 0.4, glass);
  b.box(0, 0.495, 0, 0.66, 0.008, 0.06, glow(b, 0xfff0d8, 0.8));
  for (const y of [0.1, 0.29]) {
    b.box(0, y + 0.005, 0, 0.66, 0.01, 0.36, glass);
    for (let i = 0; i < 4; i++) for (const z of [-0.08, 0.08]) {
      const c = b.pick(cakes), x = -0.24 + i * 0.16;
      b.item(b.random() < 0.6 ? "tri" : "can", c, x, y + 0.01, z, 0.08, 0.07, 0.07);
      b.item("box", 0xe6e1d6, x, y + 0.01, z, 0.11, 0.004, 0.1);
    }
  }
}

export function menuBoard(b: Build) {
  const board = b.kit.material(0x2b2420, 0, 0.9);
  b.box(0, 0, 0, 0.92, 0.66, 0.03, b.woodTrim);
  b.box(0, 0, 0.016, 0.84, 0.58, 0.004, board);
  b.sign("coffee", 0, 0.2, 0.02, 0.4, 0.12);
  ["blend", "tea", "cake", "napolitan"].forEach((id, i) => {
    const y = 0.06 - i * 0.085;
    b.sign(id, -0.16, y, 0.02, 0.36, 0.06, b.root, "print");
    for (let k = 0; k < 6; k++) b.box(0.08 + k * 0.03, y - 0.015, 0.02, 0.008, 0.004, 0.001, b.kit.material(0xf2e6cc, 0, 0.8));
    b.box(0.32, y, 0.02, 0.06, 0.02, 0.001, b.kit.material(0xf2e6cc, 0, 0.8));
  });
}

export function cafeTable(b: Build) {
  b.cyl(0, 0.705, 0, 0.32, 0.03, b.wood, 20);
  b.cyl(0, 0.36, 0, 0.03, 0.68, b.dark, 8);
  b.cyl(0, 0.015, 0, 0.21, 0.03, b.dark, 16);
}

export function cafeChair(b: Build) {
  b.cyl(0, 0.45, 0, 0.2, 0.035, b.wood, 16);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    b.tube(new T.Vector3(Math.sin(a) * 0.13, 0.44, Math.cos(a) * 0.13), new T.Vector3(Math.sin(a) * 0.18, 0.01, Math.cos(a) * 0.18), 0.012, b.woodTrim);
  }
  b.ring(0, 0.2, 0, 0.15, 0.007, b.woodTrim, b.root, 12).rotation.x = Math.PI / 2;
  for (const x of [-0.13, 0.13]) b.tube(new T.Vector3(x, 0.45, -0.15), new T.Vector3(x * 1.1, 0.88, -0.2), 0.012, b.woodTrim);
  const back = b.ring(0, 0.86, -0.15, 0.15, 0.014, b.woodTrim, b.root, 12);
  back.rotation.x = Math.PI / 2; back.scale.z = 0.4;
}

export function pendant(b: Build) {
  const shade = b.kit.material(b.variant % 2 ? 0x2d4a3e : 0x1c1c1e, 0.5, 0.45);
  b.cyl(0, 2.43, 0, 0.005, 0.54, b.dark, 4);
  b.cyl(0, 2.1, 0, 0.14, 0.14, shade, 16, b.root, 0.04);
  b.cyl(0, 2.02, 0, 0.04, 0.05, b.warm, 10);
}

// ---------------------------------------------------------------------------
// Bar.

/** A self-contained soft-drinks fridge: both sides, a back, a lit interior and a glass door. */
export function barFridge(b: Build) {
  const glass = b.kit.glass(0xa8d0d6, 0.16), w = 0.62, d = 0.62;
  b.box(0, 0.06, 0, w - 0.04, 0.12, d - 0.06, b.dark);
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.02), 0.94, 0, 0.04, 1.76, d, b.body);
  b.box(0, 0.94, -d / 2 + 0.02, w, 1.76, 0.04, b.body);
  b.box(0, 1.76, 0, w, 0.18, d, b.body);
  b.box(0, 1.76, d / 2 + 0.005, w - 0.02, 0.12, 0.01, b.header);
  b.box(0, 1.705, d / 2 + 0.011, w - 0.02, 0.016, 0.003, b.stripe);
  b.box(0, 0.94, -d / 2 + 0.045, w - 0.08, 1.5, 0.01, b.cold);
  b.box(0, 1.655, d / 2 - 0.08, w - 0.1, 0.018, 0.025, b.strip);
  const rows = ["big", "pet", "pet", "can", "can"] as const;
  [0.14, 0.47, 0.78, 1.09, 1.4].forEach((y, k) => {
    if (k) b.box(0, y, 0, w - 0.08, 0.012, d - 0.12, b.wire);
    fillRow(b, b.root, rows[k], -w / 2 + 0.05, w / 2 - 0.05, y + 0.006, d / 2 - 0.08);
  });
  b.box(0, 0.14, 0, w - 0.08, 0.02, d - 0.1, b.dark);
  const door = b.part("door-hinge", -w / 2 + 0.02, 0, d / 2 + 0.01);
  b.box(w / 2 - 0.02, 0.95, 0, w - 0.06, 1.56, 0.01, glass, door);
  for (const y of [0.15, 1.69]) b.box(w / 2 - 0.02, y, 0, w - 0.04, 0.05, 0.03, b.steel, door);
  for (const x of [0.012, w - 0.052]) b.box(x, 0.92, 0, 0.025, 1.6, 0.03, b.steel, door);
  b.box(w - 0.1, 1.0, 0.035, 0.022, 0.45, 0.022, b.chrome, door);
  for (let x = -0.22; x <= 0.22; x += 0.04) b.box(x, 0.06, d / 2 - 0.02, 0.02, 0.06, 0.01, b.wire);
}

const BACKBAR_D = 0.45;
const spirits = [0x7a4a1a, 0x2f3a2c, 0xd8d6cc, 0x4a2a14, 0x9ab0b4, 0x5a1f2a, 0xc89a3e, 0x2a3442];

function backBarBay(b: Build, g: T.Object3D, x0: number, x1: number, { capL, capR }: { capL: boolean; capR: boolean }) {
  const d = BACKBAR_D, zc = BACK + d / 2, front = BACK + d, cx = (x0 + x1) / 2, w = x1 - x0;
  const mirror = b.kit.material(0x2a3438, 0.9, 0.12), shelfGlass = b.kit.glass(0xc8e0e4, 0.35);
  const amber = b.kit.material(0xffcf8a, 0, 0.4, 1.0, 0xffb060);
  b.box(cx, 0.05, zc - 0.02, w, 0.1, d - 0.04, b.woodTrim, g);
  b.box(cx, 0.49, zc, w, 0.78, d, b.wood, g);
  for (let x = x0 + 0.34; x < x1 - 0.1; x += 0.34) b.box(x, 0.49, front + 0.002, 0.008, 0.72, 0.004, b.woodTrim, g);
  for (let x = x0 + 0.17; x < x1 - 0.05; x += 0.34) b.box(x, 0.7, front + 0.012, 0.08, 0.015, 0.015, b.chrome, g);
  b.box(cx, 0.9, zc + 0.01, w, 0.04, d + 0.02, b.woodTrim, g);
  b.box(cx, 1.49, BACK + 0.012, w, 1.14, 0.024, mirror, g);
  b.box(cx, 2.11, BACK + 0.08, w, 0.12, 0.16, b.woodTrim, g);
  b.box(cx, 2.045, BACK + 0.12, w, 0.012, 0.05, amber, g);
  fillBottles(b, g, x0, x1, 0.92, BACK + 0.3);
  for (const y of [1.22, 1.52, 1.82]) {
    b.box(cx, y, BACK + 0.13, w, 0.012, 0.22, shelfGlass, g);
    b.box(cx, y - 0.012, BACK + 0.035, w, 0.01, 0.025, amber, g);
    fillBottles(b, g, x0, x1, y + 0.006, BACK + 0.2);
  }
  for (const [x, capped, s] of [[x0, capL, 1], [x1, capR, -1]] as const) {
    if (capped) b.box(x + s * 0.02, 1.08, zc, 0.04, 2.16, d, b.woodTrim, g);
    else b.box(x + s * 0.01, 1.49, BACK + 0.05, 0.02, 1.14, 0.06, b.woodTrim, g);
  }
}

function fillBottles(b: Build, g: T.Object3D, x0: number, x1: number, y: number, z: number) {
  for (let x = x0 + 0.06; x < x1 - 0.05; x += 0.075 + b.random() * 0.03) {
    if (b.random() < 0.1) continue;
    const color = b.pick(spirits), h = 0.2 + b.random() * 0.1, square = b.random() < 0.3;
    b.item(square ? "box" : "bottle", color, x, y, z, 0.07, h, 0.07, g);
    b.item("can", b.random() < 0.5 ? 0x1a1a1a : 0xc2c9cb, x, y + h, z, 0.026, 0.06, 0.026, g);
  }
}

export const backBar = (b: Build, piece: RunPiece) => wallRun(b, piece, BACKBAR_D, 2.17, backBarBay);

export function tap(b: Build) {
  b.box(0, 0.01, 0.05, 0.34, 0.02, 0.14, b.steel);
  for (let x = -0.15; x <= 0.15; x += 0.03) b.box(x, 0.022, 0.05, 0.012, 0.004, 0.12, b.dark);
  b.cyl(0, 0.2, -0.02, 0.035, 0.38, b.chrome, 10);
  b.cyl(0, 0.4, -0.02, 0.03, 0.34, b.chrome, 10).rotation.z = Math.PI / 2;
  for (const x of [-0.11, 0.11]) {
    b.cyl(x, 0.36, 0.02, 0.012, 0.08, b.chrome, 8).rotation.x = Math.PI / 2;
    b.box(x, 0.47, -0.01, 0.028, 0.13, 0.028, b.variant % 2 ? b.dark : b.woodTrim);
  }
}

export function glassRack(b: Build) {
  const plastic = b.kit.material(0x2a3036, 0, 0.7), glass = b.kit.glass(0xd8e6ea, 0.3);
  b.box(0, 0.01, 0, 0.5, 0.02, 0.5, plastic);
  for (const s of [-1, 1]) { b.box(0, 0.05, s * 0.245, 0.5, 0.08, 0.01, plastic); b.box(s * 0.245, 0.05, 0, 0.01, 0.08, 0.5, plastic); }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) b.cyl(-0.18 + i * 0.12, 0.07, -0.18 + j * 0.12, 0.04, 0.11, glass, 8);
}

export function iceBucket(b: Build) {
  const ice = b.kit.glass(0xe6f2f4, 0.6);
  b.cyl(-0.06, 0.08, 0, 0.1, 0.16, b.steel, 14, b.root, 0.11);
  for (let i = 0; i < 6; i++) b.box(-0.06 + (b.random() - 0.5) * 0.1, 0.16, (b.random() - 0.5) * 0.1, 0.04, 0.03, 0.04, ice).rotation.y = b.random() * 3;
  b.cyl(0.1, 0.09, 0.02, 0.035, 0.18, b.chrome, 12, b.root, 0.03);
  b.cyl(0.1, 0.2, 0.02, 0.025, 0.05, b.chrome, 10, b.root, 0.012);
  b.cyl(0.16, 0.025, -0.06, 0.02, 0.05, b.chrome, 10, b.root, 0.012);
}

/** An abstract cocktail glass in neon tubing inside a cold frame: no words. */
export function neon(b: Build) {
  const pink = glow(b, 0xff4fa0, 1.8), cyan = glow(b, 0x7fe6ff, 1.6);
  b.box(0, 0, -0.005, 0.66, 0.5, 0.01, b.kit.material(0x15181b, 0.2, 0.6));
  const tube = (x0: number, y0: number, x1: number, y1: number, m: T.Material) =>
    b.tube(new T.Vector3(x0, y0, 0.03), new T.Vector3(x1, y1, 0.03), 0.009, m);
  tube(-0.14, 0.14, 0.14, 0.14, pink); tube(-0.14, 0.14, 0, -0.02, pink); tube(0.14, 0.14, 0, -0.02, pink);
  tube(0, -0.02, 0, -0.16, pink); tube(-0.08, -0.16, 0.08, -0.16, pink);
  b.ring(0.06, 0.1, 0.03, 0.025, 0.008, pink, b.root, 12);
  tube(-0.3, 0.22, 0.3, 0.22, cyan); tube(-0.3, -0.22, 0.3, -0.22, cyan);
  tube(-0.3, 0.22, -0.3, -0.22, cyan); tube(0.3, 0.22, 0.3, -0.22, cyan);
}
