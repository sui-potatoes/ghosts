// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Street ground and street furniture: the kerb line between pavement and
 * road, dropped kerbs, tactile paving, manholes and drain grates; Tokyo's
 * bins (the konbini's recycling bank, a net-covered rubbish point, the
 * folding rubbish cage, a vending can bin); a bicycle rack, a roadworks
 * group and a row of lanterns under the eaves.
 */
import { paintBox } from "../road-paint.ts";
import { Build, C, H } from "./kit.ts";
import { lantern } from "./interiors.ts";

const stone = (b: Build) => b.kit.material(0xa8a69e, 0, 0.9);

/**
 * The kerb on the edge between a raised pavement cell (+z, the cell it is
 * placed from) and the road: a granite edge 0.16 m high on the pavement
 * side and a dark gutter line on the road. It stands on the road's level
 * (edges seat on the lower floor). `dropped`: the low kerb of a driveway
 * or a crossing, 3 cm with a chamfer.
 */
export function kerb(b: Build, dropped: boolean) {
  const h = dropped ? 0.04 : 0.165;
  b.box(0, h / 2, 0.075, C, h, 0.15, stone(b));
  if (dropped) b.box(0, 0.08, 0.3, C, 0.02, 0.3, stone(b)).rotation.x = -0.45;
  const { y, height } = paintBox(0);
  b.box(0, y, -0.15, C, height, 0.3, b.kit.paint(0x3a3c3e)).castShadow = false;
}

/** Tactile paving: a band of yellow guidance blocks along the cell's north edge, dots raised. */
export function tactile(b: Build) {
  const yellow = b.kit.material(0xd9b02a, 0, 0.7);
  b.box(0, 0.004, -H + 0.15, C, 0.008, 0.3, yellow);
  for (let x = -0.6; x <= 0.6; x += 0.1) for (const z of [-H + 0.05, -H + 0.15, -H + 0.25])
    b.cyl(x, 0.011, z, 0.018, 0.006, yellow, 6);
}

/** A cast-iron manhole cover, or a drain grate on the north edge. */
export function manhole(b: Build, drain: boolean) {
  const iron = b.kit.material(0x3a3a38, 0.6, 0.6);
  if (drain) {
    b.box(0, 0.004, -H + 0.2, 0.9, 0.008, 0.3, iron);
    for (let x = -0.4; x <= 0.4; x += 0.05) b.box(x, 0.009, -H + 0.2, 0.02, 0.004, 0.26, b.dark);
    return;
  }
  b.cyl(0, 0.004, 0, 0.32, 0.008, iron, 24);
  for (let i = 0; i < 6; i++) b.ring(0, 0.009, 0, 0.06 + i * 0.045, 0.006, b.dark, b.root, 20).rotation.x = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// Bins.

/** The konbini's recycling bank against its wall (back on the north edge): four boxy cabinets, mouths labelled. */
export function binBank(b: Build) {
  const labels = ["burnable", "pet", "cans", "burnable"] as const;
  labels.forEach((label, i) => {
    const x = -0.48 + i * 0.32, z = -H + 0.3;
    b.box(x, 0.48, z, 0.3, 0.96, 0.44, b.body);
    b.box(x, 0.965, z, 0.31, 0.03, 0.45, b.header);
    b.box(x, 0.78, z + 0.222, 0.26, 0.06, 0.004, b.stripe);
    if (label === "burnable") b.box(x, 0.62, z + 0.222, 0.18, 0.06, 0.006, b.dark);
    else b.cyl(x, 0.62, z + 0.222, 0.065, 0.008, b.dark, 14).rotation.x = Math.PI / 2;
    b.sign(label, x, 0.86, z + 0.224, 0.26, 0.07);
  });
}

/** A rubbish collection point: tied bags under a blue net weighted at the edges. */
export function rubbishPoint(b: Build) {
  const net = b.kit.material(0x2f6fa8, 0, 0.8);
  for (let i = 0; i < 6; i++) {
    const bag = b.cyl(-0.3 + (i % 3) * 0.3 + (b.random() - 0.5) * 0.08, 0.21, -0.3 + Math.floor(i / 3) * 0.3, 0.16, 0.34,
      b.kit.material(b.pick([0xe8e6de, 0xd8d6cc, 0xe0dcc8]), 0, 0.5), 8, b.root, 0.08);
    bag.rotation.z = (b.random() - 0.5) * 0.4;
  }
  b.box(0, 0.37, -0.15, 1.05, 0.02, 0.8, net).rotation.x = 0.05;
  for (const x of [-0.52, 0.52]) b.box(x, 0.18, -0.15, 0.02, 0.36, 0.8, net);
  for (const z of [-0.55, 0.25]) b.box(0, 0.05, z, 1.05, 0.06, 0.06, b.kit.material(0x2a3a4a, 0, 0.8));
}

/** The folding mesh rubbish cage of an apartment block: green steel mesh, a hinged lid. */
export function rubbishCage(b: Build) {
  const green = b.kit.material(0x3e5a4a, 0.4, 0.55);
  for (const x of [-0.55, 0.55]) for (const z of [-0.35, 0.35]) b.box(x, 0.5, z, 0.03, 1.0, 0.03, green);
  for (let y = 0.1; y < 1.0; y += 0.15) {
    b.box(0, y, -0.35, 1.1, 0.008, 0.008, green); b.box(0, y, 0.35, 1.1, 0.008, 0.008, green);
    for (const x of [-0.55, 0.55]) b.box(x, y, 0, 0.008, 0.008, 0.7, green);
  }
  for (let x = -0.5; x <= 0.5; x += 0.1) for (const z of [-0.35, 0.35]) b.box(x, 0.5, z, 0.006, 1.0, 0.006, green);
  const lid = b.part("bin-lid", 0, 1.0, -0.35);
  lid.rotation.x = -0.25;
  b.box(0, 0, 0.35, 1.12, 0.02, 0.72, green, lid);
  for (let i = 0; i < 3; i++) b.cyl(-0.3 + i * 0.3, 0.2, 0, 0.15, 0.36, b.kit.material(0xe8e6de, 0, 0.5), 8, b.root, 0.07);
}

/** A bicycle rack against a wall (back on the north edge): a rail with wheel slots. */
export function bikeRack(b: Build) {
  const steel = b.kit.material(0x8a9094, 0.6, 0.45);
  b.box(0, 0.25, -H + 0.25, C, 0.04, 0.04, steel);
  for (let x = -0.55; x <= 0.56; x += 0.22) {
    b.box(x, 0.12, -H + 0.25, 0.04, 0.24, 0.04, steel);
    for (const s of [-1, 1]) b.box(x + s * 0.04, 0.15, -H + 0.35, 0.01, 0.18, 0.3, steel);
  }
}

/** A roadworks group for the kerb: striped barrier boards on feet, cones, a 工事中 board and a flashing lamp. */
export function roadworks(b: Build) {
  const yellow = b.kit.material(0xd9a52b, 0, 0.6), black = b.kit.material(0x1a1a1a, 0, 0.7);
  for (const z of [-0.45, 0.45]) {
    for (let i = 0; i < 6; i++) b.box(-0.5 + i * 0.2, 0.7, z, 0.1, 0.24, 0.03, i % 2 ? yellow : black).rotation.z = 0.5;
    b.box(0, 0.7, z, 1.2, 0.26, 0.02, yellow);
    for (const x of [-0.55, 0.55]) { b.box(x, 0.4, z, 0.04, 0.8, 0.04, black); b.box(x, 0.03, z, 0.06, 0.06, 0.4, black); }
  }
  for (const [x, z] of [[-0.45, 0], [0, 0.1], [0.45, -0.05]]) {
    b.cyl(x, 0.3, z, 0.12, 0.6, b.kit.material(0xd77439, 0, 0.7), 12, b.root, 0.025);
    b.cyl(x, 0.35, z, 0.09, 0.08, b.kit.material(0xe8e4d8, 0, 0.6), 12);
    b.box(x, 0.02, z, 0.32, 0.04, 0.32, black);
  }
  b.box(0.55, 0.9, 0.45, 0.04, 0.04, 0.04, black);
  b.cyl(0.55, 0.97, 0.45, 0.05, 0.1, b.kit.material(0xffb24a, 0, 0.4, 1.5, 0xff9a2a), 12);
  b.box(-0.2, 1.15, 0.47, 0.5, 0.3, 0.02, b.kit.material(0xf0eee6, 0, 0.6));
  b.sign("works", -0.2, 1.15, 0.482, 0.44, 0.14);
}

/** Three chōchin in a short row under the eaves, on a wall bracket (wall mount, hang +z). */
export function lanternRow(b: Build) {
  b.box(0, 0, 0.18, 1.2, 0.04, 0.04, b.woodTrim);
  for (const x of [-0.5, 0.5]) b.box(x, 0, 0.09, 0.04, 0.04, 0.18, b.woodTrim);
  for (const x of [-0.4, 0, 0.4]) {
    const g = b.frame(0, x, 0.18);
    g.position.y = -2.3;
    g.scale.setScalar(0.85);
    const inner = new Build(b.kit, `lantern-row-${x}`, b.finish, (b.variant + Math.round(x * 10)) & 3);
    lantern(inner);
    g.add(inner.root);
  }
}
