// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import items from "../../catalog/items.json" with { type: "json" };
import { commandsOf, MAX_RANGE_OFFSET, REFUSAL_TEXT, refusalOf } from "./action-registry.ts";
import { hostileAction } from "./ai.ts";
import { ChainGround, type GroundTile } from "./chain-ground.ts";
import { distance, Encounter, type Cell, type Unit } from "./game.ts";
import { blackRain, type Scenario } from "./scenario.ts";
import { aimTargets, bestShotTarget, shotBlockReason, stepAimTarget } from "./targeting.ts";

/**
 * What a player may aim at: `Encounter.inRange`, the one rule for the chain
 * authority and the local rules alike, against `Unit.perform_attack`'s
 * `assert!(eff_range + MAX_RANGE_OFFSET >= range, ERangeExceeded)` with the
 * Manhattan distance of `Map.perform_attack`, plus its line of sight.
 */

/** `Unit.perform_attack` and `Map.perform_attack`: the distance a shot is accepted at. */
const contractAccepts = (range: number, d: number) => range + MAX_RANGE_OFFSET >= d;

/** The rifles' ranges, from the catalog. */
const RIFLES = (items as { items: { id: string; name: string; stats?: { range?: number } }[] }).items
  .filter((i) => /^rifle-\d$/.test(i.id))
  .map((i) => ({ id: i.id, name: i.name, range: i.stats!.range! }));

/** An open 25×25 yard: no walls, nothing in the way. */
const yard = (): Scenario => ({
  ...blackRain,
  id: "yard",
  map: { ...blackRain.map, buildings: [], covers: [], obstacles: [], props: [], bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 } },
});

/** The same yard as a chain grid: the rules go through the ground authority, as in a match. */
const chainYard = (): Scenario => ({
  ...yard(),
  ground: {
    tiles: Array.from({ length: 25 }, () => Array.from({ length: 25 }, (): GroundTile => ({ t: "empty" }))),
    minX: -12,
    minZ: -12,
  },
});

/** One operator at the origin with `range`, one hostile at `[0, d]`, the rest gone. */
function duel(scenario: Scenario, range: number, d: number) {
  const game = new Encounter(scenario);
  const a = game.allies[0], b = game.enemies[0];
  a.pos = [0, 0];
  a.range = range;
  a.aim = 65;
  a.ap = 2;
  a.ammo = a.clip;
  b.pos = [0, d];
  game.units = [a, b];
  return { game, a, b };
}

test("the catalog's rifles: in range exactly as far as the contract accepts a shot, both rule sets", () => {
  assert.deepEqual(RIFLES.map((r) => [r.id, r.range]), [["rifle-1", 4], ["rifle-2", 5], ["rifle-3", 5]]);
  for (const { id, range } of RIFLES)
    for (const scenario of [yard(), chainYard()])
      for (let d = 1; d <= range + MAX_RANGE_OFFSET + 2; d++) {
        const { game, a, b } = duel(scenario, range, d);
        const where = `${id} at ${d} (${scenario.ground ? "chain" : "local"})`;
        assert.equal(game.inRange(a, b), contractAccepts(range, d), where);
        // a shot it accepts can hit: past the weapon's range the odds fall 10 a tile, still above 0 at the edge
        if (d === range + MAX_RANGE_OFFSET) assert.equal(game.chance(a, b), 65 - 10 * MAX_RANGE_OFFSET, where);
        if (d > range + MAX_RANGE_OFFSET) assert.equal(game.chance(a, b), 0, where);
        assert.equal(refusalOf(game, a, "Attack"), game.inRange(a, b) ? null : "no-target", where);
      }
});

test("in range: alive, hostile and in line of sight too; the chain authority's line is the ground's", () => {
  const { game, a, b } = duel(chainYard(), 4, 3);
  assert.ok(game.inRange(a, b));
  b.hp = 0;
  assert.ok(!game.inRange(a, b), "a fallen hostile");
  b.hp = 9;
  b.enemy = false;
  assert.ok(!game.inRange(a, b), "an ally is never a target");
  b.enemy = true;
  // a wall tile between them on the chain's grid
  const ground = new ChainGround(chainYard().ground!);
  ground.tiles[12 + 1][12 + 0] = { t: "wall" };
  game.authority = { ...game.authority!, clearShot: (f: Cell, t: Cell) => ground.clearShot(f, t) };
  assert.ok(!game.inRange(a, b), "no line of sight");
  // with nobody else in range, the action itself is refused before the target is
  assert.equal(shotBlockReason(game, a, b), "NO TARGET IN RANGE");
});

test("Fire is inactive with no hostile in range, with its reason; active with one", () => {
  const { game, a, b } = duel(yard(), 4, 8);
  const fire = () => commandsOf(game, a).find((c) => c.kind === "Attack")!;
  assert.equal(fire().refusal, "no-target");
  assert.equal(REFUSAL_TEXT["no-target"], "No target in range");
  assert.equal(bestShotTarget(game, a), undefined, "nothing to start aiming on");
  b.pos = [0, 7];
  assert.equal(fire().refusal, null);
  assert.equal(bestShotTarget(game, a), b);
  // AP and ammo come first, as in the contract
  a.ammo = 0;
  b.pos = [0, 9];
  assert.equal(fire().refusal, "no-ammo");
  a.ap = 0;
  assert.equal(fire().refusal, "no-ap");
});

test("aiming steps only through hostiles in range, and starts on the best of them", () => {
  const game = new Encounter(yard());
  const a = game.allies[0];
  const [near, far, other] = game.enemies;
  a.pos = [0, 0];
  a.range = 4;
  a.ap = 2;
  near.pos = [0, 2];
  far.pos = [0, 9]; // out of range
  other.pos = [3, 0];
  game.units = [a, near, far, other];
  assert.deepEqual(aimTargets(game, a).map((u) => u.id), [near.id, other.id]);
  const visited = new Set<string>();
  let at = near.id;
  for (let i = 0; i < 6; i++) {
    const next = stepAimTarget(game, a, at, i % 2 ? -1 : 1)!;
    visited.add(next.id);
    at = next.id;
  }
  assert.ok(!visited.has(far.id), "the hostile out of range is never visited");
  assert.equal(stepAimTarget(game, a, far.id, 1)?.id, near.id, "from an unlisted target, the first in range");
  assert.notEqual(bestShotTarget(game, a), far);
  // the target falls: the next in range takes its place; the last one gone ends it
  near.hp = 0;
  assert.deepEqual(aimTargets(game, a), [other]);
  other.hp = 0;
  assert.equal(bestShotTarget(game, a), undefined);
  assert.equal(refusalOf(game, a, "Attack"), "no-target");
});

test("the local AI shoots only what the same rule lets it", () => {
  const game = new Encounter(yard());
  game.phase = "enemy";
  const h: Unit = game.enemies[0];
  const [far, away] = game.allies;
  h.pos = [0, 0];
  h.range = 4;
  far.pos = [0, 10]; // out of range
  away.pos = [6, 0]; // in range (4 + 3)
  game.units = [h, far, away];
  assert.ok(distance(h.pos, far.pos) > h.range + MAX_RANGE_OFFSET);
  const next = hostileAction(game, h);
  assert.equal(next?.kind === "fire" && next.target, away);
  away.pos = [8, 0];
  assert.equal(hostileAction(game, h), null, "nobody in range: no shot");
});
