// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The layout view: the level as the rules see it, drawn over the field in place
 * of its dressed scenery (the battlefield hides that while this is on), with
 * tiles to point at and copy. Every tile is drawn by its rule type from the
 * same `ChainGround` the encounter plays by, in the training simulation's
 * schematic look (`schematic.ts`):
 *
 * - Empty and Cover tiles: a floor slab; a tile side with cover: a thin panel
 *   on that edge (low: waist high, dimmed accent; high: full height, accent)
 *   and a glowing line on the floor along the side it protects.
 * - Wall: a full-height block, dark and half see-through so units behind it
 *   show, with bright edges. Obstacle: a waist-high block in the dimmed accent.
 *   Unwalkable: a flat hatched tile in the hostile tone, no height.
 * - Spawns A and B marked, column and row numbers along the north and west
 *   edges in the level file's own coordinates (`layout-readout.ts`).
 *
 * Whole kinds are instanced (a draw call each), the grid and the panel edges
 * are line segments, the numbers sprites: far fewer draw calls than the dressed
 * scene. Picking is by raycast against the blocks, else the floor plane. Pure
 * readouts and the copied text are `layout-readout.ts`.
 */
import * as T from "three";
import type { ChainGround, Ground } from "../chain-ground.ts";
import type { Level } from "../editor/level.ts";
import { groundAfter, type Side } from "../guide/cover.ts";
import type { GameEvent } from "../events.ts";
import { addRect, coverEdges, edgeCover, rectCells, tileInfo, toggleCell, type LayoutCell, type TileInfo } from "../layout-readout.ts";
import { CELL } from "../map.ts";
import { glow, lineGlow, sideSeat, simPalette, type SimPalette } from "./schematic.ts";

/** Heights in metres, as the owner reads them: a wall and a high side stand over a unit, low cover to the waist. */
const WALL_H = 2.4,
  HIGH_H = 2.4,
  LOW_H = 1;
const SLAB = 0.14;

const same = (a: LayoutCell, b: LayoutCell) => a[0] === b[0] && a[1] === b[1];

/** The eight corners' twelve edges of a box centred at (x, z) on the floor, as line segment points. */
function boxEdges(out: number[], x: number, z: number, sx: number, h: number, sz: number) {
  const [x0, x1, z0, z1] = [x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2];
  const c = (px: number, py: number, pz: number) => [px, py, pz];
  const corners = [
    c(x0, 0, z0), c(x1, 0, z0), c(x1, 0, z1), c(x0, 0, z1),
    c(x0, h, z0), c(x1, h, z0), c(x1, h, z1), c(x0, h, z1),
  ];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...corners[a], ...corners[b]);
}

const lines = (points: number[], material: T.Material) =>
  new T.LineSegments(new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3)), material);

const unitBox = () => new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** A text label as a sprite: unlit, no fog, drawn over the blocks. */
function label(text: string, color: string, size: number, bold = false): T.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.font = `${bold ? 700 : 500} ${text.length > 2 ? 30 : 38}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 32, 34);
  }
  const material = new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const sprite = new T.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** A diagonal hatch for the unwalkable tiles. */
function hatch(tone: T.Color, ground: T.Color): T.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = `#${ground.getHexString()}`;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = `#${tone.getHexString()}`;
    g.lineWidth = 6;
    for (let i = -64; i <= 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 64);
      g.lineTo(i + 64, 0);
      g.stroke();
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

export interface LayoutOptions {
  ground: Ground;
  /** The level the ground came from, for what is placed where; null when the scene has none. */
  level: Level | null;
  onChange: () => void;
}

export class LayoutView {
  readonly group = new T.Group();
  /** The tiles picked, in the order they were picked. */
  selection: LayoutCell[] = [];
  hover: LayoutCell | null = null;
  /** The rectangle being dragged out. */
  preview: LayoutCell[] | null = null;
  readonly level: Level | null;
  /** The rules' tiles now, as `tiles[y][x]`. */
  tiles: ChainGround["tiles"];
  private readonly base: Ground;
  private readonly onChange: () => void;
  private readonly palette: SimPalette = simPalette();
  private readonly minX: number;
  private readonly minZ: number;
  private readonly width: number;
  private readonly depth: number;
  private readonly tileGroup = new T.Group();
  private readonly marks = new T.Group();
  private blocks: { mesh: T.InstancedMesh; cells: LayoutCell[] }[] = [];
  private blasts = -1;
  private dragFrom: LayoutCell | null = null;
  private anchor: LayoutCell | null = null;

  constructor({ ground, level, onChange }: LayoutOptions) {
    this.base = ground;
    this.level = level;
    this.onChange = onChange;
    this.minX = ground.minX;
    this.minZ = ground.minZ;
    this.depth = ground.tiles.length;
    this.width = ground.tiles[0]?.length ?? 0;
    this.tiles = ground.tiles;
    this.group.name = "Layout";
    this.group.add(this.tileGroup, this.marks);
    this.buildFixed();
    this.buildMarks();
  }

  /** The world point of a tile's centre. */
  private world([x, y]: LayoutCell, h = 0) {
    return new T.Vector3((x + this.minX) * CELL, h, (y + this.minZ) * CELL);
  }

  /** Follow the grenades that have gone off: they clear cover tiles. True when the picture changed. */
  sync(events: readonly GameEvent[]): boolean {
    const blasts = events.reduce((n, e) => n + (e.type === "grenade" ? 1 : 0), 0);
    if (blasts === this.blasts) return false;
    this.blasts = blasts;
    const now = groundAfter(this.base, events);
    this.tiles = now.tiles;
    this.buildTiles();
    return true;
  }

  // === Drawing ===

  private static clear(group: T.Object3D) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const mesh = o as T.Mesh & T.Sprite;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of materials) {
          (m as T.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
    }
  }

  /** What never changes: the grid, the column and row numbers, the spawn marks. */
  private buildFixed() {
    const p = this.palette;
    const fixed = new T.Group();
    const grid: number[] = [];
    const h = CELL / 2,
      y = 0.07;
    for (let r = 0; r < this.depth; r++)
      for (let c = 0; c < this.width; c++) {
        const [x, z] = [(c + this.minX) * CELL, (r + this.minZ) * CELL];
        grid.push(x - h, y, z - h, x + h, y, z - h, x + h, y, z - h, x + h, y, z + h);
        grid.push(x + h, y, z + h, x - h, y, z + h, x - h, y, z + h, x - h, y, z - h);
      }
    fixed.add(lines(grid, lineGlow(p.grid, 1.2)));
    // The numbers, in the level file's axes: x along the north edge, y down the west edge.
    // x in the accent tone, y in the wall's, so the two rows of numbers never read as one.
    const [xTone, yTone] = [`#${p.high.getHexString()}`, `#${p.wall.getHexString()}`];
    for (let c = 0; c < this.width; c++) {
      const s = label(`${c}`, xTone, 0.8);
      s.position.copy(this.world([c, 0], 0.15)).setZ((this.minZ - 1) * CELL);
      fixed.add(s);
    }
    for (let r = 0; r < this.depth; r++) {
      const s = label(`${r}`, yTone, 0.8);
      s.position.copy(this.world([0, r], 0.15)).setX((this.minX - 1) * CELL);
      fixed.add(s);
    }
    // The axes named past their last number.
    const xName = label("x", xTone, 0.9, true);
    xName.position.copy(this.world([this.width, 0], 0.15)).setZ((this.minZ - 1) * CELL);
    const yName = label("y", yTone, 0.9, true);
    yName.position.copy(this.world([0, this.depth], 0.15)).setX((this.minX - 1) * CELL);
    fixed.add(xName, yName);
    if (this.level) {
      for (const [side, cells, color] of [
        ["A", this.level.spawns.a, p.high],
        ["B", this.level.spawns.b, p.hostile],
      ] as const)
        for (const cell of cells) {
          const ring = new T.Mesh(new T.RingGeometry(0.46, 0.54, 40).rotateX(-Math.PI / 2), glow(color, 1.8));
          ring.position.copy(this.world(cell, 0.1));
          const s = label(side, `#${color.getHexString()}`, 0.75, true);
          // At the tile's corner and low, clear of the unit standing on it and its name plate.
          s.position.copy(this.world(cell, 0.12)).add(new T.Vector3(0.42, 0, 0.42));
          fixed.add(ring, s);
        }
    }
    this.group.add(fixed);
  }

  /** The tiles by rule type; rebuilt when a blast clears cover. */
  private buildTiles() {
    LayoutView.clear(this.tileGroup);
    this.blocks = [];
    const p = this.palette;
    const floors: LayoutCell[] = [],
      pits: LayoutCell[] = [],
      walls: LayoutCell[] = [],
      obstacles: LayoutCell[] = [];
    const edges: { cell: LayoutCell; side: Side; level: 1 | 2 }[] = coverEdges(this.tiles).map((e) => ({ cell: e.cell, side: e.side === "N" ? "top" : "left", level: e.level }));
    const shields: { cell: LayoutCell; side: Side; level: 1 | 2 }[] = [];
    const COMPASS: [Side, "N" | "E" | "S" | "W"][] = [["left", "W"], ["top", "N"], ["right", "E"], ["bottom", "S"]];
    this.tiles.forEach((row, y) =>
      row.forEach((tile, x) => {
        const cell: LayoutCell = [x, y];
        if (tile.t === "wall") walls.push(cell);
        else if (tile.t === "unwalkable") pits.push(cell);
        else {
          floors.push(cell);
          if (tile.t === "obstacle") obstacles.push(cell);
          // The protected side: where an edge has cover, whichever of the two tiles holds the piece.
          else
            for (const [side, compass] of COMPASS) {
              const level = edgeCover(this.tiles, cell, compass);
              if (level === 1 || level === 2) shields.push({ cell, side, level });
            }
        }
      }),
    );
    const m = new T.Matrix4(),
      q = new T.Quaternion(),
      one = new T.Vector3(1, 1, 1);
    const put = (mesh: T.InstancedMesh, i: number, at: T.Vector3, scale: T.Vector3, turn = 0) => {
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), turn);
      mesh.setMatrixAt(i, m.compose(at, q, scale));
    };
    const instanced = (geometry: T.BufferGeometry, material: T.Material, n: number) => {
      const mesh = new T.InstancedMesh(geometry, material, Math.max(n, 1));
      mesh.count = n;
      mesh.frustumCulled = false;
      this.tileGroup.add(mesh);
      return mesh;
    };
    const solid = (color: T.Color, opacity: number) =>
      new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false, fog: false });

    // Floors: the tone of an empty tile.
    const floor = instanced(new T.BoxGeometry(CELL * 0.97, 0.06, CELL * 0.97).translate(0, -0.03, 0), solid(p.floor.clone().lerp(p.wall, 0.2), 1), floors.length);
    floors.forEach((c, i) => put(floor, i, this.world(c), one));
    // Unwalkable: flat, hatched in the hostile tone.
    const pitMesh = instanced(
      new T.PlaneGeometry(CELL * 0.97, CELL * 0.97).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      new T.MeshBasicMaterial({ map: hatch(p.hostile.clone().multiplyScalar(0.8), p.floor.clone().lerp(p.hostile, 0.22)), toneMapped: false, fog: false }),
      pits.length,
    );
    pits.forEach((c, i) => put(pitMesh, i, this.world(c), one));
    const outline: Record<string, number[]> = { wall: [], obstacle: [], low: [], high: [] };
    // Walls: tall, dark, half see-through.
    const wallMesh = instanced(unitBox(), solid(p.void.clone().lerp(p.wall, 0.1), 0.72), walls.length);
    walls.forEach((c, i) => {
      const at = this.world(c);
      put(wallMesh, i, at, new T.Vector3(CELL * 0.98, WALL_H, CELL * 0.98));
      boxEdges(outline.wall, at.x, at.z, CELL * 0.98, WALL_H, CELL * 0.98);
    });
    this.blocks.push({ mesh: wallMesh, cells: walls });
    // Obstacles: waist high, in the dimmed accent.
    const obstacleMesh = instanced(unitBox(), solid(p.low.clone().lerp(p.void, 0.35), 0.6), obstacles.length);
    obstacles.forEach((c, i) => {
      const at = this.world(c);
      put(obstacleMesh, i, at, new T.Vector3(CELL * 0.72, LOW_H, CELL * 0.72));
      boxEdges(outline.obstacle, at.x, at.z, CELL * 0.72, LOW_H, CELL * 0.72);
    });
    this.blocks.push({ mesh: obstacleMesh, cells: obstacles });
    // Edge panels: thin, low or high, on the shared edge.
    for (const level of [1, 2] as const) {
      const list = edges.filter((e) => e.level === level);
      const h = level === 2 ? HIGH_H : LOW_H;
      const mesh = instanced(unitBox(), solid(level === 2 ? p.high.clone().lerp(p.void, 0.3) : p.low.clone().lerp(p.void, 0.3), level === 2 ? 0.6 : 0.8), list.length);
      list.forEach((e, i) => {
        const seat = sideSeat([e.cell[0] + this.minX, e.cell[1] + this.minZ], e.side);
        const [sx, sz] = seat.along === "x" ? [CELL * 0.98, SLAB] : [SLAB, CELL * 0.98];
        put(mesh, i, seat.mid.clone().setY(0), new T.Vector3(sx, h, sz));
        boxEdges(outline[level === 2 ? "high" : "low"], seat.mid.x, seat.mid.z, sx, h, sz);
      });
    }
    // The protected side: a line on the floor of each tile along a side with cover, in the piece's tone.
    for (const level of [1, 2] as const) {
      const list = shields.filter((s) => s.level === level);
      const mesh = instanced(unitBox(), glow(level === 2 ? p.high : p.low, 2.2), list.length);
      list.forEach((s, i) => {
        const seat = sideSeat([s.cell[0] + this.minX, s.cell[1] + this.minZ], s.side);
        const at = seat.mid.clone().addScaledVector(seat.inward, 0.16).setY(0.05);
        const length = CELL * 0.86;
        put(mesh, i, at, seat.along === "x" ? new T.Vector3(length, 0.02, 0.07) : new T.Vector3(0.07, 0.02, length));
      });
    }
    this.tileGroup.add(
      lines(outline.wall, lineGlow(p.wall, 1.2)),
      lines(outline.obstacle, lineGlow(p.low, 1.4)),
      lines(outline.low, lineGlow(p.low, 1.6)),
      lines(outline.high, lineGlow(p.high, 1.6)),
    );
    this.group.updateMatrixWorld(true);
  }

  /** The hover, the dragged rectangle and the selection: rebuilt on every change, a handful of quads. */
  private buildMarks() {
    LayoutView.clear(this.marks);
    const p = this.palette;
    const layer = (cells: readonly LayoutCell[], color: T.Color, strength: number, fill: number, y: number) => {
      if (!cells.length) return;
      const h = CELL / 2;
      const edge: number[] = [],
        quads: number[] = [];
      for (const cell of cells) {
        const { x, z } = this.world(cell);
        edge.push(x - h, y, z - h, x + h, y, z - h, x + h, y, z - h, x + h, y, z + h, x + h, y, z + h, x - h, y, z + h, x - h, y, z + h, x - h, y, z - h);
        quads.push(x - h, y, z - h, x - h, y, z + h, x + h, y, z + h, x - h, y, z - h, x + h, y, z + h, x + h, y, z - h);
      }
      this.marks.add(lines(edge, lineGlow(color, strength)));
      if (fill > 0) {
        const mesh = new T.Mesh(
          new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(quads, 3)),
          new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(strength), transparent: true, opacity: fill, depthWrite: false, toneMapped: false, fog: false, side: T.DoubleSide }),
        );
        this.marks.add(mesh);
      }
    };
    layer(this.selection, p.wall, 2.6, 0.32, 0.12);
    if (this.preview) layer(this.preview, p.high, 2.2, 0.2, 0.13);
    else if (this.hover) layer([this.hover], p.high, 2.4, 0.16, 0.13);
  }

  private changed() {
    this.buildMarks();
    this.onChange();
  }

  // === Picking and selecting ===

  /** The tile under a ray: a block it hits before the floor, else the floor. */
  pick(ray: T.Raycaster): LayoutCell | null {
    this.group.updateMatrixWorld(true);
    const floor = new T.Vector3();
    const onFloor = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), floor);
    let best: { distance: number; cell: LayoutCell } | null = null;
    for (const { mesh, cells } of this.blocks) {
      if (!cells.length) continue;
      const hit = ray.intersectObject(mesh, false)[0];
      if (hit && hit.instanceId !== undefined && (!best || hit.distance < best.distance)) best = { distance: hit.distance, cell: cells[hit.instanceId] };
    }
    if (best && (!onFloor || best.distance < ray.ray.origin.distanceTo(floor))) return best.cell;
    if (!onFloor) return null;
    const cell: LayoutCell = [Math.round(floor.x / CELL) - this.minX, Math.round(floor.z / CELL) - this.minZ];
    return cell[0] >= 0 && cell[0] < this.width && cell[1] >= 0 && cell[1] < this.depth ? cell : null;
  }

  pointerDown(cell: LayoutCell | null) {
    this.dragFrom = cell;
  }

  pointerMove(cell: LayoutCell | null) {
    const was = this.hover;
    this.hover = cell;
    if (this.dragFrom && cell && !same(this.dragFrom, cell)) this.preview = rectCells(this.dragFrom, cell);
    else if (this.preview) this.preview = null;
    else if (was && cell && same(was, cell)) return;
    else if (!was && !cell) return;
    this.changed();
  }

  /**
   * A release: a Shift-drag selects the region it covered; a click (no drag)
   * toggles the tile, or with Shift selects from the last one picked. A drag
   * without Shift was the camera's and picks nothing.
   */
  pointerUp(cell: LayoutCell | null, shift: boolean, click: boolean) {
    const from = this.dragFrom;
    this.dragFrom = null;
    this.preview = null;
    if (cell) {
      if (from && !same(from, cell)) {
        this.selection = addRect(this.selection, from, cell);
        this.anchor = cell;
      } else if (click) {
        if (shift && this.anchor && !same(this.anchor, cell)) this.selection = addRect(this.selection, this.anchor, cell);
        else this.selection = toggleCell(this.selection, cell);
        this.anchor = cell;
      }
    }
    this.changed();
  }

  /** The pointer left the field: no hover, no drag in progress. */
  pointerLeave() {
    this.dragFrom = null;
    this.preview = null;
    this.hover = null;
    this.changed();
  }

  clearSelection() {
    this.selection = [];
    this.anchor = null;
    this.changed();
  }

  /** The tile under the pointer as the rules and the level have it, for the readout. */
  info(cell: LayoutCell | null): TileInfo | null {
    return cell ? tileInfo(this.tiles, this.level, cell) : null;
  }

  dispose() {
    LayoutView.clear(this.group);
    this.group.removeFromParent();
  }

  /** Build the tiles for the first time (the grenades so far already played out). */
  start(events: readonly GameEvent[]) {
    this.blasts = -1;
    this.sync(events);
  }
}
