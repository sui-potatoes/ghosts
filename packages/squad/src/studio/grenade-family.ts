// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import {
  FRAG_GRENADE_POINTS,
  PIN,
  RING_R,
  RING_Z,
  collapse,
  fuze,
  keeper,
  lever,
  leverHead,
  lowMaterial,
  pin,
  type FragGrenadePart,
  type LeverPoint,
} from "./frag-grenade.ts";
import { WeaponGeometry, type WeaponFinish } from "./weapon-finish.ts";
import { withDetail, type Detail } from "./rifle-shapes.ts";

/**
 * The hand-grenade family on the Frag Grenade's fuze: one fuze, lever head,
 * pin, ring and keeper (`frag-grenade.ts`) at the same scale and in the same
 * frame, on different bodies. The body's top stands at the frag's neck
 * (`NECK`), so everything from the fuze up sits where it does on the frag;
 * only the lever's run down the body is the body's own.
 */

/** The frag's equator radius: a lever's `dish` of 1 fits it. */
const FRAG_R = 0.0295;

/**
 * The lever's line for a straight can of radius `r`: the frag's head, then
 * out over the can's top rim (`rim`: the height the sheet must clear) and
 * down the side to `end`, a millimetre off the wall, ending in a rounded tail.
 * Returns the line and the control points the low model keeps.
 */
export function canLever(
  r: number,
  rim: number,
  end: number,
  width = 0.0124,
): { line: LeverPoint[]; low: number[] } {
  const head = leverHead();
  const [hx] = head[head.length - 1].at;
  const x = r + 0.0012,
    dish = FRAG_R / (r + 0.0012);
  // Over the rim: a short shoulder from the ears out to the wall line.
  const shoulder: LeverPoint[] = [
    { at: [hx + (x - hx) * 0.3, rim + 0.0062], width: 0.0138, dish: 0.3 },
    {
      at: [hx + (x - hx) * 0.75, rim + 0.0042],
      width: 0.0136,
      dish: 0.6 * dish,
    },
    { at: [x - 0.0004, rim + 0.0018], width: 0.0134, dish },
    { at: [x, rim - 0.003], width: 0.0132, dish },
  ];
  const top = rim - 0.008,
    n = 6;
  const run: LeverPoint[] = Array.from({ length: n }, (_, i) => ({
    at: [x, top + ((end - top) * i) / (n - 1)],
    width: 0.013 - ((0.013 - width) * i) / (n - 1),
    dish,
  }));
  const tail: LeverPoint[] = [
    { at: [x - 0.0001, end - 0.0026], width: width * 0.72, dish },
    { at: [x - 0.0003, end - 0.0038], width: width * 0.36, dish },
  ];
  const line = [...head, ...shoulder, ...run, ...tail];
  const h = head.length,
    last = line.length - 1;
  return {
    line,
    low: [0, 3, 5, 7, 9, 10, 11, h + 1, h + 3, h + 4, h + 4 + (n - 1), last],
  };
}

/**
 * Builds a grenade of the family: `body` draws the body (in the frag's frame,
 * its top at `NECK`); the frag's fuze, lever head, pin, ring and keeper go on
 * top. Parts and details as `createFragGrenade`'s.
 */
export function assembleGrenade(
  name: string,
  detail: Detail,
  m: WeaponFinish,
  body: (g: WeaponGeometry) => void,
  leverLine: { line: LeverPoint[]; low: number[] },
): T.Group {
  const root = new T.Group();
  root.name = name;
  root.userData.detail = detail;
  const low = detail === "low" ? lowMaterial() : null;
  const part = (
    part: FragGrenadePart,
    origin: [number, number, number],
    build: (g: WeaponGeometry) => void,
  ) => {
    const g = new WeaponGeometry();
    g.offset.set(-origin[0], -origin[1], -origin[2]);
    withDetail(detail, () => build(g));
    const group = g.finish(part);
    group.position.fromArray(origin);
    root.add(low ? collapse(group, low) : group);
  };
  part("body", [0, 0, 0], (g) => {
    body(g);
    fuze(g, m);
  });
  part("lever", FRAG_GRENADE_POINTS.leverPivot, (g) =>
    lever(g, m, leverLine.line, leverLine.low),
  );
  part("pin", FRAG_GRENADE_POINTS.pin, (g) => pin(g, m));
  part("keeper", [PIN[0] - RING_R, PIN[1] - RING_R, RING_Z], (g) =>
    keeper(g, m),
  );
  return root;
}
