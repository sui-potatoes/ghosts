// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { hostilePhase } from "./ai.ts";
import { describe } from "./events.ts";
import { Encounter } from "./game.ts";

test("an order returns its events and a refused order returns none", () => {
  const g = new Encounter(),
    [u] = g.allies;
  assert.deepEqual(g.apply({ type: "move", unit: u.id, to: g.map.covers[0] }), []);
  assert.deepEqual(g.apply({ type: "reload", unit: u.id }), [], "full magazine");
  const [moved] = g.apply({ type: "move", unit: u.id, to: [-3, 3] });
  assert.equal(moved.type, "move");
  assert.equal(moved.type === "move" && moved.path.at(-1)!.join(), "-3,3");
  assert.deepEqual(g.apply({ type: "move", unit: "nobody", to: [0, 0] }), []);
});

test("the journal holds every event and the feed is written from it", () => {
  const g = new Encounter(),
    [u] = g.allies;
  g.apply({ type: "hunker", unit: u.id });
  assert.deepEqual(g.events, [{ type: "hunker", unit: u.id }]);
  assert.equal(g.log[0], `${u.name} hunkered down. Defense increased.`);
  assert.equal(describe({ type: "hostile-phase" }, String), null);
});

test("a grenade reports each casualty with the damage dealt", () => {
  const g = new Encounter(),
    [u] = g.allies,
    enemy = g.enemies[0];
  enemy.hp = 3;
  enemy.pos = [u.pos[0], u.pos[1] - 4];
  const [blast] = g.apply({ type: "grenade", unit: u.id, at: enemy.pos });
  assert.equal(blast.type, "grenade");
  if (blast.type !== "grenade") return;
  const hit = blast.casualties.find((c) => c.unit === enemy.id)!;
  assert.deepEqual(hit, { unit: enemy.id, damage: 3, killed: true });
  assert.equal(g.kills[u.id], 1);
});

test("the hostile phase is lazy, journaled and hands the turn back", () => {
  const g = new Encounter();
  const phase = hostilePhase(g);
  assert.equal(g.phase, "player", "nothing happens until the first event is asked for");
  const seen = [...phase];
  assert.equal(seen[0].type, "hostile-phase");
  assert.deepEqual(seen.at(-1), { type: "turn", turn: 2 });
  assert.deepEqual(seen, g.events);
  assert.equal(g.phase, "player");
  assert.ok(seen.some((e) => e.type === "move" || e.type === "shot"));
  assert.deepEqual([...hostilePhase(g)].length > 0, true, "the next turn plays again");
});

test("two encounters with the same seed play the same hostile phase", () => {
  const a = new Encounter(),
    b = new Encounter();
  assert.deepEqual([...hostilePhase(a)], [...hostilePhase(b)]);
});
