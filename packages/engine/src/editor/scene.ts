// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The level editor's viewport: a flat staging ground with the level's grid,
 * every placement as its real asset mesh (cell assets on their cells, walls
 * and doors on their edges, clutter on the surface beneath it), painted
 * flooring with real finishes, unwalkable tiles, deployment and objective
 * markers, a ghost preview under the cursor and the authored lighting. The
 * left mouse button paints (the host decides what that means), the right
 * orbits, the wheel zooms; the host owns all state and calls `setLevel`
 * after each edit.
 */
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetByUid, floorByUid, type AssetSpec, type FloorSpec } from "../catalog.ts";
import { districtMaps, loadDistrictTextures, pavementMaterial } from "../district.ts";
import type { MapProp } from "../environment.ts";
import { CELL, type Cell } from "../map.ts";
import type { OfficeFinish, OfficeKind } from "../office/catalog.ts";
import { FLOOR_UV_SCALE, floorSurfaceMaterial, officeFloorTexture } from "../office/flooring.ts";
import { applyTimeOfDay } from "../scene-weather.ts";
import { PropAssets } from "../scene/prop-assets.ts";
import {
  anchorOf, canonicalEdge, floorRaise, interiorPreset, newLevel, restHeight, turnOffset,
  type Level, type LevelLighting, type Placement, type Turn,
} from "./level.ts";

const placementKey = (p: Placement, rest: number, raise: number) =>
  `${p.asset}:${p.at.join()}:${p.turn}:${rest}:${raise}:${p.finish ?? ""}`;

/** The one fake prop behind a placement; `cover` picks the barrier-sized mesh variants. */
function propOf(spec: AssetSpec, turn: Turn, finish?: OfficeFinish): MapProp {
  return {
    id: `editor-${spec.uid}`,
    kind: spec.kind,
    x: 0,
    z: 0,
    yaw: turn * (Math.PI / 2),
    seed: 7,
    ...(spec.footprint === "cover" ? { cover: [0, 0] as Cell } : {}),
    ...(spec.kind.startsWith("office-")
      ? { office: { kind: spec.kind.slice(7) as OfficeKind, finish } }
      : {}),
  };
}

/** Where a placement's mesh sits: world position, yaw and run-length scale. */
function seatOf(spec: AssetSpec, at: Cell, turn: Turn, lift: number) {
  if (spec.place === "edge") {
    const e = canonicalEdge(at, turn);
    const [x, z] = e.cell;
    const mid =
      e.side === "n"
        ? new T.Vector3(x * CELL, lift, (z - 0.5) * CELL)
        : new T.Vector3((x - 0.5) * CELL, lift, z * CELL);
    if (spec.mount === "wall") {
      // Into the cell it was placed from, at its mounting height.
      const inset = new T.Vector3(at[0] * CELL, 0, at[1] * CELL).sub(mid.clone().setY(0));
      mid.add(inset.normalize().multiplyScalar(0.09));
      return { position: mid, yaw: -turn * (Math.PI / 2), scale: 1 };
    }
    return { position: mid, yaw: turn * (Math.PI / 2), scale: spec.span ? CELL / spec.span : 1 };
  }
  // The mesh sits at its authored anchor, not the footprint centroid, plus
  // its workstation offset — desk clutter composes instead of piling up.
  const [ax, az] = turnOffset(anchorOf(spec), turn);
  const [ox, oz] = spec.offset ? turnOffset(spec.offset, turn) : [0, 0];
  return {
    position: new T.Vector3((at[0] + ax) * CELL + ox, lift, (at[1] + az) * CELL + oz),
    yaw: turn * (Math.PI / 2),
    scale: 1,
  };
}

// The office surfaces at their shared scale; the street materials use the
// district's metric UVs, one repeat per 2m.
const UV_SCALE = { ...FLOOR_UV_SCALE, asphalt: [2, 2], concrete: [2, 2], slabs: [2, 2] } as const;

/** The texture a floor tile samples, or undefined for a flat tint. */
const surfaceOf = (spec: FloorSpec) => spec.texture ?? spec.street ?? (spec.slabs ? "slabs" : undefined);

export class EditorScene {
  /** The host paints over a cell; `side` is the cell edge nearest the pointer. */
  onPaint?: (cell: Cell, side: Turn) => void;
  onHover?: (cell: Cell | null, side: Turn) => void;
  /** Alt-click: the host copies what stands here instead of painting. */
  onPick?: (cell: Cell) => void;

  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera: T.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly assets = new PropAssets();
  private readonly sun = new T.DirectionalLight(0xc6d2ed, 3.6);
  private readonly ambient = new T.HemisphereLight(0xaebbd6, 0x14131a, 0.95);
  private readonly rim = new T.DirectionalLight(0xd69d70, 0.55);
  private readonly ground = new T.Group();
  private readonly floors = new T.Group();
  private readonly voids = new T.Group();
  private readonly markers = new T.Group();
  private readonly lamps = new T.Group();
  private readonly placed = new T.Group();
  private readonly byKey = new Map<string, T.Object3D>();
  private readonly floorMaterials = new Map<string, T.MeshStandardMaterial>();
  private readonly floorTextures = new Map<string, ReturnType<typeof officeFloorTexture>>();
  // The crosswalks' zebra strips, the street demo's road-paint tone.
  private readonly paint = new T.MeshStandardMaterial({ color: 0xb8b5a2, roughness: 0.85 });
  private readonly bulbMaterials = new Map<number, T.MeshBasicMaterial>();
  private readonly lampLine = new T.LineBasicMaterial({ color: 0x5a6069, transparent: true, opacity: 0.6 });
  private readonly disposable = new Set<T.BufferGeometry>();
  private level = newLevel();
  private readonly hoverTile = new T.Mesh(
    new T.PlaneGeometry(CELL * 0.94, CELL * 0.94),
    new T.MeshBasicMaterial({ color: 0xe8c17d, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  private readonly ghostMaterial = new T.MeshBasicMaterial({
    color: 0xeac78a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  private readonly eraseMaterial = new T.MeshBasicMaterial({
    color: 0xe77469,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  private readonly selectMaterial = new T.MeshBasicMaterial({
    color: 0x9fd9dd,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private ghost: T.Object3D | null = null;
  private previewUid: string | null = null;
  private previewTurn: Turn = 0;
  private hovered: Cell | null = null;
  private hoveredSide: Turn = 0;
  private readonly markedSwap = new Map<T.Mesh, T.Material | T.Material[]>();
  private markedKey = "";
  private painting = false;
  private paintedKey = "";
  private size: [number, number] = [0, 0];
  private readonly observer: ResizeObserver;
  private readonly plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  private readonly raycaster = new T.Raycaster();

  constructor(private readonly host: HTMLElement) {
    const renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    this.scene.background = new T.Color(0x0c1019);
    this.scene.fog = new T.FogExp2(0x252b3b, 0.019);
    this.camera = new T.PerspectiveCamera(50, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.45;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 90;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.ambient, this.rim);
    this.hoverTile.rotation.x = -Math.PI / 2;
    this.hoverTile.visible = false;
    this.scene.add(
      this.ground, this.floors, this.voids, this.placed, this.markers, this.lamps, this.hoverTile,
    );

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();

    // The street floor textures arrive async; patch the placeholder materials.
    loadDistrictTextures(renderer)
      .then(() => {
        for (const [uid, material] of this.floorMaterials) {
          const spec = floorByUid(uid);
          if (!spec?.street) continue;
          Object.assign(material, districtMaps(spec.street));
          material.needsUpdate = true;
        }
      })
      .catch(() => {}); // Offline: the flat tints stand in.

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.pointerDown);
    el.addEventListener("pointermove", this.pointerMove);
    el.addEventListener("pointerup", this.pointerUp);
    el.addEventListener("pointerleave", this.pointerLeave);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    renderer.setAnimationLoop(() => {
      this.controls.update();
      renderer.render(this.scene, this.camera);
    });
  }

  /** Rebuild what changed: the staging ground on resize, placements by diff. */
  setLevel(level: Level) {
    this.level = level;
    if (level.width !== this.size[0] || level.depth !== this.size[1]) {
      this.size = [level.width, level.depth];
      this.buildGround(level);
      this.frame(level);
    }
    const keep = new Set<string>();
    for (const p of level.placements) {
      const spec = assetByUid(p.asset);
      if (!spec) continue;
      const rest = restHeight(level, p);
      const raise = floorRaise(level, p.at);
      const key = placementKey(p, rest, raise);
      keep.add(key);
      if (this.byKey.has(key)) continue;
      const object = this.placementObject(spec, p, rest + raise);
      this.byKey.set(key, object);
      this.placed.add(object);
    }
    for (const [key, object] of this.byKey) {
      if (keep.has(key)) continue;
      this.byKey.delete(key);
      this.placed.remove(object);
    }
    this.buildFloors(level);
    this.buildVoids(level);
    this.buildMarkers(level);
    this.buildLights(level);
    this.applyLighting(level.lighting);
    this.moveGhost();
  }

  /** Reapply a time-of-day preset (or the indoor rig), then the level's deviations. */
  applyLighting(lighting: LevelLighting) {
    const fog = this.scene.fog as T.FogExp2;
    if (lighting.time === "interior") {
      // The office demo's exposure and fill: floors read as they do in-game.
      (this.scene.background as T.Color).setHex(lighting.sky ?? interiorPreset.sky);
      fog.color.setHex(lighting.fog ?? interiorPreset.fog);
      fog.density = lighting.density ?? interiorPreset.density;
      this.sun.color.setHex(lighting.sun ?? interiorPreset.sun);
      this.sun.intensity = lighting.strength ?? interiorPreset.strength;
      this.ambient.color.setHex(0xd1e1df);
      this.ambient.groundColor.setHex(0x45443a);
      this.ambient.intensity = lighting.ambient ?? interiorPreset.ambient;
      this.rim.color.setHex(0xadc7db);
      this.rim.position.set(16, 5, -4);
      this.rim.intensity = 0.2;
      this.renderer.toneMappingExposure = lighting.exposure ?? interiorPreset.exposure;
      return;
    }
    const preset = applyTimeOfDay(this.scene, this.sun, this.ambient, this.rim, lighting.time);
    if (lighting.sky !== undefined) (this.scene.background as T.Color).setHex(lighting.sky);
    if (lighting.fog !== undefined) fog.color.setHex(lighting.fog);
    if (lighting.density !== undefined) fog.density = lighting.density;
    if (lighting.sun !== undefined) this.sun.color.setHex(lighting.sun);
    if (lighting.strength !== undefined) this.sun.intensity = lighting.strength;
    if (lighting.ambient !== undefined) this.ambient.intensity = lighting.ambient;
    this.renderer.toneMappingExposure = lighting.exposure ?? preset.exposure;
  }

  /** The asset the cursor would place; null clears the ghost. */
  setPreview(uid: string | null, turn: Turn) {
    if (uid === this.previewUid && turn === this.previewTurn) return;
    this.previewUid = uid;
    this.previewTurn = turn;
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
    const spec = uid ? assetByUid(uid) : undefined;
    if (!spec) return;
    const asset = this.assets.get(propOf(spec, turn));
    const ghost = new T.Group();
    ghost.add(asset.intact.clone(), asset.frame.clone());
    ghost.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.material = this.ghostMaterial;
        o.castShadow = false;
      }
    });
    ghost.visible = false;
    this.ghost = ghost;
    this.scene.add(ghost);
    this.moveGhost();
  }

  /** The cursor's tone: what a click would do. */
  setTone(tone: "place" | "erase" | "select" | "mark") {
    const colors = { place: 0xe8c17d, erase: 0xe77469, select: 0x9fd9dd, mark: 0x7eaaa7 };
    (this.hoverTile.material as T.MeshBasicMaterial).color.setHex(colors[tone]);
  }

  /** Tint one placement red (about to erase) or cyan (selected); null restores. */
  mark(p: Placement | null, tone: "erase" | "select" = "erase") {
    const rest = p ? restHeight(this.level, p) : 0;
    const raise = p ? floorRaise(this.level, p.at) : 0;
    const key = p ? `${placementKey(p, rest, raise)}:${tone}` : "";
    if (key === this.markedKey) return;
    for (const [mesh, material] of this.markedSwap) mesh.material = material;
    this.markedSwap.clear();
    this.markedKey = key;
    if (!p) return;
    const object = this.byKey.get(placementKey(p, rest, raise));
    object?.traverse((o) => {
      if (o instanceof T.Mesh) {
        this.markedSwap.set(o, o.material);
        o.material = tone === "erase" ? this.eraseMaterial : this.selectMaterial;
      }
    });
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.controls.dispose();
    this.assets.dispose();
    for (const geometry of this.disposable) geometry.dispose();
    this.paint.dispose();
    this.lampLine.dispose();
    for (const material of this.bulbMaterials.values()) material.dispose();
    for (const [uid, material] of this.floorMaterials) {
      // The pavement's canvas is this scene's own; the KTX2 maps are shared.
      if (floorByUid(uid)?.slabs) material.map?.dispose();
      material.dispose();
    }
    for (const maps of this.floorTextures.values()) {
      maps.map.dispose();
      maps.detail.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // -------------------------------------------------------------------------

  private placementObject(spec: AssetSpec, p: Placement, lift: number): T.Object3D {
    const asset = this.assets.get(propOf(spec, p.turn, p.finish));
    const group = new T.Group();
    group.add(asset.intact.clone(), asset.frame.clone());
    const seat = seatOf(spec, p.at, p.turn, lift);
    group.position.copy(seat.position);
    group.rotation.y = seat.yaw;
    group.scale.x = seat.scale;
    // The pointer picks meshes before the ground, so tall assets are clickable.
    group.userData.placement = p;
    return group;
  }

  private clear(group: T.Group, geometries = false) {
    for (const o of [...group.children]) {
      group.remove(o);
      if (geometries && (o instanceof T.Mesh || o instanceof T.LineSegments)) {
        this.disposable.delete(o.geometry);
        o.geometry.dispose();
      }
    }
  }

  private floorMaterial(spec: FloorSpec): T.MeshStandardMaterial {
    let material = this.floorMaterials.get(spec.uid);
    if (material) return material;
    if (spec.slabs) {
      material = pavementMaterial();
    } else if (spec.street) {
      // The street demo's own PBR set; flat-tinted until the KTX2 maps land.
      material = new T.MeshStandardMaterial({
        color: spec.tone,
        roughness: spec.rough ?? 1,
        metalness: 0,
        normalScale: new T.Vector2(0.45, 0.45),
        ...districtMaps(spec.street),
      });
    } else if (spec.texture) {
      let maps = this.floorTextures.get(spec.texture);
      if (!maps) {
        maps = officeFloorTexture(spec.texture);
        this.floorTextures.set(spec.texture, maps);
      }
      material = floorSurfaceMaterial(spec.texture, maps, spec.tone);
    } else {
      material = new T.MeshStandardMaterial({
        color: spec.tone,
        roughness: spec.rough ?? 0.92,
        metalness: spec.metal ?? 0.04,
      });
    }
    this.floorMaterials.set(spec.uid, material);
    return material;
  }

  private buildFloors(level: Level) {
    this.clear(this.floors, true);
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
      const parts = at.map(([x, z]) => {
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
      this.disposable.add(merged);
      const mesh = new T.Mesh(merged, this.floorMaterial(spec));
      mesh.receiveShadow = true;
      mesh.castShadow = !!spec.raise;
      this.floors.add(mesh);
      const paint = strips.length ? mergeGeometries(strips) : null;
      for (const strip of strips) strip.dispose();
      if (paint) {
        this.disposable.add(paint);
        const painted = new T.Mesh(paint, this.paint);
        painted.receiveShadow = true;
        this.floors.add(painted);
      }
    }
  }

  /** Placed point lights: the lamp itself, a bulb marker and a drop line. */
  private buildLights(level: Level) {
    this.clear(this.lamps, true);
    for (const light of level.lights) {
      const [x, z] = light.at;
      const lift = floorRaise(level, light.at);
      const y = light.height + lift;
      const lamp = new T.PointLight(light.color, light.intensity, 0, 2);
      lamp.position.set(x * CELL, y, z * CELL);
      let bulb = this.bulbMaterials.get(light.color);
      if (!bulb) {
        bulb = new T.MeshBasicMaterial({ color: light.color });
        this.bulbMaterials.set(light.color, bulb);
      }
      const sphere = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), bulb);
      sphere.position.copy(lamp.position);
      const drop = new T.BufferGeometry().setAttribute(
        "position",
        new T.Float32BufferAttribute([x * CELL, lift, z * CELL, x * CELL, y - 0.08, z * CELL], 3),
      );
      this.lamps.add(lamp, sphere, new T.LineSegments(drop, this.lampLine));
    }
  }

  private buildVoids(level: Level) {
    this.clear(this.voids, true);
    if (!level.unwalkable.length) return;
    const planes = level.unwalkable.map(([x, z]) => {
      const plane = new T.PlaneGeometry(CELL * 0.96, CELL * 0.96);
      plane.rotateX(-Math.PI / 2);
      plane.translate(x * CELL, 0.018, z * CELL);
      return plane;
    });
    const merged = mergeGeometries(planes);
    for (const part of planes) part.dispose();
    if (!merged) return;
    this.disposable.add(merged);
    const pit = new T.Mesh(
      merged,
      new T.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.88 }),
    );
    this.voids.add(pit);
    const points: number[] = [];
    const r = CELL * 0.33;
    for (const [x, z] of level.unwalkable) {
      const cx = x * CELL,
        cz = z * CELL;
      points.push(cx - r, 0.02, cz - r, cx + r, 0.02, cz + r, cx - r, 0.02, cz + r, cx + r, 0.02, cz - r);
    }
    const cross = new T.LineSegments(
      new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3)),
      new T.LineBasicMaterial({ color: 0xe7ac66, transparent: true, opacity: 0.5 }),
    );
    this.disposable.add(cross.geometry);
    this.voids.add(cross);
  }

  private buildGround(level: Level) {
    this.clear(this.ground, true);
    const w = level.width * CELL,
      d = level.depth * CELL;
    const apron = new T.Mesh(
      new T.PlaneGeometry(w + 40 * CELL, d + 40 * CELL),
      new T.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.97 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(w / 2 - CELL / 2, -0.02, d / 2 - CELL / 2);
    apron.receiveShadow = true;
    const floor = new T.Mesh(
      new T.PlaneGeometry(w, d),
      new T.MeshStandardMaterial({ color: 0x272c35, roughness: 0.93 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2 - CELL / 2, 0, d / 2 - CELL / 2);
    floor.receiveShadow = true;
    const points: number[] = [];
    for (let x = 0; x <= level.width; x++)
      points.push((x - 0.5) * CELL, 0.012, -CELL / 2, (x - 0.5) * CELL, 0.012, d - CELL / 2);
    for (let z = 0; z <= level.depth; z++)
      points.push(-CELL / 2, 0.012, (z - 0.5) * CELL, w - CELL / 2, 0.012, (z - 0.5) * CELL);
    const grid = new T.LineSegments(
      new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3)),
      new T.LineBasicMaterial({ color: 0xa4b5bc, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.disposable.add(grid.geometry);
    this.ground.add(apron, floor, grid);
    const reach = Math.max(w, d);
    this.sun.shadow.camera.left = -reach;
    this.sun.shadow.camera.right = reach;
    this.sun.shadow.camera.top = reach;
    this.sun.shadow.camera.bottom = -reach;
    this.sun.shadow.camera.far = reach * 4 + 40;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set(w / 2, 0, d / 2);
  }

  private buildMarkers(level: Level) {
    this.clear(this.markers, true);
    const ring = (cell: Cell, color: number) => {
      const mesh = new T.Mesh(
        new T.RingGeometry(CELL * 0.3, CELL * 0.4, 32),
        new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: T.DoubleSide }),
      );
      this.disposable.add(mesh.geometry);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cell[0] * CELL, 0.03 + floorRaise(level, cell), cell[1] * CELL);
      this.markers.add(mesh);
    };
    for (const spawn of level.spawns) ring(spawn, 0x7eaaa7);
    if (level.objective) {
      ring(level.objective, 0xf4c583);
      const beacon = new T.Mesh(
        new T.CylinderGeometry(0.03, 0.03, 4.5, 8),
        new T.MeshBasicMaterial({ color: 0xeac78a, transparent: true, opacity: 0.25, depthWrite: false }),
      );
      this.disposable.add(beacon.geometry);
      beacon.position.set(level.objective[0] * CELL, 2.25, level.objective[1] * CELL);
      this.markers.add(beacon);
    }
  }

  /** Bring the whole staging ground into view. */
  private frame(level: Level) {
    const w = level.width * CELL,
      d = level.depth * CELL;
    const span = Math.max(w, d);
    this.controls.target.set(w / 2 - CELL / 2, 0, d / 2 - CELL / 2);
    this.camera.position.set(w / 2 - CELL / 2, span * 0.95, d / 2 - CELL / 2 + span * 0.85);
    this.controls.update();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private pointAt(event: PointerEvent): { cell: Cell; side: Turn } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new T.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    // A placed mesh wins over the ground behind it: clicking a wall or a
    // tall block names that placement's cell, not the cell its face hides.
    for (const meshHit of this.raycaster.intersectObjects(this.placed.children, true)) {
      for (let o: T.Object3D | null = meshHit.object; o; o = o.parent) {
        const p = o.userData.placement as Placement | undefined;
        if (p) return { cell: p.at, side: p.turn };
      }
    }
    const hit = new T.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const cell: Cell = [Math.round(hit.x / CELL), Math.round(hit.z / CELL)];
    if (cell[0] < 0 || cell[0] >= this.size[0] || cell[1] < 0 || cell[1] >= this.size[1]) return null;
    const fx = hit.x / CELL - cell[0],
      fz = hit.z / CELL - cell[1];
    const side: Turn = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
    return { cell, side };
  }

  private moveGhost() {
    const spec = this.previewUid ? assetByUid(this.previewUid) : undefined;
    if (this.ghost && spec) {
      this.ghost.visible = !!this.hovered;
      if (this.hovered) {
        const turn = spec.place === "edge" ? this.hoveredSide : this.previewTurn;
        const lift =
          floorRaise(this.level, this.hovered) +
          (spec.mount === "wall"
            ? (spec.lift ?? 0)
            : spec.mount === "surface"
              ? (restHeight(this.level, { asset: spec.uid, at: this.hovered, turn }) ?? 0)
              : 0);
        const seat = seatOf(spec, this.hovered, turn, lift + 0.01);
        this.ghost.position.copy(seat.position);
        this.ghost.rotation.y = seat.yaw;
        this.ghost.scale.x = seat.scale;
      }
    } else if (this.ghost) {
      this.ghost.visible = false;
    }
    this.hoverTile.visible = !!this.hovered;
    if (this.hovered)
      this.hoverTile.position.set(
        this.hovered[0] * CELL,
        0.025 + floorRaise(this.level, this.hovered),
        this.hovered[1] * CELL,
      );
  }

  private setHovered(point: { cell: Cell; side: Turn } | null) {
    const name = point ? `${point.cell.join()}:${point.side}` : "";
    const previous = this.hovered ? `${this.hovered.join()}:${this.hoveredSide}` : "";
    if (name === previous) return;
    this.hovered = point?.cell ?? null;
    this.hoveredSide = point?.side ?? 0;
    this.moveGhost();
    this.onHover?.(this.hovered, this.hoveredSide);
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const point = this.pointAt(event);
    if (!point) return;
    if (event.altKey) {
      this.onPick?.(point.cell);
      return;
    }
    this.painting = true;
    this.paintedKey = `${point.cell.join()}:${point.side}`;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.onPaint?.(point.cell, point.side);
  };

  private pointerMove = (event: PointerEvent) => {
    const point = this.pointAt(event);
    this.setHovered(point);
    if (!this.painting || !point) return;
    const key = `${point.cell.join()}:${point.side}`;
    if (key === this.paintedKey) return;
    this.paintedKey = key;
    this.onPaint?.(point.cell, point.side);
  };

  private pointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.painting = false;
    this.paintedKey = "";
  };

  private pointerLeave = () => {
    this.painting = false;
    this.setHovered(null);
  };
}
