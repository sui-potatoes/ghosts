// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/** Zones meet exactly at their edges. World-space UVs keep grain / weave at
 * real scale, independent of room size. The movement grid remains unchanged. */
export const officeFloorZones = [
  { finish: "vinyl", minX: -10.125, maxX: 10.125, minZ: -8.775, maxZ: -5.4 },
  { finish: "oak", minX: -10.125, maxX: -7.425, minZ: -5.4, maxZ: 5.4 },
  { finish: "carpet-sage", minX: -7.425, maxX: -1.35, minZ: -5.4, maxZ: 5.4 },
  { finish: "carpet-charcoal", minX: -1.35, maxX: 1.35, minZ: -5.4, maxZ: 5.4 },
  { finish: "carpet-slate", minX: 1.35, maxX: 8.1, minZ: -5.4, maxZ: 5.4 },
  { finish: "vinyl", minX: 8.1, maxX: 10.125, minZ: -5.4, maxZ: 5.4 },
  { finish: "oak", minX: -10.125, maxX: 10.125, minZ: 5.4, maxZ: 8.775 },
] as const;

export type Surface = "carpet" | "oak" | "vinyl" | "rubber";

/** World metres one texture repeat covers, per surface. */
export const FLOOR_UV_SCALE: Record<Surface, readonly [number, number]> = {
  oak: [1.08, 3.24], vinyl: [2, 2], carpet: [2, 2], rubber: [0.6, 0.6],
};

/** The standard material over a generated floor surface: tint over albedo, the
 * packed detail map as bump and roughness. The office zones and the editor's
 * painted tiles share it, so a finish reads the same in both. */
export function floorSurfaceMaterial(
  kind: Surface, maps: ReturnType<typeof officeFloorTexture>, tint = 0xffffff,
) {
  return new T.MeshStandardMaterial({ color: tint, map: maps.map,
    bumpMap: maps.detail, bumpScale: kind === "carpet" ? 0.006 : kind === "rubber" ? 0.009 : 0.002,
    roughnessMap: maps.detail, roughness: 1, metalness: 0 });
}

/** Small repeatable albedo + packed height/roughness maps. Generated once on
 * scene creation, mipmapped on upload; no texture downloads or shader patches. */
export function officeFloorTexture(kind: Surface) {
  const size = kind === "carpet" || kind === "rubber" ? 256 : 512;
  const color = new Uint8Array(size * size * 4), detail = new Uint8Array(size * size * 4);
  const noise = (x: number, y: number) => {
    let n = Math.imul(x + 17, 374761393) ^ Math.imul(y + 79, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = noise(x, y), i = (y * size + x) * 4;
    let r = 0, g = 0, b = 0, height = 128, roughness = 245;
    if (kind === "carpet") {
      // Four 50cm tiles per repeat, quarter-turned pile and nearly invisible seams.
      const tile = size / 4, tx = Math.floor(x / tile), ty = Math.floor(y / tile);
      const pile = (tx + ty) % 2 ? x : y;
      const seam = x % tile === 0 || y % tile === 0;
      const yarn = pile % 8 < 2 ? -7 : 2;
      const tileTone = noise(tx, ty) * 12 - 6;
      // Clusters survive minification better than isolated one-pixel noise.
      const fibers = (noise(Math.floor(x / 3), Math.floor(y / 3)) - 0.5) * 27;
      const speckle = (n - 0.5) * 12 + fibers;
      const tone = 139 + yarn + tileTone + speckle - (seam ? 12 : 0);
      r = tone; g = tone + 3; b = tone + 1;
      height = seam ? 95 : 126 + yarn * 2 + (n - 0.5) * 34;
      roughness = 244 + n * 11;
    } else if (kind === "oak") {
      // Six 18cm planks across a 1.08 × 3.24m repeat. Staggered end joints.
      const plankWidth = size / 6, plank = Math.floor(x / plankWidth);
      const offset = Math.floor(noise(plank, 9) * 140);
      const joint = x % plankWidth < 1.2 || (y + offset) % (size / 3) < 1;
      const phase = (x % plankWidth) * 0.8 + Math.sin(y * Math.PI * 2 / size) * 2.5;
      const grain = Math.sin(phase) * 3.5 + Math.sin(phase * 3.1 + Math.sin(y * 0.04)) * 1.6;
      const tone = grain + (n - 0.5) * 6 + (noise(plank, 2) - 0.5) * 19 - (joint ? 35 : 0);
      r = 177 + tone; g = 146 + tone * 0.85; b = 105 + tone * 0.65;
      height = joint ? 85 : 128 + grain;
      roughness = 170 + n * 18 + (joint ? 35 : 0);
    } else if (kind === "vinyl") {
      // Quiet commercial sheet vinyl with small mineral flecks, not a tile checkerboard.
      const fleck = n > 0.975 ? 18 : n < 0.025 ? -16 : (n - 0.5) * 5;
      const mottling = Math.sin(x * Math.PI * 4 / size) * Math.sin(y * Math.PI * 6 / size) * 2;
      r = 156 + fleck + mottling; g = 165 + fleck + mottling; b = 160 + fleck + mottling;
      height = 128 + fleck * 0.2; roughness = 197 + n * 15;
    } else {
      const rib = x % 12 < 3;
      r = (rib ? 43 : 65) + n * 6; g = r + 5; b = r + 6;
      height = rib ? 90 : 156; roughness = 240 + n * 15;
    }
    color.set([Math.round(r), Math.round(g), Math.round(b), 255], i);
    detail.set([Math.round(height), Math.round(roughness), 0, 255], i);
  }
  const texture = (pixels: Uint8Array, srgb: boolean) => {
    const t = new T.DataTexture(pixels, size, size, T.RGBAFormat);
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  return { map: texture(color, true), detail: texture(detail, false) };
}

export function buildOfficeFloor(): T.Group {
  const group = new T.Group(); group.name = "Office floor finishes";
  const maps = new Map<Surface, ReturnType<typeof officeFloorTexture>>();
  const material = (kind: Surface, tint = 0xffffff) => {
    let textures = maps.get(kind);
    if (!textures) { textures = officeFloorTexture(kind); maps.set(kind, textures); }
    return floorSurfaceMaterial(kind, textures, tint);
  };
  const finishes = {
    "carpet-sage": material("carpet", 0xd3d6c7),
    "carpet-slate": material("carpet", 0xbdcbd5),
    "carpet-charcoal": material("carpet", 0x85959b),
    oak: material("oak"), vinyl: material("vinyl"), rubber: material("rubber"),
  };
  const patch = (minX: number, maxX: number, minZ: number, maxZ: number,
    finish: keyof typeof finishes, y = 0.001) => {
    const geometry = new T.PlaneGeometry(maxX - minX, maxZ - minZ);
    geometry.rotateX(-Math.PI / 2); geometry.translate((minX + maxX) / 2, y, (minZ + maxZ) / 2);
    const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    const scale = FLOOR_UV_SCALE[finish.startsWith("carpet") ? "carpet" : (finish as Surface)];
    for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / scale[0], position.getZ(i) / scale[1]);
    const mesh = new T.Mesh(geometry, finishes[finish]); mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const zone of officeFloorZones) patch(zone.minX, zone.maxX, zone.minZ, zone.maxZ, zone.finish);
  // An inset entrance mat. The tiny visual offset avoids z-fighting, without a movement step.
  patch(-1.25, 1.25, 7.1, 8.65, "rubber", 0.003);
  const trim = new T.MeshStandardMaterial({ color: 0x66716e, metalness: 0.65, roughness: 0.55 });
  const strip = (x: number, z: number, w: number, d: number) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, 0.004, d), trim);
    mesh.position.set(x, 0.002, z); mesh.receiveShadow = true; group.add(mesh);
  };
  strip(0, -5.4, 20.25, 0.025); strip(0, 5.4, 20.25, 0.025);
  strip(-7.425, 0, 0.025, 10.8); strip(8.1, 0, 0.025, 10.8);
  for (const x of [-1.262, 1.262]) strip(x, 7.875, 0.024, 1.6);
  for (const z of [7.088, 8.662]) strip(0, z, 2.55, 0.024);
  return group;
}
