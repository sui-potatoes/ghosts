// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Layout common sense (`layout-checks.ts`): every shipped level passes it, and
 * each rule fires on a small hand-made fault. Night Shift is the one shipped
 * level file; Basics' training room (spawns the script overrides, vending
 * machines as its walls) and the demos rebuilt from scenario plans (typed
 * building blocks) are other designs and are not held to it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assetByUid, assetCatalog } from "../catalog.ts";
import { nightShiftLevel } from "../night-shift/level.ts";
import { PropAssets } from "../scene/prop-assets.ts";
import { HEIGHTS, LAYOUT_BUDGET, hasFront, isDoor, layoutProblems, layoutRules, type LayoutOptions, type Problem } from "./layout-checks.ts";
import { newLevel, type Level, type Turn } from "./level.ts";
import { levelProps } from "./playtest.ts";

// ---------------------------------------------------------------------------
// Measuring a level's assets the way the scene draws them: height and lamp.

function measure(level: Level): Required<Pick<LayoutOptions, "heights" | "lights">> {
  const assets = new PropAssets(), heights = new Map<string, number>(), lights = new Set<string>();
  const { props, fixed } = levelProps(level);
  for (const prop of [...props, ...fixed]) {
    const uid = level.placements[Number(prop.id.slice("level-".length))].asset;
    if (heights.has(uid)) continue;
    const model = assets.get(prop);
    heights.set(uid, model.bounds.max.y);
    if (model.light) lights.add(uid);
  }
  assets.dispose();
  return { heights, lights };
}

// ---------------------------------------------------------------------------
// Shipped levels.

const keyOf = (p: Problem) => `${p.rule}@${p.at?.join(",") ?? p.message}`;

/**
 * Night Shift's known faults: the level is pinned to a live testnet revision, so
 * these stay as they are, listed so that nothing new can slip in beside them.
 * Each is `rule@x,z`; the reason is the point.
 */
const KNOWN: Record<string, string> = {
  "fixture-front@15,7": "stockroom shelving in the store's north-east corner faces the corner wall tile 15,8: dressing, nobody can stand in front",
  "fixture-front@16,8": "the same corner: this shelf faces west into the wall tile 15,8",
  "walls-are-buildings@7,7": "vending machine is a Wall tile by design (the briefing: walls, cars and vending machines stop everything)",
  "walls-are-buildings@7,8": "second vending machine, same as 7,7",
  "edge-on-boundary@16,9": "store partition on the edge between two Wall tiles (concrete wall and cigarette display): divides nothing",
  "cover-height@14,13": "self-checkout is 1.77 m tall but low cover (Obstacle) on chain, so it blocks no sight",
  "cover-height@10,1": "kei truck (1.76 m): cars are low rim cover by the owner's decision, so shots pass over them",
  "cover-height@8,6": "delivery van (1.89 m): car, low rim by decision",
  "cover-height@5,16": "kei car (1.80 m): car, low rim by decision",
  "cover-height@11,1": "roll cage (1.70 m), low cover on chain",
  "cover-height@12,6": "stacked AC condensers (2.50 m), low cover on chain",
  "cover-height@17,4": "AC condenser (2.10 m), low cover on chain",
  "cover-height@1,6": "bus shelter (2.45 m with its roof): low cover along the back panel on chain",
};

/** Night Shift's own limits where it is over the default budget. */
const NIGHT_SHIFT_BUDGET = {
  // over budget: 75 distinct kinds against 60; the street, the store and the depot each bring their own
  kinds: 75,
  // over budget: 19 lamps against 16 (7 ceiling lights, 4 poles, 3 bulkheads, 2 floodlights, 2 street lamps, 1 wall bulkhead); play pairs the ceiling ones
  lights: 19,
};

test("Night Shift passes layout common sense, bar its known faults", () => {
  const level = nightShiftLevel(), measured = measure(level);
  // every placed asset was measured: no height is guessed
  for (const p of level.placements) assert.ok(measured.heights.has(p.asset), `${p.asset} has a measured height`);
  const problems = layoutProblems(level, { ...measured, budget: NIGHT_SHIFT_BUDGET });
  assert.deepEqual(problems.map(keyOf).sort(), Object.keys(KNOWN).sort(), problems.map((p) => `${keyOf(p)}: ${p.message}`).join("\n"));
  // the limits are tight: relax them and the level is within, tighten them and it is not
  assert.equal(level.placements.length <= LAYOUT_BUDGET.placements, true);
  assert.equal(layoutProblems(level, { ...measured, budget: { kinds: 74, lights: 18 } }, ["budget"]).length, 2);
});

// ---------------------------------------------------------------------------
// Fixtures: one small fault per rule.

const U = {
  wall: "b06", crate: "s02", cargo: "s03", barrier: "s01", masonry: "s11", tallFence: "s14", vending: "s17",
  door: "o17", fridge: "k01", car: "v01", asphalt: "f03", pavement: "f01",
};

test("fixture uids are the assets the fixtures mean", () => {
  const kind = (uid: string) => assetByUid(uid)?.kind;
  assert.deepEqual(
    [U.wall, U.crate, U.cargo, U.barrier, U.masonry, U.tallFence, U.vending, U.door, U.fridge, U.car].map(kind),
    ["block-fill", "crate", "cargo", "barrier", "wall", "fence-sheet", "vending", "office-glass-door", "shop-fridge-single", "shop-kei-car"],
  );
  assert.ok(isDoor(assetByUid(U.door)!) && !isDoor(assetByUid(U.barrier)!));
  assert.ok(hasFront(assetByUid(U.fridge)!) && !hasFront(assetByUid(U.crate)!));
  // a door is the same wherever the catalogue puts it: edge, no footprint, called a door
  assert.ok(assetCatalog.filter(isDoor).every((s) => s.place === "edge" && s.footprint === "none"));
});

/** A level from a picture: `#` a Wall tile, `a`/`b` a spawn of that side, anything else open ground. */
function make(rows: string[]): Level {
  const level = newLevel(rows[0].length, rows.length);
  rows.forEach((row, z) => [...row].forEach((ch, x) => {
    if (ch === "#") put(level, U.wall, x, z);
    if (ch === "a" || ch === "b") level.spawns[ch].push([x, z]);
  }));
  return level;
}
const put = (level: Level, asset: string, x: number, z: number, turn: Turn = 0) => level.placements.push({ asset, at: [x, z], turn });
const only = (level: Level, rule: keyof typeof layoutRules, options: LayoutOptions = {}) => layoutProblems(level, options, [rule]);

/** An open lot with a crate beside each spawn: breaks no rule. */
function clean(): Level {
  const level = make([
    "............",
    "...........b",
    "............",
    "............",
    "............",
    "............",
    "a...........",
  ]);
  put(level, U.crate, 1, 5);
  put(level, U.crate, 10, 2);
  return level;
}

test("a clean level breaks no rule", () => {
  assert.deepEqual(layoutProblems(clean()), []);
});

const ring = [
  ".........",
  ".#####...",
  ".#...#...",
  ".#####...",
  ".........",
];

test("enclosed-room: a sealed room with no door", () => {
  const level = make(ring);
  level.spawns.a.push([0, 0]);
  level.spawns.b.push([8, 4]);
  const found = only(level, "enclosed-room");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /sealed room of 3 tiles/);
});

test("enclosed-room: a room with a door must hold something", () => {
  // the east wall of the ring opened, a door on the edge between the room and the gap
  const level = make([".........", ".####....", ".#.......", ".####....", "........."]);
  level.spawns.a.push([0, 0]);
  level.spawns.b.push([8, 4]);
  put(level, U.door, 4, 2, 1);
  const empty = only(level, "enclosed-room");
  assert.equal(empty.length, 1);
  assert.match(empty[0].message, /empty room/);
  put(level, U.crate, 3, 2);
  assert.deepEqual(only(level, "enclosed-room"), []);
});

test("reachable: a walled-off pocket is cut off from both sides", () => {
  const level = make(ring);
  level.spawns.a.push([0, 0]);
  level.spawns.b.push([8, 4]);
  const found = only(level, "reachable");
  assert.equal(found.length, 2);
  assert.match(found[0].message, /3 walkable tiles cannot be reached from side A/);
  assert.match(found[1].message, /side B/);
});

test("fixture-front: the front is blocked, or reachable only over an obstacle", () => {
  const level = make(["..............", "..............", "..............", "..............", "..............", "a............b"]);
  for (const x of [3, 7, 10]) put(level, U.fridge, x, 0, 0);
  put(level, U.crate, 3, 1); // blocks the first front
  for (const [x, z] of [[6, 1], [8, 1], [7, 2]]) put(level, U.crate, x, z); // walls the second front in
  const found = only(level, "fixture-front");
  assert.equal(found.length, 2);
  assert.match(found[0].message, /not a tile anyone can stand on/);
  assert.match(found[1].message, /without hopping an obstacle/);
});

test("cover-height: the class must agree with the height", () => {
  const level = clean();
  put(level, U.cargo, 4, 3); // low cover as tall as a wall
  put(level, U.tallFence, 6, 3); // a high side that is waist-high
  put(level, U.barrier, 8, 3); // a barrier that blocks at ankle height
  const heights = new Map([[U.crate, 1], [U.cargo, 2.2], [U.tallFence, 1], [U.barrier, HEIGHTS.blockMin - 0.2]]);
  const found = only(level, "cover-height", { heights });
  assert.equal(found.length, 3);
  assert.match(found.map((p) => p.message).join("\n"), /Cargo box.*full height[\s\S]*fence.*at least 1\.6[\s\S]*barrier.*too low to block/i);
  // nothing measured, nothing said
  assert.deepEqual(only(level, "cover-height"), []);
});

test("overlap: shared tiles, shared edges, a pit under a prop, a car astride two floors", () => {
  const level = make(["........", "........", "........", "........", "........", "........"]);
  put(level, U.crate, 1, 1);
  put(level, U.cargo, 1, 1);
  put(level, U.masonry, 3, 3, 0); // the edge between 3,2 and 3,3 ...
  put(level, U.tallFence, 3, 2, 2); // ... named from the other side
  level.unwalkable.push([5, 1]);
  put(level, U.crate, 5, 1);
  put(level, U.car, 7, 0); // a kei car runs three tiles south from 7,0
  level.floors.push({ floor: U.asphalt, at: [7, 0] }, { floor: U.asphalt, at: [7, 1] }, { floor: U.pavement, at: [7, 2] });
  const text = only(level, "overlap").map((p) => p.message);
  assert.equal(text.length, 5, text.join("\n"));
  assert.match(text.join("\n"), /shares tile 1,1[\s\S]*shares an edge[\s\S]*unwalkable tile 5,1[\s\S]*straddles floors[\s\S]*not parked on road/);
});

test("walls-are-buildings: a prop that exports as a Wall", () => {
  const level = clean();
  put(level, U.vending, 5, 3);
  const found = only(level, "walls-are-buildings");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].at, [5, 3]);
  assert.match(found[0].message, /Vending machine/);
});

test("edge-on-boundary: a wall between two walls, a door into a wall or with cover across it", () => {
  const level = make(["..........", "..#.......", "..#.......", "..........", "..........", ".........."]);
  put(level, U.masonry, 2, 2, 0); // the edge between two Wall tiles
  put(level, U.door, 4, 3, 1); // a door onto the open ground east of it ...
  put(level, U.door, 5, 1, 1); // ... a doorway whose far side is 6,1
  put(level, U.wall, 6, 1);
  put(level, U.door, 4, 4, 1);
  put(level, U.barrier, 4, 4, 1); // a barrier on the doorway's own edge
  const text = only(level, "edge-on-boundary").map((p) => p.message);
  assert.equal(text.length, 3, text.join("\n"));
  assert.match(text.join("\n"), /both walls[\s\S]*does not open onto standable ground[\s\S]*carries cover across the doorway/);
});

test("spawn-sanity: off the floor, spread, in sight of each other, bare of cover", () => {
  const open = ["............", "............", "............", "............"];
  const level = make(open);
  level.spawns.a.push([0, 0], [11, 0]);
  level.spawns.b.push([2, 0]);
  const text = only(level, "spawn-sanity").map((p) => p.message).join("\n");
  assert.match(text, /spawns 0,0 and 11,0 are 11 steps apart/);
  assert.match(text, /0,0 has a clear shot at the enemy spawn 2,0/);
  assert.match(text, /no cover within 3 tiles of side A's spawn 0,0/);
  const walled = make(["a#..", "...."]);
  walled.spawns.b.push([1, 0]);
  assert.match(only(walled, "spawn-sanity").map((p) => p.message).join("\n"), /spawns on 1,0, which is not standable/);
  // a grenade reaches where a rifle may not: a tall fence stops the shot, not the throw
  const lobbed = make(["a..b", "...."]);
  put(lobbed, U.tallFence, 2, 0, 3);
  assert.match(only(lobbed, "spawn-sanity").map((p) => p.message).join("\n"), /grenade at the enemy spawn 3,0/);
});

test("budget: placements, kinds and lights over their limits", () => {
  const level = clean();
  put(level, U.cargo, 4, 3);
  const found = only(level, "budget", { budget: { placements: 2, kinds: 1, lights: 0 }, lights: new Set([U.crate]) });
  assert.equal(found.length, 3);
  assert.match(found.map((p) => p.message).join("\n"), /3 placements[\s\S]*2 kinds[\s\S]*2 lights/);
  assert.deepEqual(only(level, "budget"), []);
});
