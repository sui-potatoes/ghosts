// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter } from "./game.ts";
import * as T from "three";
import { hasExtraction } from "./scenario.ts";
import { buildRelay } from "./scene/props.ts";
import { Space } from "./scene/space.ts";
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

test("the extraction marker is built for Training and left out of a versus match", () => {
  const training = scenarioById("black-rain") ?? scenarios[0];
  const versus = { ...training, versus: true };
  const built = (scenario: typeof training) => {
    const scene = new T.Scene();
    const game = new Encounter(scenario);
    if (hasExtraction(scenario)) buildRelay(scene, new Space(game.map), game.relay);
    return scene.children.length;
  };
  assert.equal(hasExtraction(training), true);
  assert.ok(built(training) > 0, "Training draws the ring, beam and light");
  assert.equal(hasExtraction(versus), false);
  assert.equal(built(versus), 0, "a versus match draws none of it");
  assert.equal(hasExtraction({ ...training, noObjective: true }), false);
  assert.equal(new Encounter(versus).units.find((u) => !u.enemy)?.actions.includes("secure") ?? false, false);
});
