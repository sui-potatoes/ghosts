// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { PropKind } from "../environment.ts";

export const cracksWhenDamaged = (kind: PropKind) =>
  kind === "barrier" || kind === "wall" || kind === "window-wall" || kind === "glass" ||
  kind === "office-glass-wall" || kind === "office-glass-door";

export const staysRigidWhenDamaged = (kind: PropKind) =>
  kind === "cargo" || kind === "barrels" || kind === "smoking-barrel" || kind.startsWith("fence-") || kind.startsWith("office-");

/** Apply the same prop-space warp to panels, trim and labels so they stay attached. */
export function deformPropGeometry(geometry: T.BufferGeometry, bounds: T.Box3, kind: PropKind, strength: number) {
  if (staysRigidWhenDamaged(kind)) return;
  const size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
  const position = geometry.getAttribute("position");
  const wood = kind === "crate" || kind === "fence-picket";
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const height = T.MathUtils.clamp((y - bounds.min.y) / Math.max(size.y, 0.01), 0, 1);
    const dx = (x - center.x - size.x * 0.12) / Math.max(size.x * 0.36, 0.1);
    const dy = (y - center.y) / Math.max(size.y * 0.38, 0.1);
    const dent = Math.exp(-dx * dx - dy * dy) * strength * Math.min(1, height * 8);
    // Thin surfaces bend together; thicker deformable props dent on the front face.
    const front = size.z < 0.18 ? 1 : T.MathUtils.clamp((z - bounds.min.z) / size.z, 0, 1);
    const bend = strength * height * height;
    position.setXYZ(i,
      x + bend * (wood ? 0.045 : 0.13),
      y - dent * (wood ? 0.015 : 0.055),
      z + (wood ? Math.sin(height * 3) * bend * 0.065 : -dent * front * 0.24 - bend * 0.06));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
