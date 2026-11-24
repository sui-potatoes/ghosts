// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Street-level frontages for a building's ground floor: the human entrances
 * a Japanese side street is made of. Entrance doors with a lit transom,
 * stairwells with a mailbox bank, small shops under a flat fascia, izakaya
 * with a noren and a lantern, apartment lobbies with an intercom, and the
 * roller-shutter garage beside its own pedestrian door. No sloped awnings:
 * the interest is in flat signboards, blade signs, curtains, lamps and
 * tiled plinths.
 *
 * A frontage is drawn through a `Brush` so one description serves both the
 * level's masses (`street.ts`, materials of the shop kit) and the rows beyond
 * the grid (`surroundings.ts`, one vertex-coloured mesh per building). Its
 * frame: x along the face, y up from the pavement, z out of the wall (the
 * wall plane is z = 0); nothing reaches past `reach` below 2.4 m, and the
 * signs and lamps above it stay within 0.4 m.
 */

/** Colours that glow (lit panes, transoms, lanterns); every other tone is matte paint. */
export const FRONT = {
  lit: 0xffe2b0, cold: 0xc8e4ec, red: 0xe0442c,
  dark: 0x161a1e, glass: 0x1d2a31, steel: 0x8a8e90, ink: 0x2a2c2f, tile: 0x5b5f60, stone: 0x7a7a74,
  paper: 0xf1ebdc, cream: 0xe8dcc0, brown: 0x2b2420, navy: 0x2c3a5a, wood: 0x6b4a32, slat: 0x3a2a1e,
  green: 0x2f4a3c, grey: 0x5a666a, blue: 0x23508c, white: 0xcfccc2, plant: 0x3e5a3e, pot: 0x6a5a4a,
} as const;
export const GLOWS: ReadonlySet<number> = new Set([FRONT.lit, FRONT.cold, FRONT.red]);

/** The two glyph inks a front uses (dark on pale plates, cream on dark ones). */
export const INK = { dark: 0x1d1a17, cream: 0xf2e6cc } as const;

export interface Brush {
  /** A box centred on x, y, z, `w` wide along the face, `h` tall, `d` deep out of the wall. */
  box(color: number, x: number, y: number, z: number, w: number, h: number, d: number): void;
  /** Lettering `id` on a w × h plane centred on x, y, z facing out of the wall (`yaw` turns it, for a blade sign's two faces). */
  glyph(id: string, ink: number, x: number, y: number, z: number, w: number, h: number, yaw?: number): void;
}

export type FrontKind = "door" | "stairwell" | "shop" | "izakaya" | "lobby" | "garage";
export const FRONT_KINDS: readonly FrontKind[] = ["door", "stairwell", "shop", "izakaya", "lobby", "garage"];
/** How often a kind is chosen (garages are the minority); `fits` is the narrowest face it is drawn on. */
const WEIGHT: Record<FrontKind, number> = { door: 3, stairwell: 2, shop: 3, izakaya: 2, lobby: 2, garage: 1 };
const FITS: Record<FrontKind, number> = { door: 1.3, stairwell: 1.3, shop: 3.4, izakaya: 1.3, lobby: 2.6, garage: 3.4 };

/** A frontage for a face `w` wide that is not `not` (the neighbour's): weighted, seeded by `random`. */
export function pickFront(random: () => number, w: number, not?: FrontKind, only: readonly FrontKind[] = FRONT_KINDS): FrontKind {
  const pool = only.filter((k) => w >= FITS[k] && k !== not);
  const total = pool.reduce((n, k) => n + WEIGHT[k], 0);
  let r = random() * total;
  for (const k of pool) if ((r -= WEIGHT[k]) < 0) return k;
  return pool[0] ?? "door";
}

const DOORS = [FRONT.grey, FRONT.wood, FRONT.green, FRONT.navy];

/** The pedestrian door: reveal, jambs, leaf with a vision slit, lit transom, handle, a step and a lamp. */
function door(e: Brush, cx: number, leaf: number, step: number, lamp = true) {
  e.box(FRONT.dark, cx, 1.2, 0.02, 1.12, 2.4, 0.04);
  for (const s of [-1, 1]) e.box(FRONT.steel, cx + s * 0.5, 1.15, 0.06, 0.06, 2.3, 0.08);
  e.box(FRONT.steel, cx, 2.33, 0.06, 1.06, 0.06, 0.08);
  e.box(leaf, cx, 1.05, 0.05, 0.88, 2.1, 0.05);
  e.box(FRONT.lit, cx, 1.62, 0.08, 0.26, 0.8, 0.01);
  e.box(FRONT.steel, cx + 0.34, 1.0, 0.1, 0.04, 0.2, 0.04);
  e.box(FRONT.lit, cx, 2.205, 0.05, 0.92, 0.15, 0.02);
  e.box(FRONT.stone, cx, 0.06, step / 2, 1.3, 0.12, step);
  if (lamp) e.box(FRONT.lit, cx + 0.72, 2.35, 0.06, 0.12, 0.14, 0.08);
}

/** A tiled plinth band along the foot of a face. */
const plinth = (e: Brush, x: number, w: number) => e.box(FRONT.tile, x, 0.3, 0.015, w, 0.6, 0.03);

/** A blade sign standing out of the wall above the shopfronts: a thin plate, lettering on both faces. */
function blade(e: Brush, x: number, id: string, ground: number, ink: number, y = 3.9) {
  e.box(ground, x, y, 0.2, 0.1, 1.5, 0.4);
  for (const s of [-1, 1]) e.glyph(id, ink, x + s * 0.056, y, 0.2, 0.36, 1.3, s * Math.PI / 2);
}

/**
 * One ground floor, `w` wide, centred on x = 0. `reach` is the deepest a step
 * may stand out of the wall; `blades` allows a blade sign (a building tall
 * enough to carry one).
 */
export function drawFront(kind: FrontKind, e: Brush, w: number, random: () => number, reach = 0.3, blades = false) {
  const pick = <V,>(list: readonly V[]) => list[Math.floor(random() * list.length) % list.length];
  const side = random() < 0.5 ? -1 : 1;
  const leaf = pick(DOORS);
  plinth(e, 0, w - 0.1);
  if (kind === "door") {
    const cx = w < 2 ? 0 : side * (w / 2 - 0.95) * random();
    door(e, cx, leaf, reach);
    e.box(FRONT.paper, cx - 0.78, 1.6, 0.03, 0.14, 0.2, 0.01);
  } else if (kind === "stairwell") {
    const cx = w < 2 ? -0.1 : side * (w / 2 - 0.85);
    door(e, cx, FRONT.grey, reach, false);
    // The mailbox bank beside the door: two columns of steel boxes with dark slits, on a backing plate.
    const mx = cx - side * 0.8;
    if (w >= 2) {
      e.box(FRONT.dark, mx, 1.3, 0.02, 0.5, 0.7, 0.03);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
        e.box(FRONT.steel, mx - 0.11 + c * 0.22, 1.1 + r * 0.22, 0.045, 0.19, 0.17, 0.02);
        e.box(FRONT.dark, mx - 0.11 + c * 0.22, 1.13 + r * 0.22, 0.058, 0.1, 0.02, 0.01);
      }
      // A slit of glass block on the far side, lit from the stair.
      if (w >= 3.6) e.box(FRONT.cold, mx - side * 0.55, 1.7, 0.02, 0.3, 1.5, 0.03);
    }
    e.box(FRONT.cold, cx, 2.55, 0.06, 0.7, 0.05, 0.05);
  } else if (kind === "shop") {
    // A glazed door at one end, a lit window over the rest, a flat fascia board above.
    const dx = side * (w / 2 - 0.65), wx = -side * 0.45, ww = w - 1.5;
    e.box(FRONT.dark, dx, 1.1, 0.02, 0.98, 2.2, 0.04);
    e.box(FRONT.lit, dx, 1.2, 0.05, 0.8, 1.9, 0.02);
    for (const s of [-1, 1]) e.box(FRONT.steel, dx + s * 0.43, 1.1, 0.06, 0.05, 2.2, 0.06);
    e.box(FRONT.steel, dx, 2.2, 0.06, 0.9, 0.05, 0.06);
    e.box(FRONT.steel, dx + side * -0.3, 1.05, 0.08, 0.04, 0.5, 0.04);
    e.box(FRONT.stone, dx, 0.05, 0.1, 1.1, 0.1, 0.2);
    e.box(FRONT.lit, wx, 1.5, 0.03, ww, 1.2, 0.04);
    for (let x = wx - ww / 2 + ww / 3; x < wx + ww / 2 - 0.1; x += ww / 3) e.box(FRONT.dark, x, 1.5, 0.06, 0.04, 1.2, 0.04);
    e.box(FRONT.steel, wx, 0.86, 0.08, ww + 0.1, 0.05, 0.12);
    const id = pick(["coffee", "daily", "sweets", "drinks"]), dark = id === "coffee";
    e.box(dark ? FRONT.brown : FRONT.lit, 0, 2.7, 0.06, w - 0.2, 0.5, 0.06);
    e.glyph(id, dark ? INK.cream : INK.dark, 0, 2.7, 0.095, Math.min(w - 0.5, 2.2), 0.4);
    if (blades) blade(e, -side * (w / 2 - 0.1), "for-rent", FRONT.blue, INK.cream);
  } else if (kind === "izakaya") {
    // A lattice sliding door with a lit paper pane, a navy noren split over it, a red lantern, a wooden sill.
    const cx = w < 2 ? -0.05 : side * (w / 2 - 0.95);
    e.box(FRONT.dark, cx, 1.15, 0.02, 1.3, 2.3, 0.04);
    e.box(FRONT.wood, cx, 2.35, 0.06, 1.3, 0.1, 0.08);
    e.box(FRONT.lit, cx, 1.1, 0.045, 1.14, 2.1, 0.02);
    for (let k = -3; k <= 3; k++) e.box(FRONT.slat, cx + k * 0.17, 1.1, 0.06, 0.025, 2.1, 0.03);
    for (const y of [0.5, 1.1, 1.7]) e.box(FRONT.slat, cx, y, 0.06, 1.14, 0.03, 0.03);
    e.box(FRONT.wood, cx, 2.18, 0.14, 1.1, 0.04, 0.04);
    for (const s of [-1, 1]) e.box(FRONT.navy, cx + s * 0.22, 1.9, 0.14, 0.42, 0.5, 0.012);
    e.glyph("sake", INK.cream, cx, 1.9, 0.152, 0.34, 0.34);
    e.box(FRONT.stone, cx, 0.06, reach / 2, 1.4, 0.12, reach);
    const lx = cx + (w < 2 ? 0.5 : -side * 0.95);
    e.box(FRONT.dark, lx, 2.28, 0.14, 0.04, 0.22, 0.04);
    e.box(FRONT.red, lx, 1.98, 0.2, 0.3, 0.46, 0.3);
    for (const y of [1.74, 2.22]) e.box(FRONT.dark, lx, y, 0.2, 0.18, 0.03, 0.18);
    e.glyph(pick(["izakaya", "yakitori"]), INK.dark, lx, 1.98, 0.356, 0.16, 0.36);
    if (blades) blade(e, side * (w / 2 - 0.1), "izakaya", FRONT.red, INK.dark, 4.0);
  } else if (kind === "lobby") {
    // Glass double door in a steel frame with a sidelight, lit panel above, an intercom beside, planters.
    const cx = side * (w / 2 - 1.3);
    e.box(FRONT.dark, cx, 1.2, 0.02, 1.95, 2.4, 0.04);
    for (const x of [-0.95, 0, 0.95]) e.box(FRONT.steel, cx + x, 1.15, 0.06, 0.06, 2.3, 0.08);
    e.box(FRONT.steel, cx, 2.33, 0.06, 1.95, 0.06, 0.08);
    e.box(FRONT.cold, cx, 1.15, 0.05, 1.76, 2.2, 0.02);
    e.box(FRONT.steel, cx - 0.1, 1.0, 0.1, 0.03, 0.4, 0.04);
    e.box(FRONT.steel, cx + 0.1, 1.0, 0.1, 0.03, 0.4, 0.04);
    e.box(FRONT.lit, cx, 2.52, 0.05, 1.9, 0.1, 0.04);
    e.box(FRONT.stone, cx, 0.06, reach / 2, 2.1, 0.12, reach);
    const ix = cx - side * 1.25;
    e.box(FRONT.dark, ix, 1.35, 0.03, 0.2, 0.36, 0.04);
    e.box(FRONT.cold, ix, 1.45, 0.055, 0.1, 0.1, 0.01);
    for (let r = 0; r < 2; r++) e.box(FRONT.steel, ix, 1.28 + r * 0.07, 0.055, 0.12, 0.04, 0.01);
    if (Math.abs(ix) + 0.25 < w / 2) {
      e.box(FRONT.pot, ix, 0.2, 0.15, 0.5, 0.4, 0.24);
      e.box(FRONT.plant, ix, 0.55, 0.15, 0.4, 0.3, 0.2);
    }
  } else {
    // A roller shutter over most of the face, ribbed, a lamp over it, and a service door at the end.
    const sw = w - 1.6, sx = -side * 0.7;
    e.box(random() < 0.5 ? FRONT.ink : FRONT.steel, sx, 1.2, 0.03, sw, 2.4, 0.05);
    for (let k = 0; k < 11; k++) e.box(FRONT.dark, sx, 0.2 + k * 0.2, 0.06, sw, 0.012, 0.01);
    e.box(FRONT.dark, sx, 2.46, 0.07, sw + 0.1, 0.12, 0.1);
    e.box(FRONT.lit, sx, 2.7, 0.06, 0.4, 0.08, 0.08);
    door(e, side * (w / 2 - 0.65), FRONT.grey, reach, false);
  }
}

/** Upper-floor extras, sparingly: a condenser under a window, or a balcony rail. `x` is the window's centre along the face. */
export function drawUpper(e: Brush, x: number, y: number, random: () => number) {
  if (random() < 0.5) {
    e.box(FRONT.white, x, y + 0.45, 0.2, 0.7, 0.4, 0.28);
    e.box(FRONT.dark, x - 0.12, y + 0.45, 0.345, 0.3, 0.3, 0.02);
  } else {
    e.box(FRONT.ink, x, y + 0.92, 0.2, 0.9, 0.06, 0.4);
    e.box(FRONT.steel, x, y + 1.85, 0.39, 0.9, 0.04, 0.03);
    for (const s of [-1, 1]) e.box(FRONT.steel, x + s * 0.43, y + 1.4, 0.39, 0.03, 0.9, 0.03);
  }
}
