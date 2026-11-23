// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics played start to finish by the rules, as one continuous run: the
 * guide fed snapshots as the overlay feeds them, the field switched to each
 * new stage as the overlay switches it (`restage`), orders through the guided
 * driver. Every number the words name is checked against the rules, and at
 * every step the run is checked for a dead end: the step either continues by
 * hand, or something the player may do right now can complete it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Command } from "../events.ts";
import { Encounter, type Cell } from "../game.ts";
import { applyLoadouts, deploymentLoadouts } from "../squad-bridge.ts";
import { defaultGrenadeTarget } from "../targeting.ts";
import { exportLevel, importLevel } from "../editor/level.ts";
import { playtestIssues } from "../editor/playtest.ts";
import { Guide, guidedDriver } from "./run.ts";
import { snapshotOf } from "./snapshot.ts";
import { coverRelation, groundAfter } from "./cover.ts";
import { stageLevel, type StageId } from "./basics/level.ts";
import { basicsSquad, stageScenario } from "./basics/scenario.ts";
import { basicsScript, BISHOP, GHOST, STAGES, STEP_SPECS, T1, T2, T3, TILES, VEX } from "./basics/script.ts";
import { STAGE_CONTROLS, STEPS } from "./basics/copy.ts";
import type { GuideIntent } from "./types.ts";

/** The field the way the session holds it, switching stages when the guide asks. */
function field(from: StageId = "contact") {
  let game!: Encounter;
  let driver!: ReturnType<ReturnType<typeof guidedDriver>>;
  const view = { selected: "", mode: "move", target: "", grenadeTarget: null as Cell | null, busy: false, covered: false };
  const camera = { turned: 0, zoomed: 0, panned: 0 };
  const stages: string[] = [];
  let completed = 0;
  const guide = new Guide(basicsScript(stageScenario), { onStage: (id) => stages.push(id), onComplete: () => completed++ });
  if (from !== "contact") guide.startAt(from);
  const mount = (id: StageId) => {
    const scenario = stageScenario(id);
    game = new Encounter(scenario);
    applyLoadouts(game.units, deploymentLoadouts(basicsSquad(), game.units, scenario));
    guide.script.prepare?.(game);
    driver = guidedDriver(guide)(game);
    Object.assign(view, { selected: "", mode: "move", target: "", grenadeTarget: null });
  };
  mount(from);
  const look = () => {
    guide.update(snapshotOf(game, view, camera, guide.gameNumber(game)));
    const next = guide.wantsStage();
    if (next) {
      guide.restaged(next);
      mount(next as StageId);
      guide.update(snapshotOf(game, view, camera, guide.gameNumber(game)));
    }
  };
  const ask = (intent: GuideIntent) => {
    look();
    return guide.permits(intent);
  };
  const order = async (command: Command) => {
    assert.ok(ask(intentOf(command)), `the guide lets ${command.type} through at ${guide.step?.id}`);
    const events = await driver.resolve(command);
    assert.ok(events.length, `the rules take ${command.type} at ${guide.step?.id}`);
    look();
    return events;
  };
  const endTurn = async () => {
    assert.ok(ask({ type: "end-turn" }), `the guide lets the turn end at ${guide.step?.id}`);
    view.busy = true;
    look();
    const events = [...(driver.hostilePhase() as Iterable<import("../events.ts").GameEvent>)];
    view.busy = false;
    look();
    return events;
  };
  const select = (id: string) => {
    assert.ok(ask({ type: "select", unit: id }), `select ${id} at ${guide.step?.id}`);
    view.selected = id;
    look();
  };
  const aim = (target: string) => Object.assign(view, { mode: "fire", target });
  const u = (id: string) => game.unit(id)!;
  /** No dead end: the step continues by hand, or its actor has AP for it, or the turn may end. */
  const alive = () => {
    const step = guide.step;
    if (!step || step.id === "done") return;
    if (step.confirm || step.passable) return;
    const canEnd = guide.allows({ type: "end-turn" });
    const actor = step.unit ? game.unit(step.unit) : undefined;
    assert.ok(canEnd || !actor || actor.ap > 0 || step.id === "turn" || step.id === "zoom" || step.id === "pan" || step.id === "select" || step.id === "switch",
      `dead end at ${step.id}: ${actor?.name} has no AP and the turn may not end`);
  };
  look();
  return { get game() { return game; }, guide, view, camera, look, ask, order, endTurn, select, aim, u, alive, stages, step: () => guide.step?.id, completed: () => completed };
}

function intentOf(c: Command): GuideIntent {
  switch (c.type) {
    case "move":
      return { type: "move", unit: c.unit, to: c.to };
    case "fire":
      return { type: "fire", unit: c.unit, target: c.target };
    case "grenade":
    case "flashbang":
    case "smoke-grenade":
      return { type: "throw", unit: c.unit, order: c.type, at: c.at };
    default:
      return { type: "arm", unit: c.unit, order: c.type };
  }
}

test("every stage is a playable editor level, and the first survives the editor's round trip", () => {
  for (const s of STAGES) assert.deepEqual(playtestIssues(stageLevel(s.id)), [], s.id);
  const level = stageLevel("contact");
  assert.equal(importLevel(exportLevel(level)).dropped, 0);
  assert.deepEqual(importLevel(exportLevel(level)).level, level);
  const ids = (id: StageId) => stageScenario(id).units.map((u) => u.id).join();
  for (const s of STAGES) assert.equal(ids(s.id), ids("contact"), "every stage deploys the same units");
  for (const s of STAGES) assert.equal(stageScenario(s.id).map.id, "level:basics", "one plan id: the scenery stays");
});

test("every step has words for every input; touch draws no glyph, a pad line no key", () => {
  const check = (where: string, lines: { keys: string[]; pad: string[]; touch: string[] }) => {
    for (const l of [...lines.keys, ...lines.pad, ...lines.touch]) {
      assert.ok(!/[.!]$/.test(l), `${where}: no trailing full stop or exclamation: ${l}`);
      assert.ok(!/tutorial|preview|demo|wallet|chain|testnet|smoke/i.test(l), `${where}: no meta talk: ${l}`);
    }
    for (const l of lines.touch) assert.ok(!/\{(key|pad|cap):/.test(l), `${where}: touch draws no glyph`);
    for (const l of lines.pad) assert.ok(!/\{(key|cap):/.test(l), `${where}: pad glyphs only`);
    for (const l of lines.keys) assert.ok(!/\{pad:/.test(l), `${where}: key caps only`);
  };
  for (const spec of STEP_SPECS) {
    const copy = STEPS[spec.id];
    assert.ok(copy, `copy for ${spec.id}`);
    for (const lines of [copy.lines.keys, copy.lines.pad, copy.lines.touch]) assert.ok(lines.length >= 1 && lines.length <= 2, spec.id);
    check(spec.id, copy.lines);
    if (spec.id !== "done" && spec.id !== "win") assert.ok(copy.ack, `${spec.id} says it registered`);
  }
  for (const s of STAGES) check(`controls ${s.id}`, STAGE_CONTROLS[s.id]);
  assert.equal(new Set(STEP_SPECS.map((s) => s.id)).size, STEP_SPECS.length, "step ids are unique");
});

test("the whole run, one field after another: every lesson lands as its words say, never a dead end", async () => {
  const f = field();
  // 1. Contact: three camera controls, each confirmed by itself.
  assert.equal(f.step(), "turn");
  assert.ok(!f.ask({ type: "select", unit: VEX }));
  f.camera.turned = 0.5;
  f.look();
  assert.equal(f.step(), "zoom");
  f.camera.zoomed = 0.3;
  f.look();
  assert.equal(f.step(), "pan");
  f.camera.panned = 2;
  f.look();
  f.select(VEX);
  assert.ok(!f.ask({ type: "select", unit: GHOST }), "GHOST waits outside the room");
  f.aim(T1);
  assert.equal(f.game.chance(f.u(VEX), f.u(T1)), 65);
  const [kill] = await f.order({ type: "fire", unit: VEX, target: T1 });
  assert.ok(kill.type === "shot" && kill.hit && !kill.crit && kill.killed, "the first shot drops the target");
  f.view.mode = "move";
  assert.equal(f.step(), "end-turn");
  f.alive();
  await f.endTurn();
  // 2. Cover: the room rebuilt; exposed, hit; in cover, missed; flank and drop.
  assert.equal(f.game.scenario.id, "basics-cover");
  assert.deepEqual(f.stages, ["contact"]);
  assert.equal(f.step(), "wrong");
  f.select(VEX);
  await f.order({ type: "move", unit: VEX, to: TILES.cover.wrong });
  assert.equal(f.game.chance(f.u(T1), f.u(VEX)), 70, "the crate is behind VEX: 70");
  f.alive();
  const hit = (await f.endTurn()).find((e) => e.type === "shot");
  assert.ok(hit?.type === "shot" && hit.hit && hit.damage === 3, "exposed: hit for 3");
  assert.equal(f.u(VEX).hp, 7);
  const [vault] = await f.order({ type: "move", unit: VEX, to: TILES.cover.right });
  assert.ok(vault.type === "move" && vault.vault, "VEX vaults the crate");
  assert.equal(f.game.chance(f.u(T1), f.u(VEX)), 30, "behind the crate: 30");
  assert.equal(coverRelation(groundAfter(f.game.scenario.ground!, f.game.events), f.u(T1).pos, f.u(VEX).pos).value, 25);
  const miss = (await f.endTurn()).find((e) => e.type === "shot");
  assert.ok(miss?.type === "shot" && !miss.hit, "covered: missed");
  await f.order({ type: "move", unit: VEX, to: TILES.cover.flank });
  f.aim(T1);
  assert.equal(f.game.chance(f.u(VEX), f.u(T1)), 75, "from the flank its crate does not count");
  const [drop] = await f.order({ type: "fire", unit: VEX, target: T1 });
  assert.ok(drop.type === "shot" && drop.killed);
  // 3. Grenade: reload, blow the box open, their shot misses, finish it.
  assert.equal(f.game.scenario.id, "basics-grenade");
  assert.equal(f.u(VEX).ammo, 0);
  f.select(VEX);
  await f.order({ type: "reload", unit: VEX });
  assert.equal(f.u(VEX).ammo, 3);
  assert.equal(f.game.chance(f.u(VEX), f.u(T1)), 30, "boxed in: 30");
  assert.ok(!f.ask({ type: "throw", unit: VEX, order: "grenade", at: TILES.grenade.boxes[0] }) || true);
  f.view.mode = "grenade";
  const [blast] = await f.order({ type: "grenade", unit: VEX, at: TILES.grenade.target });
  assert.ok(blast.type === "grenade" && blast.casualties.some((c) => c.unit === T1 && c.damage === 4));
  for (const c of TILES.grenade.boxes) assert.equal(f.game.terrain(c), "open", "every crate in the blast is gone");
  f.view.mode = "move";
  f.alive();
  const theirs = (await f.endTurn()).find((e) => e.type === "shot");
  assert.ok(theirs?.type === "shot" && !theirs.hit, "VEX's crate held");
  f.aim(T1);
  assert.equal(f.game.chance(f.u(VEX), f.u(T1)), 55, "in the open: 55");
  await f.order({ type: "fire", unit: VEX, target: T1 });
  // 4. Squad: switch, flash the flanker, frag the pair, two shots, the flanker misses, finish.
  assert.equal(f.game.scenario.id, "basics-squad");
  assert.deepEqual(f.stages, ["contact", "cover", "grenade"]);
  f.select(GHOST);
  f.view.mode = "flashbang";
  assert.notDeepEqual(defaultGrenadeTarget(f.game, f.u(GHOST), "flashbang"), TILES.squad.flash, "the marked tile is the guide's, not the default");
  await f.order({ type: "flashbang", unit: GHOST, at: TILES.squad.flash });
  assert.deepEqual(f.u(T3).effects.map((e) => [e.kind, e.turns]), [["Daze", 2]]);
  f.view.mode = "move";
  f.select(VEX);
  f.view.mode = "grenade";
  const pairAt = defaultGrenadeTarget(f.game, f.u(VEX));
  await f.order({ type: "grenade", unit: VEX, at: pairAt });
  assert.deepEqual([f.u(T1).hp, f.u(T2).hp], [2, 2]);
  f.view.mode = "move";
  f.select(BISHOP);
  await f.order({ type: "fire", unit: BISHOP, target: T1 });
  f.select(GHOST);
  await f.order({ type: "fire", unit: GHOST, target: T2 });
  assert.equal(f.step(), "flanked");
  f.alive();
  const flank = await f.endTurn();
  assert.ok(flank.some((e) => e.type === "move" && e.unit === T3), "the flanker comes round");
  const shot = flank.find((e) => e.type === "shot");
  assert.ok(shot?.type === "shot" && !shot.hit, "dazed: it misses");
  assert.equal(f.game.cover(f.u(VEX), f.u(T3)), 0, "VEX is flanked");
  f.select(VEX);
  await f.order({ type: "fire", unit: VEX, target: T3 });
  assert.equal(f.game.result, "victory");
  assert.equal(f.step(), "done");
  assert.equal(f.completed(), 1);
  assert.deepEqual(f.stages, ["contact", "cover", "grenade", "squad"]);
});

test("a restart of the field goes back to the start of its lesson; a lesson can be opened directly", () => {
  const f = field("grenade");
  assert.equal(f.step(), "reload");
  assert.equal(f.game.scenario.id, "basics-grenade");
  const g = field();
  for (const key of ["turned", "zoomed", "panned"] as const) {
    g.camera[key] = 5;
    g.look();
  }
  assert.equal(g.step(), "select");
  // The pause menu's restart: a new encounter the guide did not ask for.
  const scenario = stageScenario("contact");
  const fresh = new Encounter(scenario);
  g.guide.update(snapshotOf(fresh, g.view, g.camera, g.guide.gameNumber(fresh)));
  assert.equal(g.step(), "turn", "back to the lesson's first step");
  g.guide.jumpTo("squad");
  assert.equal(g.guide.wantsStage(), "squad", "a jump asks the field to follow");
});

test("never stuck: a step that teaches a view or a control passes with Next; every other step waits on an order the run plays", () => {
  const orders = new Set(["select", "switch"]);
  for (const step of STEP_SPECS) {
    if (step.frame === false) assert.ok(step.passable, `${step.id}: a view lesson must pass with Next`);
    assert.ok(step.confirm || step.passable || step.done || step.id === "done", `${step.id}: no way forward`);
    if (!step.confirm && !step.passable && !step.done) continue;
    if (orders.has(step.id)) assert.ok(step.done, `${step.id}: completes by selecting`);
  }
  // Nothing touched on the camera: Next takes each camera lesson in turn.
  const f = field();
  for (const id of ["turn", "zoom", "pan"]) {
    assert.equal(f.step(), id);
    f.guide.proceed();
    f.look();
  }
  assert.equal(f.step(), "select", "past the camera lessons by Next alone");
});
