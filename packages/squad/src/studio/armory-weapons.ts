// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WEAPON_SCALE,
  WeaponGeometry,
  sizeWeapon,
  weaponFinish,
  type WeaponFinish,
} from "./weapon-finish.ts";
import { familyFinish, type Detail } from "./rifle-shapes.ts";
import {
  MARKSMAN_MOUNTS,
  MARKSMAN_MUZZLE,
  createMarksmanFurniture,
  marksmanRifle,
} from "./marksman-rifle.ts";
import {
  PLASMA_MOUNTS,
  PLASMA_MUZZLE,
  createPlasmaFurniture,
  plasmaRifle,
} from "./plasma-rifle.ts";
import {
  RIFLE_MOUNTS,
  RIFLE_MUZZLE,
  createServiceFurniture,
  serviceRifle,
} from "./service-rifle.ts";
import { createLaserTrace, createRailUpgrade } from "./rail-upgrades.ts";
import {
  createFurnitureUpgrade,
  type FurnitureGun,
} from "./furniture-upgrades.ts";
import { ATTACHMENT_SLOTS, attachmentById } from "../catalog.ts";
import type { AttachmentSlot, Equipment, WeaponAttachments } from "../types.ts";
import type { ArmorySkin } from "./armory-skins.ts";

/**
 * The redesigned long guns for the Armory stage only. Recruits, encounters and
 * the engine keep loading the baked GLB weapons through `EquipmentAssets`;
 * nothing here is reachable from them.
 *
 * A model is the gun plus its four furniture fittings, merged to one mesh per
 * material in the weapon frame (+X muzzle, +Y up), built once per
 * (gun, fittings) and shared by reference count. With a skin
 * (`armory-skins.ts`) the body and the standard clip and stock are the skinned
 * game mesh instead; upgrade fittings stay built, in their own finish.
 */

export type ArmoryGun = "rifle" | "sniper" | "plasma";
export const isArmoryGun = (model: Equipment["model"]): model is ArmoryGun =>
  model === "rifle" || model === "sniper" || model === "plasma";

/** Detail of the live stage: the authored model. */
export const ARMORY_DETAIL: Detail = "high";

const GUNS = {
  rifle: {
    furniture: "rifle" as FurnitureGun,
    mounts: RIFLE_MOUNTS,
    muzzle: () => RIFLE_MUZZLE,
    trace: 0.12,
    finish: familyFinish,
    body: (g: WeaponGeometry, m: WeaponFinish) =>
      serviceRifle(g, m, ARMORY_DETAIL),
    standard: (slot: "clip" | "stock", m: WeaponFinish) =>
      createServiceFurniture(slot, m, ARMORY_DETAIL),
  },
  sniper: {
    furniture: "marksman" as FurnitureGun,
    mounts: MARKSMAN_MOUNTS,
    muzzle: () => MARKSMAN_MUZZLE,
    trace: 0.12,
    finish: familyFinish,
    body: (g: WeaponGeometry, m: WeaponFinish) => marksmanRifle(g, m),
    standard: (slot: "clip" | "stock", m: WeaponFinish) =>
      createMarksmanFurniture(slot, m),
  },
  plasma: {
    furniture: "plasma" as FurnitureGun,
    mounts: PLASMA_MOUNTS,
    muzzle: () => PLASMA_MUZZLE,
    trace: 0.12,
    finish: () => weaponFinish("plasma"),
    body: (g: WeaponGeometry, m: WeaponFinish) => plasmaRifle(g, m),
    standard: (slot: "clip" | "stock", m: WeaponFinish) =>
      createPlasmaFurniture(slot, m),
  },
};

const INVERSE_BASIS = WEAPON_BASIS.clone().invert();

/** Fittings the stage shows: slot to tier, in a stable order. */
function fitting(
  attachments: WeaponAttachments,
): [AttachmentSlot, 1 | 2 | 3][] {
  const out: [AttachmentSlot, 1 | 2 | 3][] = [];
  for (const slot of ATTACHMENT_SLOTS) {
    const item = attachmentById(attachments[slot]);
    if (item?.slot === slot) out.push([slot, item.tier as 1 | 2 | 3]);
  }
  return out;
}

const keyOf = (
  gun: ArmoryGun,
  fits: [AttachmentSlot, number][],
  skin?: ArmorySkin,
) =>
  `${gun}:${fits.map(([s, t]) => `${s}${t}`).join(",")}${skin ? `:${skin.key}` : ""}`;

/** Fitting roots come out in the hand-socket frame, sized, with their origin
 * at the mount; bring them back to the weapon frame and seat them. */
function seat(
  root: T.Group,
  mount: readonly number[],
  into: Map<T.Material, T.BufferGeometry[]>,
) {
  const at = new T.Matrix4().makeTranslation(
    mount[0] * WEAPON_SCALE,
    mount[1] * WEAPON_SCALE,
    mount[2] * WEAPON_SCALE,
  );
  for (const mesh of root.children) {
    if (!(mesh instanceof T.Mesh)) continue;
    const geometry = mesh.geometry as T.BufferGeometry;
    geometry.applyMatrix4(INVERSE_BASIS).applyMatrix4(at);
    collect(into, mesh.material as T.Material, geometry);
  }
}

function collect(
  into: Map<T.Material, T.BufferGeometry[]>,
  material: T.Material,
  geometry: T.BufferGeometry,
) {
  const list = into.get(material) ?? [];
  list.push(geometry);
  into.set(material, list);
}

function build(
  gun: ArmoryGun,
  fits: [AttachmentSlot, 1 | 2 | 3][],
  skin?: ArmorySkin,
): T.Group {
  const spec = GUNS[gun],
    m = spec.finish(),
    parts = new Map<T.Material, T.BufferGeometry[]>();
  if (skin) {
    // The skinned game mesh replaces the built body; its pieces are already
    // in the weapon frame and sized.
    collect(parts, skin.material, skin.pieces.body.clone());
  } else {
    const g = new WeaponGeometry();
    spec.body(g, m);
    const body = sizeWeapon(g.finish("body"));
    for (const mesh of body.children)
      if (mesh instanceof T.Mesh)
        collect(
          parts,
          mesh.material as T.Material,
          mesh.geometry as T.BufferGeometry,
        );
  }
  const tiers = new Map(fits);
  for (const slot of ["clip", "stock"] as const) {
    const tier = tiers.get(slot);
    let root: T.Group | undefined;
    if (tier) {
      try {
        root = createFurnitureUpgrade(
          slot,
          spec.furniture,
          tier,
          ARMORY_DETAIL,
          m,
        );
      } catch {
        // A tier without a model yet (tube stock 1) shows the standard furniture.
      }
    }
    if (root) seat(root, spec.mounts[slot], parts);
    else if (skin) collect(parts, skin.material, skin.pieces[slot].clone());
    else {
      // Standard furniture is authored in the weapon frame behind WEAPON_BASIS too.
      seat(spec.standard(slot, m), spec.mounts[slot], parts);
    }
  }
  for (const slot of ["scope", "laser"] as const) {
    const tier = tiers.get(slot);
    if (tier)
      seat(
        createRailUpgrade(slot, tier, ARMORY_DETAIL, m),
        spec.mounts[slot],
        parts,
      );
  }
  const group = new T.Group();
  group.name = `armory-${gun}`;
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries)!;
    geometries.forEach((x) => x.dispose());
    const mesh = new T.Mesh(geometry, material);
    mesh.name = material.name;
    group.add(mesh);
  }
  // The laser's beam: its own unlit mesh, never merged with the gun finish.
  const laser = tiers.get("laser");
  if (laser) {
    const muzzle = spec.muzzle();
    group.add(
      createLaserTrace(laser, spec.mounts.laser, muzzle + spec.trace, muzzle),
    );
  }
  return group;
}

interface Entry {
  group: T.Group;
  refs: number;
  /** The skin the model was built with; released when the model is disposed. */
  skin?: ArmorySkin;
}
const cache = new Map<string, Entry>();
/** Idle models kept for quick returns while browsing fittings. */
const KEEP = 4;

function dispose(group: T.Group) {
  const materials = new Set<T.Material>();
  group.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    o.geometry.dispose();
    materials.add(o.material);
  });
  materials.forEach((m) => {
    // A skin's material and maps belong to the skin (shared between models).
    if (m.userData.armorySkin) return;
    for (const v of Object.values(m)) if (v instanceof T.Texture) v.dispose();
    m.dispose();
  });
}

function trim() {
  let idle = [...cache].filter(([, e]) => e.refs === 0);
  while (idle.length > KEEP) {
    const [key, entry] = idle.shift()!;
    cache.delete(key);
    dispose(entry.group);
    entry.skin?.release();
    idle = idle.slice();
  }
}

export interface ArmoryWeapon {
  /** A clone sharing geometry and materials with the cached build. */
  model: T.Group;
  /** Call once when the stage lets go of the model. */
  release(): void;
}

/** The redesigned gun with the attachments' fittings; shared per (gun,
 * fittings, skin). A `skin` (from `loadArmorySkin`) puts the gun's skinned
 * game mesh in place of the built body and standard clip and stock. */
export function acquireArmoryWeapon(
  gun: ArmoryGun,
  attachments: WeaponAttachments = {},
  skin?: ArmorySkin,
): ArmoryWeapon {
  const fits = fitting(attachments),
    key = keyOf(gun, fits, skin);
  let entry = cache.get(key);
  if (!entry) {
    entry = { group: build(gun, fits, skin), refs: 0, skin };
    skin?.retain();
    cache.set(key, entry);
  } else {
    // Re-insert so the idle list stays in least-recently-used order.
    cache.delete(key);
    cache.set(key, entry);
  }
  entry.refs++;
  const held = entry;
  let released = false;
  return {
    model: held.group.clone(),
    release() {
      if (released) return;
      released = true;
      held.refs--;
      trim();
    },
  };
}
