// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { allLooks } from "../scene-look.ts";
import { ambiencePlan, MIN_GAP, OneShotScheduler, seeded, FAR_RANGE } from "./ambience-model.ts";
import { SLOTS } from "./manifest.ts";

const BOUNDS = { minX: -20, maxX: 20, minZ: -15, maxZ: 15 };

test("every look on every location has a bed and only names ambience slots", () => {
  for (const location of ["street", "office"] as const)
    for (const look of [...allLooks(), null]) {
      const plan = ambiencePlan(location, look);
      const beds = Object.keys(plan.beds);
      assert.ok(beds.length > 0);
      for (const id of [...beds, ...plan.oneShots.map((r) => r.slot)]) {
        assert.ok(id in SLOTS, id);
        assert.equal(SLOTS[id as keyof typeof SLOTS].bus, "ambience");
      }
      assert.ok(plan.air > 0);
    }
});

test("rain follows the look: heavy, light, none; the office hears it faintly", () => {
  const heavy = ambiencePlan("street", { time: "night", weather: "heavy-rain" });
  const light = ambiencePlan("street", { time: "night", weather: "light-rain" });
  const clear = ambiencePlan("street", { time: "night", weather: "clear" });
  assert.ok(heavy.beds["ambience.rain.bed.a"]! > light.beds["ambience.rain.bed.a"]!);
  assert.equal(clear.beds["ambience.rain.bed.a"], undefined);
  assert.ok(heavy.oneShots.some((r) => r.slot === "ambience.rain.oneshot.thunder"));
  assert.ok(!light.oneShots.some((r) => r.slot === "ambience.rain.oneshot.thunder"));
  const office = ambiencePlan("office", { time: "night", weather: "heavy-rain" });
  assert.ok(office.beds["ambience.office.bed"]);
  assert.ok(office.beds["ambience.rain.bed.a"]! < heavy.beds["ambience.rain.bed.a"]!);
  assert.ok(!ambiencePlan("office", { time: "day", weather: "clear" }).beds["ambience.rain.bed.a"]);
});

test("fog muffles the air; nights bring more sirens than days", () => {
  assert.ok(ambiencePlan("street", { time: "dusk", weather: "fog" }).air < ambiencePlan("street", { time: "dusk", weather: "clear" }).air);
  const sirens = (time: "night" | "day") =>
    ambiencePlan("street", { time, weather: "clear" }).oneShots.find((r) => r.slot === "ambience.city.oneshot.siren")!.perMinute;
  assert.ok(sirens("night") > sirens("day"));
});

test("the seeded generator repeats per seed and differs across seeds", () => {
  const a = seeded(7), b = seeded(7), c = seeded(8);
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
});

test("one-shots come at the plan's rate, never closer than the gap, near on the field and far past it", () => {
  const plan = ambiencePlan("street", { time: "night", weather: "heavy-rain" });
  const scheduler = new OneShotScheduler(42);
  const total = plan.oneShots.reduce((s, r) => s + r.perMinute, 0);
  let time = 0;
  const counts = new Map<string, number>();
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const shot = scheduler.next(plan, BOUNDS, () => 0.1)!;
    assert.ok(shot.delay >= MIN_GAP);
    assert.ok(shot.rate >= 0.9 && shot.rate <= 1.1);
    time += shot.delay;
    counts.set(shot.slot, (counts.get(shot.slot) ?? 0) + 1);
    const rule = plan.oneShots.find((r) => r.slot === shot.slot)!;
    if (rule.range === "near") {
      assert.ok(shot.x >= BOUNDS.minX && shot.x <= BOUNDS.maxX && shot.z >= BOUNDS.minZ && shot.z <= BOUNDS.maxZ);
    } else {
      const radius = Math.hypot(20, 15);
      const d = Math.hypot(shot.x, shot.z);
      assert.ok(d >= radius + FAR_RANGE[0] - 1e-9 && d <= radius + FAR_RANGE[1] + 1e-9);
    }
  }
  // The gap floor slows the busiest plans a little; the mean stays near the plan's rate.
  const perMinute = (N / time) * 60;
  assert.ok(perMinute > total * 0.6 && perMinute <= total * 1.05, `${perMinute} vs ${total}`);
  // The drip is the commonest sound of a rainy night.
  const drips = counts.get("ambience.rain.oneshot.drip")!;
  for (const [slot, n] of counts) if (slot !== "ambience.rain.oneshot.drip") assert.ok(n < drips);
});

test("the same seed schedules the same ambience", () => {
  const plan = ambiencePlan("office", null);
  const a = new OneShotScheduler(3), b = new OneShotScheduler(3);
  for (let i = 0; i < 20; i++) assert.deepEqual(a.next(plan, BOUNDS, () => 0.05), b.next(plan, BOUNDS, () => 0.05));
});

test("a plan without one-shots schedules nothing", () => {
  assert.equal(new OneShotScheduler(1).next({ beds: {}, oneShots: [], air: 1000 }, BOUNDS, () => 0), null);
});
