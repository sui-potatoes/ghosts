// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { commandsOf, kindOfTag, specOf } from "./action-registry.ts";
import { hostilePhase, hostileThrow } from "./ai.ts";
import { ChainGround, type GroundTile } from "./chain-ground.ts";
import { describe, type GameEvent } from "./events.ts";
import { Encounter, replayEncounter, type Unit } from "./game.ts";
import { baseIntel } from "./intel.ts";
import { blackRain, type Scenario } from "./scenario.ts";
import { Overlays } from "./scene/overlays.ts";
import { Space } from "./scene/space.ts";
import { effectKindOfTag, effectLines, effectsTag, unitCombat } from "./status-effects.ts";
import { burstUnits, grenadeBlockReason } from "./targeting.ts";

/**
 * A small fight in the open: two of the squad and two hostiles, the first of
 * the squad carrying a flashbang and a smoke grenade (one each), the first
 * hostile the same. Everyone else is moved far off.
 */
function skirmish(scenario: Scenario = blackRain) {
  const game = new Encounter(scenario);
  const [a, b, ...restAllies] = game.allies;
  const [h, k, ...restHostiles] = game.enemies;
  const kit = (u: Unit) =>
    (u.actions = [
      { kind: "Move", uses: null },
      { kind: "Attack", uses: null },
      { kind: "Reload", uses: null },
      { kind: "Flashbang", uses: 1 },
      { kind: "SmokeGrenade", uses: 1 },
    ]);
  kit(a);
  kit(h);
  a.pos = [0, 4];
  b.pos = [1, 2];
  h.pos = [0, 1];
  k.pos = [4, -3];
  game.units = [a, b, h, k];
  void restAllies;
  void restHostiles;
  return { game, a, b, h, k };
}

const types = (events: GameEvent[]) => events.map((e) => e.type);
const effectsOf = (u: Unit) => u.effects.map((e) => `${e.kind}:${e.turns}`);

test("the chain tags: Flashbang 4, SmokeGrenade 5; effects Daze 0, Smoke 1", () => {
  assert.equal(kindOfTag(4), "Flashbang");
  assert.equal(kindOfTag(5), "SmokeGrenade");
  assert.equal(specOf("flashbang").id, "Flashbang");
  assert.equal(specOf("smoke-grenade").id, "SmokeGrenade");
  assert.equal(effectKindOfTag(0), "Daze");
  assert.equal(effectKindOfTag(1), "Smoke");
  assert.equal(effectKindOfTag(7), "#7");
});

test("a flashbang dazes every unit in the burst, either side and the thrower, in Map.units order, with no damage", () => {
  const { game, a, b, h, k } = skirmish();
  const hp = game.units.map((u) => u.hp);
  // Lands on [0, 3]: the thrower (1 away), b (2 away) and h (2 away) are caught; k is far.
  const events = game.apply({ type: "flashbang", unit: a.id, at: [0, 3] });
  assert.deepEqual(types(events), ["flashbang", "effect-start", "effect-start", "effect-start"]);
  // Row-major by tile: row (z) first, then column (x): h [0,1], b [1,2], a [0,4].
  assert.deepEqual(
    events.slice(1).map((e) => e.type === "effect-start" && [e.unit, e.effect.kind, e.effect.turns]),
    [
      [h.id, "Daze", 2],
      [b.id, "Daze", 2],
      [a.id, "Daze", 2],
    ],
  );
  assert.deepEqual(effectsOf(k), []);
  assert.deepEqual(game.units.map((u) => u.hp), hp, "no damage");
  assert.equal(a.ap, 1, "one AP");
  assert.equal(commandsOf(game, a).find((c) => c.kind === "Flashbang")!.uses, 0, "the one use is spent");
  assert.deepEqual(game.apply({ type: "flashbang", unit: a.id, at: [0, 3] }), [], "no second throw");
  assert.equal(unitCombat(a).aim, 0, "a dazed unit's aim is 0");
  assert.equal(a.aim > 0, true, "its base aim is untouched");
});

test("a smoke grenade smokes the burst: aim −30 (floor 0), defense +30; cover is untouched", () => {
  const { game, a, b } = skirmish();
  const cover = game.map.covers.length;
  const aim = b.aim, defense = b.defense;
  game.apply({ type: "smoke-grenade", unit: a.id, at: [1, 3] });
  assert.deepEqual(effectsOf(b), ["Smoke:2"]);
  assert.deepEqual([unitCombat(b).aim, unitCombat(b).defense], [Math.max(0, aim - 30), defense + 30]);
  assert.equal(game.map.covers.length, cover);
  b.aim = 20;
  assert.equal(unitCombat(b).aim, 0, "aim floors at 0");
});

test("the throws keep the frag's checks: range 5, the action and a use, line of throw", () => {
  const { game, a, b } = skirmish();
  assert.equal(grenadeBlockReason(game, a, [0, -2], "flashbang"), "OUT OF THROW RANGE");
  assert.deepEqual(game.apply({ type: "flashbang", unit: a.id, at: [0, -2] }), []);
  assert.ok(!commandsOf(game, b).some((c) => c.kind === "SmokeGrenade"), "never offered without the item");
  assert.deepEqual(game.apply({ type: "smoke-grenade", unit: b.id, at: [0, 3] }), [], "no smoke grenade, no throw");
  game.throwBlocked = () => true;
  assert.equal(grenadeBlockReason(game, a, [0, 3], "flashbang"), "WALL BLOCKS THROW");
  assert.deepEqual(game.apply({ type: "flashbang", unit: a.id, at: [0, 3] }), []);
});

test("on a chain tile grid a throw cannot land on a wall, and walls block its line", () => {
  const tiles: GroundTile[][] = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => ({ t: "empty" }) as GroundTile));
  tiles[2][3] = { t: "wall" };
  const ground = { tiles, minX: 0, minZ: 0 };
  const scenario: Scenario = { ...blackRain, ground, noObjective: true };
  const { game, a } = skirmish(scenario);
  a.pos = [3, 0];
  assert.equal(new ChainGround(ground).clearThrow([3, 0], [3, 2]), false);
  assert.equal(grenadeBlockReason(game, a, [3, 2], "smoke-grenade"), "WALL BLOCKS THROW");
  assert.equal(grenadeBlockReason(game, a, [3, 4], "smoke-grenade"), "WALL BLOCKS THROW");
  assert.equal(grenadeBlockReason(game, a, [1, 2], "smoke-grenade"), null);
});

test("the burst preview marks every unit it will catch, the thrower and the squad too", () => {
  const { game, a, b, h, k } = skirmish();
  assert.deepEqual(burstUnits(game, [0, 3]), [h, b, a]);
  assert.deepEqual(burstUnits(game, [4, -2]), [k]);
  assert.deepEqual(burstUnits(game, null), []);
});

test("the overlay rings every caught unit under the throw arc", (t: TestContext) => {
  const { game, a } = skirmish();
  const scene = new T.Scene();
  const overlays = new Overlays(scene, new Space(game.map));
  t.after(() =>
    scene.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    }),
  );
  overlays.showPath([a.pos, [0, 3]], true, burstUnits(game, [0, 3]).map((u) => u.pos));
  const burst = scene.getObjectByName("Burst")!;
  assert.deepEqual(
    burst.children.filter((c) => c.name.startsWith("caught:")).map((c) => c.name),
    ["caught:0,1", "caught:1,2", "caught:0,4"],
  );
  assert.equal((burst.children[0] as T.InstancedMesh).count, 13, "the diamond of radius 2");
});

test("effects tick on every turn end: applied on A's turn, gone when B ends theirs", () => {
  const { game, a, b } = skirmish();
  game.apply({ type: "flashbang", unit: a.id, at: [0, 3] });
  assert.deepEqual(effectsOf(b), ["Daze:2"]);
  const ended = game.beginEnemy();
  assert.deepEqual(types(ended), ["hostile-phase"], "one turn off, nothing ends");
  assert.deepEqual(effectsOf(b), ["Daze:1"]);
  assert.equal(unitCombat(b).aim, 0, "still dazed through the other side's turn");
  const next = game.nextTurn();
  assert.deepEqual(types(next), ["turn", "effect-end", "effect-end", "effect-end"]);
  assert.deepEqual(effectsOf(b), []);
  assert.equal(unitCombat(b).aim, b.aim);
});

test("thrown on the hostiles' turn, it ends when the squad ends theirs", () => {
  const { game, h, b } = skirmish();
  game.beginEnemy();
  h.ap = 2;
  assert.ok(game.apply({ type: "smoke-grenade", unit: h.id, at: [0, 2] }).length);
  assert.deepEqual(effectsOf(b), ["Smoke:2"]);
  assert.deepEqual(types(game.nextTurn()), ["turn"]);
  assert.deepEqual(effectsOf(b), ["Smoke:1"]);
  const ended = game.beginEnemy();
  assert.deepEqual(
    ended.map((e) => (e.type === "effect-end" ? `${e.unit}:${e.kind}` : e.type)),
    ["hostile-phase", `${h.id}:Smoke`, `${b.id}:Smoke`, `${game.allies[0].id}:Smoke`],
  );
  assert.deepEqual(effectsOf(b), []);
});

test("a second effect of a kind keeps the larger timer, in the same slot, with no end before it", () => {
  const { game, a, b, h } = skirmish();
  game.apply({ type: "smoke-grenade", unit: a.id, at: [1, 3] });
  game.apply({ type: "flashbang", unit: a.id, at: [1, 3] });
  assert.deepEqual(effectsOf(b), ["Smoke:2", "Daze:2"], "both kinds coexist, in the order they landed");
  assert.deepEqual([unitCombat(b).aim, unitCombat(b).defense], [0, b.defense + 30], "daze and smoke: aim 0, defense +30");
  game.beginEnemy();
  assert.deepEqual(effectsOf(b), ["Smoke:1", "Daze:1"]);
  h.ap = 2;
  const again = game.apply({ type: "smoke-grenade", unit: h.id, at: [1, 2] });
  assert.ok(!again.some((e) => e.type === "effect-end"));
  assert.ok(again.some((e) => e.type === "effect-start" && e.unit === b.id && e.effect.turns === 2));
  assert.deepEqual(effectsOf(b), ["Smoke:2", "Daze:1"], "refreshed in place, the daze untouched");
  const next = game.nextTurn();
  assert.deepEqual(
    next.filter((e) => e.type === "effect-end" && e.unit === b.id).map((e) => e.type === "effect-end" && e.kind),
    ["Daze"],
  );
  assert.deepEqual(effectsOf(b), ["Smoke:1"]);
});

test("a unit that falls takes its effects with it, and no effect-end is written for it", () => {
  const { game, a, h } = skirmish();
  game.apply({ type: "smoke-grenade", unit: a.id, at: [0, 2] });
  assert.deepEqual(effectsOf(h), ["Smoke:2"]);
  game.ingest({ type: "shot", unit: a.id, target: h.id, hit: true, crit: false, damage: h.hp, killed: true, reaction: false });
  assert.deepEqual(effectsOf(h), []);
  game.beginEnemy();
  const ends = game.nextTurn().filter((e) => e.type === "effect-end");
  assert.ok(ends.length > 0);
  assert.ok(!ends.some((e) => e.type === "effect-end" && e.unit === h.id));
});

test("the journal rebuilds every unit's effects, turn by turn", () => {
  const { game, a } = skirmish();
  const history: GameEvent[] = [];
  history.push(...game.apply({ type: "flashbang", unit: a.id, at: [0, 3] }));
  history.push(...game.beginEnemy());
  const replay = replayEncounter(blackRain, []);
  replay.units = structuredClone(skirmish().game.units);
  for (const event of history) replay.ingest(event);
  assert.deepEqual(replay.units.map(effectsOf), game.units.map(effectsOf));
  history.push(...game.nextTurn());
  for (const event of history.slice(-4)) replay.ingest(event);
  assert.deepEqual(replay.units.map(effectsOf), game.units.map(effectsOf));
  assert.ok(game.units.every((u) => !u.effects.length));
});

test("feed lines name the throw and each effect with its numbers", () => {
  const name = (id: string) => id.toUpperCase();
  assert.equal(describe({ type: "flashbang", unit: "v", at: [0, 0] }, name), "V threw a flashbang. Burst radius: 2.");
  assert.equal(describe({ type: "smoke-grenade", unit: "v", at: [0, 0] }, name), "V threw a smoke grenade. Burst radius: 2.");
  assert.equal(describe({ type: "effect-start", unit: "g", effect: { kind: "Daze", turns: 2 } }, name), "G: dazed, aim 0, 2 turns left.");
  assert.equal(describe({ type: "effect-end", unit: "g", kind: "Smoke" }, name), "G: no longer in smoke.");
});

test("the status line and the marker say what each effect does and for how long", () => {
  assert.deepEqual(
    effectLines([
      { kind: "Daze", turns: 1 },
      { kind: "Smoke", turns: 2 },
    ]).map((e) => e.text),
    ["Dazed: aim 0, 1 turn left", "In smoke: +30 defense, −30 aim, 2 turns left"],
  );
  assert.equal(effectsTag([{ kind: "Daze", turns: 2 }]), "DAZED 2");
  const { game, b } = skirmish();
  b.effects = [{ kind: "Smoke", turns: 2 }];
  const intel = baseIntel(game, b);
  assert.deepEqual(intel.effects, [{ id: "Smoke", label: "In smoke", turns: 2, detail: "+30 defense, −30 aim" }]);
});

test("the hit preview counts effects on the shooter and on the target", () => {
  const { game, a, h } = skirmish();
  a.aim = 65;
  a.range = 3;
  const open = game.chance(a, h);
  assert.ok(open > 0);
  h.effects = [{ kind: "Smoke", turns: 2 }];
  assert.equal(game.chance(a, h), Math.max(0, open - 30), "a target in smoke: 30 off");
  h.effects = [];
  a.effects = [{ kind: "Smoke", turns: 1 }];
  assert.equal(game.chance(a, h), Math.max(0, open - 30), "a shooter in smoke: 30 off its aim");
  a.effects = [{ kind: "Daze", turns: 1 }];
  // Dazed: aim 0, and the distance bonus still applies inside the range (no minimum).
  const d = Math.abs(a.pos[0] - h.pos[0]) + Math.abs(a.pos[1] - h.pos[1]);
  assert.equal(game.chance(a, h), Math.max(0, 5 * (a.range - d) - game.cover(h, a) - h.defense));
});

test("on a chain tile grid the odds are the contract's: 65, 35 in smoke, 0 dazed, 10 dazed up close", () => {
  const tiles: GroundTile[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({ t: "empty" }) as GroundTile));
  const scenario: Scenario = { ...blackRain, ground: { tiles, minX: 0, minZ: 0 }, noObjective: true };
  const { game, a, h } = skirmish(scenario);
  a.pos = [0, 4];
  h.pos = [0, 0];
  a.aim = 65;
  a.range = 4;
  h.defense = 0;
  assert.equal(game.chance(a, h), 65);
  h.effects = [{ kind: "Smoke", turns: 2 }];
  assert.equal(game.chance(a, h), 35);
  h.effects = [];
  a.effects = [{ kind: "Daze", turns: 2 }];
  assert.equal(game.chance(a, h), 0);
  h.pos = [0, 2];
  assert.equal(game.chance(a, h), 10, "a dazed range-4 shooter at distance 2");
  a.effects = [];
  assert.equal(game.chance(a, h), 75);
});

test("a hostile holding its ground flashbangs the squad, never its own side", () => {
  const { game, h, k, a, b } = skirmish();
  game.beginEnemy();
  h.pos = [0, -1];
  const choice = hostileThrow(game, h)!;
  assert.equal(choice.order, "flashbang");
  const caught = burstUnits(game, choice.at);
  assert.ok(caught.some((u) => u === a || u === b));
  assert.ok(!caught.some((u) => u.enemy), "no hostile in its own burst");
  void k;
  // Moved already (one AP left): it just shoots.
  h.ap = 1;
  assert.equal(hostileThrow(game, h), null);
});

test("a wounded hostile smokes itself when no flashbang is worth it, and none of the squad", () => {
  const { game, h } = skirmish();
  game.beginEnemy();
  h.actions = h.actions.filter((x) => x.kind !== "Flashbang");
  assert.equal(hostileThrow(game, h), null, "unhurt, it keeps the smoke");
  h.hp = Math.floor(h.maxHp / 2);
  const choice = hostileThrow(game, h)!;
  assert.equal(choice.order, "smoke-grenade");
  const caught = burstUnits(game, choice.at);
  assert.ok(caught.includes(h));
  assert.ok(caught.every((u) => u.enemy));
});

test("the hostile phase plays its throws and the effects that run out", () => {
  const { game, h } = skirmish();
  h.pos = [0, -1];
  const events = [...hostilePhase(game)];
  const start = events.findIndex((e) => e.type === "flashbang");
  assert.ok(start > 0, "the hostile threw its flashbang");
  assert.equal(events[start + 1]?.type, "effect-start");
  assert.ok(events.at(-1)!.type === "turn" || events.at(-1)!.type === "effect-end" || game.result);
});
