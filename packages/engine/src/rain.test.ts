// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { LOOK } from "./scene/look.ts";
import { Precipitation } from "./scene/precipitation.ts";

type Particles = T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
const named = (weather: Precipitation, name: string) =>
  weather.group.children.find((o) => o.name === name) as Particles;

test("rain animates from one time uniform: seeds are never rewritten and the clock stops when it is off", () => {
  const weather = new Precipitation();
  try {
    const rain = named(weather, "GPU rain");
    const seeds = rain.geometry.getAttribute(
      "seed",
    ) as T.InstancedBufferAttribute;
    const before = seeds.array.slice(),
      version = seeds.version;
    for (let i = 0; i < 900; i++) weather.update(1);
    assert.deepEqual(seeds.array, before);
    assert.equal(seeds.version, version);
    assert.equal(weather.time, 900);
    weather.setKind("clear");
    weather.update(100);
    assert.equal(weather.time, 900, "clear weather does not run the clock");
    assert.equal(rain.visible, false);
    weather.setKind("rain");
    weather.update(1 / 60);
    assert(weather.time > 900);
    assert.equal(rain.visible, true);
  } finally {
    weather.dispose();
  }
});

test("rain is one draw call in battery saver; splashes, spray and the larger drop count come only off it", () => {
  const weather = new Precipitation();
  try {
    const rain = named(weather, "GPU rain"),
      splashes = named(weather, "GPU rain splashes");
    assert.equal(rain.geometry.instanceCount, LOOK.rain.drops.battery);
    assert.equal(splashes.visible, false);
    assert.equal(named(weather, "GPU rain spray").visible, false);
    assert.equal(weather.instances, LOOK.rain.drops.battery);
    weather.setBatterySaver(false);
    assert.equal(rain.geometry.instanceCount, LOOK.rain.drops.smooth);
    assert.equal(splashes.visible, true);
    assert.equal(
      weather.instances,
      LOOK.rain.drops.smooth + LOOK.rain.splashes,
    );
    for (const mesh of [rain, splashes]) {
      assert.equal(mesh.material.depthWrite, false);
      assert.equal(
        mesh.frustumCulled,
        false,
        "positions come from the shader, so bounds cannot cull",
      );
    }
  } finally {
    weather.dispose();
  }
});

test("the volume follows the camera's focus on the ground plane only", () => {
  const weather = new Precipitation();
  try {
    const { center, volume } = named(weather, "GPU rain").material.uniforms;
    weather.follow(new T.Vector3(7, 3, -4));
    assert.deepEqual(center.value.toArray(), [7, volume.value.y / 2, -4]);
  } finally {
    weather.dispose();
  }
});
