// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { hostilePhase } from "../ai.ts";
import { loadoutActions, usesLeft } from "../action-registry.ts";
import type { GameEvent } from "../events.ts";
import { distance, Encounter, key, type Cell, type Unit } from "../game.ts";
import { blackRain } from "../scenario.ts";
import { Destruction, loadDestruction } from "../scene/destruction.ts";
import { opensTurn, rebuildEncounter, turnAt, turnsOf } from "./timeline.ts";

/** The squad's gear for these games: every ally carries all three grenades. */
function prepare(game: Encounter) {
  for (const u of game.units.filter((u) => !u.enemy))
    u.actions = loadoutActions({
      armed: true,
      utilities: [
        [{ kind: "Grenade", uses: 1 }],
        [{ kind: "Flashbang", uses: 1 }],
        [{ kind: "SmokeGrenade", uses: 1 }],
      ],
      demo: { extract: true },
    });
}

const nearest = (game: Encounter, from: Cell) =>
  [...game.enemies].sort((a, b) => distance(a.pos, from) - distance(b.pos, from))[0];

/** One ally's go: a throw at a hostile in reach, else a shot, else a step closer. */
function act(game: Encounter, u: Unit) {
  for (let guard = 0; guard < 4 && u.hp > 0 && u.ap > 0 && !game.result; guard++) {
    const target = nearest(game, u.pos);
    if (!target) return;
    const throws = (["grenade", "flashbang", "smoke-grenade"] as const).filter(
      (order) => usesLeft(u, order === "grenade" ? "Grenade" : order === "flashbang" ? "Flashbang" : "SmokeGrenade") !== 0,
    );
    const order = throws[0];
    const at: Cell = order === "smoke-grenade" ? u.pos : target.pos;
    const closer = () => {
      let best: Cell | null = null;
      for (const [, path] of game.paths(u)) {
        const end = path[path.length - 1];
        if (key(end) === key(u.pos)) continue;
        if (!best || distance(end, target.pos) < distance(best, target.pos)) best = end;
      }
      return !!best && game.apply({ type: "move", unit: u.id, to: best }).length > 0;
    };
    if (order && game.apply({ type: order, unit: u.id, at }).length) continue;
    if (distance(u.pos, target.pos) > 4 && u.ap > 1 && closer()) continue;
    if (game.chance(u, target) > 0 && u.ammo > 0 && game.apply({ type: "fire", unit: u.id, target: target.id }).length) continue;
    if (u.ammo === 0 && game.apply({ type: "reload", unit: u.id }).length) continue;
    if (!closer()) return;
  }
}

/** Everything the rules hold that a rebuild must bring back. */
function state(game: Encounter) {
  return {
    units: structuredClone(game.units),
    props: game.map.props.map((p) => [p.id, game.map.health(p.id)]),
    // the cover the rules read, not only the props' health behind it
    covers: game.map.covers.map(key).sort(),
    coverBy: game.units.map((u) => [u.id, game.cover(u), game.coverAt(u.pos)]),
    turn: game.turn,
    phase: game.phase,
    secured: game.secured,
    kills: { ...game.kills },
    result: game.result,
    log: [...game.log],
  };
}

/** A whole game, played by the bundled rules on both sides, with the state after every order and every hostile event. */
function playGame(turns = 10) {
  const game = new Encounter(blackRain);
  prepare(game);
  const snapshots = new Map<number, ReturnType<typeof state>>([[0, state(game)]]);
  const snap = () => snapshots.set(game.events.length, state(game));
  for (let t = 0; t < turns && !game.result; t++) {
    for (const u of game.allies) {
      act(game, u);
      snap();
    }
    // Every state the hostile phase passes through, turn starts among them.
    for (const _ of hostilePhase(game)) snap();
  }
  return { game, snapshots };
}

test("a whole local game is rebuilt from its journal at every point of it, effects and deaths included", () => {
  const { game, snapshots } = playGame();
  const events = game.events;
  const turns = turnsOf(events);
  assert.ok(turns.length >= 6, `played ${turns.length} turns`);
  assert.ok(events.some((e) => e.type === "effect-start"), "a status effect landed");
  assert.ok(events.some((e) => e.type === "effect-end"), "a status effect ran out");
  assert.ok(events.some((e) => (e.type === "shot" && e.killed) || (e.type === "grenade" && e.casualties.some((c) => c.killed))), "a unit fell");
  // The state after every order and every hostile event, as the game was played.
  for (const [index, expected] of snapshots) {
    const rebuilt = rebuildEncounter(blackRain, events, index, prepare);
    const actual = state(rebuilt);
    assert.deepEqual(actual.units, expected.units, `units after ${index} events`);
    assert.deepEqual(actual.props, expected.props, `props after ${index} events`);
    assert.deepEqual(actual.covers, expected.covers, `cover after ${index} events`);
    assert.deepEqual(actual.coverBy, expected.coverBy, `cover readouts after ${index} events`);
    assert.deepEqual([actual.turn, actual.phase, actual.secured, actual.result], [expected.turn, expected.phase, expected.secured, expected.result]);
    assert.deepEqual(actual.kills, expected.kills);
    assert.deepEqual(actual.log, expected.log);
  }
  const end = rebuildEncounter(blackRain, events, events.length, prepare);
  assert.deepEqual(state(end), state(game));
});

test("rebuilding to a turn start equals playing to it, for several turns", () => {
  const { game } = playGame(8);
  const turns = turnsOf(game.events);
  // Play the journal forward once, comparing against a fresh rebuild at each turn start.
  const forward = new Encounter(blackRain);
  prepare(forward);
  let cursor = 0;
  for (const turn of turns) {
    while (cursor < turn.start) forward.ingest(game.events[cursor++]);
    assert.deepEqual(state(rebuildEncounter(blackRain, game.events, turn.start, prepare)), state(forward), `turn at ${turn.start}`);
  }
});

test("turns: one per side's go, the side named by the event that opens it, kills counted", () => {
  const events: GameEvent[] = [
    { type: "move", unit: "a", path: [[0, 0], [0, 1]], vault: false, cover: false },
    { type: "hostile-phase" },
    { type: "effect-end", unit: "a", kind: "Smoke" },
    { type: "shot", unit: "h", target: "a", hit: true, crit: false, damage: 9, killed: true, reaction: false },
    { type: "turn", turn: 2 },
    { type: "grenade", unit: "b", at: [0, 0], casualties: [{ unit: "h", damage: 5, killed: true }, { unit: "i", damage: 5, killed: false }] },
  ];
  const turns = turnsOf(events);
  assert.deepEqual(turns, [
    { start: 0, side: 0, round: 1, kills: 0 },
    { start: 2, side: 1, round: 1, kills: 1 },
    { start: 5, side: 0, round: 2, kills: 1 },
  ]);
  assert.deepEqual(
    turnsOf(events, 0, 0).map((t) => t.round),
    [0, 0, 2],
    "a chain match opens on round 0 (the number its players see), and a turn event names its round",
  );
  assert.equal(turnAt(turns, 0), 0);
  assert.equal(turnAt(turns, 1), 0);
  assert.equal(turnAt(turns, 2), 1);
  assert.equal(turnAt(turns, 4), 1);
  assert.equal(turnAt(turns, 5), 2);
  assert.equal(turnAt(turns, 6), 2);
  assert.equal(turnsOf([], 1)[0].side, 1, "a match may open on side 1's turn");
});

/** What the scene would draw for an encounter's map: which props are standing. */
async function standing(game: Encounter) {
  const destruction = new Destruction(game.map, () => {});
  try {
    return game.map.props.filter((p) => destruction.isPropVisible(p.id)).map((p) => p.id);
  } finally {
    destruction.dispose();
  }
}

test("destroyed cover follows the cursor: gone from the blast on, back when stepping before it", async () => {
  await loadDestruction();
  const base = new Encounter(blackRain);
  const [coverProp, other] = base.map.props.filter((p) => p.cover && !p.covers);
  const cell = coverProp.cover!;
  assert.ok(base.map.isCover(cell) && base.map.isCover(other.cover!));
  const thrower = base.allies[0];
  const events: GameEvent[] = [
    { type: "hostile-phase" },
    { type: "turn", turn: 2 },
    {
      type: "grenade",
      unit: thrower.id,
      at: cell,
      casualties: [],
      environment: [{ id: coverProp.id, hp: 0, destroyed: true }],
    },
    { type: "hostile-phase" },
    { type: "turn", turn: 3 },
  ];
  const before = 2;
  const at = 3;
  const covers = (index: number) => rebuildEncounter(blackRain, events, index, prepare).map.covers.map(key);
  // forward, then backward, then jumping about: the same state for the same cursor
  for (const order of [[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0], [3, 0, 5, 2, 4, 1]])
    for (const index of order) {
      const game = rebuildEncounter(blackRain, events, index, prepare);
      const gone = index >= at;
      assert.equal(game.map.isCover(cell), !gone, `cover on ${cell} after ${index} events`);
      assert.equal(game.map.isCover(other.cover!), true, "the other cover stands");
      assert.equal(game.map.covers.length, base.map.covers.length - (gone ? 1 : 0));
      assert.equal((await standing(game)).includes(coverProp.id), !gone, `prop drawn after ${index} events`);
    }
  assert.deepEqual(covers(before), covers(0));
  assert.deepEqual(covers(at), covers(5));
  assert.notDeepEqual(covers(before), covers(at));
  // played forward event by event, as a live game's rules take it, the state is the rebuilt one
  const forward = new Encounter(blackRain);
  prepare(forward);
  events.forEach((event, i) => {
    forward.ingest(event);
    assert.deepEqual(forward.map.covers.map(key).sort(), covers(i + 1).sort());
  });
});
