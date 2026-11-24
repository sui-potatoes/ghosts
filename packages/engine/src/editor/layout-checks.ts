// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Layout common sense for a level: the faults a person finds by walking it
 * (a sealed room, a fridge nobody can stand in front of, a car that stops
 * every shot, a wall that is really a prop) as checks any shipped level must
 * pass. Three-free: the rules read the exported tile grid (`toMoveMap`), the
 * placements and the catalogue, and walk it with `ChainGround`, the
 * TypeScript copy of the Move rules. What only a model can tell (an asset's
 * real height, whether it carries a light) comes in through `LayoutOptions`,
 * measured by the caller; a rule with nothing to go on stays quiet rather
 * than guess.
 *
 * Terms: a tile is *standable* when a unit may end a move on it (Empty or
 * Cover). A *region* is a set of standable tiles joined by steps, a step
 * crossing no high side and hopping at most one Obstacle.
 */
import { assetByUid, floorByUid, type AssetSpec } from "../catalog.ts";
import { ChainGround } from "../chain-ground.ts";
import type { Cell } from "../map.ts";
import { buildingBlocks } from "./buildings.ts";
import {
  edgeCells, edgeKey, floorRaise, inLevel, placementCells, toMoveMap, type Level, type Placement, type Side, type Turn,
} from "./level.ts";

export interface Problem {
  rule: string;
  at?: Cell;
  message: string;
}

/** What a level may hold before the scene gets slow: placements, distinct asset kinds, point lights. */
export const LAYOUT_BUDGET = { placements: 200, kinds: 60, lights: 16 } as const;
export type Budget = { [K in keyof typeof LAYOUT_BUDGET]: number };

/** Metres: low cover stands between these, anything that is a wall or a high side from `WALL_MIN` up, nothing blocks below `BLOCK_MIN`. */
export const HEIGHTS = { lowMin: 0.5, lowMax: 1.6, wallMin: 1.6, blockMin: 0.4 } as const;
/** A unit may open at most this many steps from its squad mates. */
export const SPAWN_SPREAD = 8;
/** Cover (any side of a standable tile) must lie within this many tiles of a side's deployment. */
export const SPAWN_COVER = 3;

export interface LayoutOptions {
  /** Real height in metres by asset uid, measured from the model (`cover-height` skips what is missing). */
  heights?: ReadonlyMap<string, number>;
  /** Uids of assets that carry a point light in play (counted by `budget` with the level's own lights). */
  lights?: ReadonlySet<string>;
  /** Limits to hold the level to, over `LAYOUT_BUDGET`. */
  budget?: Partial<Budget>;
  /** Manhattan reach at which a clear line is a shot on turn zero. */
  shotReach?: number;
  /** Manhattan reach of a grenade from a spawn. */
  throwReach?: number;
}

const N4: readonly Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (c: readonly number[]) => `${c[0]},${c[1]}`;

// ---------------------------------------------------------------------------
// What the catalogue says an asset is.

/**
 * Wall-backed fixtures have a front: the piece stands against a wall (`turn`
 * names it: 0 north, 1 west, 2 south, 3 east) and is used from the cell
 * opposite. The catalogue carries no flag, so the family is named here by
 * kind: the fridge, chiller, wall-shelf and back-bar runs, the store's
 * built-ins (fridges, chillers, shelves, cigarettes, ATM, terminal, copier,
 * stock), vending machines, AC condensers and the recycling bank.
 */
const FRONTED = /^shop-(?:fridge|chiller|wall-shelf|back-bar)-|^shop-building-wall-(?:fridge|chiller|shelf|cigarettes|atm|terminal|copier|stock)|^shop-vending-|^shop-ac-|^shop-bin-bank$/;

export function hasFront(spec: AssetSpec): boolean {
  return !spec.place && spec.footprint !== "none" && FRONTED.test(spec.kind);
}

/** The cell a wall-backed piece is used from, opposite the wall `turn` names. */
export function frontCell(at: Cell, turn: Turn): Cell {
  return turn === 0 ? [at[0], at[1] + 1] : turn === 1 ? [at[0] + 1, at[1]] : turn === 2 ? [at[0], at[1] - 1] : [at[0] - 1, at[1]];
}

/** A door, a doorway curtain: an open edge piece (no footprint, not wall-mounted) the catalogue calls a door. */
export function isDoor(spec: AssetSpec): boolean {
  return spec.place === "edge" && spec.footprint === "none" && !spec.mount && /\bdoor/.test(`${spec.kind} ${spec.tags ?? ""}`);
}

/** A cell piece that is a vehicle: low rim round its footprint. */
const isVehicle = (spec: AssetSpec) => !spec.place && !!spec.lowRim;

// ---------------------------------------------------------------------------
// The level as the rules walk it.

interface Ctx {
  level: Level;
  options: LayoutOptions;
  tiles: ReturnType<typeof toMoveMap>["tiles"];
  ground: ChainGround;
  /** Edge keys that carry a door. */
  doors: Set<string>;
  placed: { p: Placement; spec: AssetSpec }[];
}

const tileOf = (ctx: Ctx, c: Cell) => (inLevel(ctx.level, c) ? ctx.tiles[c[1]][c[0]] : undefined);
const standable = (ctx: Ctx, c: Cell) => {
  const t = tileOf(ctx, c)?.t;
  return t === "empty" || t === "cover";
};
const isWall = (ctx: Ctx, c: Cell) => tileOf(ctx, c)?.t === "wall";

/** The edge between two neighbouring cells, named as `edgeKey` does. */
function edgeBetween(a: Cell, b: Cell): string {
  if (b[1] < a[1]) return `${a.join()}:n`;
  if (b[1] > a[1]) return `${b.join()}:n`;
  return b[0] < a[0] ? `${a.join()}:w` : `${b.join()}:w`;
}

function context(level: Level, options: LayoutOptions): Ctx {
  const { tiles } = toMoveMap(level);
  const placed = level.placements.flatMap((p) => {
    const spec = assetByUid(p.asset);
    return spec ? [{ p, spec }] : [];
  });
  const doors = new Set<string>();
  for (const { p, spec } of placed) if (isDoor(spec)) doors.add(edgeKey(p.at, p.turn));
  return { level, options, tiles, ground: new ChainGround({ tiles, minX: 0, minZ: 0 }), doors, placed };
}

/**
 * Regions of standable tiles: joined by a step (`ChainGround.step`), hopping
 * at most one Obstacle when `hop`, and with every door edge a barrier when
 * `sealDoors` (what a room is, as opposed to the street round it).
 */
function regions(ctx: Ctx, hop: boolean, sealDoors: boolean): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let n = k; n !== root; ) { const next = parent.get(n)!; parent.set(n, root); n = next; }
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const open = (a: Cell, b: Cell) => ctx.ground.step(a, b) && !(sealDoors && ctx.doors.has(edgeBetween(a, b)));
  const cells: Cell[] = [];
  for (let z = 0; z < ctx.level.depth; z++) for (let x = 0; x < ctx.level.width; x++) if (standable(ctx, [x, z])) {
    cells.push([x, z]);
    parent.set(key([x, z]), key([x, z]));
  }
  for (const a of cells) for (const [dx, dz] of N4) {
    const n: Cell = [a[0] + dx, a[1] + dz];
    if (!open(a, n)) continue;
    if (standable(ctx, n)) union(key(a), key(n));
    else if (hop && tileOf(ctx, n)?.t === "obstacle")
      for (const [ex, ez] of N4) {
        const m: Cell = [n[0] + ex, n[1] + ez];
        if (key(m) !== key(a) && standable(ctx, m) && open(n, m)) union(key(a), key(m));
      }
  }
  const ids = new Map<string, number>(), out = new Map<string, number>();
  for (const c of cells) {
    const root = find(key(c));
    if (!ids.has(root)) ids.set(root, ids.size);
    out.set(key(c), ids.get(root)!);
  }
  return out;
}

/** The regions as lists of cells, largest first. */
function groups(map: Map<string, number>): Cell[][] {
  const lists: Cell[][] = [];
  for (const [k, id] of map) (lists[id] ??= []).push(k.split(",").map(Number) as unknown as Cell);
  return lists.sort((a, b) => b.length - a.length);
}

const spawnsOf = (ctx: Ctx, side: Side) => ctx.level.spawns[side].filter((c) => standable(ctx, c));

// ---------------------------------------------------------------------------
// Rules. Each returns its problems; the name is the rule.

/**
 * Rooms are the regions left when doors are walls. Apart from the largest
 * (the street, the outdoors) a region with no door anywhere on its edge and no
 * deployment in it is sealed; one with a door must hold furniture, or it is a
 * pointless empty room.
 */
function enclosedRoom(ctx: Ctx): Problem[] {
  const rule = "enclosed-room", out: Problem[] = [];
  const map = regions(ctx, true, true), lists = groups(map);
  const spawned = new Set([...ctx.level.spawns.a, ...ctx.level.spawns.b].map(key));
  for (const cells of lists.slice(1)) {
    const mine = new Set(cells.map(key));
    const doored = [...ctx.doors].some((k) => {
      const [cell, side] = k.split(":"), [x, z] = cell.split(",").map(Number);
      const [a, b] = side === "n" ? [[x, z], [x, z - 1]] : [[x, z], [x - 1, z]];
      return mine.has(key(a)) || mine.has(key(b));
    });
    if (cells.some((c) => spawned.has(key(c)))) continue;
    if (!doored) {
      out.push({ rule, at: cells[0], message: `a sealed room of ${cells.length} tiles with no door or opening` });
      continue;
    }
    // Furniture: a blocking cell piece in the room or against it, or a wall-backed fixture on its wall.
    const furnished = ctx.placed.some(({ p, spec }) => {
      if (spec.place || spec.footprint === "none" || (spec.footprint === "solid" && !hasFront(spec))) return false;
      return placementCells(spec, p).some((c) => mine.has(key(c)) || N4.some(([dx, dz]) => mine.has(key([c[0] + dx, c[1] + dz]))));
    });
    if (!furnished) out.push({ rule, at: cells[0], message: `an empty room of ${cells.length} tiles: nothing stands in it` });
  }
  return out;
}

/** Every standable tile can be reached from both deployments, one problem per cut-off region. */
function reachable(ctx: Ctx): Problem[] {
  const out: Problem[] = [], map = regions(ctx, true, false), lists = groups(map);
  for (const side of ["a", "b"] as const) {
    const reached = new Set(spawnsOf(ctx, side).map((c) => map.get(key(c))));
    if (!reached.size) continue;
    for (const cells of lists)
      if (!reached.has(map.get(key(cells[0])))) out.push({ rule: "reachable", at: cells[0], message: `${cells.length} walkable tiles cannot be reached from side ${side.toUpperCase()}` });
  }
  return out;
}

/** A wall-backed fixture's front is a standable tile reached from both deployments without hopping an Obstacle. */
function fixtureFront(ctx: Ctx): Problem[] {
  const out: Problem[] = [], rule = "fixture-front";
  const walk = regions(ctx, false, false);
  const sides = (["a", "b"] as const).map((s) => new Set(spawnsOf(ctx, s).map((c) => walk.get(key(c))))).filter((s) => s.size);
  for (const { p, spec } of ctx.placed) {
    if (!hasFront(spec)) continue;
    const front = frontCell(p.at, p.turn);
    const label = `${spec.name} (${p.asset}) at ${p.at}, its front ${front}`;
    if (!standable(ctx, front)) out.push({ rule, at: p.at, message: `${label} is not a tile anyone can stand on` });
    else if (!sides.every((s) => s.has(walk.get(key(front)))))
      out.push({ rule, at: p.at, message: `${label} cannot be reached from every deployment without hopping an obstacle` });
  }
  return out;
}

/**
 * An asset's play class agrees with its height: low cover (a cover cell or
 * edge, a low rim) between `lowMin` and `lowMax`, a Wall or a high side at least
 * `wallMin`, anything that blocks at all at least `blockMin`. One problem per
 * asset, at its first placement.
 */
function coverHeight(ctx: Ctx): Problem[] {
  const heights = ctx.options.heights, out: Problem[] = [], rule = "cover-height";
  if (!heights) return out;
  const seen = new Set<string>();
  for (const { p, spec } of ctx.placed) {
    const h = heights.get(p.asset);
    if (h === undefined || seen.has(p.asset) || spec.footprint === "none") continue;
    seen.add(p.asset);
    const high = spec.footprint === "solid" || (spec.place === "edge" && spec.footprint === "obstacle");
    const low = spec.footprint === "cover" || !!spec.lowRim;
    const say = (why: string) => out.push({ rule, at: p.at, message: `${spec.name} (${p.asset}) is ${h.toFixed(2)} m tall: ${why}` });
    if (h < HEIGHTS.blockMin) say(`too low to block or give cover (under ${HEIGHTS.blockMin} m)`);
    else if (low && !high && h < HEIGHTS.lowMin) say(`too low for cover (under ${HEIGHTS.lowMin} m)`);
    else if (low && !high && h > HEIGHTS.lowMax) say(`low cover must be under ${HEIGHTS.lowMax} m: it is full height`);
    else if (high && h < HEIGHTS.wallMin) say(`a wall or high side must be at least ${HEIGHTS.wallMin} m`);
  }
  return out;
}

/** Nothing shares a cell or an edge it should not, and a vehicle stands on one level of street floor. */
function overlap(ctx: Ctx): Problem[] {
  const out: Problem[] = [], rule = "overlap";
  const cells = new Map<string, string>(), edges = new Map<string, string>();
  const unwalkable = new Set(ctx.level.unwalkable.map(key));
  const interior = new Set(buildingBlocks(ctx.level).blocks.flatMap((b) => b.interior.map(key)));
  for (const { p, spec } of ctx.placed) {
    if (spec.footprint === "none" || spec.mount) continue;
    if (spec.place === "edge") {
      const k = edgeKey(p.at, p.turn), other = edges.get(k);
      if (other) out.push({ rule, at: p.at, message: `${spec.name} (${p.asset}) shares an edge with ${other}` });
      else edges.set(k, `${spec.name} (${p.asset}) at ${p.at}`);
      continue;
    }
    for (const c of placementCells(spec, p)) {
      const other = cells.get(key(c));
      if (other) out.push({ rule, at: c, message: `${spec.name} (${p.asset}) at ${p.at} shares tile ${c} with ${other}` });
      else cells.set(key(c), `${spec.name} (${p.asset}) at ${p.at}`);
      if (unwalkable.has(key(c)))
        out.push({ rule, at: c, message: `${spec.name} (${p.asset}) at ${p.at} stands on unwalkable tile ${c}${interior.has(key(c)) ? " inside a building" : ""}` });
    }
  }
  for (const { p, spec } of ctx.placed) {
    if (!isVehicle(spec)) continue;
    const own = placementCells(spec, p);
    const raises = new Set(own.map((c) => floorRaise(ctx.level, c)));
    if (raises.size > 1) out.push({ rule, at: p.at, message: `${spec.name} (${p.asset}) at ${p.at} straddles floors of different height` });
    const paved = own.every((c) => {
      const tile = ctx.level.floors.find((f) => key(f.at) === key(c));
      return !!(tile && floorByUid(tile.floor)?.street);
    });
    if (!paved) out.push({ rule, at: p.at, message: `${spec.name} (${p.asset}) at ${p.at} is not parked on road or car-park floor` });
  }
  return out;
}

/** Every Wall tile is part of a building (a mass, a shell or its built-ins): a prop must never export as Wall. */
function wallsAreBuildings(ctx: Ctx): Problem[] {
  const owned = new Set(buildingBlocks(ctx.level).blocks.flatMap((b) => b.cells.map(key)));
  const out: Problem[] = [];
  ctx.tiles.forEach((row, z) => row.forEach((t, x) => {
    if (t.t !== "wall" || owned.has(key([x, z]))) return;
    const by = ctx.placed.filter(({ p, spec }) => !spec.place && spec.footprint === "solid" && placementCells(spec, p).some((c) => c[0] === x && c[1] === z));
    const names = by.map(({ p, spec }) => `${spec.name} (${p.asset})`).join(", ") || "no placement";
    out.push({ rule: "walls-are-buildings", at: [x, z], message: `Wall tile at ${x},${z} belongs to no building: ${names}` });
  }));
  return out;
}

/**
 * Edge pieces sit on boundaries that make sense: a wall, glass or fence piece
 * needs something to divide (not two Wall or unwalkable tiles, or the outside:
 * props on either side may be cleared, so an Obstacle tile counts as ground),
 * and a door joins two standable tiles with a step through it and no cover
 * across it. A door hung on the face of a building nobody enters (a noren on a
 * closed mass) is dressing and is left alone.
 */
function edgeOnBoundary(ctx: Ctx): Problem[] {
  const out: Problem[] = [], rule = "edge-on-boundary";
  const closed = new Set(buildingBlocks(ctx.level).blocks.filter((b) => !b.shell).flatMap((b) => b.cells.map(key)));
  const blocked = (c: Cell) => { const t = tileOf(ctx, c)?.t; return !t || t === "wall" || t === "unwalkable"; };
  for (const { p, spec } of ctx.placed) {
    if (spec.place !== "edge" || spec.mount) continue;
    const [a, b] = edgeCells(p.at, p.turn);
    const name = `${spec.name} (${p.asset}) at ${p.at}`;
    if (spec.footprint === "solid" || spec.footprint === "obstacle") {
      if (blocked(a) && blocked(b)) out.push({ rule, at: p.at, message: `${name} stands between ${a} and ${b}, both walls, pits or outside the grid` });
    } else if (isDoor(spec) && !closed.has(key(a)) && !closed.has(key(b))) {
      if (!standable(ctx, a) || !standable(ctx, b)) out.push({ rule, at: p.at, message: `${name} does not open onto standable ground (${a} | ${b})` });
      else if (!ctx.ground.step(a, b) || !ctx.ground.step(b, a)) out.push({ rule, at: p.at, message: `${name} cannot be walked through: a high side crosses it` });
      else if (ctx.ground.cover(b, a) || ctx.ground.cover(a, b)) out.push({ rule, at: p.at, message: `${name} carries cover across the doorway` });
    }
  }
  return out;
}

/**
 * The opening: each spawn standable, a side's spawns close together, no side
 * with a clear shot or throw at the other on turn zero, and cover near every
 * side's spawns.
 */
function spawnSanity(ctx: Ctx): Problem[] {
  const out: Problem[] = [], rule = "spawn-sanity", { level, ground } = ctx;
  const shot = ctx.options.shotReach ?? 11, throwReach = ctx.options.throwReach ?? 7;
  for (const side of ["a", "b"] as const) for (const c of level.spawns[side])
    if (!standable(ctx, c)) out.push({ rule, at: c, message: `side ${side.toUpperCase()} spawns on ${c}, which is not standable` });
  const steps = (from: Cell) => {
    const dist = new Map<string, number>([[key(from), 0]]), queue = [from];
    while (queue.length) {
      const c = queue.shift()!, d = dist.get(key(c))!;
      for (const [dx, dz] of N4) {
        const n: Cell = [c[0] + dx, c[1] + dz];
        if (!dist.has(key(n)) && ground.step(c, n)) { dist.set(key(n), d + 1); queue.push(n); }
      }
    }
    return dist;
  };
  for (const side of ["a", "b"] as const) {
    const own = spawnsOf(ctx, side);
    own.forEach((from, i) => {
      const dist = steps(from);
      for (const to of own.slice(i + 1)) {
        const d = dist.get(key(to));
        if (d === undefined || d > SPAWN_SPREAD) out.push({ rule, at: from, message: `side ${side.toUpperCase()} spawns ${from} and ${to} are ${d === undefined ? "not connected" : `${d} steps apart (over ${SPAWN_SPREAD})`}` });
      }
    });
    for (const from of own) {
      const near = Array.from({ length: 2 * SPAWN_COVER + 1 }, (_, i) => i - SPAWN_COVER).flatMap((dx) =>
        Array.from({ length: 2 * SPAWN_COVER + 1 }, (_, j) => j - SPAWN_COVER).map((dz): Cell => [from[0] + dx, from[1] + dz]))
        .filter((c) => Math.abs(c[0] - from[0]) + Math.abs(c[1] - from[1]) <= SPAWN_COVER && standable(ctx, c));
      if (!near.some((c) => ground.shelter(c) > 0)) out.push({ rule, at: from, message: `no cover within ${SPAWN_COVER} tiles of side ${side.toUpperCase()}'s spawn ${from}` });
    }
  }
  for (const from of spawnsOf(ctx, "a")) for (const to of spawnsOf(ctx, "b")) {
    const distance = Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
    if (distance <= shot && ground.clearShot(from, to)) out.push({ rule, at: from, message: `${from} has a clear shot at the enemy spawn ${to} on turn zero (${distance} tiles)` });
    else if (distance <= throwReach && ground.clearThrow(from, to)) out.push({ rule, at: from, message: `${from} can throw a grenade at the enemy spawn ${to} on turn zero (${distance} tiles)` });
  }
  return out;
}

/** Placements, distinct kinds and point lights stay within budget. */
function budget(ctx: Ctx): Problem[] {
  const limit = { ...LAYOUT_BUDGET, ...ctx.options.budget }, out: Problem[] = [];
  const kinds = new Set(ctx.placed.map(({ spec }) => spec.kind)).size;
  const lit = ctx.options.lights;
  const lights = ctx.level.lights.length + (lit ? ctx.placed.filter(({ p }) => lit.has(p.asset)).length : 0);
  const count = { placements: ctx.level.placements.length, kinds, lights };
  for (const k of Object.keys(count) as (keyof Budget)[])
    if (count[k] > limit[k]) out.push({ rule: "budget", message: `${count[k]} ${k} is over the budget of ${limit[k]}` });
  return out;
}

export const layoutRules = {
  "enclosed-room": enclosedRoom,
  reachable,
  "fixture-front": fixtureFront,
  "cover-height": coverHeight,
  overlap,
  "walls-are-buildings": wallsAreBuildings,
  "edge-on-boundary": edgeOnBoundary,
  "spawn-sanity": spawnSanity,
  budget,
} as const satisfies Record<string, (ctx: Ctx) => Problem[]>;

/** Every fault `level` has under the rules above (all of them, or just `only`), in rule order. */
export function layoutProblems(level: Level, options: LayoutOptions = {}, only?: readonly (keyof typeof layoutRules)[]): Problem[] {
  const ctx = context(level, options);
  return (Object.keys(layoutRules) as (keyof typeof layoutRules)[])
    .filter((rule) => !only || only.includes(rule))
    .flatMap((rule) => layoutRules[rule](ctx));
}
