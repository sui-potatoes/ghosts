// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The konbini as a building: thin walls with built-in fixtures (the Wall
 * tiles of the store), thin edge partitions, the self-checkout and packing
 * table, the ATM, multi-purpose terminal and copier, the sign kit with the
 * chains' marks, the roof and ceiling, and a light fixture for every lamp a
 * level hangs. Wall-backed pieces: back on the north edge at turn 0, front +z.
 */
import * as T from "three";
import type { RunPiece } from "./catalog.ts";
import { BACK, Build, C, H } from "./kit.ts";
import { chiller, fridge, wallShelf } from "./konbini.ts";
import { SHELL_T, shell } from "./street.ts";

const glow = (b: Build, color: number, strength = 1.2) => b.kit.material(color, 0, 0.4, strength, color);

// ---------------------------------------------------------------------------
// Built-ins: the thin store wall with a full-depth fixture standing against it.

/** The dark plinth from a fixture's front to the tile's edge: the Wall tile's leftover floor. */
function plinth(b: Build, front: number) {
  void b; void front; // the shop floor runs under the fixture to the wall
}

export type BuiltIn = `fridge-${RunPiece}` | `chiller-${RunPiece}` | `shelf-${RunPiece}` | "cigarettes" | "atm" | "terminal" | "copier" | "stock";

export function builtIn(b: Build, kind: BuiltIn) {
  shell(b, "store", false);
  const [family, piece] = kind.split("-") as [string, RunPiece];
  if (family === "fridge") { fridge(b, piece); plinth(b, BACK + 0.8); return; }
  if (family === "chiller") { chiller(b, piece); plinth(b, BACK + 0.82); return; }
  if (family === "shelf") { wallShelf(b, piece); plinth(b, BACK + 0.47); return; }
  if (kind === "cigarettes") return cigarettes(b);
  if (kind === "stock") return stockShelving(b);
  machine(b, kind as "atm" | "terminal" | "copier");
}

/** The back-counter cigarette display: numbered rows of packs behind clear fronts, lit. */
function cigarettes(b: Build) {
  const d = 0.35, front = -H + SHELL_T + d;
  b.box(0, 1.1, -H + SHELL_T + d / 2, C, 2.2, d, b.body);
  b.box(0, 1.25, front + 0.002, C - 0.1, 1.5, 0.004, b.kit.material(0x15181b, 0.2, 0.6));
  for (let r = 0; r < 8; r++) for (let x = -0.6; x < 0.6; x += 0.06) {
    const y = 0.6 + r * 0.18;
    b.item("box", b.pick([0xe8e4d8, 0x2a3a5a, 0xb8322a, 0x3a5a3a, 0xc8b070, 0x1a1a1a, 0x8a9aa8]), x, y, front - 0.03, 0.05, 0.08, 0.02);
    if (x < -0.55) b.box(0, y - 0.015, front + 0.006, C - 0.1, 0.012, 0.004, glow(b, 0xe8f4ff, 0.6));
  }
  b.box(0, 2.1, front + 0.004, C - 0.1, 0.12, 0.006, b.header);
  b.box(0, 0.25, front + 0.004, C - 0.1, 0.4, 0.006, b.dark);
  plinth(b, front);
}

function stockShelving(b: Build) {
  const steel = b.kit.material(0x8a9094, 0.6, 0.45), carton = [0x9c8160, 0xa88c66, 0x8a7052, 0xb8a080];
  for (const x of [-0.6, 0.6]) for (const z of [-H + SHELL_T + 0.04, -H + SHELL_T + 0.56]) b.box(x, 1.0, z, 0.04, 2.0, 0.04, steel);
  for (const y of [0.1, 0.6, 1.1, 1.6, 2.0]) {
    b.box(0, y, -H + SHELL_T + 0.3, 1.24, 0.03, 0.6, steel);
    if (y > 1.9) continue;
    for (let x = -0.5; x < 0.55; x += 0.34) if (b.random() < 0.85)
      b.item("box", b.pick(carton), x + (b.random() - 0.5) * 0.04, y + 0.015, -H + SHELL_T + 0.3, 0.3, 0.2 + b.random() * 0.22, 0.45);
  }
  plinth(b, -H + SHELL_T + 0.62);
}

/** The ATM, the multi-purpose ticket terminal, the copier: wall-backed machines with lit screens. */
function machine(b: Build, kind: "atm" | "terminal" | "copier") {
  const screen = b.kit.material(0x183b48, 0.1, 0.5, 0.8), z0 = -H + SHELL_T;
  if (kind === "copier") {
    const shell = b.kit.material(0xd8d6cc, 0.2, 0.6);
    b.box(0, 0.5, z0 + 0.35, 0.65, 1.0, 0.6, shell);
    b.box(0, 1.04, z0 + 0.35, 0.62, 0.08, 0.56, b.dark);
    b.box(0.2, 1.1, z0 + 0.62, 0.22, 0.04, 0.14, screen);
    for (const y of [0.25, 0.55]) b.box(0, y, z0 + 0.652, 0.58, 0.22, 0.006, b.kit.material(0xb8b6ae, 0.2, 0.6));
    b.box(0.4, 0.75, z0 + 0.35, 0.16, 0.04, 0.4, b.paper);
    plinth(b, z0 + 0.66);
    return;
  }
  const atm = kind === "atm";
  const cabinet = b.kit.material(atm ? 0x3a4a5a : 0xe8e6de, 0.3, 0.5);
  b.box(0, 0.75, z0 + 0.3, 0.7, 1.5, 0.6, cabinet);
  b.box(0, 1.6, z0 + 0.2, 0.7, 0.3, 0.4, atm ? b.header : b.kit.material(0x2f6fa8, 0.2, 0.5));
  if (atm) b.sign("atm", 0, 1.6, z0 + 0.402, 0.4, 0.14, b.root, "lit");
  const face = b.frame(0, 0, z0 + 0.6);
  const panel = b.box(0, 1.15, 0.02, 0.5, 0.36, 0.06, b.dark, face);
  panel.rotation.x = -0.35;
  b.box(0, 1.16, 0.06, 0.4, 0.26, 0.004, screen, face).rotation.x = -0.35;
  b.box(0, 0.88, 0.02, 0.3, 0.03, 0.02, b.chrome, face);
  b.box(0.2, 0.95, 0.03, 0.08, 0.02, 0.02, b.dark, face);
  b.box(0, 0.6, 0.004, 0.36, 0.08, 0.008, b.dark, face);
  // A privacy hood over an ATM's screen.
  if (atm) for (const x of [-0.3, 0.3]) b.box(x, 1.2, 0.12, 0.02, 0.5, 0.24, cabinet, face);
  plinth(b, z0 + 0.62);
}

// ---------------------------------------------------------------------------
// Thin edge walls for interior divisions and the outside skin.

/** `partition`: painted both sides. `exterior`: the store's tile and fascia on -z, paint on +z (faces in). */
export function edgeWall(b: Build, exterior: boolean) {
  const paint = b.kit.material(0xc9c5b8, 0, 0.88), skirting = b.kit.material(0x3a3c3e, 0.1, 0.7);
  b.box(0, 1.5, 0, C, 3.0, 0.1, paint);
  b.box(0, 3.03, 0, C, 0.06, 0.14, b.kit.material(0x55585a, 0.1, 0.85));
  for (const s of exterior ? [1] : [1, -1]) b.box(0, 0.05, s * 0.056, C, 0.1, 0.012, skirting);
  if (!exterior) return;
  const tile = b.kit.material(0xd2cec2, 0, 0.7), joint = b.kit.material(0x9a968c, 0, 0.8);
  b.box(0, 1.22, -0.054, C, 2.34, 0.008, tile);
  for (let y = 0.35; y < 2.35; y += 0.3) b.box(0, y, -0.06, C, 0.008, 0.004, joint);
  b.box(0, 2.7, -0.062, C, 0.56, 0.024, b.header);
  b.box(0, 2.47, -0.076, C, 0.03, 0.004, b.stripe);
}

// ---------------------------------------------------------------------------
// Customer furniture.

/** The self-checkout: a standing kiosk with a screen, scanner bed, card reader and bagging shelf. */
export function selfCheckout(b: Build) {
  const shell = b.kit.material(0xd8d6cc, 0.2, 0.55), screen = b.kit.material(0x183b48, 0.1, 0.5, 0.85);
  b.box(0, 0.45, -0.1, 0.5, 0.9, 0.45, shell);
  b.box(0, 0.92, -0.05, 0.56, 0.04, 0.6, b.dark);
  b.box(0, 0.925, 0.05, 0.3, 0.012, 0.2, glow(b, 0xff4a3a, 0.5));
  b.box(0, 1.25, -0.26, 0.06, 0.65, 0.06, b.dark);
  const head = b.frame(0, 0, -0.22);
  b.box(0, 1.4, 0.02, 0.46, 0.34, 0.05, b.dark, head).rotation.x = -0.25;
  b.box(0, 1.41, 0.05, 0.4, 0.27, 0.004, screen, head).rotation.x = -0.25;
  b.box(0.3, 1.0, 0.12, 0.1, 0.06, 0.12, b.dark).rotation.x = -0.4;
  b.box(-0.45, 0.8, -0.05, 0.36, 0.03, 0.45, b.steel);
  for (const x of [-0.6, -0.3]) b.box(x, 0.4, -0.05, 0.03, 0.8, 0.4, b.steel);
  b.box(0, 1.72, -0.24, 0.24, 0.1, 0.1, b.header);
  b.box(0, 1.725, -0.188, 0.2, 0.06, 0.004, glow(b, 0x9fe0a0, 0.8));
}

/** The packing table along the window: a long laminate shelf on legs, bags and a waste bin under it. */
export function packingTable(b: Build) {
  b.box(0, 0.88, -0.35, C, 0.04, 0.5, b.laminate);
  for (const x of [-0.6, 0.6]) b.box(x, 0.44, -0.35, 0.04, 0.88, 0.45, b.body);
  b.box(0, 0.3, -0.35, C - 0.1, 0.02, 0.4, b.body);
  b.item("box", 0xe6e2d6, -0.35, 0.9, -0.4, 0.3, 0.06, 0.25);
  b.item("box", 0xe9e4d5, 0.3, 0.9, -0.42, 0.14, 0.07, 0.1);
  b.cyl(0.4, 0.17, -0.35, 0.13, 0.34, b.dark, 12);
}

/** The low magazine rack by the window: sloped tiers of covers facing the aisle (+z). */
export function magazineRack(b: Build) {
  b.box(0, 0.5, -0.4, C, 1.0, 0.12, b.body);
  for (const [y, z] of [[0.25, -0.12], [0.55, -0.2], [0.85, -0.28]] as const) {
    b.box(0, y, z, C, 0.02, 0.3, b.steel);
    for (let x = -0.58; x < 0.6; x += 0.2) {
      const cover = b.item("box", b.pick([0xc8302a, 0xe8e4d8, 0x2f6fa8, 0xd9a52b, 0x1a1a1a, 0xd88e9a]), x, y + 0.01, z + 0.05, 0.18, 0.26, 0.015);
      cover.rotation.x = -0.25;
    }
  }
  for (const x of [-0.66, 0.66]) b.box(x, 0.5, -0.25, 0.03, 1.0, 0.4, b.body);
}

export function entranceMat(b: Build) {
  b.box(0, 0.008, 0, 1.2, 0.016, 0.9, b.kit.material(0x2a2c2e, 0, 0.95));
  b.box(0, 0.017, 0.38, 1.1, 0.002, 0.04, b.stripe);
}

/** A basket stack and a plastic umbrella stand by the door. */
export function doorDecor(b: Build) {
  for (let k = 0; k < 6; k++) b.box(0.35, 0.12 + k * 0.035, -0.4, 0.46, 0.2, 0.32, b.kit.material(b.finish === "yandottir" ? 0x1d6f6a : 0x2a2238, 0, 0.6));
  b.box(-0.35, 0.3, -0.42, 0.4, 0.6, 0.18, b.steel);
  for (let i = 0; i < 4; i++) b.cyl(-0.5 + i * 0.1, 0.65, -0.42, 0.035, 0.8, b.kit.glass(0xe6eef0, 0.45), 8, b.root, 0.01);
}

// ---------------------------------------------------------------------------
// Signs: the chains' marks. Wall-mounted signs face +z, into the cell they are placed from:
// mount them from the street side.

/**
 * An original mark per chain. ELEVENTY: a plum tile holding a mustard crescent
 * moon (the store that never sleeps). YANDOTTIR: a teal tile with a cream roof
 * over a bar (a station shelter). Plain: a grey tile with a ring.
 */
function logo(b: Build, g: T.Object3D, x: number, y: number, z: number, size: number) {
  const [ground, ink] = b.finish === "eleventy" ? [0x2a2238, 0xf2c14e] : b.finish === "yandottir" ? [0x1d6f6a, 0xf6e7d0] : [0x46505a, 0xe8e8e4];
  const lit = (c: number) => b.kit.material(c, 0, 0.5, 0.7, c);
  b.box(x, y, z, size, size, 0.02, lit(ground), g);
  if (b.finish === "eleventy") {
    b.cyl(x, y, z + 0.012, size * 0.32, 0.004, lit(ink), 24, g).rotation.x = Math.PI / 2;
    b.cyl(x + size * 0.12, y + size * 0.08, z + 0.016, size * 0.27, 0.004, lit(ground), 24, g).rotation.x = Math.PI / 2;
  } else if (b.finish === "yandottir") {
    for (const s of [-1, 1]) b.box(x + s * size * 0.15, y + size * 0.05, z + 0.012, size * 0.4, size * 0.08, 0.004, lit(ink), g).rotation.z = -s * 0.5;
    b.box(x, y - size * 0.18, z + 0.012, size * 0.46, size * 0.08, 0.004, lit(ink), g);
  } else b.ring(x, y, z + 0.012, size * 0.28, size * 0.04, lit(ink), g, 20);
}

/** The fascia: a lit sign band over the glass, one module long; `mark` carries the logo and wordmark. */
export function fascia(b: Build, mark: boolean) {
  const lit = b.kit.material(0xf2f0ea, 0, 0.5, 0.55, 0xf2f0ea);
  b.box(0, 0.22, 0.07, C, 0.48, 0.14, b.header);
  b.box(0, 0.24, 0.142, C, 0.34, 0.004, lit);
  b.box(0, 0.02, 0.145, C, 0.04, 0.004, b.stripe);
  b.box(0, 0.44, 0.145, C, 0.03, 0.004, b.stripe);
  if (!mark) return;
  logo(b, b.root, -0.42, 0.24, 0.15, 0.28);
  if (b.finish !== "plain") b.sign(b.finish, 0.18, 0.24, 0.155, 0.8, 0.2);
}

/** The blade sign projecting from the wall: lit both faces, the mark over 24時間. */
export function bladeSign(b: Build) {
  const g = b.frame(Math.PI / 2, 0, 0.45);
  b.box(0, 0, 0, 0.7, 1.2, 0.12, b.header, g);
  for (const s of [1, -1]) {
    const face = b.frame(0); g.add(face); face.rotation.y = s > 0 ? 0 : Math.PI;
    logo(b, face, 0, 0.32, 0.065, 0.36);
    b.sign("24h", 0, -0.22, 0.066, 0.2, 0.6, face, "lit");
  }
  for (const y of [0.4, -0.4]) b.box(0, y, 0.05, 0.04, 0.04, 0.15, b.steel);
}

/** The forecourt pylon: a pole carrying a lit two-faced box with the mark, wordmark and 24時間. */
export function pylonSign(b: Build) {
  b.box(0, 0.1, 0, 0.5, 0.2, 0.5, b.kit.material(0x7c7d78, 0, 0.9));
  b.box(0, 2.0, 0, 0.18, 4.0, 0.18, b.steel);
  b.box(0, 4.6, 0, 1.3, 1.3, 0.3, b.header);
  for (const s of [1, -1]) {
    const face = b.frame(s > 0 ? 0 : Math.PI);
    logo(b, face, 0, 4.85, 0.155, 0.6);
    if (b.finish !== "plain") b.sign(b.finish, 0, 4.4, 0.156, 1.1, 0.22, face, "lit");
    b.box(0, 4.1, 0.156, 1.2, 0.2, 0.004, b.stripe, face);
  }
}

/** Posters and price stickers on the inside of the glass, read from the street (+z). */
export function windowPosters(b: Build) {
  const ids = ["sale", "new", "onigiri", "ice", "drinks"];
  for (let i = 0; i < 3; i++) {
    if (b.random() < 0.2) continue;
    const x = -0.42 + i * 0.42, h = 0.5 + b.random() * 0.2;
    b.item("box", b.pick([0xc8302a, 0xe8e4d8, 0xd9a52b, 0x2f6fa8]), x, -h / 2, 0.02, 0.36, h, 0.004);
    b.sign(b.pick(ids), x, 0.12 - h / 2 + h * 0.7 - h / 2, 0.025, 0.3, 0.1);
  }
}

// ---------------------------------------------------------------------------
// Roof, ceiling and light fixtures. Roof and ceiling pieces are `shop-building-` kinds, so they
// cut away cell by cell like the walls when they hide a unit or the camera's focus.

/** A store roof tile over a walkable floor: a dark deck under the walls' coping line; `plant` adds a condenser cluster. */
export function storeRoof(b: Build, plant: boolean) {
  b.box(0, 3.0, 0, C, 0.08, C, b.kit.material(0x2a2c2f, 0, 0.95));
  if (!plant) return;
  const shell = b.kit.material(0xcfccc2, 0.2, 0.55), grille = b.kit.material(0x3a3e40, 0.4, 0.5);
  for (const x of [-0.3, 0.3]) {
    b.box(x, 3.36, 0, 0.52, 0.64, 0.36, shell);
    b.cyl(x, 3.38, 0.185, 0.2, 0.01, grille, 18).rotation.x = Math.PI / 2;
  }
  b.box(0, 3.1, -0.3, 1.1, 0.12, 0.12, b.kit.material(0x9a968c, 0.3, 0.6));
}

/** A recessed LED panel in the ceiling; the lit one carries a lamp, the plain one only glows. */
export function ceilingLight(b: Build, lit: boolean) {
  b.box(0, 2.95, 0, 1.2, 0.04, 0.6, b.kit.material(0xb8b6ae, 0.3, 0.5));
  b.box(0, 2.928, 0, 1.12, 0.004, 0.52, b.kit.material(0xf2f8fa, 0, 0.4, 1.4, 0xe8f4ff));
  if (lit) b.root.userData.light = { color: 0xe8f4ff, intensity: 6, distance: 9, at: [0, 2.8, 0] };
}

/** A street lamp post, its head reaching over the road (+z), carrying the lamp. */
export function streetLamp(b: Build) {
  const steel = b.kit.material(0x5a5e62, 0.6, 0.45);
  b.cyl(0, 2.6, -0.3, 0.07, 5.2, steel, 10, b.root, 0.05);
  b.tube(new T.Vector3(0, 5.1, -0.3), new T.Vector3(0, 5.35, 0.55), 0.04, steel);
  b.box(0, 5.32, 0.7, 0.24, 0.1, 0.5, steel);
  b.box(0, 5.265, 0.7, 0.18, 0.012, 0.4, b.kit.material(0xfff0d8, 0, 0.4, 1.6, 0xffe2b0));
  b.root.userData.light = { color: 0xffe2b0, intensity: 10, distance: 16, at: [0, 5.0, 0.7] };
}

/** A car-park floodlight: a tall pole with two square heads aimed down-forward (+z). */
export function floodlight(b: Build) {
  const steel = b.kit.material(0x6a6e72, 0.6, 0.45);
  b.box(0, 3.5, -0.4, 0.14, 7.0, 0.14, steel);
  b.box(0, 7.0, -0.25, 0.9, 0.08, 0.08, steel);
  for (const x of [-0.35, 0.35]) {
    const head = b.box(x, 6.85, -0.1, 0.36, 0.28, 0.12, steel);
    head.rotation.x = -0.6;
    b.box(x, 6.8, -0.03, 0.3, 0.2, 0.01, b.kit.material(0xf2f8fa, 0, 0.4, 1.6, 0xe8f4ff)).rotation.x = -0.6;
  }
  b.root.userData.light = { color: 0xe8f4ff, intensity: 18, distance: 22, at: [0, 6.5, 0.6] };
}

/** A wall bulkhead light for an alley or a back door: a caged oval on the wall, lit. */
export function bulkhead(b: Build) {
  b.box(0, 0, 0.03, 0.26, 0.16, 0.06, b.kit.material(0x2a2d30, 0.4, 0.5));
  b.box(0, 0, 0.065, 0.2, 0.1, 0.02, b.kit.material(0xfff0d8, 0, 0.4, 1.2, 0xffe2b0));
  for (const x of [-0.05, 0, 0.05]) b.box(x, 0, 0.078, 0.008, 0.11, 0.008, b.dark);
  b.root.userData.light = { color: 0xffe2b0, intensity: 3, distance: 7, at: [0, -0.1, 0.3] };
}

/** The toilet door plate: トイレ on a small white sign at eye height. */
export function toiletSign(b: Build) {
  b.box(0, 0, 0.004, 0.3, 0.12, 0.008, b.kit.material(0xf0eee6, 0, 0.6));
  b.sign("toilet", 0, 0, 0.01, 0.26, 0.09);
}

/** The bulkhead set on the face of the Wall tile north of its cell, 2.3 m up. */
export function bulkheadOnBuilding(b: Build) {
  const g = b.frame(0, 0, -H);
  g.position.y = 2.3;
  const inner = new Build(b.kit, "bulkhead-inner", b.finish, b.variant);
  bulkhead(inner);
  g.add(inner.root);
  const light = inner.root.userData.light as { at: [number, number, number] };
  b.root.userData.light = { ...inner.root.userData.light, at: [light.at[0], light.at[1] + 2.3, light.at[2] - H] };
}
