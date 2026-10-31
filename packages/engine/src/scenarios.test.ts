// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter } from "./game.ts";
import { scenarioById, scenarios } from "./scenarios.ts";

// Scenery for each map id is looked up in `scene/maps.ts` when the level boots.
test("every registered scenario deploys cleanly", () => {
  assert.ok(scenarios.length >= 1);
  for (const scenario of scenarios) {
    assert.equal(scenarioById(scenario.id), scenario);
    const g = new Encounter(scenario);
    assert.ok(g.allies.length > 0 && g.enemies.length > 0);
    assert.ok(g.map.open(scenario.relay), "the relay is a standable cell");
    for (const u of g.units) assert.ok(g.map.open(u.pos), `${u.id} deploys on open ground`);
  }
  assert.equal(scenarioById("no-such-level"), undefined);
});
