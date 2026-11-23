// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The training simulation's look: a dark void with a glowing tile grid, and
 * every piece of the level drawn as a light construct by what it is in the
 * rules, so the picture itself teaches the cover system. Only Basics uses it
 * (its map view is registered under its own plan id; its constructs are added
 * by the guide's overlay); every other level is untouched.
 *
 * - Wall tile (blocks movement, sight and fire; never breaks): a solid block,
 *   the theme's text tone, bright edges.
 * - High cover edge (50 off, no walking through; breaks under a grenade): a
 *   tall panel in the accent tone, hatched.
 * - Low cover edge (25 off, see and step over; breaks): a waist-high panel in
 *   a dimmed accent, hatched.
 * - Obstacle (low cover to every neighbour, vaulted, never stood on; breaks):
 *   a waist-high block in the dimmed accent, hatched.
 * - The protected side: a glowing line on the floor of each tile along the
 *   side a piece covers, in the piece's tone (the contract's cover-with-sides).
 * - Targets: a reticle on the floor under every hostile, in the hostile tone.
 * - Who covers whom: a line from a target to an operator. It stops on the
 *   piece that protects the operator, which lights up; flanked, it runs clean
 *   to the operator and the operator's own shield lines go dark.
 *
 * Tints come from the host's theme tokens (`--text-color`, `--accent-color`,
 * `--background-color`, `--surface-color`) and the engine's `--hostile`; the
 * glow is the scene's existing bloom (unlit materials pushed past its
 * threshold). Nothing animates: the constructs are rebuilt only when the field
 * changes, so the field still renders on demand.
 */
import * as T from "three";
import type { ChainGround } from "../chain-ground.ts";
import type { Level } from "../editor/level.ts";
import { levelOrigin } from "../editor/playtest.ts";
import { CELL, type Cell } from "../map.ts";
import type { MapView } from "../scene/maps.ts";
import { coverPieces, tileAt, type CoverRelation, type Side } from "./cover.ts";

/** The simulation's tones, read from the theme. */
export interface SimPalette {
  void: T.Color;
  floor: T.Color;
  grid: T.Color;
  wall: T.Color;
  high: T.Color;
  low: T.Color;
  hostile: T.Color;
}

function token(el: Element | null, name: string, fallback: string): T.Color {
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  const c = new T.Color();
  try {
    c.setStyle(raw || fallback);
  } catch {
    c.setStyle(fallback);
  }
  return c;
}

/** The palette from the theme tokens on the page (the encounter's root when mounted). */
export function simPalette(): SimPalette {
  const doc = typeof document !== "undefined" ? document : null;
  const root = doc?.querySelector(".encounter") ?? doc?.documentElement ?? null;
  const text = token(root, "--text-color", "#ffffff");
  const accent = token(root, "--accent-color", "#7fe3ef");
  const background = token(root, "--background-color", "#0a0b0d");
  const surface = token(root, "--surface-color", "#101215");
  const hostile = token(root, "--hostile", "#d67c73");
  return {
    void: background.clone().lerp(new T.Color(0, 0, 0), 0.4),
    floor: surface.clone().lerp(background, 0.5),
    grid: accent.clone().lerp(background, 0.8),
    wall: text.clone().lerp(background, 0.12),
    high: accent.clone(),
    low: accent.clone().lerp(background, 0.5),
    hostile,
  };
}

/** Unlit and pushed past the bloom threshold: a glowing line or face. */
const glow = (c: T.Color, strength = 1.8, opacity = 1) =>
  new T.MeshBasicMaterial({
    color: c.clone().multiplyScalar(strength),
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
const lineGlow = (c: T.Color, strength = 1.8) =>
  new T.LineBasicMaterial({ color: c.clone().multiplyScalar(strength), toneMapped: false });

/** The world point of a cell's centre at height `y`. */
const centre = ([x, z]: Cell, y = 0) => new T.Vector3(x * CELL, y, z * CELL);

/** The midpoint of a cell's side and the direction along it. */
function sideSeat(cell: Cell, side: Side): { mid: T.Vector3; along: "x" | "z"; inward: T.Vector3 } {
  const c = centre(cell);
  const h = CELL / 2;
  switch (side) {
    case "top":
      return { mid: c.clone().add(new T.Vector3(0, 0, -h)), along: "x", inward: new T.Vector3(0, 0, 1) };
    case "bottom":
      return { mid: c.clone().add(new T.Vector3(0, 0, h)), along: "x", inward: new T.Vector3(0, 0, -1) };
    case "left":
      return { mid: c.clone().add(new T.Vector3(-h, 0, 0)), along: "z", inward: new T.Vector3(1, 0, 0) };
    case "right":
      return { mid: c.clone().add(new T.Vector3(h, 0, 0)), along: "z", inward: new T.Vector3(-1, 0, 0) };
  }
}

const NEXT: Record<Side, Cell> = { left: [-1, 0], top: [0, -1], right: [1, 0], bottom: [0, 1] };
const BACK: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
const SIDES: Side[] = ["left", "top", "right", "bottom"];

/** Heights in metres: a wall stands over a unit, high cover to the shoulder, low cover to the waist. */
const WALL_H = 2.6,
  HIGH_H = 1.9,
  LOW_H = 0.85;

/** The level's own floor in the void: a slab per walkable cell and the grid between them. */
export function simulationView(level: Level): MapView {
  const [minX, minZ] = levelOrigin(level);
  const width = level.width * CELL,
    depth = level.depth * CELL;
  const cx = (minX + (level.width - 1) / 2) * CELL,
    cz = (minZ + (level.depth - 1) / 2) * CELL;
  const pits = new Set(level.unwalkable.map((c) => c.join()));
  return {
    furnishedCover: true,
    defaults: { time: "night", weather: "clear" },
    extent: Math.hypot(width / 2 + Math.abs(cx), depth / 2 + Math.abs(cz)),
    // The void: no sun, no fog, an even fill so the operators read.
    interiorLighting: (scene, key, ambient, rim) => {
      const p = simPalette();
      scene.background = p.void.clone();
      // A haze that swallows everything past the room: nothing else of the simulation is ever in sight.
      scene.fog = new T.FogExp2(p.void.clone(), 0.024);
      key.color.set(0xffffff);
      key.intensity = 1.1;
      key.castShadow = true;
      ambient.color.copy(p.wall);
      ambient.groundColor.copy(p.void);
      ambient.intensity = 1.1;
      rim.color.copy(p.high);
      rim.position.set(12, 6, -10);
      rim.intensity = 0.6;
      rim.castShadow = false;
      return 1.1;
    },
    load: async () => {},
    build(scene) {
      const p = simPalette();
      const slab = new T.MeshStandardMaterial({ color: p.floor, roughness: 0.92, metalness: 0 });
      const tiles = new T.InstancedMesh(new T.BoxGeometry(CELL * 0.97, 0.08, CELL * 0.97), slab, level.width * level.depth);
      const m = new T.Matrix4();
      let n = 0;
      const lines: number[] = [];
      for (let x = 0; x < level.width; x++)
        for (let z = 0; z < level.depth; z++) {
          if (pits.has(`${x},${z}`)) continue;
          const wx = (x + minX) * CELL,
            wz = (z + minZ) * CELL;
          m.makeTranslation(wx, -0.04, wz);
          tiles.setMatrixAt(n++, m);
          const h = CELL / 2,
            y = 0.012;
          lines.push(wx - h, y, wz - h, wx + h, y, wz - h, wx + h, y, wz - h, wx + h, y, wz + h);
          lines.push(wx + h, y, wz + h, wx - h, y, wz + h, wx - h, y, wz + h, wx - h, y, wz - h);
        }
      tiles.count = n;
      tiles.receiveShadow = true;
      const grid = new T.LineSegments(
        new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(lines, 3)),
        lineGlow(p.grid, 0.9),
      );
      scene.add(tiles, grid);
      // The room's edge: a low wall of light, fading upwards.
      const fade = document.createElement("canvas");
      fade.width = 2;
      fade.height = 64;
      const g = fade.getContext("2d");
      if (g) {
        const ramp = g.createLinearGradient(0, 0, 0, 64);
        ramp.addColorStop(0, "rgba(255,255,255,0)");
        ramp.addColorStop(1, "rgba(255,255,255,0.55)");
        g.fillStyle = ramp;
        g.fillRect(0, 0, 2, 64);
      }
      const wallTexture = new T.CanvasTexture(fade);
      const light = new T.MeshBasicMaterial({
        color: p.high.clone().multiplyScalar(0.9),
        map: wallTexture,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
      });
      const [x0, x1] = [minX * CELL - CELL / 2, (minX + level.width) * CELL - CELL / 2];
      const [z0, z1] = [minZ * CELL - CELL / 2, (minZ + level.depth) * CELL - CELL / 2];
      const H = 1.4;
      for (const [w, x, z, turn] of [
        [x1 - x0, (x0 + x1) / 2, z0, 0],
        [x1 - x0, (x0 + x1) / 2, z1, 0],
        [z1 - z0, x0, (z0 + z1) / 2, 1],
        [z1 - z0, x1, (z0 + z1) / 2, 1],
      ] as const) {
        const plane = new T.Mesh(new T.PlaneGeometry(w, H), light);
        plane.position.set(x, H / 2, z);
        plane.rotation.y = turn ? Math.PI / 2 : 0;
        scene.add(plane);
      }
      return [];
    },
  };
}

/** Who covers whom right now, as the overlay asks the constructs to draw it. */
export interface SimRelation {
  from: Cell;
  to: Cell;
  /** The rules' answer (`coverRelation`) and whether there is a line at all. */
  cover: CoverRelation;
  sight: boolean;
}

/** The constructs over the floor: pieces, shield lines, target reticles, the cover line. */
export class SimulationConstructs {
  readonly group = new T.Group();
  private readonly pieces = new T.Group();
  private readonly markers = new T.Group();
  private readonly relation = new T.Group();
  private piecesKey = "";
  private markersKey = "";
  private relationKey = "";
  private palette: SimPalette;
  /** Shield lines by `cell:side`, so the cover line can light or darken them. */
  private shields = new Map<string, T.Mesh>();

  constructor(palette: SimPalette = simPalette()) {
    this.palette = palette;
    this.group.name = "Simulation";
    this.group.add(this.pieces, this.markers, this.relation);
  }

  /** Rebuild what changed; true when anything did (the scene should redraw). */
  update(
    ground: ChainGround,
    origin: Cell,
    units: { id: string; pos: Cell; enemy: boolean; hp: number }[],
    relation: SimRelation | null,
    materialize = false,
  ): boolean {
    let changed = false;
    const key = JSON.stringify(ground.tiles);
    if (key !== this.piecesKey) {
      this.piecesKey = key;
      this.relationKey = "";
      this.buildPieces(ground, origin);
      // A new room rises out of the floor; a blast only takes pieces away.
      if (materialize) this.pieces.scale.y = 0.02;
      changed = true;
    }
    const marks = JSON.stringify(units.filter((u) => u.enemy && u.hp > 0).map((u) => u.pos));
    if (marks !== this.markersKey) {
      this.markersKey = marks;
      this.buildMarkers(units.filter((u) => u.enemy && u.hp > 0).map((u) => u.pos));
      changed = true;
    }
    const rel = JSON.stringify(relation);
    if (rel !== this.relationKey) {
      this.relationKey = rel;
      this.buildRelation(relation);
      changed = true;
    }
    return changed;
  }

  private static clear(group: T.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const mesh = o as T.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as T.Material | T.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((mat) => mat.dispose());
        else material?.dispose();
      });
    }
  }

  /** One frame of the room rising; true while it still is. */
  rise(dt: number): boolean {
    if (this.pieces.scale.y >= 1) return false;
    this.pieces.scale.y = Math.min(1, this.pieces.scale.y + dt / 0.5);
    return true;
  }

  /** Light the targets standing in the room, so they read against the dark (up to three). */
  lightTargets(cells: Cell[]) {
    // Each target: a neutral key from the camera's side, a hostile rim from behind, a soft glow on the floor under it.
    while (this.lamps.length < 3) {
      const key = new T.PointLight(0xffffff, 0, 3.6, 1.6);
      const rim = new T.PointLight(this.palette.hostile.clone(), 0, 3.4, 1.4);
      const glow = new T.Mesh(
        new T.CircleGeometry(0.62, 32),
        new T.MeshBasicMaterial({ color: this.palette.hostile.clone(), transparent: true, opacity: 0.32, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      this.lamps.push({ key, rim, glow });
      this.group.add(key, rim, glow);
    }
    this.lamps.forEach(({ key, rim, glow }, i) => {
      const c = cells[i];
      key.intensity = c ? 6 : 0;
      rim.intensity = c ? 11 : 0;
      glow.visible = !!c;
      if (!c) return;
      key.position.copy(centre(c, 1.6)).add(new T.Vector3(0, 0, 1.1));
      rim.position.copy(centre(c, 2.0)).add(new T.Vector3(0, 0, -0.8));
      glow.position.copy(centre(c, 0.03));
    });
  }
  private readonly lamps: { key: T.PointLight; rim: T.PointLight; glow: T.Mesh }[] = [];

  dispose() {
    SimulationConstructs.clear(this.pieces);
    SimulationConstructs.clear(this.markers);
    SimulationConstructs.clear(this.relation);
    this.group.removeFromParent();
  }

  /**
   * A piece's outline over the real prop that stands there: a permanent one
   * (a wall) in solid lines, one that breaks under a grenade in dashes.
   */
  private block(size: T.Vector3, at: T.Vector3, tone: T.Color, permanent: boolean): T.Object3D {
    const geometry = new T.EdgesGeometry(new T.BoxGeometry(size.x, size.y, size.z));
    const material = permanent
      ? lineGlow(tone, 1.4)
      : new T.LineDashedMaterial({ color: tone.clone().multiplyScalar(1.7), dashSize: 0.16, gapSize: 0.1, toneMapped: false });
    const edges = new T.LineSegments(geometry, material);
    if (!permanent) edges.computeLineDistances();
    edges.position.copy(at);
    return edges;
  }

  /** A shield line on a tile's floor along the side a piece protects. */
  private shield(cell: Cell, side: Side, tone: T.Color) {
    const seat = sideSeat(cell, side);
    const length = CELL * 0.86;
    const geometry = seat.along === "x" ? new T.BoxGeometry(length, 0.02, 0.07) : new T.BoxGeometry(0.07, 0.02, length);
    const line = new T.Mesh(geometry, glow(tone, 2.2));
    line.position.copy(seat.mid).addScaledVector(seat.inward, 0.16).setY(0.02);
    line.userData.tone = tone;
    this.shields.set(`${cell.join()}:${side}`, line);
    this.pieces.add(line);
  }

  private buildPieces(ground: ChainGround, [minX, minZ]: Cell) {
    SimulationConstructs.clear(this.pieces);
    this.shields.clear();
    const p = this.palette;
    const standable = (cell: Cell) => {
      const t = tileAt(ground, cell)?.t;
      return t === "empty" || t === "cover";
    };
    const drawnEdges = new Set<string>();
    for (const piece of coverPieces(ground, minX, minZ)) {
      if (piece.kind === "wall" || piece.kind === "obstacle") {
        const wall = piece.kind === "wall";
        const h = wall ? WALL_H : LOW_H;
        const size = wall ? new T.Vector3(CELL * 0.98, h, CELL * 0.98) : new T.Vector3(CELL * 0.72, h, CELL * 0.72);
        this.pieces.add(this.block(size, centre(piece.cell, h / 2), wall ? p.wall : p.low, wall));
        // Every neighbour the piece stands beside is covered on that side.
        for (const side of SIDES) {
          const [dx, dz] = NEXT[side];
          const next: Cell = [piece.cell[0] + dx, piece.cell[1] + dz];
          if (standable(next)) this.shield(next, BACK[side], wall ? p.wall : p.low);
        }
        continue;
      }
      // An edge: one panel per shared edge, at the higher of its two sides; a shield line per covered tile.
      const tone = piece.level === 2 ? p.high : p.low;
      this.shield(piece.cell, piece.side, tone);
      const [dx, dz] = NEXT[piece.side];
      const other: Cell = [piece.cell[0] + dx, piece.cell[1] + dz];
      const edgeKey = [piece.cell.join(), other.join()].sort().join("|");
      if (drawnEdges.has(edgeKey)) continue;
      drawnEdges.add(edgeKey);
      const otherTile = tileAt(ground, other);
      const otherLevel = otherTile?.t === "cover" ? otherTile.sides[SIDES.indexOf(BACK[piece.side])] : 0;
      const level = Math.max(piece.level, otherLevel);
      const h = level === 2 ? HIGH_H : LOW_H;
      const seat = sideSeat(piece.cell, piece.side);
      const size = seat.along === "x" ? new T.Vector3(CELL * 0.98, h, 0.12) : new T.Vector3(0.12, h, CELL * 0.98);
      this.pieces.add(this.block(size, seat.mid.clone().setY(h / 2), level === 2 ? p.high : p.low, false));
    }
  }

  private buildMarkers(cells: Cell[]) {
    SimulationConstructs.clear(this.markers);
    for (const cell of cells) {
      const ring = new T.Mesh(new T.RingGeometry(0.52, 0.58, 48).rotateX(-Math.PI / 2), glow(this.palette.hostile, 1.6));
      const cross = new T.LineSegments(
        new T.BufferGeometry().setAttribute(
          "position",
          new T.Float32BufferAttribute([-0.72, 0, 0, -0.36, 0, 0, 0.36, 0, 0, 0.72, 0, 0, 0, 0, -0.72, 0, 0, -0.36, 0, 0, 0.36, 0, 0, 0.72], 3),
        ),
        lineGlow(this.palette.hostile, 1.6),
      );
      const g = new T.Group().add(ring, cross);
      g.position.copy(centre(cell, 0.03));
      this.markers.add(g);
    }
  }

  private buildRelation(relation: SimRelation | null) {
    SimulationConstructs.clear(this.relation);
    // Every shield line back to its own tone first.
    for (const line of this.shields.values()) {
      (line.material as T.MeshBasicMaterial).color.copy((line.userData.tone as T.Color).clone().multiplyScalar(2.2));
      line.visible = true;
    }
    if (!relation) return;
    const p = this.palette;
    const from = centre(relation.from, 1.2),
      to = centre(relation.to, 1.2);
    let end = to;
    const edge = relation.cover.edge;
    if (relation.sight && edge) {
      // The line stops on the protecting side: the piece takes the shot.
      const seat = sideSeat(edge.cell, edge.side);
      const mid = seat.mid.clone().setY(1.2);
      const dir = to.clone().sub(from);
      const t = Math.min(1, Math.max(0, mid.clone().sub(from).dot(dir) / dir.lengthSq()));
      end = from.clone().addScaledVector(dir, t);
      const bar =
        seat.along === "x" ? new T.BoxGeometry(CELL * 0.9, 0.06, 0.06) : new T.BoxGeometry(0.06, 0.06, CELL * 0.9);
      const impact = new T.Mesh(bar, glow(relation.cover.value >= 50 ? p.high : p.low, 3.2));
      impact.position.copy(seat.mid).setY(relation.cover.value >= 50 ? HIGH_H : LOW_H);
      this.relation.add(impact);
      const lit = this.shields.get(`${edge.cell.join()}:${edge.side}`) ?? this.shields.get(`${relation.to.join()}:${edge.side}`);
      if (lit) (lit.material as T.MeshBasicMaterial).color.copy(p.high.clone().multiplyScalar(3.4));
    } else {
      // Flanked or out of sight: the operator's own shield lines go dark.
      for (const side of SIDES) {
        const line = this.shields.get(`${relation.to.join()}:${side}`);
        if (line) line.visible = false;
      }
    }
    const geometry = new T.BufferGeometry().setFromPoints([from, end]);
    const material = relation.sight
      ? lineGlow(p.hostile, 2)
      : new T.LineDashedMaterial({ color: p.hostile.clone().multiplyScalar(1.2), dashSize: 0.25, gapSize: 0.2, toneMapped: false });
    const line = new T.Line(geometry, material);
    if (!relation.sight) line.computeLineDistances();
    this.relation.add(line);
  }
}
