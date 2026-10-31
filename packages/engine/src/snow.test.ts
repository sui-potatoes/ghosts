// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { Precipitation } from "./scene/precipitation.ts";
import { Snow, SNOW_PARTICLES } from "./scene/snow.ts";

test("snow animation leaves particle buffers untouched and uses a bounded draw budget", () => {
  const snow = new Snow();
  try {
    const { geometry, material } = snow.mesh;
    const positions = geometry.getAttribute("position") as T.BufferAttribute;
    const flakes = geometry.getAttribute("flake") as T.BufferAttribute;
    const before = positions.array.slice(), seeds = flakes.array.slice();
    const version = positions.version;
    assert.equal(geometry.drawRange.count, SNOW_PARTICLES.battery);
    for (let i = 0; i < 900; i++) snow.update(1);
    assert.deepEqual(positions.array, before);
    assert.deepEqual(flakes.array, seeds);
    assert.equal(positions.version, version);
    assert.equal(material.uniforms.time.value, 900);
    snow.mesh.visible = false; snow.update(100);
    assert.equal(material.uniforms.time.value, 900);
    snow.mesh.visible = true; snow.update(1 / 60);
    assert(material.uniforms.time.value > 900);
    snow.setBatterySaver(false);
    assert.equal(geometry.drawRange.count, positions.count);
    assert.equal(positions.count, SNOW_PARTICLES.smooth);
    snow.setViewportHeight(1080);
    assert.equal(material.uniforms.viewportHeight.value, 1080);
    assert.equal(material.depthWrite, false);
  } finally { snow.dispose(); }
});

test("weather switches reuse snow, stop hidden effects, and release their resources", () => {
  const weather = new Precipitation();
  assert.equal(weather.kind, "rain");
  assert.equal(weather.group.children.length, 1, "no snow buffers until requested");
  weather.setBatterySaver(false);
  weather.setViewportHeight(720);
  weather.setKind("snow");
  const snow = weather.group.children.find((o) => o instanceof T.Points) as T.Points<T.BufferGeometry, T.ShaderMaterial>;
  const rain = weather.group.children.find((o) => o instanceof T.LineSegments) as T.LineSegments;
  const rainPositions = rain.geometry.getAttribute("position").array.slice();
  assert.equal(weather.particles, 2400);
  assert.equal(snow.material.uniforms.viewportHeight.value, 720);
  const resources = [snow.geometry, snow.material, rain.geometry, rain.material as T.Material];
  let disposed = 0;
  resources.forEach((resource) => resource.addEventListener("dispose", () => disposed++));
  for (let i = 0; i < 5; i++) {
    weather.setKind("snow"); weather.update(1);
    assert.equal(rain.visible, false);
    assert.deepEqual(rain.geometry.getAttribute("position").array, rainPositions);
    const time = snow.material.uniforms.time.value;
    weather.setKind("clear"); weather.update(30);
    assert.equal(snow.material.uniforms.time.value, time);
    assert(weather.group.children.every((o) => !o.visible));
  }
  weather.setKind("rain");
  assert.equal(snow.visible, false); assert.equal(rain.visible, true);
  weather.update(1);
  assert.notDeepEqual(rain.geometry.getAttribute("position").array, rainPositions);
  weather.setBatterySaver(true); weather.setKind("snow");
  assert.equal(weather.particles, 900);
  assert.equal(weather.group.children.length, 2);
  weather.dispose();
  assert.equal(disposed, 4);
  assert.equal(weather.group.children.length, 0);
});
