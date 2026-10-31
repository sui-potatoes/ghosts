// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { CELL, type Cell, type MapPlan } from "../map.ts";
import type { OfficeFinish, OfficeKind } from "./catalog.ts";
import type { MapProp } from "../environment.ts";

export interface OfficePlacement {
  id: string;
  kind: OfficeKind;
  x: number; z: number; y?: number; yaw?: number;
  finish?: OfficeFinish;
  open?: boolean;
  collision?: { cell: Cell; type: "cover" | "solid" | "obstacle" };
}

/** The office layout is shared by the map rules and scenery. Coordinates are metres. */
export const officeLayout: OfficePlacement[] = [];
const place = (kind: OfficeKind, x: number, z: number, extra: Partial<OfficePlacement> = {}) =>
  officeLayout.push({ id: `office-${officeLayout.length}`, kind, x: x * CELL, z: z * CELL, ...extra });
const collision = (x: number, z: number, type: "cover" | "solid" | "obstacle") => ({ cell: [x, z] as Cell, type });

for (const z of [-2, 1]) for (const x of [-5, -3, 2, 4]) {
  const finish = x < 0 ? "sage" : "slate";
  const tucked = x === -3 || x === 4;
  place(tucked ? "desk-tucked" : "desk", x, z, { finish, collision: collision(x, z, "cover") });
  place("cubicle", x, z, { finish, z: z * CELL - 0.55 });
  place("monitor", x, z, { y: 0.766, z: z * CELL - 0.14 });
  place("keyboard", x, z, { y: 0.766, x: x * CELL - 0.1, z: z * CELL + 0.19 });
  place("computer", x, z, { x: x * CELL + 0.39, z: z * CELL - 0.03 });
  place(x < 0 ? "folders" : "papers", x, z, { y: 0.766, x: x * CELL + 0.43, z: z * CELL - 0.03 });
  if (!tucked) place("task-chair", x, z + 1, { finish, yaw: Math.PI + (x % 3) * 0.12, collision: collision(x, z + 1, "obstacle") });
}

// A conference table on the west, clear central aisle, and low archive cabinets east.
place("meeting-table", -7, -0.5, { finish: "sand", collision: collision(-7, -1, "cover") });
place("laptop", -7, -0.65, { y: 0.8, yaw: Math.PI / 2 });
place("papers", -7, 0.1, { y: 0.8, yaw: 0.2 });
for (const z of [-1, 0]) place("visitor-chair", -6, z, { finish: "sand", yaw: -Math.PI / 2, collision: collision(-6, z, "obstacle") });
for (const z of [-1, 0, 1]) {
  place("filing-cabinet", 7, z, { yaw: -Math.PI / 2, collision: collision(7, z, "cover") });
  place(z === 0 ? "printer" : "binders", 7, z, { y: 1.02, yaw: -Math.PI / 2 });
}
place("desk", 4, 5, { finish: "sand", collision: collision(4, 5, "cover") });
place("desk-tray", 4, 5, { y: 0.766, x: 4 * CELL + 0.35 });
place("laptop", 4, 5, { y: 0.766, x: 4 * CELL - 0.2 });
place("corner-desk", -6, 5, { finish: "sand", collision: collision(-6, 5, "cover") });
place("monitor", -6, 5, { y: 0.766, z: 5 * CELL - 0.1 });
place("folders", -6, 5, { y: 0.766, x: -6 * CELL - 0.3, z: 5 * CELL + 0.65 });

// Two open doorways lead into the records room. PIN pads are visual assets in this demo.
for (let x = -7; x <= 7; x++) {
  if (x === -3 || x === 3) {
    place(x < 0 ? "steel-door" : "glass-door", x, -4, { open: true });
    place("keypad", x, -4, { x: x * CELL + 0.77, z: -4 * CELL + 0.13, y: 1.05 });
    continue;
  }
  const kind = x <= 0 ? (x === -5 ? "window-wall" : "steel-wall") : "glass-wall";
  place(kind, x, -4, { collision: collision(x, -4, kind === "glass-wall" ? "obstacle" : "solid") });
}
for (const x of [-6, -4, 4, 6]) place("shelf", x, -6, { collision: collision(x, -6, "solid") });
for (const x of [-1, 0, 1]) place("locker", x, -6, { collision: collision(x, -6, "solid") });

// Perimeter outside playable cells; no invisible wall through an open tile.
for (let x = -7; x <= 7; x++) place(x % 4 === 0 ? "window-wall" : "steel-wall", x, -6.5);
for (let z = -6; z <= 6; z++) {
  place(z % 3 === 0 ? "window-wall" : "steel-wall", -7.5, z, { yaw: Math.PI / 2 });
  place("glass-wall", 7.5, z, { yaw: Math.PI / 2 });
}

// Utility props occupy existing furniture space or the outer service aisle.
place("wastebasket", -5, 1, { x: -5 * CELL - .33, z: CELL + .08, collision: collision(-5, 1, "obstacle") });
place("recycling-bin", 7, 3, { collision: collision(7, 3, "obstacle") });
place("pedal-bin", -7, 3, { collision: collision(-7, 3, "obstacle") });
place("wheelie-bin", -2, -6, { collision: collision(-2, -6, "obstacle") });

/** Shot volumes match the outer dimensions of the authored office pieces. */
const sizes: Record<OfficeKind, [number, number, number]> = {
  wastebasket: [.36, .36, .36], "recycling-bin": [.43, .63, .39],
  "pedal-bin": [.43, .585, .48], "wheelie-bin": [.64, .96, .63],
  "desk-tucked": [1.25, 1.12, .98], desk: [1.25, .77, .72], "corner-desk": [1.25, .77, 1.37], "meeting-table": [1.16, .8, 2.55],
  "task-chair": [.64, 1.12, .64], "visitor-chair": [.5, .94, .46], monitor: [.57, .49, .19],
  computer: [.19, .43, .42], laptop: [.35, .28, .28], keyboard: [.61, .05, .2], printer: [.51, .33, .5],
  papers: [.24, .04, .32], folders: [.31, .08, .37], binders: [.29, .32, .26], "desk-tray": [.28, .14, .34],
  cubicle: [1.3, 1.21, .09], "glass-door": [1.12, 2.52, .055], "steel-door": [1.35, 2.7, .16],
  keypad: [.13, .24, .06], "steel-wall": [1.35, 2.7, .16], "window-wall": [1.35, 2.7, .16],
  "glass-wall": [1.25, 2.55, .018], "filing-cabinet": [.52, 1.02, .67], shelf: [1.22, 1.91, .48], locker: [.6, 1.94, .51],
};

export const officeProps: MapProp[] = officeLayout.map(p => {
  const [width, height, depth] = sizes[p.kind];
  const cover = p.collision?.type === "cover" ? p.collision.cell : undefined;
  const cells = p.collision ? [p.collision.cell] : [];
  const covers = cover ? [cover] : [];
  if (p.kind === "meeting-table") { cells.push([-7, 0]); covers.push([-7, 0]); }
  if (p.kind === "corner-desk") cells.push([-6, 6]);
  if (p.kind === "cubicle") {
    const cell: Cell = [Math.round(p.x / CELL), Math.round(p.z / CELL)]; cells.push(cell); covers.push(cell);
  }
  return { id: p.id, kind: `office-${p.kind}`, x: p.x, z: p.z, y: p.y, yaw: p.yaw ?? 0, seed: 731,
    office: { kind: p.kind, finish: p.finish, open: p.open },
    cover: covers[0], covers, blocks: cells,
    hitbox: { width, height, depth,
      ...(p.kind === "glass-wall" ? { y: .075 } : {}),
      ...(p.kind === "corner-desk" ? { z: .325 } : {}),
      ...(p.kind === "desk-tucked" ? { z: .13 } : {}),
    },
  };
});

for (const prop of officeProps) {
  const kind = prop.office!.kind;
  // The open leaf occupies the doorway's hinge side, not the empty doorway.
  if ((kind === "glass-door" || kind === "steel-door") && prop.office!.open) {
    prop.hitbox = { width: .055, height: 2.52, depth: 1.12, x: -.57, y: .04, z: -.57 };
  }
  if (kind === "keypad") {
    const owner = officeProps.filter(p => p.kind.endsWith("-wall") || p.kind.endsWith("-door"))
      .sort((a, b) => Math.hypot(a.x - prop.x, a.z - prop.z) - Math.hypot(b.x - prop.x, b.z - prop.z))[0];
    if (owner && Math.hypot(owner.x - prop.x, owner.z - prop.z) < 1) prop.support = owner.id;
  }
  if ((prop.y ?? 0) >= .7) {
    const furniture = officeProps.filter(p => ["office-desk", "office-desk-tucked", "office-corner-desk", "office-meeting-table", "office-filing-cabinet"].includes(p.kind));
    const owner = furniture.sort((a, b) => Math.hypot(a.x - prop.x, a.z - prop.z) - Math.hypot(b.x - prop.x, b.z - prop.z))[0];
    if (owner && Math.hypot(owner.x - prop.x, owner.z - prop.z) < 1) prop.support = owner.id;
  }
}

// Steel walls / doors keep their structure when a separate vision pane shatters.
for (const p of officeLayout) if (p.kind === "window-wall" || p.kind === "steel-door") {
  const wall = p.kind === "window-wall", yaw = (p.yaw ?? 0) + (p.open ? Math.PI / 2 : 0);
  const dx = p.open ? -.57 : 0, dz = p.open ? -.57 : 0;
  const c = Math.cos(p.yaw ?? 0), s = Math.sin(p.yaw ?? 0);
  const width = wall ? 1.22 : .33, height = wall ? 1.46 : .36;
  officeProps.push({ id: `${p.id}-pane`, kind: "glass", x: p.x + dx * c + dz * s, z: p.z - dx * s + dz * c,
    y: wall ? .93 : 1.69, yaw, seed: 731, support: p.id, pane: { width, height },
    hitbox: { width, height, depth: .018 } });
}

const solids = officeLayout.filter(p => p.collision?.type === "solid");
export const officePlan: MapPlan = {
  id: "office",
  bounds: { minX: -7, maxX: 7, minZ: -6, maxZ: 6 },
  buildings: solids.map(p => ({ x: p.collision!.cell[0], z: p.collision!.cell[1], w: 1, d: 1, h: 2.7, kind: p.kind, prop: p.id })),
  covers: [...new Map(officeProps.flatMap(p => p.covers ?? []).map(cell => [cell.join(), cell])).values()],
  props: officeProps,
  street: { avenueHalf: 99, crossHalf: 99, curb: 0, reach: 20 },
};
