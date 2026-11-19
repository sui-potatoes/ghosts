// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { gearFinish } from "./gear-geometry.ts";
import { NECK, UV, lathe, revolve, stud, type Rect } from "./frag-grenade.ts";
import { assembleGrenade, canLever } from "./grenade-family.ts";
import { WeaponGeometry, type WeaponFinish } from "./weapon-finish.ts";
import { familyFinish, isLow, seg, type Detail } from "./rifle-shapes.ts";

/**
 * Flashbang: a slim stun charge on the Frag Grenade's fuze
 * (`grenade-family.ts`). A dark inner can carries the charge; a thin
 * gunmetal sleeve over it is pierced by three rows of eight round vents, and
 * two raised end rings hold the sleeve. The vents are the marking: no band.
 * The carry stud under the base is the frag's.
 *
 * About 48 mm across and 120 mm from stud to lever. Same frame as the frag
 * (+Y up the fuze axis, +X the lever side, +Z the ring side, metres), the
 * fuze where it stands on the frag.
 */

/** Outer radius of the vented sleeve. */
const SLEEVE = 0.0232;
/** Sleeve wall. */
const WALL = 0.0009;
/** The end rings stand proud of the sleeve. */
const RING = 0.0243;
/** The inner can, seen through the vents. */
const CORE = 0.019;
/** Bottom of the can (the stud's seat). */
const BOTTOM = -0.054;
/** The sleeve between the end rings. */
const SLEEVE_Y: [number, number] = [-0.0442, 0.0214];
/** Vent grid: rows x columns, square cells, round vents. */
const ROWS = 3,
  COLUMNS = 8,
  VENT = 0.0047;

/** Points other code may want, in the grenade frame (as `FRAG_GRENADE_POINTS`). */
export const FLASHBANG_POINTS = {
  grip: [0, -0.008, 0] as [number, number, number],
  carry: [0, BOTTOM - 0.0031, 0] as [number, number, number],
};

/** Where a stencil pass puts its labels (as `FRAG_GRENADE_STENCILS`): on the
 * top end ring, read from the ring side. */
export const FLASHBANG_STENCILS = [
  { text: "FLASH", angle: 90, y: 0.0256, r: RING, size: 0.004, tone: "light" },
  {
    text: "M12   STUN",
    angle: 270,
    y: -0.049,
    r: RING,
    size: 0.0032,
    tone: "light",
  },
] as const;

/** The family's slots: the sleeve in dark gunmetal; the end rings are the lever's steel. */
export function flashbangFinish(base: WeaponFinish = familyFinish()) {
  return {
    ...base,
    shell: gearFinish("01_Cerakote", 0x2b3135, 0.62, 0.38, 0.016),
  };
}

/** Square vent cells: as wide as an eighth of the sleeve, as tall. */
const CELL = (Math.PI * 2 * SLEEVE) / COLUMNS;
const VENTS_Y: [number, number] = [
  (SLEEVE_Y[0] + SLEEVE_Y[1]) / 2 - (CELL * ROWS) / 2,
  (SLEEVE_Y[0] + SLEEVE_Y[1]) / 2 + (CELL * ROWS) / 2,
];

/** Arc-length offsets along a cell's edge where the frame meets it. */
const edgeOffsets = (rays: number) => {
  const out: number[] = [];
  for (let k = 0; k <= rays / 4; k++) {
    const t = Math.tan(-Math.PI / 4 + (k * 2 * Math.PI) / rays);
    out.push((t * CELL) / 2);
  }
  return out;
};

/**
 * The vented zone of the sleeve: per cell, a frame from the square cell edge
 * to the vent's circle on the sleeve's face, and the vent's bore through the
 * wall. Cells share their edge vertices, so the sleeve is closed.
 */
function ventedSleeve(g: WeaponGeometry, m: T.Material, rect: Rect) {
  const rays = 16;
  const p: number[] = [],
    n: number[] = [],
    uv: number[] = [];
  const at = (angle: number, y: number, r: number) =>
    new T.Vector3(r * Math.cos(angle), y, r * Math.sin(angle));
  const radial = (angle: number) =>
    new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const span = VENTS_Y[1] - VENTS_Y[0];
  const push = (v: T.Vector3, normal: T.Vector3, angle: number) => {
    p.push(v.x, v.y, v.z);
    n.push(normal.x, normal.y, normal.z);
    uv.push(
      rect[0] + (rect[2] - rect[0]) * (angle / (Math.PI * 2)),
      rect[1] + (rect[3] - rect[1]) * ((v.y - VENTS_Y[0]) / span),
    );
  };
  /** Two triangles a-b-c, a-c-d with the given per-vertex normals. */
  const quad = (
    q: { v: T.Vector3; n: T.Vector3; a: number }[],
    outward: T.Vector3,
  ) => {
    const [A, B, C] = q;
    const face = B.v.clone().sub(A.v).cross(C.v.clone().sub(A.v));
    const order =
      face.dot(outward) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) push(q[i].v, q[i].n, q[i].a);
  };
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLUMNS; col++) {
      // Cell centre: columns centred between +X and the next eighth, so the
      // lever lies on a solid strip.
      const ac = ((col + 0.5) * Math.PI * 2) / COLUMNS,
        yc = VENTS_Y[0] + (row + 0.5) * CELL;
      const ray = (k: number) => (k * Math.PI * 2) / rays;
      // Square edge point along ray k (u along the arc, v up), and the vent's.
      const edge = (k: number): [number, number] => {
        const t = ray(k),
          c = Math.cos(t),
          s = Math.sin(t),
          f = CELL / 2 / Math.max(Math.abs(c), Math.abs(s));
        return [c * f, s * f];
      };
      const hole = (k: number): [number, number] => [
        Math.cos(ray(k)) * VENT,
        Math.sin(ray(k)) * VENT,
      ];
      const onSleeve = ([u, v]: [number, number], r: number) => {
        const angle = ac + u / SLEEVE;
        return { v: at(angle, yc + v, r), angle };
      };
      for (let k = 0; k < rays; k++) {
        const k1 = (k + 1) % rays;
        // Frame on the sleeve's face.
        const corners = [edge(k), hole(k), hole(k1), edge(k1)].map((uv) => {
          const s = onSleeve(uv, SLEEVE);
          return { v: s.v, n: radial(s.angle), a: s.angle };
        });
        quad(corners, radial(ac));
        // Bore through the wall, facing the vent's axis.
        const bore = [
          [hole(k), SLEEVE],
          [hole(k), SLEEVE - WALL],
          [hole(k1), SLEEVE - WALL],
          [hole(k1), SLEEVE],
        ].map(([uvk, r]) => {
          const [u, v] = uvk as [number, number],
            s = onSleeve([u, v], r as number);
          const tangent = new T.Vector3(
            -Math.sin(s.angle),
            0,
            Math.cos(s.angle),
          );
          const inward = tangent
            .multiplyScalar(-u)
            .add(new T.Vector3(0, -v, 0))
            .normalize();
          return { v: s.v, n: inward, a: s.angle };
        });
        const [hu, hv] = hole(k);
        const mid = at(ac + hu / SLEEVE, yc + hv, SLEEVE);
        const centre = at(ac, yc, SLEEVE);
        quad(bore, centre.sub(mid));
      }
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  geo.setAttribute("normal", new T.Float32BufferAttribute(n, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.add(geo, m);
}

function body(g: WeaponGeometry, m: WeaponFinish) {
  const around = seg(48, 16);
  // Bottom end ring, with the recessed base the stud stands on.
  lathe(
    g,
    m.steel,
    [
      [BOTTOM + 0.0015, 0],
      [BOTTOM + 0.0015, 0.0178],
      [BOTTOM + 0.0003, 0.0196],
      [BOTTOM, 0.0222],
      [BOTTOM + 0.0009, RING],
      [SLEEVE_Y[0] - 0.0009, RING],
      [SLEEVE_Y[0], SLEEVE],
    ],
    around,
    [0, 0, 1, 0.12],
  );
  // Top end ring and the shoulder up to the fuze boss.
  lathe(
    g,
    m.steel,
    [
      [SLEEVE_Y[1], SLEEVE],
      [SLEEVE_Y[1] + 0.0009, RING],
      [0.0296, RING],
      [0.0306, 0.0234],
      [0.0336, 0.0204],
      [NECK - 0.0002, 0.0178],
      [NECK, 0.0158],
      [NECK, 0.0141],
      [NECK, 0],
    ],
    around,
    [0, 0.44, 1, 0.56],
  );
  if (isLow()) {
    // A plain sleeve: the vents come from the bake.
    lathe(
      g,
      m.shell,
      [
        [SLEEVE_Y[0], SLEEVE],
        [SLEEVE_Y[1], SLEEVE],
      ],
      around,
      [0, 0.12, 1, 0.44],
    );
    return;
  }
  // The sleeve's solid ends, on the vent cells' own edge columns.
  const columns: number[] = [];
  const offsets = edgeOffsets(16);
  for (let col = 0; col < COLUMNS; col++)
    for (const u of offsets.slice(0, -1))
      columns.push(((col + 0.5) * Math.PI * 2) / COLUMNS + u / SLEEVE);
  for (const [y0, y1] of [
    [SLEEVE_Y[0], VENTS_Y[0]],
    [VENTS_Y[1], SLEEVE_Y[1]],
  ])
    revolve(
      g,
      [
        { y: y0, r: SLEEVE },
        { y: y1, r: SLEEVE },
      ],
      columns,
      columns.map(() => false),
      0,
      () => ({ m: m.shell, flat: false }),
      [0, 0.12, 1, 0.44],
    );
  ventedSleeve(g, m.shell, [0, 0.12, 1, 0.44]);
  // The inner can behind the vents.
  lathe(
    g,
    m.rubber,
    [
      [SLEEVE_Y[0] - 0.0004, CORE],
      [SLEEVE_Y[1] + 0.0004, CORE],
    ],
    32,
    UV.hardware,
  );
}

/**
 * Builds the Flashbang, with the frag's parts (`body`, `lever`, `pin`,
 * `keeper`) and details: "high" the authored model with the vents cut
 * through the sleeve, "low" one baked material and a plain sleeve.
 */
export function createFlashbang(
  options: { detail?: Detail; finish?: WeaponFinish } = {},
): T.Group {
  const detail = options.detail ?? "high";
  const m = options.finish ?? flashbangFinish();
  return assembleGrenade(
    "Flashbang",
    detail,
    m,
    (g) => {
      body(g, m);
      stud(g, m, BOTTOM + 0.0404);
    },
    canLever(RING, 0.0296, -0.03, 0.0118),
  );
}
