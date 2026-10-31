// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { localDriver, type DriverFactory } from "./driver.ts";
import type { GameEvent } from "./events.ts";
import { Encounter } from "./game.ts";

test("the local driver answers orders with the rules' events, already applied", async () => {
  const g = new Encounter(),
    d = localDriver(g),
    [u] = g.allies;
  const events = await d.resolve({ type: "move", unit: u.id, to: [-3, 3] });
  assert.equal(events[0].type, "move");
  assert.deepEqual(u.pos, [-3, 3]);
  assert.deepEqual(await d.resolve({ type: "reload", unit: u.id }), [], "refused orders are empty");
});

test("the local hostile phase stays lazy under for-await", async () => {
  const g = new Encounter(),
    d = localDriver(g);
  const phase = d.hostilePhase();
  assert.equal(g.phase, "player", "nothing happens until the first event is asked for");
  const seen: GameEvent[] = [];
  for await (const event of phase) seen.push(event);
  assert.equal(seen[0].type, "hostile-phase");
  assert.deepEqual(seen.at(-1), { type: "turn", turn: 2 });
  assert.deepEqual(seen, g.events);
});

test("an async driver may decide elsewhere and ingest what it is handed", async () => {
  // A stand-in for the chain: a second encounter decides, this one ingests.
  const oracle = new Encounter();
  const chainLike: DriverFactory = (game) => ({
    async resolve(command) {
      await Promise.resolve(); // the transaction in flight
      const events = oracle.apply(command);
      for (const event of events) game.ingest(event);
      return events;
    },
    hostilePhase: () => [],
  });
  const g = new Encounter(),
    d = chainLike(g),
    [u] = g.allies;
  const events = await d.resolve({ type: "move", unit: u.id, to: [-3, 3] });
  assert.equal(events.length, 1);
  assert.deepEqual(g.unit(u.id)!.pos, [-3, 3]);
  assert.deepEqual(g.units, oracle.units);
  assert.deepEqual(g.events, oracle.events);
});
