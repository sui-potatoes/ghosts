// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WEAPON_BASIS } from "./gear-geometry.ts";
import {
  WEAPON_SCALE,
  WeaponGeometry,
  weaponFinish,
  type WeaponFinish,
} from "./weapon-finish.ts";
import { familyFinish, withDetail, type Detail } from "./rifle-shapes.ts";
import {
  HANDGUARD as RIFLE_HANDGUARD,
  RIFLE_BORE,
  RIFLE_MOUNTS,
  RIFLE_MUZZLE,
  createServiceFurniture,
  serviceRifle,
} from "./service-rifle.ts";
import {
  HANDGUARD as MARKSMAN_HANDGUARD,
  MARKSMAN_BORE,
  MARKSMAN_MOUNTS,
  MARKSMAN_MUZZLE,
  createMarksmanFurniture,
  marksmanRifle,
} from "./marksman-rifle.ts";
import {
  HANDGUARD as PLASMA_HANDGUARD,
  PLASMA_BORE,
  PLASMA_MOUNTS,
  PLASMA_MUZZLE,
  createPlasmaFurniture,
  plasmaRifle,
} from "./plasma-rifle.ts";
import { createRailUpgrade } from "./rail-upgrades.ts";
import {
  createFurnitureUpgrade,
  type FurnitureGun,
} from "./furniture-upgrades.ts";
import { ATTACHMENT_SLOTS, attachmentById } from "../catalog.ts";
import type { AttachmentSlot, WeaponAttachments } from "../types.ts";

/**
 * The redesigned long guns as a character holds them: the service rifle
 * ("rifle"), the marksman rifle ("sniper") and the plasma rifle, with their
 * fittings (upgrade models at the gun's own mount table, the gun's standard
 * clip and stock where nothing is fitted), merged to one mesh per material.
 *
 * Output frame: the shared hand socket, the frame `createLongGun` used, so
 * `mountHandEquipment`, the combat weapon mount and the baked equipment poses
 * take these guns without a new calibration. The guns share the family pistol
 * grip, which sits where the old receivers had it; the gun is sized by
 * `WEAPON_SCALE` about that same grip point (`HELD_GRIP`), so the trigger hand
 * is unchanged. The support hand and the stock follow the per-gun handguard
 * and stock mounts exported here (`heldSupport`, `heldPoint`).
 */

export type HeldGun = "rifle" | "sniper" | "plasma";
export const isHeldGun = (model: string): model is HeldGun =>
  model === "rifle" || model === "sniper" || model === "plasma";

/** The sizing pivot in the hand socket: the trigger-hand contact inside the
 * pistol grip (authoring x -0.114, y -0.045). Shared by every long gun. */
export const HELD_GRIP = [0, -0.114, 0.045] as const;

interface Spec {
  furniture: FurnitureGun;
  bore: number;
  muzzle: number;
  mounts: Record<AttachmentSlot, [number, number, number]>;
  /** Weapon-frame station (x, unsized) where the support palm closes on
   * the gun: a hand's width onto the handguard (rifle, marksman), the middle
   * of the elastomer forend under the coils (plasma). */
  support: number;
  finish: () => WeaponFinish;
  body: (g: WeaponGeometry, m: WeaponFinish, detail: Detail) => void;
  standard: (
    slot: "clip" | "stock",
    m: WeaponFinish,
    detail: Detail,
  ) => T.Group;
}

/** From the handguard's rear edge to the support palm's centre. */
const SUPPORT_REACH = 0.06;
/** From the plasma forend's hand stop back to the support palm's centre. */
const SUPPORT_STOP = 0.045;

const SPECS: Record<HeldGun, Spec> = {
  rifle: {
    furniture: "rifle",
    bore: RIFLE_BORE,
    muzzle: RIFLE_MUZZLE,
    mounts: RIFLE_MOUNTS,
    support: RIFLE_HANDGUARD[0] + SUPPORT_REACH,
    finish: familyFinish,
    body: (g, m, detail) => serviceRifle(g, m, detail),
    standard: (slot, m, detail) => createServiceFurniture(slot, m, detail),
  },
  sniper: {
    furniture: "marksman",
    bore: MARKSMAN_BORE,
    muzzle: MARKSMAN_MUZZLE,
    mounts: MARKSMAN_MOUNTS,
    support: MARKSMAN_HANDGUARD[0] + SUPPORT_REACH,
    finish: familyFinish,
    body: (g, m, detail) => withDetail(detail, () => marksmanRifle(g, m)),
    standard: (slot, m, detail) =>
      withDetail(detail, () => createMarksmanFurniture(slot, m)),
  },
  plasma: {
    furniture: "plasma",
    bore: PLASMA_BORE,
    muzzle: PLASMA_MUZZLE,
    mounts: PLASMA_MOUNTS,
    support: PLASMA_HANDGUARD[1] - SUPPORT_STOP,
    finish: () => weaponFinish("plasma"),
    body: (g, m, detail) => withDetail(detail, () => plasmaRifle(g, m)),
    standard: (slot, m, detail) =>
      withDetail(detail, () => createPlasmaFurniture(slot, m)),
  },
};

/** Weapon frame (+X muzzle, +Y up, +Z right, unsized) to the hand socket:
 * mirrored back across z = 0, the basis rotation, then `WEAPON_SCALE` about
 * the shared grip. The hand socket carries a reflection (the native mount's
 * negative scale), so the socket takes the authoring frame (+Z left) as the
 * old receivers had it: the mirror here and the socket's reflection cancel,
 * and the shooter's left (support hand, laser rail) stays on the left. */
const SOCKET = new T.Matrix4()
  .makeTranslation(
    HELD_GRIP[0] * (1 - WEAPON_SCALE),
    HELD_GRIP[1] * (1 - WEAPON_SCALE),
    HELD_GRIP[2] * (1 - WEAPON_SCALE),
  )
  .multiply(WEAPON_BASIS)
  .multiply(
    new T.Matrix4().makeScale(WEAPON_SCALE, WEAPON_SCALE, -WEAPON_SCALE),
  );
const INVERSE_BASIS = WEAPON_BASIS.clone().invert();

/** A weapon-frame point (unsized, as the gun files' tables give it) in the
 * hand socket the held gun is drawn in. */
export function heldPoint(point: readonly number[]) {
  return new T.Vector3(point[0], point[1], point[2]).applyMatrix4(SOCKET);
}

/** Hand-socket muzzle: the crown centre on the bore. */
export const heldMuzzle = (gun: HeldGun) =>
  heldPoint([SPECS[gun].muzzle, SPECS[gun].bore, 0]);

/** Hand-socket mount of a fitting slot, from the gun's own mount table. */
export const heldMount = (gun: HeldGun, slot: AttachmentSlot) =>
  heldPoint(SPECS[gun].mounts[slot]);

/** Hand-socket point on the bore at the support-hand station. */
export const heldSupport = (gun: HeldGun) =>
  heldPoint([SPECS[gun].support, SPECS[gun].bore, 0]);

/** The hand socket to the holder frame `mountHandEquipment` mounts in
 * (sized authoring axes: +X muzzle, +Y up, +Z the shooter's left). */
export const HOLDER_BASIS = new T.Matrix4().makeBasis(
  new T.Vector3(0, 0, -1),
  new T.Vector3(1, 0, 0),
  new T.Vector3(0, -1, 0),
);

/** Where the support hand closes on a built gun, measured on its mesh in
 * the holder frame: `contact` is the underside of the handguard (or
 * forend) on the centre plane at the support station, `half` how far its
 * left flank stands out from the centre plane just above that underside.
 * Offline fitting and tests only. */
export function supportSeat(group: T.Object3D, gun: HeldGun) {
  const station = heldSupport(gun).applyMatrix4(HOLDER_BASIS);
  group.updateMatrixWorld(true);
  const toWorld = group.matrixWorld
    .clone()
    .multiply(HOLDER_BASIS.clone().invert());
  const toHolder = toWorld.clone().invert();
  const cast = (from: T.Vector3, direction: T.Vector3) => {
    const origin = from.clone().applyMatrix4(toWorld);
    const target = from.clone().add(direction).applyMatrix4(toWorld);
    const hit = new T.Raycaster(
      origin,
      target.sub(origin).normalize(),
    ).intersectObject(group, true)[0];
    return hit ? hit.point.clone().applyMatrix4(toHolder) : undefined;
  };
  // A few rays around the station, so slots and vents in the handguard
  // don't let one ray through to the barrel.
  const around = [-0.01, 0, 0.01];
  let bottom = Infinity,
    half = 0;
  for (const dx of around)
    for (const dz of [-0.006, 0, 0.006]) {
      const hit = cast(
        new T.Vector3(station.x + dx, station.y - 0.3, dz),
        new T.Vector3(0, 1, 0),
      );
      if (hit) bottom = Math.min(bottom, hit.y);
    }
  if (!Number.isFinite(bottom))
    throw Error(`${gun}: nothing under the support station`);
  for (const dx of around)
    for (const dy of [0.008, 0.012, 0.016, 0.02, 0.025, 0.03]) {
      const hit = cast(
        new T.Vector3(station.x + dx, bottom + dy, 0.3),
        new T.Vector3(0, 0, -1),
      );
      if (hit) half = Math.max(half, hit.z);
    }
  return {
    contact: new T.Vector3(station.x, bottom, 0),
    half,
  };
}

/** Fittings shown: slot to tier, in a stable order. */
export function heldFittings(
  attachments: WeaponAttachments = {},
): [AttachmentSlot, 1 | 2 | 3][] {
  const out: [AttachmentSlot, 1 | 2 | 3][] = [];
  for (const slot of ATTACHMENT_SLOTS) {
    const item = attachmentById(attachments[slot]);
    if (item?.slot === slot) out.push([slot, item.tier as 1 | 2 | 3]);
  }
  return out;
}

function collect(
  into: Map<T.Material, T.BufferGeometry[]>,
  material: T.Material,
  geometry: T.BufferGeometry,
) {
  const list = into.get(material) ?? [];
  // Merging needs one layout: the builders' parts are triangle soup with
  // position, normal and uv; drop anything else.
  for (const name of Object.keys(geometry.attributes))
    if (name !== "position" && name !== "normal" && name !== "uv")
      geometry.deleteAttribute(name);
  list.push(geometry.index ? geometry.toNonIndexed() : geometry);
  into.set(material, list);
}

/** Fitting roots come out in the hand-socket frame, sized about their own
 * origin at the mount: back to the weapon frame, then seated at the mount. */
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

/** A fresh, uncached build: the gun, its fittings and standard furniture,
 * one mesh per material, in the hand socket. Each call owns its geometry
 * and materials; runtime callers share builds through `acquireHeldWeapon`. */
export function createHeldWeapon(
  gun: HeldGun,
  attachments: WeaponAttachments = {},
  detail: Detail = "high",
): T.Group {
  const spec = SPECS[gun],
    m = spec.finish(),
    parts = new Map<T.Material, T.BufferGeometry[]>(),
    fits = heldFittings(attachments),
    tiers = new Map(fits);
  const g = new WeaponGeometry();
  spec.body(g, m, detail);
  // The body is drawn in the weapon frame, unsized.
  const sized = new T.Matrix4().makeScale(
    WEAPON_SCALE,
    WEAPON_SCALE,
    WEAPON_SCALE,
  );
  for (const mesh of g.finish("body").children)
    if (mesh instanceof T.Mesh) {
      (mesh.geometry as T.BufferGeometry).applyMatrix4(sized);
      collect(parts, mesh.material as T.Material, mesh.geometry);
    }
  for (const slot of ["clip", "stock"] as const) {
    const tier = tiers.get(slot);
    let root: T.Group | undefined;
    if (tier)
      try {
        root = createFurnitureUpgrade(slot, spec.furniture, tier, detail, m);
      } catch {
        // A tier without a model yet (tube stock 1) keeps the standard piece.
      }
    seat(root ?? spec.standard(slot, m, detail), spec.mounts[slot], parts);
  }
  for (const slot of ["scope", "laser"] as const) {
    const tier = tiers.get(slot);
    if (tier)
      seat(createRailUpgrade(slot, tier, detail, m), spec.mounts[slot], parts);
  }
  // Weapon frame (sized about its origin) to the hand socket.
  const toSocket = SOCKET.clone().multiply(sized.clone().invert());
  const group = new T.Group();
  group.name = `held-${gun}`;
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries)!;
    geometries.forEach((x) => x !== geometry && x.dispose());
    geometry.applyMatrix4(toSocket);
    rewind(geometry);
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.userData.weaponPart = true;
    group.add(mesh);
  }
  // Mount markers keep the interface the sockets always had; the fittings
  // themselves are merged into the gun's meshes.
  for (const slot of ATTACHMENT_SLOTS) {
    const socket = new T.Object3D();
    socket.name = `mount_${slot}`;
    socket.position.copy(heldMount(gun, slot));
    socket.userData.interface = `ghosts:${slot}:v1`;
    const tier = tiers.get(slot);
    if (tier) socket.userData.tier = tier;
    group.add(socket);
  }
  group.userData.model = gun;
  group.userData.detail = detail;
  group.userData.fittings = fits.map(([s, t]) => `${s}${t}`).join(",");
  group.userData.muzzle = heldMuzzle(gun).toArray();
  return group;
}

/** Reverses every triangle of a non-indexed geometry, after a mirror. */
function rewind(geometry: T.BufferGeometry) {
  for (const attr of Object.values(geometry.attributes)) {
    const a = attr as T.BufferAttribute,
      n = a.itemSize;
    for (let t = 0; t + 2 < a.count; t += 3)
      for (let k = 0; k < n; k++) {
        const i = (t + 1) * n + k,
          j = (t + 2) * n + k;
        [a.array[i], a.array[j]] = [a.array[j], a.array[i]];
      }
  }
}

/** Triangles in a held build. */
export function heldTriangles(group: T.Object3D) {
  let n = 0;
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      const g = o.geometry as T.BufferGeometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return n;
}

interface Entry {
  group: T.Group;
  refs: number;
}
const cache = new Map<string, Entry>();
/** Idle builds kept for quick returns (browsing fittings, roster changes). */
const KEEP = 6;

function disposeBuild(group: T.Group) {
  const materials = new Set<T.Material>();
  group.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    o.geometry.dispose();
    materials.add(o.material as T.Material);
  });
  for (const m of materials) {
    for (const v of Object.values(m)) if (v instanceof T.Texture) v.dispose();
    m.dispose();
  }
}

function trim() {
  const idle = [...cache].filter(([, e]) => e.refs === 0);
  while (idle.length > KEEP) {
    const [key, entry] = idle.shift()!;
    cache.delete(key);
    disposeBuild(entry.group);
  }
}

export interface HeldWeapon {
  /** A clone sharing geometry and materials with the cached build. */
  model: T.Group;
  /** Call once when the holder lets go of the model. */
  release(): void;
}

/** The held gun with its fittings, built once per (gun, fittings, detail)
 * and shared by reference count. Meshes are marked `userData.sharedWeapon`:
 * holders must not dispose their geometry or materials. */
export function acquireHeldWeapon(
  gun: HeldGun,
  attachments: WeaponAttachments = {},
  detail: Detail = "high",
): HeldWeapon {
  const key = `${gun}:${detail}:${heldFittings(attachments)
    .map(([s, t]) => `${s}${t}`)
    .join(",")}`;
  let entry = cache.get(key);
  if (!entry) {
    const group = createHeldWeapon(gun, attachments, detail);
    group.traverse((o) => {
      if (o instanceof T.Mesh) o.userData.sharedWeapon = true;
    });
    entry = { group, refs: 0 };
    cache.set(key, entry);
  } else {
    cache.delete(key);
    cache.set(key, entry);
  }
  entry.refs++;
  const held = entry;
  let released = false;
  const model = held.group.clone();
  model.userData = { ...held.group.userData };
  return {
    model,
    release() {
      if (released) return;
      released = true;
      held.refs--;
      trim();
    },
  };
}
