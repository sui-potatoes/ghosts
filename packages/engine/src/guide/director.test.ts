// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { back, current, finished, forward, initialState, observe, permits, proceed, restart, skip, type StepSpec } from "./director.ts";
import type { GuideSnapshot } from "./types.ts";

const snap = (over: Partial<GuideSnapshot> = {}): GuideSnapshot => ({
  game: 1,
  turn: 1,
  phase: "player",
  result: null,
  busy: false,
  covered: false,
  selected: "",
  mode: "move",
  target: "",
  throwAt: null,
  units: [],
  events: [],
  camera: { turned: 0, zoomed: 0, panned: 0 },
  ...over,
});

const STEPS: StepSpec[] = [
  { id: "pick", done: (now) => now.selected === "a", permits: (i) => i.type === "select" },
  { id: "read", confirm: true, permits: () => false },
  { id: "go", done: (now, start) => now.turn > start.turn, busy: true, permits: (i) => i.type === "end-turn" },
  { id: "end" },
];

test("a step completes only when its predicate holds, then the next begins", () => {
  let s = observe(STEPS, initialState(), snap());
  assert.equal(current(STEPS, s)?.id, "pick");
  s = observe(STEPS, s, snap({ selected: "b" }));
  assert.equal(current(STEPS, s)?.id, "pick");
  s = observe(STEPS, s, snap({ selected: "a" }));
  assert.equal(current(STEPS, s)?.id, "read");
  assert.equal(s.view, 1);
  assert.equal(s.start?.selected, "a", "the next step begins on the field that completed the last");
});

test("a step that only tells waits for the player to continue", () => {
  let s = observe(STEPS, initialState(), snap({ selected: "a" }));
  s = observe(STEPS, s, snap({ selected: "a", turn: 5 }));
  assert.equal(current(STEPS, s)?.id, "read", "observing never passes a step that only tells");
  s = proceed(STEPS, s, snap({ selected: "a" }));
  assert.equal(current(STEPS, s)?.id, "go");
  assert.equal(proceed(STEPS, s, snap()), s, "continue does nothing on a step that waits for an order");
});

test("the field is not judged under a dialog, nor mid-animation unless the step says so", () => {
  let s = observe(STEPS, initialState(), snap({ selected: "a", covered: true }));
  assert.equal(current(STEPS, s)?.id, "pick");
  s = observe(STEPS, s, snap({ selected: "a", busy: true }));
  assert.equal(current(STEPS, s)?.id, "pick", "a move still animating has not landed yet");
  s = proceed(STEPS, observe(STEPS, s, snap({ selected: "a" })), snap({ selected: "a" }));
  s = observe(STEPS, s, snap({ turn: 2, busy: true }));
  assert.equal(current(STEPS, s)?.id, "end", "a busy step completes while the scene plays on");
  assert.ok(!finished(STEPS, s), "the closing step stays");
});

test("only what the step allows goes through; nothing is held once the run is left", () => {
  const s = observe(STEPS, initialState(), snap());
  assert.ok(permits(STEPS, s, { type: "select", unit: "a" }, snap()));
  assert.ok(!permits(STEPS, s, { type: "end-turn" }, snap()));
  assert.ok(!permits(STEPS, s, { type: "move", unit: "a", to: [0, 0] }, snap()));
  assert.ok(permits(STEPS, skip(s), { type: "end-turn" }, snap()));
  assert.equal(current(STEPS, skip(s)), undefined);
});

test("back and forward read earlier steps without undoing them", () => {
  let s = observe(STEPS, initialState(), snap({ selected: "a" }));
  s = proceed(STEPS, s, snap({ selected: "a" }));
  assert.deepEqual([s.index, s.view], [2, 2]);
  s = back(back(back(s)));
  assert.deepEqual([s.index, s.view], [2, 0], "back stops at the first step");
  assert.equal(proceed(STEPS, back(s), snap()), back(s), "continue only acts on the step being played");
  s = forward(forward(forward(s)));
  assert.deepEqual([s.index, s.view], [2, 2], "forward stops at the step being played");
  // Playing on while reading back brings the new step into view.
  s = observe(STEPS, back(s), snap({ turn: 3 }));
  assert.deepEqual([s.index, s.view], [3, 3]);
});

test("a restart starts the run over on the new game", () => {
  let s = observe(STEPS, initialState(), snap({ selected: "a" }));
  s = restart(snap({ game: 2 }));
  assert.deepEqual([s.index, s.view, s.left], [0, 0, false]);
  assert.equal(s.start?.game, 2);
  // A snapshot of another game re-bases the step instead of judging it against the old one.
  const moved = observe(STEPS, { ...s, start: snap({ game: 1 }) }, snap({ game: 3, selected: "b" }));
  assert.equal(moved.start?.game, 3);
});

test("steps already done on arrival pass in one look", () => {
  const steps: StepSpec[] = [
    { id: "x", done: (now) => now.selected === "a" },
    { id: "y", done: (now) => now.selected === "a" },
    { id: "z" },
  ];
  const s = observe(steps, initialState(), snap({ selected: "a" }));
  assert.equal(current(steps, s)?.id, "z");
});
