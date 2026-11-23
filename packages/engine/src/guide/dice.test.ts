// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The guide's fixed dice against the rules' own shots: what `seedFor` promises is what `Encounter.shoot` rolls. */
import assert from "node:assert/strict";
import test from "node:test";
import { Encounter } from "../game.ts";
import { blackRain } from "../scenario.ts";
import { fixShot, rollShot, seedFor } from "./dice.ts";

/** Black Rain with VEX and WRAITH–01 in line of sight, given the numbers asked for. */
function duel(shooter: Partial<ReturnType<Encounter["unit"]> & object>, target: Partial<ReturnType<Encounter["unit"]> & object>) {
  const game = new Encounter(blackRain);
  const a = game.unit("v")!,
    b = game.unit("h1")!;
  Object.assign(a, { pos: [0, 2], ...shooter });
  Object.assign(b, { pos: [0, -1], ...target });
  return { game, a, b };
}

test("the outcome rolled for a seed is the shot the rules take with it", () => {
  const stats = [
    [{ damage: 4, spread: 2, plusOne: 10, critChance: 10 }, { armor: 0, dodge: 0 }],
    [{ damage: 5, spread: 1, plusOne: 20, critChance: 20 }, { armor: 1, dodge: 10 }],
    [{ damage: 6, spread: 0, plusOne: 0, critChance: 10 }, { armor: 2, dodge: 30 }],
  ] as const;
  for (const [shooter, target] of stats)
    for (let seed = 1; seed < 400; seed += 7) {
      const { game, a, b } = duel(shooter, target);
      const chance = game.chance(a, b);
      const expected = rollShot(seed, a, b, chance);
      game.seed = seed;
      const [shot] = game.apply({ type: "fire", unit: a.id, target: b.id });
      assert.ok(shot?.type === "shot");
      assert.deepEqual([shot.hit, shot.crit, shot.damage], [expected.hit, expected.crit, expected.damage], `seed ${seed}`);
    }
});

test("a seed is found for a sure miss and for an exact plain hit", () => {
  const { game, a, b } = duel({ damage: 4, spread: 2, plusOne: 10, critChance: 10 }, { armor: 1, dodge: 10 });
  const chance = game.chance(a, b);
  for (const damage of [1, 2, 3, 4, 5, 6]) {
    const seed = seedFor(a, b, chance, { hit: true, damage });
    assert.notEqual(seed, null, `damage ${damage}`);
    assert.deepEqual(rollShot(seed!, a, b, chance), { hit: true, crit: false, damage });
  }
  assert.equal(seedFor(a, b, chance, { hit: true, damage: 40 }), null, "never more than the weapon can do");
  const miss = seedFor(a, b, chance, { hit: false });
  assert.equal(rollShot(miss!, a, b, chance).hit, false);
});

test("fixShot sets the dice only for a shot the rules allow", () => {
  const { game, a, b } = duel({ damage: 4, spread: 2, plusOne: 10, critChance: 10 }, { armor: 0, dodge: 0 });
  fixShot(game, { type: "fire", unit: a.id, target: b.id }, { hit: true, damage: 5 });
  const [shot] = game.apply({ type: "fire", unit: a.id, target: b.id });
  assert.ok(shot?.type === "shot" && shot.hit && shot.damage === 5);
  const seed = game.seed;
  fixShot(game, { type: "fire", unit: a.id, target: "nobody" }, { hit: false });
  fixShot(game, { type: "reload", unit: a.id }, { hit: false });
  assert.equal(game.seed, seed);
});
