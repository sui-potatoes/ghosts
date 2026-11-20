// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALLOUT_LINE,
  CALLOUT_SECONDS,
  CALLOUT_STAGGER,
  Callouts,
  calloutFor,
  calloutLook,
  stackOffset,
  type CalloutNode,
  type Projected,
} from "./callouts.ts";
import { SceneClock } from "./clock.ts";

function node(): CalloutNode & { removed: boolean } {
  return {
    className: "",
    textContent: "",
    dataset: {},
    style: { transform: "", opacity: "", display: "" },
    removed: false,
    remove() {
      this.removed = true;
    },
  };
}

function field(reduced = false) {
  const clock = new SceneClock();
  const nodes: ReturnType<typeof node>[] = [];
  const callouts = new Callouts(
    { create: () => node(), append: (n) => nodes.push(n as ReturnType<typeof node>) },
    clock,
    () => reduced,
  );
  return { clock, nodes, callouts };
}

const project = (_a: unknown, _l: number, out: Projected) => {
  out.x = 400;
  out.y = 300;
  out.visible = true;
};
const anchor = { x: 1, y: 0, z: 2 };

test("every shot outcome maps to its callout kind and text", () => {
  assert.deepEqual(calloutFor({ hit: false, crit: false, damage: 0 }), { kind: "miss", text: "MISS" });
  assert.deepEqual(calloutFor({ hit: true, crit: false, damage: 3 }), { kind: "hit", text: "−3" });
  assert.deepEqual(calloutFor({ hit: true, crit: true, damage: 8 }), { kind: "crit", text: "CRIT −8" });
  assert.deepEqual(calloutFor({ hit: true, damage: 2 }), { kind: "hit", text: "−2" }, "a grenade casualty has no crit");
});

test("with the damage numbers off only MISS and CRIT are called out", () => {
  assert.deepEqual(calloutFor({ hit: false, damage: 0 }, false), { kind: "miss", text: "MISS" });
  assert.deepEqual(calloutFor({ hit: true, crit: true, damage: 8 }, false), { kind: "crit", text: "CRIT" });
  assert.equal(calloutFor({ hit: true, crit: false, damage: 3 }, false), null);
  const { callouts, nodes } = field();
  assert.equal(callouts.show({ hit: true, damage: 3 }, "u", anchor, false), false);
  assert.equal(nodes.length, 0);
});

test("a callout shows for its duration on the scene clock, then leaves the DOM", () => {
  const { clock, nodes, callouts } = field();
  assert.equal(callouts.show({ hit: false, damage: 0 }, "u", anchor), true);
  assert.equal(callouts.count, 1);
  assert.equal(nodes[0].textContent, "MISS");
  assert.equal(nodes[0].className, "shot-callout miss");
  clock.step(CALLOUT_SECONDS * 0.5);
  callouts.place(800, 600, project);
  assert.equal(nodes[0].style.display, "");
  assert.ok(nodes[0].style.transform.startsWith("translate(438.0px,"), "beside the target's projection");
  assert.equal(nodes[0].removed, false);
  clock.step(CALLOUT_SECONDS * 0.6);
  assert.equal(callouts.count, 0);
  assert.equal(nodes[0].removed, true);
  assert.equal(clock.pending, 0);
});

test("it follows the playback speed and holds at a time scale of 0", () => {
  const { clock, callouts, nodes } = field();
  callouts.show({ hit: true, crit: true, damage: 8 }, "u", anchor);
  clock.timeScale = 0;
  assert.equal(clock.moving, false);
  for (let i = 0; i < 120; i++) clock.step(1 / 60);
  assert.equal(callouts.count, 1, "held");
  clock.timeScale = 2;
  for (let i = 0; i < 31; i++) clock.step(1 / 60);
  assert.equal(callouts.count, 1, "2x: not done in 0.5 s");
  for (let i = 0; i < 30; i++) clock.step(1 / 60);
  assert.equal(callouts.count, 0, "2x: done by 1.1 s of scene time");
  assert.equal(nodes[0].removed, true);
});

test("a seek clears every callout at once, and its job leaves the clock", () => {
  const { clock, callouts, nodes } = field();
  callouts.show({ hit: false, damage: 0 }, "a", anchor);
  callouts.show({ hit: true, damage: 2 }, "b", anchor);
  clock.step(0.2);
  callouts.clear();
  assert.equal(callouts.count, 0);
  assert.ok(nodes.every((n) => n.removed));
  clock.step(0.01);
  assert.equal(clock.pending, 0);
  // `finish` (a seek's flush) leaves nothing either.
  callouts.show({ hit: false, damage: 0 }, "a", anchor);
  clock.flush();
  assert.equal(callouts.count, 0);
});

test("simultaneous callouts on one target stack and stagger; other targets are alone", () => {
  const { clock, callouts, nodes } = field();
  callouts.show({ hit: true, damage: 2 }, "t", anchor);
  callouts.show({ hit: true, damage: 2 }, "t", anchor);
  callouts.show({ hit: false, damage: 0 }, "t", anchor);
  callouts.show({ hit: false, damage: 0 }, "other", anchor);
  assert.deepEqual(nodes.map((n) => n.dataset.slot), ["0", "1", "2", "0"]);
  assert.deepEqual(stackOffset(0), { x: 0, y: 0 });
  assert.equal(stackOffset(1).y, -CALLOUT_LINE);
  assert.notDeepEqual(stackOffset(1), stackOffset(2));
  clock.step(0.01);
  callouts.place(800, 600, project);
  assert.equal(nodes[1].style.display, "none", "the second waits its beat");
  clock.step(CALLOUT_STAGGER);
  callouts.place(800, 600, project);
  assert.equal(nodes[1].style.display, "");
  const ys = nodes.slice(0, 2).map((n) => n.style.transform.split(",")[1]);
  assert.notEqual(ys[0], ys[1], "never at the same spot");
  // A freed slot is reused.
  clock.step(CALLOUT_SECONDS);
  callouts.show({ hit: false, damage: 0 }, "t", anchor);
  assert.equal(nodes.at(-1)!.dataset.slot, "0");
});

test("reduced motion: no pop and no rise, only the fade", () => {
  for (const t of [0, 0.1, 0.5, 0.9]) {
    const l = calloutLook(t, true);
    assert.equal(l.scale, 1);
    assert.equal(l.rise, 0);
  }
  assert.equal(calloutLook(0.2, true).opacity, 1);
  assert.ok(calloutLook(0.9, true).opacity < 0.5);
  assert.ok(calloutLook(1, true).opacity < 1e-9);
  assert.ok(calloutLook(0.05, false).scale < 1, "pops in");
  assert.ok(calloutLook(0.2, false).scale > 1, "overshoots");
  assert.ok(calloutLook(1, false).rise > calloutLook(0.3, false).rise, "rises");
  const { clock, callouts, nodes } = field(true);
  callouts.show({ hit: false, damage: 0 }, "u", anchor);
  clock.step(0.1);
  callouts.place(800, 600, project);
  assert.ok(nodes[0].style.transform.endsWith("scale(1.000)"));
});

test("a callout near the edge is held inside the field", () => {
  const { clock, callouts, nodes } = field();
  callouts.show({ hit: true, crit: true, damage: 8 }, "u", anchor);
  clock.step(0.2);
  const edge = (_a: unknown, _l: number, out: Projected) => {
    out.x = 790;
    out.y = -50;
    out.visible = true;
  };
  callouts.place(800, 600, edge);
  const [x, y] = nodes[0].style.transform.match(/translate\(([\d.]+)px,([\d.-]+)px\)/)!.slice(1).map(Number);
  assert.ok(x < 800 && x > 600);
  assert.ok(y >= 16);
});
