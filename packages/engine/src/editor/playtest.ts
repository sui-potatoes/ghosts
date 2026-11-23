// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * An editor level as a playable encounter: the demo's single-player fight
 * against the AI, on the level's grid, by the rules a chain match on its
 * exported tiles would follow.
 *
 * - The grid is centred on the scene (cell `[x, z]` of the level is scene cell
 *   `[x - ⌊w/2⌋, z - ⌊d/2⌋]`, which puts the shipped demos back where they were).
 * - Rules: the scenario carries the exported Move tile grid as its `ground`, so
 *   moving, cover, sight and grenades follow `ghosts::map` (`chain-ground.ts`):
 *   a crate or barrier is an Obstacle, low cover to its neighbours that a unit
 *   vaults but never stands on (two side by side cannot be crossed); low cover
 *   on an edge (low barriers and fences) protects but never blocks a step;
 *   high cover edges (walls, glazing, tall fences) and wall tiles do. The
 *   scene counts the obstacles as its cover cells, so units crouch beside
 *   them and vault them.
 * - Scenery: every placement becomes a catalog prop the battlefield draws and
 *   breaks; indestructible stand-ins (hit points 0) stay out of the props and
 *   are drawn as static scenery by the level's view (`playtest-view.ts`). Wall
 *   tiles also stand as one-cell building footprints, so the scene takes cover
 *   against them and shots stop at them as the rules say.
 * - Units: side A deploys the squad (the demo's four slots, filled from the
 *   saved roster by `deploymentLoadouts`), side B one hostile per cell with its
 *   role's kit (`roleKits`).
 */
import { assetByUid, floorByUid } from "../catalog.ts";
import type { MapProp } from "../environment.ts";
import { CELL, type Building, type Cell, type MapPlan } from "../map.ts";
import { blackRain, type Scenario, type UnitSpec } from "../scenario.ts";
import type { Role } from "../game.ts";
import { placementLook, placementSeat, restHeight, SQUAD_SIZE, toMoveMap, type Level } from "./level.ts";
import { deploymentIssues } from "./preset.ts";

/** The scene cell of the level's `[0, 0]`: the grid centred on the origin. */
export function levelOrigin(level: Level): Cell {
  return [-Math.floor(level.width / 2), -Math.floor(level.depth / 2)];
}

/** The plan id a level plays under; its scenery registers under the same id. */
export const levelPlanId = (level: Level) => `level:${level.name || "untitled"}`;

/**
 * What keeps `level` from being playtested: deployment the chain would refuse
 * outright (`deploymentIssues`: a side without cells or past a squad, a cell on
 * a wall, an unwalkable tile, outside, or doubled) and an objective nobody can
 * reach. Uneven sides play; only the chain needs them even.
 */
export function playtestIssues(level: Level): string[] {
  const issues = deploymentIssues(level);
  if (level.objective) {
    const tile = toMoveMap(level).tiles[level.objective[1]]?.[level.objective[0]];
    if (!tile) issues.push("The objective is outside the grid");
    else if (tile.t === "wall" || tile.t === "unwalkable" || tile.t === "obstacle")
      issues.push(
        `The objective stands on ${tile.t === "wall" ? "a wall" : tile.t === "obstacle" ? "an obstacle" : "an unwalkable tile"}: nobody can extract`,
      );
  }
  return issues;
}

const WALL_HEIGHT = 2.6;
/** The hostiles' roles in deployment order, Black Rain's first. */
const HOSTILE_ROLES: Role[] = ["ASSAULT", "HEAVY", "RECON", "SPECIALIST"];

/** A placement as the prop the battlefield draws: same mesh, seat and stretch as in the editor. */
function propOf(level: Level, index: number, origin: Cell): MapProp | null {
  const p = level.placements[index];
  const spec = assetByUid(p.asset);
  if (!spec) return null;
  const seat = placementSeat(spec, p.at, p.turn);
  const rest = restHeight(level, p);
  return {
    id: `level-${index}`,
    kind: spec.kind,
    x: seat.x + origin[0] * CELL,
    z: seat.z + origin[1] * CELL,
    ...(rest ? { y: rest } : {}),
    yaw: seat.yaw,
    // The editor's look: every mesh variant reads as it did there.
    ...placementLook(spec, p),
    ...(seat.span !== 1 ? { span: seat.span } : {}),
    // `cover` picks the barrier-sized mesh variants; the rules take cover from the ground, not from it.
    ...(spec.footprint === "cover" ? { cover: [p.at[0] + origin[0], p.at[1] + origin[1]] as Cell } : {}),
  };
}

/**
 * The level's props: what the battlefield draws and breaks (`props`), and the
 * indestructible stand-ins it would hide as destroyed (`fixed`), for the
 * level's view to draw as static scenery.
 */
export function levelProps(level: Level): { props: MapProp[]; fixed: MapProp[] } {
  const origin = levelOrigin(level);
  const props: MapProp[] = [];
  const fixed: MapProp[] = [];
  level.placements.forEach((p, i) => {
    const prop = propOf(level, i, origin);
    if (!prop) return;
    (assetByUid(p.asset)!.hp > 0 ? props : fixed).push(prop);
  });
  return { props, fixed };
}

/** The rules' map for `level`: bounds, wall footprints, unwalkable tiles, props, raised floors. */
export function levelPlan(level: Level): MapPlan {
  const [minX, minZ] = levelOrigin(level);
  const { tiles } = toMoveMap(level);
  const buildings: Building[] = [];
  const obstacles: Cell[] = [];
  const covers: Cell[] = [];
  tiles.forEach((row, z) =>
    row.forEach((tile, x) => {
      if (tile.t === "wall") buildings.push({ x: x + minX, z: z + minZ, w: 1, d: 1, h: WALL_HEIGHT, kind: "level-wall" });
      else if (tile.t === "unwalkable") obstacles.push([x + minX, z + minZ]);
      else if (tile.t === "obstacle") covers.push([x + minX, z + minZ]);
    }),
  );
  const rises = level.floors.flatMap((f) => {
    const raise = floorByUid(f.floor)?.raise;
    return raise ? [[f.at[0] + minX, f.at[1] + minZ, raise] as const] : [];
  });
  return {
    id: levelPlanId(level),
    bounds: { minX, maxX: minX + level.width - 1, minZ, maxZ: minZ + level.depth - 1 },
    buildings,
    // The ground's obstacles: the scene's cover cells, to crouch beside and vault (the rules take cover from the ground).
    covers,
    obstacles,
    props: levelProps(level).props,
    // A flat stage: no street, no curbs.
    street: { avenueHalf: 0, crossHalf: 0, curb: 0, reach: 0 },
    ...(rises.length ? { rises } : {}),
  };
}

/**
 * The encounter `level` plays as. Throws when the level cannot be played
 * (`playtestIssues`), with every reason in the message.
 */
export function scenarioFromLevel(level: Level): Scenario {
  const issues = playtestIssues(level);
  if (issues.length) throw new Error(issues.join(" · "));
  const origin = levelOrigin(level);
  const [minX, minZ] = origin;
  const scene = (c: Cell): Cell => [c[0] + minX, c[1] + minZ];
  const squad = blackRain.units.filter((u) => !u.enemy);
  const hostile = blackRain.units.find((u) => u.enemy)!;
  const units: UnitSpec[] = [
    ...level.spawns.a.slice(0, SQUAD_SIZE).map((cell, i): UnitSpec => ({ ...squad[i % squad.length], pos: scene(cell) })),
    ...level.spawns.b.slice(0, SQUAD_SIZE).map((cell, i): UnitSpec => ({
      id: `h${i + 1}`,
      name: `WRAITH–0${i + 1}`,
      full: hostile.full,
      role: HOSTILE_ROLES[i % HOSTILE_ROLES.length],
      pos: scene(cell),
      color: hostile.color,
      enemy: true,
    })),
  ];
  const name = level.name || "untitled";
  const [a, b] = [level.spawns.a.length, level.spawns.b.length];
  const time = level.lighting.time;
  return {
    ...blackRain,
    id: "playtest",
    map: levelPlan(level),
    ground: { tiles: toMoveMap(level).tiles, minX, minZ },
    units,
    // Without an objective the relay sits off the grid, unused and undrawn.
    relay: level.objective ? scene(level.objective) : [minX - 1, minZ - 1],
    ...(level.objective ? {} : { noObjective: true }),
    briefing: {
      issuer: "LEVEL EDITOR / PLAYTEST",
      title: `Playtest · ${name}`,
      setting: `Editor draft / ${level.width} × ${level.depth} cells / ${time}. Played by the rules a chain match on this tile grid follows.`,
      contract: [
        `Side A fields ${a} of your squad, side B ${b} hostile operator${b === 1 ? "" : "s"}.`,
        level.objective
          ? "Move an operator onto the relay pad and use *Extract*, then neutralize the hostiles"
          : "This level has no objective: neutralize every hostile to finish",
      ],
      rules:
        "Two action points per operator. Movement, cover and sight follow the exported tile grid as a chain match would: walls and unwalkable tiles cannot be entered, high cover on an edge (walls, glass panes, tall fences) blocks a step and a shot across it, low cover on an edge (low barriers and fences) protects by 25 points but never blocks a step. Crates and barriers give the tiles beside them 25 points and can be vaulted but not stood on; two side by side cannot be crossed. A grenade clears every cover tile within two. Hunker keeps the demo's flat bonus",
      facts: [
        ["LEVEL", name.toUpperCase()],
        ["GRID", `${level.width} × ${level.depth}`],
        ["SIDES", `${a} V ${b}`],
        ["OBJECTIVE", level.objective ? "RELAY" : "NONE"],
      ],
    },
    location: { ...blackRain.location, sector: "LEVEL EDITOR / PLAYTEST", code: "LV–00.000" },
    contract: { employer: "PLAYTEST", division: "LEVEL EDITOR", value: "₡ 0", threat: "TEST", threatLevel: 1 },
    objectives: {
      secure: { title: "Secure the relay", detail: "Reach the relay pad and extract", order: "Take the relay" },
      eliminate: { title: "Neutralize side B", order: "Clear side B" },
    },
    lines: {
      opening: `Playtest: ${name}`,
      secured: "Relay secured. Eliminate remaining hostiles",
      securedStamp: "RELAY SECURED",
    },
  };
}
