// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GearGeometry, gearFinish } from "./gear-geometry.ts";

/** Shared metre-scale reduction, baked into geometry so sockets remain unit-scale. */
export const WEAPON_SCALE = 0.9;
export function sizeWeapon(root: T.Group, pivot = new T.Vector3()) {
  for (const child of root.children) {
    if (child instanceof T.Mesh) {
      child.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      child.geometry.scale(WEAPON_SCALE, WEAPON_SCALE, WEAPON_SCALE);
      child.geometry.translate(pivot.x, pivot.y, pivot.z);
    }
  }
  return root;
}

/** Stable material slots, shared by all weapons and fittings. Colours are linearized by Three. */
export function weaponFinish(
  kind: "rifle" | "sniper" | "plasma" | "attachment",
) {
  const shell = {
    rifle: 0x685f4e,
    sniper: 0x46575b,
    plasma: 0xc3c7bf,
    attachment: 0x586365,
  }[kind];
  const light = new T.MeshStandardMaterial({
    name: "07_Indicator",
    color: 0x99ece7,
    emissive: 0x42c7c2,
    emissiveIntensity: 1.1,
    roughness: 0.28,
    metalness: 0.3,
  });
  return {
    shell: gearFinish("01_Cerakote", shell, 0.45, 0.38, 0.018),
    metal: gearFinish("02_Graphite", 0x272f33, 0.72, 0.32, 0.014),
    steel: gearFinish("03_Titanium", 0x9aa7ab, 0.85, 0.27, 0.008),
    rubber: gearFinish("04_Elastomer", 0x131b1e, 0.02, 0.78, 0.045),
    accent: gearFinish("05_Copper", 0xb87743, 0.78, 0.3, 0.012),
    glass: new T.MeshStandardMaterial({
      name: "06_OpticalGlass",
      color: 0x185a69,
      metalness: 0.55,
      roughness: 0.08,
    }),
    light,
    marking: new T.MeshStandardMaterial({
      name: "08_Markings",
      color: 0xd7dfd9,
      roughness: 0.65,
    }),
  };
}
export type WeaponFinish = ReturnType<typeof weaponFinish>;

/** Small edge radii catch studio lighting; fasteners stay real geometry at inspection distance. */
export class WeaponGeometry extends GearGeometry {
  override box(p: number[], size: number[], m: T.Material, rotation?: T.Euler) {
    const radius = Math.min(...size) * 0.16;
    this.add(
      new RoundedBoxGeometry(size[0], size[1], size[2], 1, radius),
      m,
      p,
      rotation,
    );
  }
  screw(x: number, y: number, z: number, m: WeaponFinish, r = 0.0027) {
    const side = Math.sign(z) || 1;
    this.cylinder([x, y, z], r, 0.002, m.steel, "z", r, 12);
    this.cylinder(
      [x, y, z + side * 0.0011],
      r * 0.48,
      0.0003,
      m.rubber,
      "z",
      r * 0.48,
      6,
    );
  }
  rail(start: number, end: number, y: number, m: WeaponFinish) {
    this.box([(start + end) / 2, y, 0], [end - start, 0.007, 0.022], m.metal);
    for (let x = start + 0.005; x < end - 0.003; x += 0.012)
      this.box([x, y + 0.005, 0], [0.007, 0.006, 0.032], m.shell);
  }
}
