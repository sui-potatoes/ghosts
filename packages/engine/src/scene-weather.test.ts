// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { applyTimeOfDay, timePresets } from './scene-weather.ts';

test('daytime disables fixture lights and emission, evening restores them without changing combat effects', () => {
  const scene = new T.Scene();
  scene.background = new T.Color(); scene.fog = new T.FogExp2();
  const sun = new T.DirectionalLight(), ambient = new T.HemisphereLight(), rim = new T.DirectionalLight();
  const lamp = new T.SpotLight(0xffffff, 95); lamp.userData.nightIntensity = 95;
  const flash = new T.PointLight(0xffffff, 12);
  const glow = new T.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.5 });
  glow.userData.nightGlow = 1.5;
  const vending = new T.PointLight(0xc8eeec, 5); vending.userData.dayOffIntensity = 5;
  const display = new T.MeshStandardMaterial({ emissive: 0xc8eeec, emissiveIntensity: 1.6 });
  display.userData.dayOffGlow = 1.6;
  scene.add(lamp, flash, vending, new T.Mesh(new T.BoxGeometry(), glow), new T.Mesh(new T.BoxGeometry(), display));
  for (const time of ['morning', 'day', 'evening', 'night', 'day', 'morning'] as const) {
    const p = applyTimeOfDay(scene, sun, ambient, rim, time);
    assert.equal(lamp.intensity, p.lights ? 95 : 0);
    assert.equal(glow.emissiveIntensity, p.lights ? 1.5 : 0);
    assert.equal(flash.intensity, 12);
    assert.equal(vending.intensity, time === 'day' ? 0 : 5);
    assert.equal(display.emissiveIntensity, time === 'day' ? 0 : 1.6);
    assert.equal(vending.castShadow, false);
    assert.deepEqual(sun.position.toArray(), [...timePresets[time].position]);
    assert.equal(scene.background.getHex(), p.sky);
    assert.equal(scene.fog.density, p.density);
  }
});
