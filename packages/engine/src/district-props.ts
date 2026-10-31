// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { propRandom, type MapProp, type PropKind } from "./environment.ts";
import type { Cell } from "./map.ts";

/** Randomness varies finishes and dressing, never tactical occupancy. */
export function districtProps(covers: readonly Cell[], cellSize: number): MapProp[] {
  const kinds: PropKind[] = [
    "barrier", "crate", "cargo", "barrier", "barrels",
    "fence-sheet", "crate", "smoking-barrel", "cargo", "barrels",
  ];
  const props: MapProp[] = covers.map((cell, i) => ({
    id: `cover-${i}`, kind: kinds[i % kinds.length],
    x: cell[0] * cellSize, z: cell[1] * cellSize, yaw: 0, seed: 731 + i * 97, cover: cell,
  }));
  const random = propRandom(8411);
  const add = (kind: PropKind, x: number, z: number, yaw = 0, y = 0) => {
    props.push({ id: `dressing-${props.length}`, kind, x, z, yaw, y, seed: Math.floor(random() * 65536) });
  };
  // Service alleys behind the four shops; the main streets remain clear.
  for (const side of [-1, 1]) {
    for (const [i, kind] of (["fence-chain", "fence-sheet", "fence-picket"] as const).entries())
      add(kind, side * (4.2 + i * 2.45), -10.65, (random() - 0.5) * 0.04);
    add("wall", side * 9.1, 10.05);
    add("window-wall", side * 6.65, 10.05);
    // Independent glazing: shattering the pane leaves the masonry frame.
    add("glass", side * 6.65, 10.05, 0, 0.92);
    props[props.length - 1].support = props[props.length - 2].id;
    add("glass", side * 4.2, 10.05);
    add("sign", side * 2.1, side * 10.6, side > 0 ? Math.PI : 0);
    add("cone", side * 0.65, side * (side < 0 ? 10.5 : 9.25), random());
    add("cone", side * 1.25, side * (side < 0 ? 11.4 : 10.15), random());
    add("smoking-barrel", side * 11.1, side * 10.65, random());
    // Delivery stacks behind the southern stores, clear of their solid footprints.
    for (let i = 0; i < 4; i++)
      add(i % 2 ? "barrels" : "crate", side * (4.1 + i * 2.0), 9.25, (random() - 0.5) * 0.3);
    add("cargo", side * 11.9, 9.25, (random() - 0.5) * 0.15);
    add("sign", side * 14, 1.2, -side * Math.PI / 2);
    add("cone", side * 13.9, 0.3, random());
  }
  return props;
}
