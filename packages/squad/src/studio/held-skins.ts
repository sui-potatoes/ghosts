// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { buildArmoryWeapon } from "./armory-weapons.ts";
import {
  heldFittings,
  heldMount,
  heldMuzzle,
  heldPoint,
  type HeldGun,
  type HeldWeapon,
} from "./held-weapons.ts";
import { WEAPON_SCALE } from "./weapon-finish.ts";
import { ATTACHMENT_SLOTS } from "../catalog.ts";
import type { WeaponAttachments } from "../types.ts";
import type { ArmorySkin } from "./armory-skins.ts";

/**
 * A held gun wearing a skin: the skinned game mesh (body, and the standard
 * clip and stock where nothing upgraded is fitted) with the procedural
 * fittings beside it in the skin's live paint, exactly as the Armory builds it (`buildArmoryWeapon`),
 * then taken from the weapon frame into the hand socket by the same transform
 * `held-weapons.ts` uses for the procedural gun: mirrored across z = 0, the
 * basis rotation, `WEAPON_SCALE` about `HELD_GRIP`. The hands, mounts and
 * muzzle therefore stay where the baked equipment poses expect them.
 *
 * Kept apart from `held-weapons.ts` on purpose: that file is one of the
 * sources the equipment-pose calibration hashes, and nothing here changes
 * the gun's geometry. The socket transform is recovered from `heldPoint`
 * (an affine map) rather than restated.
 *
 * Builds are shared per (gun, fittings, skin) by reference count; each build
 * holds its skin (`retain`/`release`) so the skin's maps stay until the last
 * gun wearing them is gone. Fittings are always the authored detail (the
 * Armory's); skins are a Headquarters feature, field units never get one.
 */

/** The weapon frame (+X muzzle, +Y up, +Z right, unsized) to the hand socket. */
const SOCKET = (() => {
  const o = heldPoint([0, 0, 0]);
  return new T.Matrix4()
    .makeBasis(
      heldPoint([1, 0, 0]).sub(o),
      heldPoint([0, 1, 0]).sub(o),
      heldPoint([0, 0, 1]).sub(o),
    )
    .setPosition(o);
})();
/** The Armory's frame (the weapon frame sized about its origin) to the hand
 * socket: what a skin's pieces go through. */
export const ARMORY_TO_SOCKET = SOCKET.clone().multiply(
  new T.Matrix4().makeScale(
    1 / WEAPON_SCALE,
    1 / WEAPON_SCALE,
    1 / WEAPON_SCALE,
  ),
);

/** The live paint on fittings reads the weapon frame back from the socket. */
const HELD_FRAME = { key: "held", toWeapon: ARMORY_TO_SOCKET.clone().invert() };

/** Reverses every triangle after the mirror, indexed or not. */
function rewind(geometry: T.BufferGeometry) {
  const index = geometry.index;
  if (index) {
    const a = index.array;
    for (let t = 0; t + 2 < a.length; t += 3)
      [a[t + 1], a[t + 2]] = [a[t + 2], a[t + 1]];
    index.needsUpdate = true;
    return;
  }
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

/** A fresh, uncached skinned build in the hand socket; the caller owns its
 * geometry and fitting materials (the skin's material stays the skin's). */
export function createSkinnedHeldWeapon(
  gun: HeldGun,
  attachments: WeaponAttachments,
  skin: ArmorySkin,
): T.Group {
  const group = buildArmoryWeapon(gun, attachments, skin, HELD_FRAME);
  group.name = `held-${gun}`;
  for (const mesh of group.children) {
    if (!(mesh instanceof T.Mesh)) continue;
    const geometry = mesh.geometry as T.BufferGeometry;
    // Tangents move with the geometry and keep their sign: this mirror and
    // the hand socket's reflection cancel, as they do for positions, so the
    // normal map's bitangent comes out right in the world.
    geometry.applyMatrix4(ARMORY_TO_SOCKET);
    rewind(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.userData.weaponPart = true;
  }
  const fits = heldFittings(attachments),
    tiers = new Map(fits);
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
  group.userData.detail = "high";
  group.userData.fittings = fits.map(([s, t]) => `${s}${t}`).join(",");
  group.userData.skin = skin.key;
  group.userData.muzzle = heldMuzzle(gun).toArray();
  return group;
}

interface Entry {
  group: T.Group;
  refs: number;
  skin: ArmorySkin;
}
const cache = new Map<string, Entry>();
/** Idle builds kept for quick returns (roster changes, finish browsing). */
const KEEP = 3;

function disposeBuild(group: T.Group) {
  const materials = new Set<T.Material>();
  group.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    o.geometry.dispose();
    materials.add(o.material as T.Material);
  });
  for (const m of materials) {
    // The skin's material and maps belong to the skin loader.
    if (m.userData.armorySkin) continue;
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
    entry.skin.release();
  }
}

/** Cache key of a skinned held build. */
export const skinnedHeldKey = (
  gun: HeldGun,
  attachments: WeaponAttachments,
  skin: ArmorySkin,
) =>
  `${gun}:${heldFittings(attachments)
    .map(([s, t]) => `${s}${t}`)
    .join(",")}:${skin.key}`;

/** The held gun wearing `skin` (from `loadArmorySkin`), built once per
 * (gun, fittings, skin) and shared like `acquireHeldWeapon`'s builds. */
export function acquireSkinnedHeldWeapon(
  gun: HeldGun,
  attachments: WeaponAttachments,
  skin: ArmorySkin,
): HeldWeapon {
  const key = skinnedHeldKey(gun, attachments, skin);
  let entry = cache.get(key);
  if (!entry) {
    const group = createSkinnedHeldWeapon(gun, attachments, skin);
    group.traverse((o) => {
      if (o instanceof T.Mesh) o.userData.sharedWeapon = true;
    });
    skin.retain();
    entry = { group, refs: 0, skin };
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

/** Skinned builds in the cache, for tests: key and live references. */
export const skinnedHeldCache = () =>
  [...cache].map(([key, e]) => ({ key, refs: e.refs }));
