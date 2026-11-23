// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The convenience store: wall fridges, open chillers and wall shelves as
 * wall-backed run kits, double-sided gondolas, the chest freezer island and
 * the checkout counter with its register and hot food case. Real konbini
 * proportions: drink doors about 0.65 m wide and 2 m tall, gondolas 1.32 m
 * (seen over: low cover) or 1.8 m (the tall option, blocks sight), the
 * freezer and counter waist to hip high.
 */
import * as T from "three";
import type { RunPiece } from "./catalog.ts";
import { BACK, H, tones, type Build } from "./kit.ts";

type Side = { capL: boolean; capR: boolean };
/** Draws one straight stretch of a wall-backed unit between x0 and x1 (front +z) in `g`. */
type Bay = (b: Build, g: T.Object3D, x0: number, x1: number, side: Side) => void;

/**
 * A wall-backed piece: a straight module, or the inside corner, which is the
 * dead square in the corner plus two short arms that are slices of the turn-0
 * and turn-1 modules on either side, so both runs meet it flush.
 */
export function wallRun(b: Build, piece: RunPiece, depth: number, height: number, bay: Bay) {
  const front = BACK + depth;
  if (piece !== "corner") {
    bay(b, b.root, -H, H, { capL: piece === "single" || piece === "left", capR: piece === "single" || piece === "right" });
    return;
  }
  const s = front - BACK, c = (front + BACK) / 2;
  b.box(c, height / 2, c, s, height, s, b.body);
  b.box(c, height + 0.004, c, s - 0.06, 0.008, s - 0.06, b.dark);
  bay(b, b.root, front, H, { capL: false, capR: false });
  bay(b, b.frame(Math.PI / 2), -H, -front, { capL: false, capR: false });
}

type Row = "pet" | "can" | "big" | "carton" | "cup" | "onigiri" | "sandwich" | "bento" | "bag" | "box" | "noodle" | "tin" | "jug";
const dims: Record<Row, [w: number, h: number, d: number]> = {
  pet: [0.068, 0.21, 0.068], can: [0.066, 0.122, 0.066], big: [0.1, 0.3, 0.1], carton: [0.072, 0.19, 0.072],
  cup: [0.075, 0.08, 0.075], onigiri: [0.095, 0.09, 0.04], sandwich: [0.13, 0.12, 0.06], bento: [0.2, 0.055, 0.15],
  bag: [0.15, 0.22, 0.07], box: [0.12, 0.17, 0.06], noodle: [0.1, 0.1, 0.1], tin: [0.08, 0.085, 0.08], jug: [0.09, 0.24, 0.07],
};
const shapeOf: Record<Row, Parameters<Build["item"]>[0]> = {
  pet: "bottle", can: "can", big: "bottle", carton: "box", cup: "cup", onigiri: "tri", sandwich: "tri", bento: "box",
  bag: "box", box: "box", noodle: "cup", tin: "can", jug: "box",
};
const paletteOf: Record<Row, readonly number[]> = {
  pet: tones.drinks, can: tones.drinks, big: tones.drinks, carton: tones.dairy, cup: tones.dairy,
  onigiri: [tones.rice], sandwich: [0xd9c79a, 0xd3bb86, 0xe0cfa2], bento: tones.bento,
  bag: tones.snacks, box: tones.snacks, noodle: [0xe8e3d6, 0xe8e3d6, 0xc23a2e, 0xe0b23c, 0xd8d2c0], tin: tones.goods, jug: tones.goods,
};

/**
 * One shelf's merchandise from x0 to x1 standing on `y`, its front face at
 * `z`: facings of two to four of a colour, the odd sold-out gap, `rows`
 * deep (a deep row is one elongated block: it reads as stock behind).
 */
export function fillRow(b: Build, g: T.Object3D, row: Row, x0: number, x1: number, y: number, z: number, deep = 0, empty = 0.05) {
  const [w, h, d] = dims[row], palette = paletteOf[row], gap = row === "bento" ? 0.015 : 0.008;
  let left = 0, color = palette[0];
  for (let x = x0 + gap + w / 2; x + w / 2 <= x1 - gap / 2; x += w + gap) {
    if (left-- <= 0) { color = b.pick(palette); left = 1 + Math.floor(b.random() * 3); }
    if (b.random() < empty) continue;
    const depth = deep ? Math.max(d, deep) : d, lean = row === "bag" ? (b.random() - 0.5) * 0.12 : 0;
    const tall = h * (0.94 + b.random() * 0.1);
    const o = b.item(shapeOf[row], color, x, y, z - depth / 2, w, tall, depth, g);
    o.rotation.z = lean;
    if (row === "onigiri") b.item("box", tones.nori, x, y, z - depth / 2 + 0.002, w * 0.36, tall * 0.42, depth + 0.004, g);
    if (row === "sandwich") b.item("box", b.pick([0x9a4b3a, 0x7f9a52, 0xe2c25c]), x, y + tall * 0.18, z - depth / 2, w * 0.6, tall * 0.08, depth + 0.006, g);
    if (row === "bento" && b.random() < 0.6) b.item("box", color, x, y + h, z - depth / 2, w * 0.98, h * 0.9, depth * 0.98, g);
    if (row === "noodle") b.item("box", b.pick(tones.snacks), x, y + tall * 0.55, z - depth / 2, w * 0.98, tall * 0.2, depth * 0.98, g);
  }
}

// ---------------------------------------------------------------------------
// Upright glass-door drinks fridge.

const FRIDGE_D = 0.78;

function fridgeBay(dead: boolean): Bay {
  return (b, g, x0, x1, { capL, capR }) => {
    const d = FRIDGE_D, front = BACK + d, zc = BACK + d / 2, w = x1 - x0, cx = (x0 + x1) / 2;
    const glass = b.kit.glass(0xa8d0d6, 0.16), rail = b.kit.material(0x7d878b, 0.6, 0.4);
    b.box(cx, 0.06, zc - 0.03, w, 0.12, d - 0.06, b.dark, g);
    b.box(cx, 0.14, zc, w, 0.04, d, b.body, g);
    b.box(cx, 1.955, zc, w, 0.19, d, b.body, g);
    b.box(cx, 1.965, front + 0.008, w, 0.14, 0.016, b.header, g);
    b.box(cx, 1.906, front + 0.018, w, 0.02, 0.004, b.stripe, g);
    b.box(cx, 2.053, zc + 0.08, w - 0.12, 0.008, 0.3, b.dark, g);
    for (let x = x0 + 0.1; x < x1 - 0.06; x += 0.1) b.box(x, 2.058, zc + 0.08, 0.025, 0.008, 0.28, b.wire, g);
    b.box(cx, 1.832, front - 0.07, w - 0.02, 0.02, 0.026, dead ? b.dark : b.strip, g);
    if (w > 1 && b.variant % 2 === 0) b.sign("drinks", cx, 1.965, front + 0.0175, 0.34, 0.085, g);
    const n = Math.max(1, Math.round(w / 0.66)), dw = w / n;
    for (let i = 0; i < n; i++) {
      const l = x0 + i * dw, r = l + dw;
      const gl = l + (i === 0 ? (capL ? 0.05 : 0.015) : 0.025), gr = r - (i === n - 1 ? (capR ? 0.05 : 0.015) : 0.025);
      // A dead tube now and then: the noir variety a long wall of fridges needs.
      const dim = dead || (b.variant === 3 && i === n - 1);
      b.box((l + r) / 2, 1.0, BACK + 0.015, dw, 1.72, 0.03, dim ? b.coldDim : b.cold, g);
      for (const y of [0.47, 0.78, 1.09, 1.4]) b.box((gl + gr) / 2, y, zc - 0.03, gr - gl, 0.014, d - 0.14, b.wire, g);
      const rows: Row[] = ["big", b.pick(["pet", "carton"] as Row[]), "pet", b.pick(["can", "pet"] as Row[]), "can"];
      [0.16, 0.477, 0.787, 1.097, 1.407].forEach((y, k) =>
        fillRow(b, g, rows[k], gl, gr, y, front - 0.09, 0, dead ? 0.55 : 0.05));
      if (i < n - 1) b.box(r, 1.0, front - 0.03, 0.05, 1.72, 0.06, b.body, g);
      // The leaf: a framed pane with the pull on its free side. A dead unit hangs its first door open.
      const open = dead && i === 0;
      const leaf = open ? b.part("door-hinge", gl, 0, front - 0.02, g) : new T.Group();
      if (!open) { leaf.position.set(gl, 0, front - 0.02); g.add(leaf); }
      else leaf.rotation.y = -0.8;
      const lw = gr - gl;
      b.box(lw / 2, 1.0, 0, lw - 0.05, 1.6, 0.01, glass, leaf);
      for (const y of [0.185, 1.815]) b.box(lw / 2, y, 0, lw, 0.05, 0.03, rail, leaf);
      for (const x of [0.0125, lw - 0.0125]) b.box(x, 1.0, 0, 0.025, 1.68, 0.03, rail, leaf);
      b.box(lw - 0.06, 1.05, 0.04, 0.022, 0.55, 0.022, b.chrome, leaf);
      for (const y of [0.8, 1.3]) b.box(lw - 0.06, y, 0.022, 0.018, 0.018, 0.03, b.chrome, leaf);
    }
    for (const [x, capped, s] of [[x0, capL, 1], [x1, capR, -1]] as const) {
      if (capped) b.box(x + s * 0.025, 1.03, zc + 0.01, 0.05, 2.06, d + 0.02, b.body, g);
      else b.box(x + s * 0.0075, 1.0, front - 0.03, 0.015, 1.72, 0.06, b.body, g);
    }
    if (dead) {
      // A toppled bottle and a cracked header: the store went dark a while ago.
      b.item("bottle", b.pick(tones.drinks), cx + 0.1, 0.16, front - 0.2, 0.1, 0.3, 0.1, g).rotation.z = Math.PI / 2;
      b.box(cx - 0.2, 1.95, front + 0.018, 0.3, 0.008, 0.004, b.dark, g).rotation.z = 0.35;
    }
  };
}

// ---------------------------------------------------------------------------
// Open multideck chiller: rice balls, sandwiches, lunch boxes, dairy.

const CHILLER_D = 0.8;

const chillerBay: Bay = (b, g, x0, x1, { capL, capR }) => {
  const d = CHILLER_D, front = BACK + d, zc = BACK + d / 2, w = x1 - x0, cx = (x0 + x1) / 2;
  const rail = b.kit.material(0xcfd4cf, 0.05, 0.6);
  b.box(cx, 0.06, zc - 0.03, w, 0.12, d - 0.06, b.dark, g);
  b.box(cx, 0.33, front - 0.03, w, 0.42, 0.06, b.body, g);
  b.box(cx, 0.5, front + 0.002, w, 0.03, 0.004, b.stripe, g);
  b.box(cx, 0.3, front + 0.012, w, 0.045, 0.024, b.steel, g);
  b.box(cx, 0.4, zc - 0.02, w, 0.03, d - 0.1, b.dark, g);
  b.box(cx, 0.27, BACK + 0.015, w, 0.26, 0.03, b.dark, g);
  b.box(cx, 1.12, BACK + 0.015, w, 1.16, 0.03, b.cold, g);
  // The canopy: lit header band and a light tube over the top tier.
  b.box(cx, 1.82, BACK + 0.25, w, 0.26, 0.5, b.body, g);
  b.box(cx, 1.835, -0.092, w, 0.19, 0.016, b.header, g);
  b.box(cx, 1.755, -0.082, w, 0.02, 0.004, b.stripe, g);
  if (w > 1) b.sign(b.variant % 2 ? "bento" : "onigiri", cx, 1.85, -0.0835, 0.4, 0.1, g);
  b.box(cx, 1.682, -0.17, w - 0.02, 0.02, 0.05, b.strip, g);
  b.box(cx, 1.954, BACK + 0.25, w - 0.12, 0.008, 0.36, b.dark, g);
  // A deck of lunch boxes, then three stepped tiers.
  fillRow(b, g, b.pick(["bento", "bento", "carton"] as Row[]), x0 + 0.03, x1 - 0.03, 0.415, front - 0.08, 0.34);
  const tiers: [y: number, depth: number][] = [[0.84, 0.5], [1.12, 0.42], [1.4, 0.34]];
  const kinds: Row[] = b.variant % 2
    ? ["sandwich", "onigiri", b.pick(["cup", "carton"] as Row[])]
    : ["onigiri", b.pick(["onigiri", "sandwich"] as Row[]), "cup"];
  tiers.forEach(([y, dep], k) => {
    const z = BACK + 0.03 + dep;
    b.box(cx, y, BACK + 0.03 + dep / 2, w, 0.02, dep, b.wire, g);
    b.box(cx, y - 0.018, z + 0.006, w, 0.05, 0.012, rail, g);
    for (let x = x0 + 0.15; x < x1 - 0.05; x += 0.33 + b.random() * 0.2) b.box(x, y - 0.018, z + 0.014, 0.05, 0.035, 0.004, b.stripe, g);
    fillRow(b, g, kinds[k], x0 + 0.02, x1 - 0.02, y + 0.01, z - 0.02, kinds[k] === "cup" ? 0 : 0.0);
    fillRow(b, g, kinds[k], x0 + 0.04, x1 - 0.04, y + 0.01, z - 0.15, 0, 0.15);
  });
  for (const [x, capped, s] of [[x0, capL, 1], [x1, capR, -1]] as const) {
    if (!capped) continue;
    const px = x + s * 0.025;
    b.box(px, 0.33, zc + 0.005, 0.05, 0.66, d + 0.01, b.body, g);
    b.box(px, 1.3, BACK + 0.25, 0.05, 1.3, 0.5, b.body, g);
    // The sloped cheek between the well and the canopy.
    const slope = b.box(px, 1.17, front - 0.18, 0.05, 1.1, 0.12, b.body, g);
    slope.rotation.x = -0.27;
  }
};

// ---------------------------------------------------------------------------
// Single-sided wall shelf.

const SHELF_D = 0.45;

const shelfBay: Bay = (b, g, x0, x1, { capL, capR }) => {
  const d = SHELF_D, zc = BACK + d / 2, w = x1 - x0, cx = (x0 + x1) / 2;
  const rail = b.kit.material(0xcfd4cf, 0.05, 0.6);
  b.box(cx, 0.05, zc - 0.02, w, 0.1, d - 0.04, b.dark, g);
  b.box(cx, 0.95, BACK + 0.012, w, 1.7, 0.024, b.body, g);
  for (const y of [0.45, 0.81, 1.17, 1.53]) b.box(cx, y + 0.1, BACK + 0.026, w, 0.006, 0.004, b.dark, g);
  b.box(cx, 1.86, BACK + 0.06, w, 0.14, 0.12, b.header, g);
  b.box(cx, 1.81, BACK + 0.121, w, 0.02, 0.004, b.stripe, g);
  if (w > 1 && b.variant % 2 === 0) b.sign("daily", cx, 1.87, BACK + 0.1215, 0.34, 0.085, g);
  const tiers: [y: number, depth: number][] = [[0.1, 0.42], [0.46, 0.38], [0.82, 0.34], [1.18, 0.31], [1.54, 0.28]];
  const kinds: Row[] = [b.pick(["jug", "box"] as Row[]), "box", b.pick(["tin", "bag"] as Row[]), "bag", b.pick(["box", "tin", "noodle"] as Row[])];
  tiers.forEach(([y, dep], k) => {
    const z = BACK + 0.024 + dep;
    b.box(cx, y, BACK + 0.024 + dep / 2, w, 0.022, dep, b.steel, g);
    if (k) b.box(cx, y - 0.012, z + 0.006, w, 0.045, 0.012, rail, g);
    fillRow(b, g, kinds[k], x0 + 0.02, x1 - 0.02, y + 0.011, z - 0.02, dep * 0.8);
  });
  for (const [x, capped, s] of [[x0, capL, 1], [x1, capR, -1]] as const) {
    if (capped) b.box(x + s * 0.015, 0.965, zc, 0.03, 1.93, d, b.body, g);
    else b.box(x + s * 0.01, 0.95, BACK + 0.04, 0.02, 1.8, 0.04, b.body, g);
  }
};

export function fridge(b: Build, piece: RunPiece | "dead") {
  if (piece === "dead") return fridgeBay(true)(b, b.root, -H, H, { capL: false, capR: false });
  wallRun(b, piece, FRIDGE_D, 2.05, fridgeBay(false));
}
export const chiller = (b: Build, piece: RunPiece) => wallRun(b, piece, CHILLER_D, 1.95, chillerBay);
export const wallShelf = (b: Build, piece: RunPiece) => wallRun(b, piece, SHELF_D, 1.93, shelfBay);

// ---------------------------------------------------------------------------
// Double-sided gondola: the middle aisles. End caps face +x; turn the piece for the other end.

/** One face of shelving looking +z in `g`, from x0 to x1, its shelves starting behind z = 0. */
function gondolaFace(b: Build, g: T.Object3D, x0: number, x1: number, tiers: readonly [number, number][], lean = 0) {
  const rail = b.kit.material(0xcfd4cf, 0.05, 0.6), cx = (x0 + x1) / 2, w = x1 - x0;
  const pool: Row[] = ["bag", "box", "noodle", "tin", "bag", "can", "box"];
  tiers.forEach(([y, dep], k) => {
    b.box(cx, y, dep / 2, w, 0.022, dep, b.steel, g);
    if (k) b.box(cx, y - 0.012, dep + 0.006, w, 0.045, 0.012, rail, g);
    const row = k === 0 ? b.pick(["box", "tin", "noodle"] as Row[]) : b.pick(pool);
    fillRow(b, g, row, x0 + 0.015, x1 - 0.015, y + 0.011, dep - 0.015 - lean, dep * 0.8);
  });
}

export function gondola(b: Build, piece: "single" | "end" | "mid", tall: boolean) {
  const h = tall ? 1.8 : 1.32;
  const tiers: [number, number][] = tall
    ? [[0.1, 0.4], [0.44, 0.36], [0.78, 0.33], [1.12, 0.3], [1.46, 0.27]]
    : [[0.1, 0.4], [0.42, 0.35], [0.73, 0.31], [1.03, 0.27]];
  const [x0, x1] = piece === "mid" ? [-H, H] : piece === "end" ? [-H, H - 0.45] : [-0.225, 0.225];
  const cx = (x0 + x1) / 2, w = x1 - x0;
  b.box(cx, 0.05, 0, w, 0.1, 0.86, b.dark);
  b.box(cx, h / 2, 0, w, h, 0.05, b.body);
  b.box(cx, h + 0.015, 0, w, 0.03, 0.09, b.header);
  for (const s of [-1, 1]) {
    b.box(cx, h - 0.03, s * 0.027, w, 0.02, 0.004, b.stripe);
    const face = b.frame(s > 0 ? 0 : Math.PI);
    face.position.z = s * 0.025;
    gondolaFace(b, face, s > 0 ? x0 : -x1, s > 0 ? x1 : -x0, tiers);
  }
  // Uprights where modules meet: halves at a run join, whole posts at an end cap.
  for (const [x, s, capped] of [[x0, 1, piece === "single"], [x1, -1, piece !== "mid"]] as const)
    b.box(x + s * (capped ? 0.02 : 0.01), h / 2, 0, capped ? 0.04 : 0.02, h, 0.07, b.body);
  const caps = piece === "mid" ? [] : piece === "end" ? [1] : [-1, 1];
  for (const s of caps) {
    const end = b.frame(s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? x1 : x0, 0);
    b.box(0, 0.05, 0.225, 0.86, 0.1, 0.45, b.dark, end);
    b.box(0, h / 2, 0.015, 0.9, h, 0.03, b.body, end);
    for (const x of [-0.44, 0.44]) b.box(x, h / 2, 0.225, 0.02, h, 0.45, b.body, end);
    gondolaFace(b, end, -0.43, 0.43, tiers.map(([y, dep]) => [y, Math.min(dep, 0.4)] as [number, number]));
    // The promotion header on the end: the aisle's marker from the tactical camera.
    b.box(0, h + 0.13, 0.08, 0.7, 0.2, 0.025, b.header, end);
    b.box(0, h + 0.06, 0.094, 0.7, 0.025, 0.004, b.stripe, end);
    b.sign("sweets", 0, h + 0.145, 0.0935, 0.52, 0.13, end);
    for (const x of [-0.3, 0.3]) b.box(x, h + 0.02, 0.08, 0.02, 0.06, 0.02, b.steel, end);
  }
}

// ---------------------------------------------------------------------------
// Chest freezer island: ice cream and frozen food under sliding glass lids.

export function freezer(b: Build, piece: "single" | "end" | "mid") {
  const [x0, x1] = piece === "mid" ? [-H, H] : piece === "end" ? [-H, H - 0.05] : [-H + 0.05, H - 0.05];
  const cx = (x0 + x1) / 2, w = x1 - x0, glass = b.kit.glass(0xb4d6dc, 0.2);
  b.box(cx, 0.04, 0, w, 0.08, 0.76, b.dark);
  for (const s of [-1, 1]) {
    b.box(cx, 0.44, s * 0.4, w, 0.72, 0.04, b.body);
    b.box(cx, 0.62, s * 0.43, w, 0.05, 0.03, b.steel);
    b.box(cx, 0.74, s * 0.4205, w, 0.03, 0.004, b.stripe);
    if (b.variant % 2 === 0) b.sign("ice", cx, 0.5, s * 0.4205, 0.3, 0.075).rotation.y = s > 0 ? 0 : Math.PI;
    b.box(cx, 0.81, s * 0.39, w, 0.03, 0.06, b.steel);
    const lid = b.part(`lid-${s > 0 ? "front" : "back"}`, cx + s * 0.04 * (b.variant % 2 ? 1 : -1), 0.83 + (s > 0 ? 0.012 : 0), s * 0.19);
    b.box(0, 0, 0, w - 0.1, 0.01, 0.36, glass, lid);
    for (const z of [-0.18, 0.18]) b.box(0, 0, z, w - 0.1, 0.016, 0.02, b.steel, lid);
    for (const x of [-(w - 0.1) / 2, (w - 0.1) / 2]) b.box(x, 0, 0, 0.02, 0.016, 0.36, b.steel, lid);
  }
  b.box(cx, 0.35, 0, w, 0.02, 0.76, b.cold);
  b.box(cx, 0.82, 0, w, 0.025, 0.04, b.steel);
  // Heaped boxes and tubs, seeded per module.
  for (let x = x0 + 0.1; x < x1 - 0.06; x += 0.17)
    for (const z of [-0.27, -0.1, 0.08, 0.25]) {
      const n = 1 + Math.floor(b.random() * 4), color = b.pick(tones.ice);
      for (let k = 0; k < n; k++)
        b.item(b.random() < 0.3 ? "cup" : "box", color, x + (b.random() - 0.5) * 0.02, 0.36 + k * 0.075, z, 0.15, 0.07, 0.13);
    }
  for (const [x, s, capped] of [[x0, -1, piece === "single"], [x1, 1, piece !== "mid"]] as const) {
    if (!capped) continue;
    b.box(x + s * 0.025, 0.42, 0, 0.05, 0.84, 0.86, b.body);
    b.box(x + s * 0.047, 0.62, 0, 0.004, 0.05, 0.86, b.steel);
  }
}

// ---------------------------------------------------------------------------
// Checkout counter: customer side +z, staff cubbies behind.

function counterRun(b: Build, g: T.Object3D, x0: number, x1: number, capR: boolean, capL = false) {
  const cx = (x0 + x1) / 2, w = x1 - x0;
  b.box(cx, 0.52, 0.32, w, 0.88, 0.04, b.header, g);
  b.box(cx, 0.04, 0.27, w, 0.08, 0.06, b.dark, g);
  b.box(cx, 0.86, 0.342, w, 0.025, 0.004, b.stripe, g);
  b.box(cx, 0.24, 0.342, w, 0.012, 0.004, b.stripe, g);
  // The corner's top reaches over its cheek to meet the turned arm's overhang.
  const reach = capR && x1 < H - 0.01 ? 0.03 : 0;
  b.box(cx + reach / 2, 0.98, 0.01, w + reach, 0.04, 0.74, b.laminate, g);
  b.box(cx, 0.05, -0.03, w, 0.1, 0.6, b.dark, g);
  for (const y of [0.4, 0.68]) b.box(cx, y, -0.03, w, 0.02, 0.6, b.body, g);
  b.box(cx, 0.94, -0.03, w, 0.04, 0.6, b.body, g);
  for (const [x, s, capped] of [[x0, 1, capL], [x1, -1, capR]] as const) {
    if (capped) b.box(x - s * 0.02 + s * 0.04, 0.48, 0.0, 0.04, 0.96, 0.7, b.header, g);
    else b.box(x + s * 0.01, 0.48, -0.03, 0.02, 0.88, 0.6, b.body, g);
  }
  // Staff-side stock: carrier bags, receipt rolls, a cash bag.
  for (let x = x0 + 0.12; x < x1 - 0.1; x += 0.22 + b.random() * 0.12) {
    const y = b.pick([0.1, 0.42, 0.7]);
    const r = b.random();
    if (r < 0.4) b.item("box", 0xe6e2d6, x, y, -0.1, 0.18, 0.06 + b.random() * 0.1, 0.26, g);
    else if (r < 0.7) for (let k = 0; k < 3; k++) b.item("can", 0xe9e4d5, x + k * 0.06 - 0.06, y, -0.15, 0.05, 0.06, 0.05, g);
    else b.item("box", b.pick([0x3e5f7a, 0x8c3b2e, 0x5a6a5c]), x, y, -0.12, 0.16, 0.12, 0.2, g);
  }
}

export function counter(b: Build, piece: "straight" | "end" | "end-left" | "corner") {
  // The chain's name on the counter front, once per end piece.
  if (piece === "end" && b.finish !== "plain") b.sign(b.finish, -0.1, 0.62, 0.3405, 0.72, 0.18);
  if (piece === "end-left" && b.finish !== "plain") b.sign(b.finish, 0.1, 0.62, 0.3405, 0.72, 0.18);
  if (piece === "corner") {
    counterRun(b, b.root, -H, 0.35, true);
    counterRun(b, b.frame(Math.PI / 2), 0.35, H, false);
    return;
  }
  counterRun(b, b.root, -H, H, piece === "end", piece === "end-left");
}

// ---------------------------------------------------------------------------
// Counter-top equipment.

export function register(b: Build) {
  const screen = b.kit.material(0x183b48, 0.1, 0.5, 0.65);
  const ui = b.kit.material(0x5fbbc6, 0.1, 0.4, 0.65);
  b.box(0, 0.05, 0, 0.42, 0.1, 0.4, b.dark);
  b.box(0, 0.05, 0.201, 0.38, 0.07, 0.004, b.body);
  b.box(0, 0.06, 0.205, 0.08, 0.012, 0.006, b.steel);
  b.box(0, 0.16, -0.05, 0.05, 0.14, 0.05, b.dark);
  const display = b.part("display", 0, 0.32, -0.07);
  display.rotation.x = 0.28;
  b.box(0, 0, 0, 0.36, 0.25, 0.035, b.dark, display);
  b.box(0, 0, -0.019, 0.32, 0.2, 0.004, screen, display);
  b.box(0, 0.06, -0.022, 0.28, 0.02, 0.002, ui, display);
  for (let i = 0; i < 4; i++) {
    b.box(-0.08, 0.02 - i * 0.03, -0.022, 0.12, 0.012, 0.002, b.steel, display);
    b.box(0.08, 0.02 - i * 0.03, -0.022, 0.06 + (i % 2) * 0.04, 0.012, 0.002, ui, display);
  }
  // The customer's pole display, card reader and the receipt printer.
  b.box(0.13, 0.17, 0.12, 0.025, 0.14, 0.025, b.dark);
  b.box(0.13, 0.27, 0.12, 0.17, 0.07, 0.03, b.dark);
  b.box(0.13, 0.27, 0.136, 0.15, 0.05, 0.002, screen);
  b.box(0.27, 0.02, 0.13, 0.09, 0.04, 0.12, b.dark);
  const reader = b.box(0.27, 0.07, 0.13, 0.08, 0.03, 0.15, b.dark);
  reader.rotation.x = -0.45;
  b.box(0.27, 0.088, 0.105, 0.05, 0.004, 0.04, screen).rotation.x = -0.45;
  b.box(-0.27, 0.07, -0.05, 0.15, 0.14, 0.18, b.body);
  b.box(-0.27, 0.142, -0.05, 0.13, 0.004, 0.16, b.dark);
  b.box(-0.27, 0.17, 0.03, 0.07, 0.07, 0.003, b.paper).rotation.x = -0.4;
}

export function hotCase(b: Build) {
  const w = 0.56, d = 0.42, glass = b.kit.glass(0xd8c8b0, 0.2);
  const lamp = b.kit.material(0xffd2a0, 0, 0.4, 0.9, 0xffa560);
  b.box(0, 0.05, 0, w, 0.1, d, b.steel);
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(x * (w / 2 - 0.015), 0.28, z * (d / 2 - 0.015), 0.03, 0.46, 0.03, b.steel);
  b.box(0, 0.475, 0, w, 0.03, d, b.header);
  b.box(0, 0.47, d / 2 + 0.001, w, 0.02, 0.004, b.stripe);
  b.box(0, 0.455, 0, w - 0.06, 0.012, 0.06, lamp);
  b.box(0, 0.28, d / 2 - 0.01, w - 0.03, 0.34, 0.008, glass);
  b.box(0, 0.28, -d / 2 + 0.01, w - 0.03, 0.34, 0.008, glass);
  for (const x of [-1, 1]) b.box(x * (w / 2 - 0.01), 0.28, 0, 0.008, 0.34, d - 0.03, glass);
  const fried = [0xa8662e, 0xb87838, 0x9a5a2a, 0xc48a44];
  for (const y of [0.1, 0.27]) {
    b.box(0, y + 0.006, 0, w - 0.06, 0.012, d - 0.06, b.chrome);
    for (let x = -0.2; x <= 0.2; x += 0.1) for (const z of [-0.08, 0.08]) {
      if (b.random() < 0.15) continue;
      const kind = b.random();
      if (kind < 0.5) b.item("ball", b.pick(fried), x, y + 0.012, z, 0.08, 0.05, 0.07);
      else if (kind < 0.8) b.item("box", b.pick(fried), x, y + 0.012, z, 0.08, 0.035, 0.05);
      else b.item("box", 0xd9c79a, x, y + 0.012, z, 0.02, 0.02, 0.14);
    }
  }
}
