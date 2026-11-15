// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A level's painted floor tiles as meshes, for the editor's viewport and for
 * the playtest's scenery alike: one merged mesh per floor kind (raised slabs as
 * boxes), world-space UVs so grain and weave keep their real scale, and the
 * crosswalks' zebra strips. Materials come from the caller, which caches and
 * disposes them (`floorMaterial` makes one).
 */
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { floorByUid, type FloorSpec } from "../catalog.ts";
import { districtMaps, pavementMaterial } from "../district.ts";
import { CELL, type Cell } from "../map.ts";
import { FLOOR_UV_SCALE, floorSurfaceMaterial, officeFloorTexture } from "../office/flooring.ts";
import type { Level } from "./level.ts";

// The office surfaces at their shared scale; the street materials use the
// district's metric UVs, one repeat per 2m.
const UV_SCALE = { ...FLOOR_UV_SCALE, asphalt: [2, 2], concrete: [2, 2], slabs: [2, 2] } as const;

/** The texture a floor tile samples, or undefined for a flat tint. */
const surfaceOf = (spec: FloorSpec) => spec.texture ?? spec.street ?? (spec.slabs ? "slabs" : undefined);

export type FloorTextures = Map<string, ReturnType<typeof officeFloorTexture>>;

/**
 * A fresh material for a floor kind. Office surfaces share their generated
 * maps through `textures`; street floors take the district's KTX2 set, flat
 * tinted until `loadDistrictTextures` resolves.
 */
export function floorMaterial(spec: FloorSpec, textures: FloorTextures): T.MeshStandardMaterial {
  if (spec.slabs) return pavementMaterial();
  if (spec.street)
    return new T.MeshStandardMaterial({
      color: spec.tone,
      roughness: spec.rough ?? 1,
      metalness: 0,
      normalScale: new T.Vector2(0.45, 0.45),
      ...districtMaps(spec.street),
    });
  if (spec.texture) {
    let maps = textures.get(spec.texture);
    if (!maps) {
      maps = officeFloorTexture(spec.texture);
      textures.set(spec.texture, maps);
    }
    return floorSurfaceMaterial(spec.texture, maps, spec.tone);
  }
  return new T.MeshStandardMaterial({ color: spec.tone, roughness: spec.rough ?? 0.92, metalness: spec.metal ?? 0.04 });
}

/**
 * The level's floor tiles as meshes, `origin` cells off the level's own grid
 * (the playtest centres the grid on the scene). The caller owns the merged
 * geometries.
 */
export function floorMeshes(
  level: Level,
  material: (spec: FloorSpec) => T.Material,
  paint: T.Material,
  origin: Cell = [0, 0],
): T.Mesh[] {
  const meshes: T.Mesh[] = [];
  const cells = new Map<string, Cell[]>();
  for (const tile of level.floors) {
    const list = cells.get(tile.floor) ?? [];
    list.push(tile.at);
    cells.set(tile.floor, list);
  }
  for (const [uid, at] of cells) {
    const spec = floorByUid(uid);
    if (!spec) continue;
    const surface = surfaceOf(spec);
    const strips: T.BufferGeometry[] = [];
    const parts = at.map(([cx, cz]) => {
      const x = cx + origin[0], z = cz + origin[1];
      const geometry = spec.raise
        ? new T.BoxGeometry(CELL, spec.raise, CELL)
        : new T.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
      geometry.translate(x * CELL, spec.raise ? spec.raise / 2 : 0.006, z * CELL);
      if (surface) {
        // World-space UVs keep grain and weave at real scale across tiles;
        // on a raised box the sides map by their world axes, like the street.
        const [sx, sz] = UV_SCALE[surface];
        const position = geometry.getAttribute("position");
        const normal = geometry.getAttribute("normal");
        const uv = geometry.getAttribute("uv");
        for (let i = 0; i < position.count; i++) {
          const side = Math.abs(normal.getY(i)) < 0.5;
          const u = Math.abs(normal.getX(i)) > 0.5 ? position.getZ(i) : position.getX(i);
          uv.setXY(i, u / sx, (side ? position.getY(i) : position.getZ(i)) / sz);
        }
      }
      // Zebra paint: two strips per cell, aligned across neighbours.
      if (spec.stripes)
        for (const offset of [-CELL / 4, CELL / 4]) {
          const along = spec.stripes === "x";
          const strip = new T.BoxGeometry(along ? 0.34 : CELL - 0.13, 0.012, along ? CELL - 0.13 : 0.34);
          strip.translate(x * CELL + (along ? offset : 0), 0.013, z * CELL + (along ? 0 : offset));
          strips.push(strip);
        }
      return geometry;
    });
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    const mesh = new T.Mesh(merged, material(spec));
    mesh.receiveShadow = true;
    mesh.castShadow = !!spec.raise;
    meshes.push(mesh);
    const painted = strips.length ? mergeGeometries(strips) : null;
    for (const strip of strips) strip.dispose();
    if (painted) {
      const mesh = new T.Mesh(painted, paint);
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
  }
  return meshes;
}
