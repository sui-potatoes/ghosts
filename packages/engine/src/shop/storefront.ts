// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The konbini's front and the street hardware around it: floor-to-ceiling
 * storefront glass on slim shared mullions, the automatic sliding door and
 * a steel service door whose leaves open in the field, and the wired
 * utility pole. Edge pieces here face in (`facing: "in"`): +z is the cell
 * they were placed from, the store's floor for the glass and the doors.
 */
import * as T from "three";
import { C, H, type Build } from "./kit.ts";

const MULLION = 0.045, HEAD = 2.62;

const aluminium = (b: Build) => b.kit.material(0xa9b0b3, 0.75, 0.32);
/** Shop glass: clear with a faint reflection. */
const shopGlass = (b: Build) => {
  const m = b.kit.glass(0xb8d4da, 0.2);
  m.metalness = 0.6; m.roughness = 0.05;
  return m;
};

/** Mullions on both module ends (shared with the neighbour, square so a corner shares one too), kick plate and head. */
function storefrontFrame(b: Build) {
  const alu = aluminium(b);
  for (const x of [-H, H]) b.box(x, 1.45, 0, MULLION, 2.9, MULLION, alu);
  b.box(0, 0.06, 0, C + 0.05, 0.12, 0.1, b.kit.material(0x3a3e42, 0.6, 0.4));
  b.box(0, HEAD + 0.15, 0, C + 0.05, 0.3, 0.12, alu);
  b.box(0, 2.95, 0, C + 0.05, 0.1, 0.14, b.kit.material(0x2a2d30, 0.3, 0.6));
}

export function storefrontGlass(b: Build) {
  storefrontFrame(b);
  b.box(0, (0.12 + HEAD) / 2, 0, C - MULLION, HEAD - 0.12, 0.012, shopGlass(b));
  // The frosted band at waist height, with the store's stripe across it, both faces.
  const frost = b.kit.glass(0xeef2f2, 0.6);
  for (const s of [-1, 1]) {
    b.box(0, 1.1, s * 0.009, C - MULLION, 0.22, 0.003, frost);
    b.box(0, 1.235, s * 0.011, C - MULLION, 0.03, 0.002, b.stripe);
  }
}

/** Two glass leaves on a floor track under a header carrying the chain's fascia; they slide apart for a unit. */
export function autoDoor(b: Build) {
  storefrontFrame(b);
  const alu = aluminium(b), glass = shopGlass(b);
  b.box(0, 0.006, 0.04, C, 0.012, 0.08, b.steel);
  b.box(0, HEAD + 0.15, 0.065, C, 0.28, 0.012, b.header);
  b.box(0, HEAD + 0.03, 0.072, C, 0.025, 0.003, b.stripe);
  b.box(0, HEAD - 0.04, 0.09, 0.2, 0.06, 0.05, b.dark);
  b.box(0.06, HEAD - 0.04, 0.116, 0.025, 0.012, 0.003, b.kit.material(0xff5a3a, 0, 0.4, 0.9));
  for (const s of [-1, 1]) {
    const leaf = b.part(`leaf-${s > 0 ? "right" : "left"}`, s * 0.33, 0, 0.04);
    leaf.userData.slide = s * 0.58;
    b.box(0, 1.33, 0, 0.6, 2.42, 0.012, glass, leaf);
    for (const x of [-0.29, 0.29]) b.box(x, 1.33, 0, 0.03, 2.46, 0.035, alu, leaf);
    for (const y of [0.1, 2.55]) b.box(0, y, 0, 0.6, 0.06, 0.035, alu, leaf);
    b.box(0, 1.1, 0.008, 0.56, 0.16, 0.003, b.kit.glass(0xeef2f2, 0.6), leaf);
    b.box(s * -0.22, 1.1, 0.011, 0.04, 0.16, 0.002, b.stripe, leaf);
  }
}

/**
 * A steel back door in its frame, standing open into the cell it faces: on
 * chain a doorway is nothing, so the leaf is shown open from the start, folded
 * back along the wall clear of the walkable tile.
 */
export function serviceDoor(b: Build) {
  const paint = b.kit.material(0x5a6266, 0.5, 0.5), bar = b.chrome;
  for (const x of [-0.625, 0.625]) b.box(x, 1.12, 0, 0.1, 2.24, 0.16, paint);
  b.box(0, 2.3, 0, C, 0.16, 0.16, paint);
  b.box(0, 2.6, 0, C, 0.44, 0.12, b.kit.material(0x7c7d78, 0, 0.92));
  const leaf = b.part("door-hinge", -0.575, 0, 0.02);
  leaf.rotation.y = -1.5;
  b.box(0.575, 1.08, 0, 1.13, 2.12, 0.05, b.kit.material(0x6e787c, 0.5, 0.45), leaf);
  b.box(0.575, 1.06, 0.035, 0.95, 0.05, 0.03, bar, leaf);
  for (const x of [0.15, 1.0]) b.box(x, 1.06, 0.03, 0.04, 0.08, 0.03, bar, leaf);
  b.box(0.95, 1.5, -0.035, 0.03, 0.12, 0.02, b.dark, leaf);
  b.box(0.575, 1.75, 0.027, 0.36, 0.08, 0.004, b.kit.material(0xe8e4d8, 0, 0.8), leaf);
  b.box(0.3, 2.2, 0.05, 0.35, 0.06, 0.06, b.dark);
}

/**
 * A Japanese concrete utility pole: crossarms with insulators, two
 * transformer cans, a telecom box, step bolts, a striped guard at the
 * foot and a street-lamp arm (+z) that carries a light.
 */
export function utilityPole(b: Build) {
  const concrete = b.kit.material(0x9a9890, 0, 0.9), steel = b.kit.material(0x4a4e52, 0.6, 0.5);
  const porcelain = b.kit.material(0xd8d6cc, 0.1, 0.4), can = b.kit.material(0x8a9094, 0.5, 0.5);
  b.cyl(0, 4.3, 0, 0.13, 8.6, concrete, 12, b.root, 0.1);
  for (const [y, w] of [[7.25, 1.3], [6.6, 0.9]] as const) {
    b.box(0, y, 0, w, 0.1, 0.1, steel);
    for (const x of y > 7 ? [-0.45, 0, 0.45] : [-0.35, 0.35]) b.cyl(x, y + 0.12, 0, 0.04, 0.14, porcelain, 8);
  }
  for (const x of [-0.32, 0.32]) {
    b.cyl(x, 5.9, -0.2, 0.22, 0.75, can, 12);
    b.cyl(x, 6.29, -0.2, 0.23, 0.04, steel, 12);
  }
  b.box(0, 5.9, -0.05, 0.9, 0.06, 0.08, steel);
  b.box(0, 5.2, 0.12, 0.3, 0.4, 0.14, b.kit.material(0x5a5e60, 0.4, 0.6));
  for (let y = 1.8; y < 7; y += 0.45) b.box((y * 10) % 2 > 1 ? 0.13 : -0.13, y, 0, 0.12, 0.02, 0.02, steel);
  for (let i = 0; i < 5; i++) b.cyl(0, 0.2 + i * 0.32, 0, 0.142, 0.16, b.kit.material(i % 2 ? 0x1a1a1a : 0xd9a52b, 0, 0.6), 12);
  // The street lamp: a short arm reaching over the pavement, a head lit from below.
  b.tube(new T.Vector3(0, 4.6, 0.1), new T.Vector3(0, 4.85, 1.05), 0.03, steel);
  b.box(0, 4.82, 1.12, 0.22, 0.08, 0.42, steel);
  b.box(0, 4.77, 1.12, 0.16, 0.02, 0.34, b.kit.material(0xfff0d8, 0, 0.4, 1.6, 0xffe2b0));
  b.root.userData.light = { color: 0xffe2b0, intensity: 45, distance: 12, at: [0, 4.6, 1.12], night: true };
}

/**
 * The bus stop's pole: a round sign head with バス停 on both faces, a name
 * plate and a timetable panel of small print, on a concrete base. Stand it at
 * the kerb at the head of the shelter (the end oncoming traffic reaches
 * first: Japan drives on the left).
 */
export function busStopSign(b: Build) {
  const base = b.kit.material(0x8a8a84, 0, 0.9), pole = b.kit.material(0xb8bcbe, 0.6, 0.35);
  const blue = b.kit.material(0x23508c, 0.2, 0.5), white = b.kit.material(0xf0eee6, 0.1, 0.5), print = b.kit.material(0x2a2e33, 0, 0.8);
  b.cyl(0, 0.05, 0.45, 0.24, 0.1, base, 16);
  b.cyl(0, 1.3, 0.45, 0.035, 2.5, pole, 10);
  b.cyl(0, 2.42, 0.45, 0.27, 0.035, blue, 24).rotation.x = Math.PI / 2;
  for (const s of [1, -1]) {
    b.cyl(0, 2.42, 0.45 + s * 0.02, 0.22, 0.004, white, 24).rotation.x = Math.PI / 2;
    const sign = b.sign("bus-stop", 0, 2.42, 0.45 + s * 0.024, 0.34, 0.14, b.root, "print", false);
    if (s < 0) sign.rotation.y = Math.PI;
  }
  b.box(0, 1.95, 0.45, 0.42, 0.16, 0.03, blue);
  for (const s of [1, -1]) b.box(0, 1.95, 0.45 + s * 0.017, 0.36, 0.05, 0.003, white);
  b.box(0.16, 1.35, 0.45, 0.3, 0.45, 0.04, white);
  for (let i = 0; i < 9; i++) for (const s of [1, -1])
    b.box(0.16 + (i % 3 - 1) * 0.08, 1.5 - Math.floor(i / 3) * 0.12, 0.45 + s * 0.022, 0.06, 0.012, 0.002, print);
}
