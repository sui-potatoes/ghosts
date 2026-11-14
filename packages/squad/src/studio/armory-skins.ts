// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { assetUrl } from "./character-assets.ts";
import { createGLTFLoader } from "./gltf-loader.ts";
import type { ArmoryGun } from "./armory-weapons.ts";

/**
 * Skinned guns, for the Armory stage and for recruits holding a skinned gun
 * (`held-skins.ts`): one loader, so both share the mesh and each skin's maps.
 * A skin is a baked texture set over the
 * gun's game mesh (low detail, one UV atlas, normal map and AO baked from the
 * authored model): `weapons/skins/<gun>.glb` holds the body and the standard
 * clip and stock as separate meshes in the Armory weapon frame, sharing one
 * material with the normal and AO maps; each skin adds a colour map and a
 * roughness/metalness map (`<gun>-<skin>-{base,rm}.webp`). Nothing is fetched
 * until a skin is first shown. Fittings stay procedural: an upgraded clip or
 * stock replaces the skinned standard piece and keeps its own finish.
 *
 * The shared mesh and its two maps are kept for the session once loaded; a
 * skin's own maps and material are reference counted by the stage models
 * built with it, and up to `KEEP` idle skins are kept for quick switching.
 */

const VERSION = 1;
/** Guns that have skins: the shared mesh per gun. */
const SKINNABLE: Partial<Record<ArmoryGun, true>> = { rifle: true };

export interface SkinPieces {
  body: T.BufferGeometry;
  clip: T.BufferGeometry;
  stock: T.BufferGeometry;
}

export interface ArmorySkin {
  /** `<gun>:<skin>`. */
  key: string;
  /** Shared, never modify: clone before merging or transforming. */
  pieces: SkinPieces;
  /** Shared by every model built with this skin; never dispose it directly. */
  material: T.MeshStandardMaterial;
  /** A model built with the skin holds it until it is disposed. */
  retain(): void;
  release(): void;
}

export const hasSkins = (gun: ArmoryGun) => !!SKINNABLE[gun];

const loader = createGLTFLoader();
// Bitmaps decode off the main thread; a plain image decodes on its first draw.
const bitmaps =
  typeof createImageBitmap === "function"
    ? new T.ImageBitmapLoader().setOptions({ premultiplyAlpha: "none" })
    : null;
const images = new T.TextureLoader();

interface Shared {
  pieces: SkinPieces;
  material: T.MeshStandardMaterial;
}
const meshes = new Map<ArmoryGun, Promise<Shared>>();

function shared(gun: ArmoryGun): Promise<Shared> {
  let p = meshes.get(gun);
  if (!p) {
    p = loader
      .loadAsync(assetUrl(`weapons/skins/${gun}.glb?v=${VERSION}`))
      .then((gltf) => {
        const found: Partial<SkinPieces> = {};
        let material: T.MeshStandardMaterial | undefined;
        gltf.scene.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const name = o.name as keyof SkinPieces;
          if (name === "body" || name === "clip" || name === "stock")
            found[name] = o.geometry as T.BufferGeometry;
          material = o.material as T.MeshStandardMaterial;
        });
        if (!found.body || !found.clip || !found.stock || !material)
          throw new Error("Weapon finish unavailable.");
        return { pieces: found as SkinPieces, material };
      });
    meshes.set(gun, p);
    // a failed load is forgotten so the next request retries
    p.catch(() => meshes.delete(gun));
  }
  return p;
}

function texture(path: string, color: boolean): Promise<T.Texture> {
  const url = assetUrl(path);
  return (
    bitmaps
      ? bitmaps.loadAsync(url).then((b) => new T.Texture(b))
      : images.loadAsync(url)
  ).then((t) => {
    // glTF UV convention, like the textures inside the GLB
    t.flipY = false;
    t.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

interface Entry {
  promise: Promise<ArmorySkin>;
  refs: number;
  dispose?(): void;
}
const skins = new Map<string, Entry>();
/** Idle skins kept for quick returns while browsing finishes. */
const KEEP = 2;

function trim() {
  const idle = [...skins].filter(([, e]) => e.refs === 0 && e.dispose);
  while (idle.length > KEEP) {
    const [key, entry] = idle.shift()!;
    skins.delete(key);
    entry.dispose!();
  }
}

/**
 * Loads (once) a gun's skin: the shared mesh and the skin's two maps. Use the
 * result with `acquireArmoryWeapon`, which retains it for the model's life.
 */
export function loadArmorySkin(
  gun: ArmoryGun,
  skin: string,
): Promise<ArmorySkin> {
  if (!hasSkins(gun))
    return Promise.reject(new Error("This weapon has no finishes yet."));
  const key = `${gun}:${skin}`;
  const known = skins.get(key);
  if (known) {
    // least recently used last
    skins.delete(key);
    skins.set(key, known);
    return known.promise;
  }
  const entry: Entry = { refs: 0, promise: undefined! };
  entry.promise = Promise.all([
    shared(gun),
    texture(`weapons/skins/${gun}-${skin}-base.webp?v=${VERSION}`, true),
    texture(`weapons/skins/${gun}-${skin}-rm.webp?v=${VERSION}`, false),
  ]).then(([{ pieces, material: base }, map, rm]) => {
    const material = base.clone();
    material.name = `skin-${skin}`;
    material.color.set(0xffffff);
    material.map = map;
    material.roughnessMap = rm;
    material.metalnessMap = rm;
    material.roughness = 1;
    material.metalness = 1;
    material.userData.armorySkin = key;
    entry.dispose = () => {
      map.dispose();
      rm.dispose();
      material.dispose();
    };
    return {
      key,
      pieces,
      material,
      retain() {
        entry.refs++;
      },
      release() {
        entry.refs = Math.max(0, entry.refs - 1);
        trim();
      },
    };
  });
  skins.set(key, entry);
  entry.promise.catch(() => {
    if (skins.get(key) === entry) skins.delete(key);
  });
  return entry.promise;
}
