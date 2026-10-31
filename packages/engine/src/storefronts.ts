// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { MapProp } from "./environment.ts";
import { footprint, type Building } from "./map.ts";

/** Shared by the scenery frames and the independently breakable glazing. */
export function storefrontFaces(building: Building) {
  if (building.kind !== "seven" && building.kind !== "lawson") return [];
  const f = footprint(building), w = f.w - 0.1, d = f.d - 0.1;
  const side = building.kind === "seven" ? 1 : -1;
  return [
    { width: w, door: 0, x: 0, z: d / 2, yaw: 0, shift: side * 0.28, extra: 0.56 },
    { width: d, door: -side * 0.65, x: side * w / 2, z: 0, yaw: side * Math.PI / 2, shift: -side * 0.3, extra: 0.6 },
  ];
}

export function storefrontPanes(width: number, door: number) {
  const bays = [[-width / 2 + 0.08, door - 0.72], [door + 0.72, width / 2 - 0.08]];
  return [
    ...bays.map(([a, b]) => ({ x: (a + b) / 2, y: 0.15, z: 0, width: b - a, height: 2.5 })),
    ...[-1, 1].map((side) => ({ x: door + side * 0.355, y: 0.13, z: 0.04, width: 0.68, height: 2.28 })),
  ];
}

/** Building collision stays solid; only the visible glass becomes a prop. */
export function storefrontProps(buildings: readonly Building[]): MapProp[] {
  return buildings.flatMap((b, building) => {
    const f = footprint(b);
    return storefrontFaces(b).flatMap((face, faceIndex) =>
      storefrontPanes(face.width, face.door).map((pane, index) => ({
        id: `${b.kind}-glass-${faceIndex}-${index}`, kind: "glass" as const,
        x: f.x + face.x + Math.cos(face.yaw) * pane.x + Math.sin(face.yaw) * pane.z,
        z: f.z + face.z - Math.sin(face.yaw) * pane.x + Math.cos(face.yaw) * pane.z,
        y: pane.y, yaw: face.yaw, seed: 731,
        storefront: { building, width: pane.width, height: pane.height },
      })));
  });
}
