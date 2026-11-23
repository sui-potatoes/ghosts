// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics played start to finish by the rules: the guide fed snapshots as the
 * overlay would feed them, orders through the guided driver as the field
 * would send them, and every lesson's outcome checked against what the text
 * says happened.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Command } from "../events.ts";
import { Encounter, type Cell } from "../game.ts";
import { damagePreview, defaultGrenadeTarget } from "../targeting.ts";
import { applyLoadouts, deploymentLoadouts } from "../squad-bridge.ts";
import { importLevel, exportLevel } from "../editor/level.ts";
import { playtestIssues } from "../editor/playtest.ts";
import { Guide, guidedDriver } from "./run.ts";
import { snapshotOf } from "./snapshot.ts";
import { basicsLevel } from "./basics/level.ts";
import { basicsScenario, basicsSquad } from "./basics/scenario.ts";
import { basicsScript, GHOST, TILES, VEX, WRAITH_1, WRAITH_2 } from "./basics/script.ts";
import { STEPS } from "./basics/copy.ts";
import type { GuideIntent } from "./types.ts";

/** A field the way the session holds it, around a real encounter and the guided driver. */
function field() {
  const scenario = basicsScenario();
  const game = new Encounter(scenario);
  applyLoadouts(game.units, deploymentLoadouts(basicsSquad(), game.units, scenario));
  let completed = 0;
  const guide = new Guide(basicsScript, { onComplete: () => completed++ });
  const driver = guidedDriver(guide)(game);
  const view = { selected: "", mode: "move", target: "", grenadeTarget: null as Cell | null, busy: false, covered: false };
  const camera = { turned: 0, zoomed: 0, panned: 0 };
  const look = () => guide.update(snapshotOf(game, view, camera, guide.gameNumber(game)));
  const step = () => guide.step?.id;
  /** Ask, as the field's actions do; true when the guide lets it through. */
  const ask = (intent: GuideIntent) => {
    look();
    return guide.permits(intent);
  };
  const order = async (command: Command) => {
    const events = await driver.resolve(command);
    look();
    return events;
  };
  const endTurn = async () => {
    view.busy = true;
    look();
    for (const _ of driver.hostilePhase() as Iterable<unknown>) look();
    view.busy = false;
    look();
  };
  look();
  return { game, guide, view, camera, look, step, ask, order, endTurn, completed: () => completed };
}

test("the yard file is a playable editor level and survives the editor's round trip", () => {
  const level = basicsLevel();
  assert.deepEqual(playtestIssues(level), []);
  assert.deepEqual([level.width, level.depth], [12, 10]);
  assert.deepEqual(importLevel(exportLevel(level)).level, level);
  assert.equal(importLevel(exportLevel(level)).dropped, 0);
});

test("every step has words for every input, and touch never names a key or a button", () => {
  for (const spec of basicsScript.steps) {
    const copy = STEPS[spec.id];
    assert.ok(copy, `copy for ${spec.id}`);
    for (const lines of [copy.lines.keys, copy.lines.pad, copy.lines.touch]) {
      assert.ok(lines.length >= 1 && lines.length <= 2, `${spec.id}: one or two lines`);
      for (const line of lines) {
        assert.ok(!/[.!]$/.test(line), `${spec.id}: no trailing full stop or exclamation: ${line}`);
        assert.ok(!/tutorial|preview|demo|wallet|chain|testnet/i.test(line), `${spec.id}: no meta talk: ${line}`);
      }
    }
    for (const line of copy.lines.touch) assert.ok(!/\{(key|pad|cap):/.test(line), `${spec.id}: touch draws no glyph`);
    for (const line of copy.lines.pad) assert.ok(!/\{(key|cap):/.test(line), `${spec.id}: a pad line draws pad glyphs only`);
    for (const line of copy.lines.keys) assert.ok(!/\{pad:/.test(line), `${spec.id}: a keys line draws key caps only`);
  }
});

test("the run, start to finish: each lesson lands as its words say", async () => {
  const f = field();
  const { game, view, camera, ask, order, step } = f;
  const unit = (id: string) => game.unit(id)!;

  // Camera: nothing else goes until the view has turned, zoomed and panned.
  assert.equal(step(), "camera");
  assert.ok(!ask({ type: "select", unit: GHOST }));
  assert.equal(f.guide.nudge?.text, STEPS.camera.nudge);
  camera.turned = 0.5;
  camera.zoomed = 0.2;
  f.look();
  assert.deepEqual(f.guide.ticks(), [true, true, false]);
  assert.equal(step(), "camera");
  camera.panned = 2;
  f.look();

  // Select GHOST: any operator may be picked; the step waits for GHOST.
  assert.equal(step(), "select");
  assert.ok(ask({ type: "select", unit: VEX }));
  view.selected = VEX;
  f.look();
  assert.equal(step(), "select");
  view.selected = GHOST;
  f.look();

  // Move: only to the marked tile, and the move costs 1 of 2 AP.
  assert.equal(step(), "move");
  assert.ok(!ask({ type: "move", unit: GHOST, to: [4, 3] }));
  assert.ok(!ask({ type: "end-turn" }));
  assert.ok(!ask({ type: "arm", unit: GHOST, order: "fire" }));
  assert.ok(ask({ type: "move", unit: GHOST, to: TILES.ghostMove }));
  await order({ type: "move", unit: GHOST, to: TILES.ghostMove });
  assert.equal(unit(GHOST).ap, 1);

  // Vault: over the pallets onto the far tile, GHOST's last AP.
  assert.equal(step(), "vault");
  assert.ok(ask({ type: "move", unit: GHOST, to: TILES.ghostVault }));
  const [vault] = await order({ type: "move", unit: GHOST, to: TILES.ghostVault });
  assert.ok(vault.type === "move" && vault.vault && vault.path.length === 3, "one move, the pallets one tile of it");
  assert.equal(unit(GHOST).ap, 0);

  // Switch to VEX, then cover behind the crate: 25 off WRAITH–01's odds.
  assert.equal(step(), "switch");
  view.selected = VEX;
  f.look();
  assert.equal(step(), "cover");
  assert.ok(!ask({ type: "move", unit: VEX, to: [-1, 2] }));
  await order({ type: "move", unit: VEX, to: TILES.vexCover });
  assert.equal(game.cover(unit(VEX), unit(WRAITH_1)), 25);

  // Aim: WRAITH–01 is in sight; the wall hides WRAITH–02.
  assert.equal(step(), "aim");
  assert.ok(game.inRange(unit(VEX), unit(WRAITH_1)));
  assert.ok(!game.inRange(unit(VEX), unit(WRAITH_2)), "the wall hides WRAITH–02 from VEX");
  assert.ok(!ask({ type: "arm", unit: VEX, order: "grenade" }));
  assert.ok(ask({ type: "arm", unit: VEX, order: "fire" }));
  view.mode = "fire";
  view.target = WRAITH_1;
  f.look();

  // Fire: 65 at range 4, 25 off for the crate = 40; the shot lands as the readout's critical hit.
  assert.equal(step(), "shoot");
  assert.equal(game.chance(unit(VEX), unit(WRAITH_1)), 40);
  assert.ok(!ask({ type: "fire", unit: VEX, target: WRAITH_2 }));
  assert.ok(ask({ type: "fire", unit: VEX, target: WRAITH_1 }));
  assert.deepEqual(damagePreview(unit(VEX), unit(WRAITH_1)), { hit: 4, crit: 6, lethal: false });
  const [shot] = await order({ type: "fire", unit: VEX, target: WRAITH_1 });
  assert.ok(shot.type === "shot" && shot.hit && shot.crit && shot.damage === 6);
  assert.equal(unit(WRAITH_1).hp, 4);
  assert.equal(unit(VEX).ap, 0, "a shot spends every AP left");
  view.mode = "move";
  f.look();

  // End the turn; the hostile turn: WRAITH–01 misses VEX in cover, WRAITH–02 hits GHOST for 3.
  assert.equal(step(), "end-turn");
  assert.ok(!ask({ type: "move", unit: VEX, to: [-1, 2] }));
  assert.ok(ask({ type: "end-turn" }));
  const before = game.events.length;
  await f.endTurn();
  const shots = game.events.slice(before).filter((e) => e.type === "shot");
  assert.deepEqual(
    shots.map((e) => e.type === "shot" && [e.unit, e.target, e.hit, e.damage]),
    [
      [WRAITH_1, VEX, false, 0],
      [WRAITH_2, GHOST, true, 3],
    ],
  );
  assert.ok(!game.events.slice(before).some((e) => e.type === "move"), "nobody moves on the hostile turn");
  assert.equal(unit(GHOST).hp, 7);
  assert.equal(unit(GHOST).armor, 1, "the armour the words name");
  assert.equal(unit(VEX).hp, 10);
  assert.equal(game.turn, 2);

  // Damage: read, then continue.
  assert.equal(step(), "hit");
  f.look();
  assert.equal(step(), "hit");
  f.guide.proceed();

  // Reload: 2 of 3 rounds, 1 AP.
  assert.equal(step(), "reload");
  assert.equal(unit(VEX).ammo, 2);
  assert.ok(ask({ type: "arm", unit: VEX, order: "reload" }));
  await order({ type: "reload", unit: VEX });
  assert.deepEqual([unit(VEX).ammo, unit(VEX).ap], [3, 1]);

  // Grenade: only a landing that catches both Wraiths, both crates and none of the squad; the throw starts aimed there.
  assert.equal(step(), "grenade");
  assert.deepEqual(defaultGrenadeTarget(game, unit(VEX)), TILES.blast);
  assert.ok(ask({ type: "arm", unit: VEX, order: "grenade" }));
  assert.ok(!ask({ type: "throw", unit: VEX, order: "grenade", at: [-3, -3] }), "WRAITH–02 left out");
  assert.ok(ask({ type: "throw", unit: VEX, order: "grenade", at: TILES.blast }));
  const [blast] = await order({ type: "grenade", unit: VEX, at: TILES.blast });
  assert.ok(blast.type === "grenade");
  assert.deepEqual(
    blast.casualties.map((c) => [c.unit, c.damage, c.killed]).sort(),
    [
      [WRAITH_1, 4, true],
      [WRAITH_2, 4, false],
    ],
  );
  assert.equal(unit(WRAITH_2).hp, 6);
  for (const cell of TILES.crates) assert.equal(game.terrain(cell), "open", "the crates in the blast are gone");
  assert.equal(game.terrain(TILES.vexCrate), "obstacle", "VEX's own crate is out of the blast");

  // Flashbang: GHOST dazes WRAITH–02 and nobody of the squad.
  assert.equal(step(), "flash");
  assert.ok(ask({ type: "select", unit: GHOST }));
  view.selected = GHOST;
  assert.ok(!ask({ type: "arm", unit: GHOST, order: "fire" }));
  assert.ok(ask({ type: "arm", unit: GHOST, order: "flashbang" }));
  assert.ok(!ask({ type: "throw", unit: GHOST, order: "flashbang", at: [3, -2] }), "WRAITH–02 out of the burst");
  const flashAt = defaultGrenadeTarget(game, unit(GHOST), "flashbang");
  assert.ok(ask({ type: "throw", unit: GHOST, order: "flashbang", at: flashAt }), "the throw starts aimed where it should land");
  await order({ type: "flashbang", unit: GHOST, at: flashAt });
  assert.deepEqual(unit(WRAITH_2).effects.map((e) => [e.kind, e.turns]), [["Daze", 2]]);
  assert.deepEqual([unit(VEX).effects, unit(GHOST).effects], [[], []]);
  assert.equal(unit(GHOST).ap, 1, "the throw cost 1 AP");

  // The shot: 65 at GHOST's range 5, 10 off for the tile beyond, the cover gone; it downs WRAITH–02 and wins.
  assert.equal(step(), "finish");
  assert.equal(game.chance(unit(GHOST), unit(WRAITH_2)), 55);
  assert.equal(f.completed(), 0);
  assert.equal(damagePreview(unit(GHOST), unit(WRAITH_2)).crit, 6, "the readout's crit downs it");
  const [last] = await order({ type: "fire", unit: GHOST, target: WRAITH_2 });
  assert.ok(last.type === "shot" && last.hit && last.crit && last.killed);
  assert.equal(game.result, "victory");
  assert.equal(step(), "done");
  assert.equal(f.completed(), 1, "the host hears the run is done");
  f.look();
  assert.equal(f.completed(), 1, "once");
  assert.equal(basicsScript.steps.length - 1, 15, "15 steps before the closing card");
});

test("a restart starts the lessons over; skipping lifts every hold and plays the rules' own dice", async () => {
  const f = field();
  f.camera.turned = f.camera.zoomed = f.camera.panned = 5;
  f.look();
  assert.equal(f.step(), "select");
  // The encounter restarts: a new game under the same guide.
  const scenario = basicsScenario();
  const fresh = new Encounter(scenario);
  applyLoadouts(fresh.units, deploymentLoadouts(basicsSquad(), fresh.units, scenario));
  f.guide.update(snapshotOf(fresh, f.view, f.camera, f.guide.gameNumber(fresh)));
  assert.equal(f.step(), "camera");
  let left = 0;
  const g = new Guide(basicsScript, { onLeave: () => left++ });
  g.update(snapshotOf(fresh, f.view, f.camera, g.gameNumber(fresh)));
  assert.ok(!g.permits({ type: "end-turn" }));
  g.skip();
  assert.equal(left, 1);
  assert.ok(g.permits({ type: "end-turn" }));
  assert.equal(g.step, undefined);
});
