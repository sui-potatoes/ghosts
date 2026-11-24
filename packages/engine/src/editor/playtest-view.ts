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
import type { Occluder } from "../scene/occlusion.ts";
import { floorMaterial, floorMeshes, type FloorTextures } from "./floors.ts";
import { floorRaise, interiorPreset, turnOffset, type Level } from "./level.ts";
import { levelOrigin, levelProps, scenarioFromLevel } from "./playtest.ts";
import { buildingBlocks } from "./buildings.ts";
import { massDims, roofDims } from "../shop/catalog.ts";
import { buildSurroundings, surroundingBuildings } from "../shop/surroundings.ts";

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
    level,
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

      // Indestructible stand-ins: the same meshes, as fixed scenery. A cell of a building
      // mass fades like the district's buildings when it stands between the camera and a
      // unit: a cutaway of the cells in the way, not the block.
      // Beyond the grid: the streets and buildings the level declares per side, into the fog.
      // Where the level’s roadway reaches an edge, the street beyond opens into a junction.
      const paved = new Set(level.floors.map((f) => f.at.join()));
      const road = (c: [number, number]) => paved.has(c.join()) && floorRaise(level, c) === 0;
      const mouths = (cells: [number, number][], axis: 0 | 1, origin: number) => {
        const runs: [number, number][] = [];
        for (const c of cells) {
          if (!road(c)) continue;
          const a = (c[axis] + origin - 0.5) * CELL, last = runs[runs.length - 1];
          if (last && Math.abs(last[1] - a) < 1e-6) last[1] = a + CELL; else runs.push([a, a + CELL]);
        }
        return runs;
      };
      const xs = Array.from({ length: level.width }, (_, x) => x), zs = Array.from({ length: level.depth }, (_, z) => z);
      const beyond = !level.surroundings ? null : buildSurroundings({
        minX: (minX - 0.5) * CELL, maxX: (minX + level.width - 0.5) * CELL,
        minZ: (minZ - 0.5) * CELL, maxZ: (minZ + level.depth - 0.5) * CELL,
      }, level.surroundings, {
        north: mouths(xs.map((x) => [x, 0]), 0, minX), south: mouths(xs.map((x) => [x, level.depth - 1]), 0, minX),
        west: mouths(zs.map((z) => [0, z]), 1, minZ), east: mouths(zs.map((z) => [level.width - 1, z]), 1, minZ),
      });
      const occluders: Occluder[] = [];
      // The rows beyond the grid cut away like the level’s own buildings when they stand between the camera and a unit.
      if (beyond) {
        scene.add(beyond);
        beyond.updateMatrixWorld(true);
        occluders.push(...surroundingBuildings(beyond));
      }
      const poles: T.Vector3[] = [];
      const roofs = new Map<string, T.Group[]>();
      const ceilingLamps: T.PointLight[] = [];
      // A closed building (a mass nobody enters) is one thing: every piece and its roof in one
      // group, so it cuts away whole, never a tile at a time. A store's skin still opens by the cell.
      const { blocks, blockOf } = buildingBlocks(level);
      const massOf = new Map<string, number>();
      blocks.forEach((block, n) => { if (!block.shell) for (const c of block.cells) massOf.set(c.join(), n); });
      const masses = new Map<number, T.Group>();
      const mass = (n: number) => {
        let group = masses.get(n);
        if (!group) {
          masses.set(n, (group = new T.Group()));
          scene.add(group);
        }
        return group;
      };
      for (const prop of levelProps(level).fixed) {
        const asset = kit.props.get(prop);
        const root = new T.Group();
        root.add(asset.intact.clone(), asset.frame.clone());
        // A whole building or roof is seated by its origin cell (its centre may sit between cells).
        const index = Number(prop.id.slice("level-".length)), placed = level.placements[index];
        const wholeMass = massDims(prop.kind), wholeRoof = roofDims(prop.kind);
        const cell: [number, number] = wholeMass || wholeRoof ? [placed.at[0], placed.at[1]]
          : [Math.round(prop.x / CELL) - minX, Math.round(prop.z / CELL) - minZ];
        root.position.set(prop.x, floorRaise(level, cell) + (prop.y ?? 0), prop.z);
        root.rotation.y = prop.yaw;
        if (prop.span) root.scale.x = prop.span;
        // A fixture carries its own lamp: the light comes from something you can see.
        if (asset.light) {
          const lamp = new T.PointLight(asset.light.color, asset.light.intensity, asset.light.distance, 2);
          // A ceiling lamp stays lit when its roof cuts away: it hangs in the scene, not the roof.
          if (/^shop-building-(roof|ceiling)/.test(prop.kind)) {
            root.updateMatrixWorld(true);
            lamp.position.copy(root.localToWorld(asset.light.at.clone()));
            ceilingLamps.push(lamp);
          } else {
            lamp.position.copy(asset.light.at);
            // A street lamp burns at night only, like the district's own.
            if (asset.light.night) lamp.userData.nightIntensity = lamp.intensity;
            root.add(lamp);
          }
        }
        if (prop.kind === "shop-utility-pole") poles.push(root.position.clone());
        // Roof and ceiling tiles cut away per roof, not per cell: gathered and grouped below.
        if (/^shop-building-(roof|ceiling)/.test(prop.kind)) {
          // A cell may hold a roof tile and a ceiling fixture: both go with the roof.
          const at = (c: string) => roofs.get(c) ?? roofs.set(c, []).get(c)!;
          at(cell.join()).push(root);
          // A whole roof holds every cell it spans, so the fixtures beside it join its group.
          if (wholeRoof) for (let x = 0; x < wholeRoof.w; x++) for (let z = 0; z < wholeRoof.d; z++) {
            const [dx, dz] = turnOffset([x, z], placed.turn);
            at([cell[0] + dx, cell[1] + dz].join());
          }
          continue;
        }
        // A whole building is its own occluder group (the roof and the water tank join it below).
        if (wholeMass) {
          mass(blockOf.get(index)!).add(root);
          continue;
        }
        if (!prop.kind.startsWith("shop-building-")) {
          scene.add(root);
          continue;
        }
        const whole = massOf.get(cell.join());
        if (whole !== undefined) {
          mass(whole).add(root);
          continue;
        }
        // The battlefield resets an occluder's own transform: the cell sits inside one.
        const group = new T.Group();
        group.add(root);
        scene.add(group);
        group.updateMatrixWorld(true);
        occluders.push({ group, bounds: new T.Box3().setFromObject(group) });
      }

      // Blocks nobody enters: a flat dark fill over the whole footprint (what a cutaway shows,
      // like the poché of a plan), and the roof carried over the empty interior cells, which
      // cut away cell by cell like the pieces around them. At most one rooftop object per
      // block, large enough to read: a water tank on legs on the bigger, taller blocks.
      const fill = new T.MeshStandardMaterial({ color: 0x16181b, roughness: 0.95 });
      const slabTop = Math.max(0, ...level.floors.map((f) => floorRaise(level, f.at)));
      const roofing = new T.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.95 });
      const tankSteel = new T.MeshStandardMaterial({ color: 0x8a8c88, roughness: 0.6, metalness: 0.4 });
      blocks.forEach((block, n) => {
        const y = (c: [number, number]) => floorRaise(level, c);
        // A cut-away mass shows a flat dark fill at pavement height, nothing raised. A store’s
        // skin keeps the shop floor under its fixtures instead.
        // A building that is one placement gets one slab over its footprint; the piecewise ones a tile each.
        if (block.mass !== undefined) {
          const xs = block.cells.map((c) => c[0]), zs = block.cells.map((c) => c[1]);
          const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
          const slab = new T.Mesh(new T.BoxGeometry((x1 - x0 + 1) * CELL, 0.02, (z1 - z0 + 1) * CELL), fill);
          slab.position.set(((x0 + x1) / 2 + minX) * CELL, slabTop + 0.01, ((z0 + z1) / 2 + minZ) * CELL);
          scene.add(slab);
        } else if (!block.shell) for (const cell of block.cells) {
          const slab = new T.Mesh(new T.BoxGeometry(CELL, 0.02, CELL), fill);
          slab.position.set((cell[0] + minX) * CELL, slabTop + 0.01, (cell[1] + minZ) * CELL);
          scene.add(slab);
        }
        // Only over a real roofed interior, so it can never land on a shop's skin or a lone wall.
        const tankAt = block.interior.length >= 4 && block.height >= 6 && n % 2 === 0
          ? block.interior[Math.floor(block.interior.length / 2)] : null;
        // A whole building's own mesh carries the roof over the interior.
        for (const cell of block.mass === undefined ? block.interior : []) {
          const group = new T.Group();
          const roof = new T.Mesh(new T.BoxGeometry(CELL, 0.012, CELL), roofing);
          roof.position.set((cell[0] + minX) * CELL, y(cell) + block.height + 0.006, (cell[1] + minZ) * CELL);
          roof.receiveShadow = true;
          if (!block.shell) {
            mass(n).add(roof);
            continue;
          }
          group.add(roof);
          scene.add(group);
          occluders.push({ group, bounds: new T.Box3(
            new T.Vector3(roof.position.x - CELL / 2, y(cell), roof.position.z - CELL / 2),
            new T.Vector3(roof.position.x + CELL / 2, y(cell) + block.height, roof.position.z + CELL / 2)) });
        }
        if (tankAt) {
          const tank = new T.Group();
          tank.position.set((tankAt[0] + minX) * CELL, y(tankAt) + block.height, (tankAt[1] + minZ) * CELL);
          const body = new T.Mesh(new T.CylinderGeometry(0.7, 0.7, 1.3, 16), tankSteel);
          body.position.y = 1.55;
          const lid = new T.Mesh(new T.CylinderGeometry(0.72, 0.72, 0.08, 16), tankSteel);
          lid.position.y = 2.24;
          tank.add(body, lid);
          for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
            const leg = new T.Mesh(new T.BoxGeometry(0.08, 0.9, 0.08), tankSteel);
            leg.position.set(lx, 0.45, lz);
            tank.add(leg);
          }
          tank.traverse((o) => { if (o instanceof T.Mesh) o.castShadow = true; });
          (block.shell ? scene : mass(n)).add(tank);
        }
      });
      for (const group of masses.values()) {
        group.updateMatrixWorld(true);
        occluders.push({ group, bounds: new T.Box3().setFromObject(group) });
      }

      // A roof is every roof and ceiling tile joined four ways: one occluder, so with anyone
      // inside (or the camera's focus there) the whole sales floor opens at once.
      const seen = new Set<string>();
      for (const start of roofs.keys()) {
        if (seen.has(start)) continue;
        const group = new T.Group(), queue = [start];
        seen.add(start);
        while (queue.length) {
          const k = queue.pop()!, [x, z] = k.split(",").map(Number);
          for (const root of roofs.get(k)!) group.add(root);
          for (const n of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].map((c) => c.join()))
            if (roofs.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
        }
        scene.add(group);
        group.updateMatrixWorld(true);
        const bounds = new T.Box3().setFromObject(group);
        bounds.min.y = 0;
        occluders.push({ group, bounds });
      }

      for (const lamp of pairLamps(ceilingLamps)) scene.add(lamp);

      // Overhead lines between neighbouring utility poles: each pole wires to its nearest
      // neighbours within eight tiles, three sagging conductors and a lower telecom cable.
      if (poles.length > 1) scene.add(poleCables(poles));

      // The level's point lights, always on, hung in fixtures.
      for (const light of level.lights) {
        const [x, z] = light.at;
        const y = light.height + floorRaise(level, light.at);
        const lamp = new T.PointLight(light.color, light.intensity, 0, 2);
        lamp.position.set((x + minX) * CELL, y, (z + minZ) * CELL);
        // No bulb marker in play: a level's lamps hang in fixtures (the editor alone shows the gizmo).
        scene.add(lamp);
      }
      return occluders;
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

/**
 * A ceiling's lamps for the renderer: every point light costs every lit pixel
 * of the scene, so neighbouring lamps of a grid (two cells apart at most, same
 * light and height) share one light between them, as bright as both, reaching
 * as far. Below a ceiling that reads the same; the panels themselves still glow.
 * `userData.stands` keeps the two lamps a merged light stands for.
 */
export function pairLamps(lamps: readonly T.PointLight[]): T.PointLight[] {
  const reach = 2 * CELL + 1e-3;
  const pairs: [number, number, number][] = [];
  lamps.forEach((a, i) => lamps.forEach((b, j) => {
    const d = a.position.distanceTo(b.position);
    if (j > i && d <= reach && a.color.equals(b.color) && a.intensity === b.intensity && a.distance === b.distance &&
      Math.abs(a.position.y - b.position.y) < 1e-3) pairs.push([d, i, j]);
  }));
  // Closest first; ties in the order the lamps came, so a level always pairs the same way.
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const paired = new Set<number>(), out: T.PointLight[] = [];
  for (const [d, i, j] of pairs) {
    if (paired.has(i) || paired.has(j)) continue;
    paired.add(i).add(j);
    const a = lamps[i], b = lamps[j];
    const lamp = new T.PointLight(a.color, a.intensity + b.intensity, a.distance + d / 2, a.decay);
    lamp.position.copy(a.position).add(b.position).multiplyScalar(0.5);
    // The battlefield splits it back into the two for its reflection probe, which sees the difference.
    lamp.userData.stands = [a, b];
    out.push(lamp);
  }
  lamps.forEach((lamp, i) => { if (!paired.has(i)) out.push(lamp); });
  return out;
}

/** Catenary spans between nearby poles, as one line batch (no collision, no shadow). */
function poleCables(poles: readonly T.Vector3[]): T.LineSegments {
  const points: number[] = [], done = new Set<string>();
  const heights: [number, number][] = [[-0.45, 7.25], [0, 7.25], [0.45, 7.25], [0.25, 5.2]];
  poles.forEach((a, i) => {
    const near = poles.map((b, j) => ({ j, d: a.distanceTo(b) }))
      .filter(({ j, d }) => j !== i && d < CELL * 8).sort((p, q) => p.d - q.d).slice(0, 2);
    for (const { j, d } of near) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (done.has(key)) continue;
      done.add(key);
      const b = poles[j], dir = b.clone().sub(a).setY(0).normalize(), side = new T.Vector3(-dir.z, 0, dir.x);
      for (const [offset, y] of heights) {
        const sag = 0.25 + d * 0.035;
        for (let k = 0; k < 12; k++) for (const t of [k / 12, (k + 1) / 12]) {
          const p = a.clone().lerp(b, t).addScaledVector(side, offset);
          points.push(p.x, y - sag * 4 * t * (1 - t), p.z);
        }
      }
    }
  });
  const geometry = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3));
  return new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0x0c0d0f }));
}
