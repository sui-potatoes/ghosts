// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * How an editor level looks under playtest, in the game's own renderer (the
 * battlefield with its post pipeline, fog, weather and destruction): the
 * level's painted floors, unwalkable pits, point lights and lighting dials,
 * the indestructible stand-ins as static scenery (everything else is a prop
 * the battlefield draws and breaks), on a neutral stage: an asphalt apron
 * outdoors, a dark slab indoors, the grid's edge painted on the ground. No
 * district is built around it: no buildings, street furniture or lamp posts.
 */
import * as T from "three";
import { districtMaps, loadDistrictTextures } from "../district.ts";
import { CELL } from "../map.ts";
import type { Scenario } from "../scenario.ts";
import { registerMapView, type MapView } from "../scene/maps.ts";
import { floorMaterial, floorMeshes, type FloorTextures } from "./floors.ts";
import { floorRaise, interiorPreset, type Level } from "./level.ts";
import { levelOrigin, levelProps, scenarioFromLevel } from "./playtest.ts";

/** A flat plane on the ground with metric UVs (one texture repeat per 2m). */
function ground(width: number, depth: number, material: T.Material, x: number, y: number, z: number) {
  const geometry = new T.PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
  geometry.translate(x, y, z);
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / 2, position.getZ(i) / 2);
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The scenery of `level` for the battlefield. */
export function levelView(level: Level): MapView {
  const [minX, minZ] = levelOrigin(level);
  const interior = level.lighting.time === "interior";
  const time = level.lighting.time === "interior" ? "night" : level.lighting.time;
  const width = level.width * CELL, depth = level.depth * CELL;
  // The grid's centre in metres: cells sit on their centres, the rectangle reaches half a cell past them.
  const cx = (minX + (level.width - 1) / 2) * CELL, cz = (minZ + (level.depth - 1) / 2) * CELL;
  const lighting = level.lighting;
  return {
    // No barrier meshes for cover cells: the level's own props are its cover.
    furnishedCover: true,
    defaults: { time, weather: interior || time !== "night" ? "clear" : "rain" },
    extent: Math.hypot(width / 2 + Math.abs(cx), depth / 2 + Math.abs(cz)),
    ...(interior
      ? {
          // The editor's indoor rig with the level's dials: no sun unless dialled in, a neutral fill.
          interiorLighting: (scene, key, ambient, rim) => {
            scene.background = new T.Color(lighting.sky ?? interiorPreset.sky);
            const density = lighting.density ?? interiorPreset.density;
            scene.fog = density > 0 ? new T.FogExp2(lighting.fog ?? interiorPreset.fog, density) : null;
            key.color.setHex(lighting.sun ?? interiorPreset.sun);
            key.intensity = lighting.strength ?? interiorPreset.strength;
            key.castShadow = key.intensity > 0;
            ambient.color.setHex(0xd1e1df);
            ambient.groundColor.setHex(0x45443a);
            ambient.intensity = lighting.ambient ?? interiorPreset.ambient;
            rim.color.setHex(0xadc7db);
            rim.position.set(16, 5, -4);
            rim.intensity = 0.2;
            rim.castShadow = false;
            return lighting.exposure ?? interiorPreset.exposure;
          },
        }
      : {
          // The level's dials over its own time of day; another time the player picks plays plain.
          tune: (scene, sun, ambient, _rim, now) => {
            if (now !== lighting.time) return;
            if (lighting.sky !== undefined) (scene.background as T.Color).setHex(lighting.sky);
            const fog = scene.fog as T.FogExp2 | null;
            if (fog && lighting.fog !== undefined) fog.color.setHex(lighting.fog);
            if (fog && lighting.density !== undefined) fog.density = lighting.density;
            if (lighting.sun !== undefined) sun.color.setHex(lighting.sun);
            if (lighting.strength !== undefined) sun.intensity = lighting.strength;
            if (lighting.ambient !== undefined) ambient.intensity = lighting.ambient;
            return lighting.exposure;
          },
        }),
    // The street's PBR set: the apron, the slab and any street floor tile.
    load: loadDistrictTextures,
    build(scene, kit) {
      // The stage: an apron to the horizon and the level's slab, its edge painted.
      if (interior) {
        scene.add(ground(160, 160, new T.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.97 }), cx, -0.13, cz));
        const slab = new T.Mesh(
          new T.BoxGeometry(width, 0.22, depth),
          new T.MeshStandardMaterial({ color: 0x303d45, roughness: 0.9 }),
        );
        slab.position.set(cx, -0.11, cz);
        slab.receiveShadow = true;
        scene.add(slab);
      } else {
        const asphalt = new T.MeshStandardMaterial({
          color: 0x5f6772, roughness: 0.78, normalScale: new T.Vector2(0.45, 0.45), ...districtMaps("asphalt"),
        });
        const concrete = new T.MeshStandardMaterial({
          color: 0x9c9fa3, roughness: 0.9, normalScale: new T.Vector2(0.45, 0.45), ...districtMaps("concrete"),
        });
        scene.add(ground(160, 160, asphalt, cx, -0.01, cz), ground(width, depth, concrete, cx, 0.001, cz));
      }
      const edge = new T.MeshStandardMaterial({ color: 0xb8b5a2, roughness: 0.85 });
      for (const [w, d, x, z] of [
        [width, 0.06, cx, cz - depth / 2], [width, 0.06, cx, cz + depth / 2],
        [0.06, depth, cx - width / 2, cz], [0.06, depth, cx + width / 2, cz],
      ]) {
        const line = new T.Mesh(new T.BoxGeometry(w, 0.012, d), edge);
        line.position.set(x, 0.008, z);
        line.receiveShadow = true;
        scene.add(line);
      }

      // Painted floors, as the editor paints them.
      const materials = new Map<string, T.MeshStandardMaterial>();
      const textures: FloorTextures = new Map();
      const paint = new T.MeshStandardMaterial({ color: 0xb8b5a2, roughness: 0.85 });
      for (const mesh of floorMeshes(level, (spec) => {
        let material = materials.get(spec.uid);
        if (!material) materials.set(spec.uid, (material = floorMaterial(spec, textures)));
        return material;
      }, paint, [minX, minZ]))
        scene.add(mesh);

      // Unwalkable tiles read as dark pits.
      const pit = new T.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.88 });
      for (const [x, z] of level.unwalkable) {
        const plane = new T.Mesh(new T.PlaneGeometry(CELL * 0.96, CELL * 0.96).rotateX(-Math.PI / 2), pit);
        plane.position.set((x + minX) * CELL, 0.014 + floorRaise(level, [x, z]), (z + minZ) * CELL);
        scene.add(plane);
      }

      // Indestructible stand-ins: the same meshes, as fixed scenery.
      for (const prop of levelProps(level).fixed) {
        const asset = kit.props.get(prop);
        const root = new T.Group();
        root.add(asset.intact.clone(), asset.frame.clone());
        const cell: [number, number] = [Math.round(prop.x / CELL) - minX, Math.round(prop.z / CELL) - minZ];
        root.position.set(prop.x, floorRaise(level, cell) + (prop.y ?? 0), prop.z);
        root.rotation.y = prop.yaw;
        if (prop.span) root.scale.x = prop.span;
        scene.add(root);
      }

      // The level's point lights, always on, each with its bulb.
      for (const light of level.lights) {
        const [x, z] = light.at;
        const y = light.height + floorRaise(level, light.at);
        const lamp = new T.PointLight(light.color, light.intensity, 0, 2);
        lamp.position.set((x + minX) * CELL, y, (z + minZ) * CELL);
        const bulb = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), new T.MeshBasicMaterial({ color: light.color }));
        bulb.position.copy(lamp.position);
        scene.add(lamp, bulb);
      }
      return [];
    },
  };
}

/**
 * The encounter `level` plays as (`scenarioFromLevel`), with its scenery
 * registered for the battlefield. Throws when the level cannot be played.
 */
export function playtestScenario(level: Level): Scenario {
  const scenario = scenarioFromLevel(level);
  registerMapView(scenario.map.id, levelView(level));
  return scenario;
}
