// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { LOOK } from "./scene/look.ts";
import { Precipitation } from "./scene/precipitation.ts";

type Particles = T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
const named = (weather: Precipitation, name: string) =>
  weather.group.children.find((o) => o.name === name) as Particles | undefined;

test("snow allocates on first use, leaves its seeds untouched and keeps a bounded draw budget", () => {
  const weather = new Precipitation();
  try {
    assert.equal(weather.kind, "rain");
    assert.equal(
      named(weather, "GPU snow"),
      undefined,
      "no snow buffers until requested",
    );
    assert.equal(weather.particles, 0);
    weather.setKind("snow");
    const snow = named(weather, "GPU snow")!;
    const seeds = snow.geometry.getAttribute(
      "seed",
    ) as T.InstancedBufferAttribute;
    const before = seeds.array.slice(),
      version = seeds.version;
    assert.equal(weather.particles, LOOK.snow.flakes.battery);
    for (let i = 0; i < 900; i++) weather.update(1);
    assert.deepEqual(seeds.array, before);
    assert.equal(seeds.version, version);
    weather.setBatterySaver(false);
    assert.equal(weather.particles, LOOK.snow.flakes.smooth);
    assert.equal(seeds.count, LOOK.snow.flakes.smooth);
    assert.equal(snow.material.depthWrite, false);
  } finally {
    weather.dispose();
  }
});

test("weather switches reuse snow, show one effect at a time, and release their resources", () => {
  const weather = new Precipitation();
  weather.setBatterySaver(false);
  weather.setKind("snow");
  const snow = named(weather, "GPU snow")!,
    rain = named(weather, "GPU rain")!,
    splashes = named(weather, "GPU rain splashes")!;
  const resources = [snow, rain, splashes].flatMap((mesh) => [
    mesh.geometry,
    mesh.material,
  ]);
  let disposed = 0;
  resources.forEach((resource) =>
    resource.addEventListener("dispose", () => disposed++),
  );
  for (let i = 0; i < 5; i++) {
    weather.setKind("snow");
    weather.update(1);
    assert.equal(rain.visible, false);
    assert.equal(splashes.visible, false);
    assert.equal(snow.visible, true);
    const time = weather.time;
    weather.setKind("clear");
    weather.update(30);
    assert.equal(weather.time, time);
    assert(weather.group.children.every((o) => !o.visible));
  }
  weather.setKind("rain");
  assert.equal(snow.visible, false);
  assert.equal(rain.visible, true);
  assert.equal(weather.group.children.length, 4, "snow is built once");
  weather.setBatterySaver(true);
  weather.setKind("snow");
  assert.equal(weather.particles, LOOK.snow.flakes.battery);
  weather.dispose();
  assert.equal(disposed, 6);
  assert.equal(weather.group.children.length, 0);
});
