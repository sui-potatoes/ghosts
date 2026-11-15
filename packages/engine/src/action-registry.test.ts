// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIONS,
  actionName,
  actionSpec,
  commandsOf,
  GRENADE_DAMAGE,
  GRENADE_RADIUS,
  GRENADE_RANGE,
  kindOfTag,
  loadoutActions,
  MAX_RANGE_OFFSET,
  refusalOf,
  type Refusal,
} from "./action-registry.ts";
import { Encounter, type Unit } from "./game.ts";
import { blackRain } from "./scenario.ts";
import { deploymentLoadouts } from "./squad-bridge.ts";
import { effectiveStats, effectLines, effectsTag, type EffectSpec } from "./status-effects.ts";
import catalog from "../../catalog/actions.json" with { type: "json" };

const move = (path: string) => readFileSync(new URL(`../../../move/packages/ghosts/sources/${path}`, import.meta.url), "utf8");

/** `ActionKind`'s variants in tag order, read from the Move source. */
function chainKinds(): string[] {
  const body = /public enum ActionKind[^{]*\{([\s\S]*?)\n\}/.exec(move("map/action.move"))![1];
  return [...body.matchAll(/^\s*([A-Z]\w*),/gm)].map((m) => m[1]);
}

/** The error constants a `Unit.perform_*` function asserts, in order. */
function unitAsserts(fn: string): string[] {
  const src = move("map/unit.move");
  const start = src.indexOf(`public fun ${fn}(`);
  const body = src.slice(start, src.indexOf("\n}\n", start));
  return [...body.matchAll(/assert!\([^;]*?,\s*(E\w+)\)/g)].map((m) => m[1]);
}

/** A Move constant's value. */
const constant = (path: string, name: string) => Number(new RegExp(`const ${name}: \\w+ = (\\d+);`).exec(move(path))![1]);

test("the registry has every ActionKind tag of action.move, under its catalog id and tag", () => {
  const kinds = chainKinds();
  assert.deepEqual(kinds, ["Move", "Attack", "Reload", "Grenade"]);
  kinds.forEach((kind, tag) => {
    const spec = actionSpec(kind);
    assert.ok(spec, `${kind} is in the registry`);
    assert.equal(spec.tag, tag, `${kind} tag`);
    assert.equal(spec.status, "chain");
    assert.equal(kindOfTag(tag), kind);
  });
  // Engine-only kinds never claim a tag.
  for (const spec of ACTIONS.filter((a) => a.status !== "chain")) assert.equal(spec.tag, null, spec.id);
});

test("names, descriptions and costs come from the catalog, and the costs are the contract's", () => {
  for (const spec of ACTIONS) {
    const entry = catalog.actions.find((a) => a.id === spec.id)!;
    assert.equal(spec.name, entry.name);
    assert.equal(spec.description, entry.description);
    assert.equal(spec.ap, entry.ap);
  }
  // `perform_move`, `perform_reload` and `perform_grenade` decrease AP by 1; `perform_attack` depletes it.
  const unit = move("map/unit.move");
  assert.match(unit, /public fun perform_move[\s\S]*?unit\.ap\.decrease\(1\)/);
  assert.match(unit, /public fun perform_reload[\s\S]*?unit\.ap\.decrease\(1\)/);
  assert.match(unit, /public fun perform_grenade[\s\S]*?unit\.ap\.decrease\(1\)/);
  assert.match(unit, /public fun perform_attack[\s\S]*?unit\.ap\.deplete\(\)/);
  assert.deepEqual(
    ["Move", "Attack", "Reload", "Grenade"].map((id) => actionSpec(id)!.ap),
    [1, "all", 1, 1],
  );
  assert.equal(actionSpec("Attack")!.endsActivation, true);
  assert.equal(GRENADE_RANGE, constant("map/map.move", "GRENADE_RANGE"));
  assert.equal(GRENADE_RADIUS, constant("map/map.move", "GRENADE_RADIUS"));
  assert.equal(GRENADE_DAMAGE, constant("map/map.move", "GRENADE_DAMAGE"));
  assert.equal(MAX_RANGE_OFFSET, constant("map/unit.move", "MAX_RANGE_OFFSET"));
});

/** A player's unit in a fresh demo encounter, carrying exactly `actions`. */
function unitWith(actions: Unit["actions"]) {
  const game = new Encounter();
  const u = game.allies[0];
  u.actions = actions;
  return { game, u };
}

test("a unit's commands are its actions, in its order: unarmed has no Attack or Reload, no utility no Grenade", () => {
  const unarmed = unitWith(loadoutActions({ armed: false, utilities: [[{ kind: "Grenade", uses: 1 }]] }));
  assert.deepEqual(commandsOf(unarmed.game, unarmed.u).map((c) => c.kind), ["Move", "Grenade"]);
  const rifle = unitWith(loadoutActions({ armed: true, utilities: [[]] }));
  assert.deepEqual(commandsOf(rifle.game, rifle.u).map((c) => c.kind), ["Move", "Attack", "Reload"]);
  // Two grenades are one command with their uses summed; the contract spends the first with a use.
  const two = unitWith([
    { kind: "Move", uses: null },
    { kind: "Grenade", uses: 1 },
    { kind: "Grenade", uses: 2 },
  ]);
  const [, grenade] = commandsOf(two.game, two.u);
  assert.equal(grenade.uses, 3);
  // The demo adds its own orders after the chain's, Extract only where there is an objective.
  assert.deepEqual(
    loadoutActions({ armed: true, utilities: [], demo: { extract: true } }).map((a) => a.kind),
    ["Move", "Attack", "Reload", "Overwatch", "Hunker", "Secure"],
  );
  assert.deepEqual(
    loadoutActions({ armed: false, utilities: [], demo: { extract: false } }).map((a) => a.kind),
    ["Move", "Hunker"],
  );
});

test("demo units carry what their loadout gives, like chain units", () => {
  const game = new Encounter();
  const [a, b] = game.allies;
  const recruit = (id: string, primary: string | null, utility: string | null) =>
    ({ id, equipment: { primary, sidearm: "k12", armor: null, utility } }) as never;
  const loadouts = deploymentLoadouts([recruit(a.id, null, "frag"), recruit(b.id, "mx4", null)], game.units, blackRain);
  assert.deepEqual(loadouts.get(a.id)!.actions.map((x) => x.kind), ["Move", "Grenade", "Hunker", "Secure"]);
  assert.deepEqual(loadouts.get(a.id)!.actions.find((x) => x.kind === "Grenade"), { kind: "Grenade", uses: 1 });
  assert.ok(!loadouts.get(b.id)!.actions.some((x) => x.kind === "Grenade"), "no frag, no grenade");
  assert.ok(loadouts.get(b.id)!.actions.some((x) => x.kind === "Attack"));
  for (const foe of game.enemies) {
    // hostiles are built from their kit too, with the orders of a chain unit and none of the demo's
    assert.deepEqual(loadouts.get(foe.id)!.actions.map((x) => x.kind), ["Move", "Attack", "Reload"]);
  }
});

test("limited uses go down with each throw and refuse at zero", () => {
  const { game, u } = unitWith([
    { kind: "Move", uses: null },
    { kind: "Grenade", uses: 1 },
  ]);
  u.pos = [0, 0];
  assert.equal(commandsOf(game, u)[1].uses, 1);
  assert.ok(game.throwGrenade(u, [2, 0]));
  const [, spent] = commandsOf(game, u);
  assert.equal(spent.uses, 0);
  assert.equal(spent.refusal, "no-uses");
  assert.equal(game.throwGrenade(u, [2, 0]), false);
  assert.deepEqual(u.actions[1], { kind: "Grenade", uses: 0 }, "the spent action stays on the unit, as on chain");
});

/** The refusal each contract assert stands for. */
const ASSERT_REFUSAL: Record<string, Refusal | null> = {
  EActionNotAllowed: null, // never offered: the command isn't on the bar
  ENoAP: "no-ap",
  EOutOfAmmo: "no-ammo",
  EFullAmmo: "full-ammo",
  ERangeExceeded: null, // a target's range, judged when it is picked
};

test("each refusal is the contract's assert for that case, in the contract's order", () => {
  const cases: [fn: string, kind: string, broken: (u: Unit) => void, fixes: ((u: Unit) => void)[]][] = [
    ["perform_move", "Move", (u) => (u.ap = 0), [(u) => (u.ap = 2)]],
    ["perform_reload", "Reload", (u) => ((u.ap = 0), (u.ammo = u.clip)), [(u) => (u.ap = 2), (u) => (u.ammo = 0)]],
    ["perform_attack", "Attack", (u) => ((u.ap = 0), (u.ammo = 0)), [(u) => (u.ap = 2), (u) => (u.ammo = 1)]],
  ];
  for (const [fn, kind, broken, fixes] of cases) {
    const expected = unitAsserts(fn)
      .map((e) => ASSERT_REFUSAL[e])
      .filter((r): r is Refusal => !!r);
    const { game, u } = unitWith(loadoutActions({ armed: true, utilities: [] }));
    broken(u);
    const seen: (Refusal | null)[] = [];
    for (const fix of fixes) {
      seen.push(refusalOf(game, u, kind));
      fix(u);
    }
    assert.deepEqual(seen, expected, fn);
    assert.equal(refusalOf(game, u, kind), null, `${fn}: available once every assert holds`);
  }
  // `perform_grenade`: AP, then a use (`spend_use` aborts with ENoUsesLeft).
  assert.deepEqual(unitAsserts("perform_grenade"), ["EActionNotAllowed", "ENoAP"]);
  assert.match(move("map/unit.move"), /fun spend_use[\s\S]*?ENoUsesLeft/);
  const { game, u } = unitWith([{ kind: "Grenade", uses: 0 }]);
  u.ap = 0;
  assert.equal(refusalOf(game, u, "Grenade"), "no-ap");
  u.ap = 2;
  assert.equal(refusalOf(game, u, "Grenade"), "no-uses");
});

test("the turn's own asserts come first: game over, not your turn, out of time", () => {
  const { game, u } = unitWith(loadoutActions({ armed: true, utilities: [] }));
  game.beginEnemy();
  assert.equal(refusalOf(game, u, "Move"), "not-your-turn");
  game.nextTurn();
  game.turnDeadline = 1_000;
  assert.equal(refusalOf(game, u, "Move", 2_000), "turn-over");
  assert.equal(refusalOf(game, u, "Move", 500), null);
  game.turnDeadline = undefined;
  for (const e of game.enemies) e.hp = 0;
  game.secured = true;
  assert.equal(refusalOf(game, u, "Move"), "game-over");
  // The order matches `begin_turn_action`: over, then the side, then the clock.
  const turn = move("ghosts.move");
  const begin = turn.slice(turn.indexOf("fun begin_turn_action"));
  assert.ok(begin.indexOf("ENotYourTurn") < begin.indexOf("ETurnExpired"));
});

test("a kind the client doesn't know shows by its catalog name, refused, and leaves the rest alone", () => {
  const { game, u } = unitWith([
    { kind: "Move", uses: null },
    { kind: "#9", uses: 2 },
    { kind: "StunGrenade", uses: 1 },
    { kind: "Attack", uses: null },
  ]);
  const commands = commandsOf(game, u);
  assert.deepEqual(commands.map((c) => c.kind), ["Move", "#9", "StunGrenade", "Attack"]);
  assert.equal(commands[1].name, "Action 9");
  assert.equal(commands[1].refusal, "unsupported");
  assert.equal(commands[1].spec, undefined);
  assert.equal(commands[2].name, "Stun grenade");
  assert.equal(commands[2].refusal, "unsupported");
  assert.equal(commands[0].refusal, null);
  assert.equal(commands[3].refusal, null);
  assert.equal(actionName("#3"), "Grenade", "a tag the catalog knows reads by its name");
});

test("the demo's own orders are not offered as available in a match against a player", () => {
  const versus = new Encounter({ ...blackRain, versus: true });
  const u = versus.allies[0];
  u.actions = loadoutActions({ armed: true, utilities: [], demo: { extract: false } });
  const refused = commandsOf(versus, u).filter((c) => c.refusal === "unsupported").map((c) => c.kind);
  assert.deepEqual(refused, ["Overwatch", "Hunker"]);
});

test("effect slots: empty without effects, filled from fixture data, base stats untouched", () => {
  const { u } = unitWith([]);
  assert.deepEqual(u.effects, []);
  assert.deepEqual(effectLines(u.effects), []);
  assert.equal(effectsTag(u.effects), "");
  const fixture: EffectSpec[] = [
    { id: "Smoke", tag: 0, name: "Smoke", description: "Harder to hit, harder to aim.", icon: "eye", modifies: { aim: -20, defense: 25 } },
  ];
  const effects = [
    { kind: "Smoke", turns: 2 },
    { kind: "#7", turns: 1 },
    { kind: "Smoke", turns: 0 },
  ];
  assert.deepEqual(
    effectLines(effects, fixture).map((e) => [e.name, e.turns]),
    [
      ["Smoke", 2],
      ["Effect 7", 1],
    ],
  );
  assert.equal(effectsTag(effects, fixture), "SMOKE 2 · EFFECT 7 1");
  const base = { aim: 10, defense: 0, mobility: 7, armor: 1 };
  assert.deepEqual(effectiveStats(base, effects, fixture), { aim: 0, defense: 25, mobility: 7, armor: 1 });
  assert.deepEqual(base, { aim: 10, defense: 0, mobility: 7, armor: 1 }, "the base is never written");
});
