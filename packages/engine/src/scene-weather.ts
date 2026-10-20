// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from 'three';

export const timePresets = {
  morning: { sky: 0x9caebc, fog: 0xb5b9bb, density: .014, sun: 0xffd2a0, strength: 3.8, position: [-24, 13, -12], ambient: 1.35, rim: .25, exposure: 1.05, lights: false, mist: 0xc3c3bf },
  day: { sky: 0x98b8cf, fog: 0xb4c7d4, density: .009, sun: 0xfff3df, strength: 4.8, position: [-8, 35, 12], ambient: 1.7, rim: .2, exposure: 1, lights: false, mist: 0xc6d3d9 },
  evening: { sky: 0x4b4356, fog: 0x82747f, density: .017, sun: 0xffae70, strength: 3.2, position: [24, 10, 8], ambient: .85, rim: .4, exposure: 1.08, lights: true, mist: 0xb5a3b5 },
  night: { sky: 0x0c1019, fog: 0x252b3b, density: .019, sun: 0xc6d2ed, strength: 3.6, position: [-16, 18, 5], ambient: .95, rim: .55, exposure: 1.12, lights: true, mist: 0x9aa8c0 },
} as const;
export type TimeOfDay = keyof typeof timePresets;

/** Reuses existing lights and materials; shadow maps refresh only on preset changes. */
export function applyTimeOfDay(scene: T.Scene, sun: T.DirectionalLight, ambient: T.HemisphereLight, rim: T.DirectionalLight, time: TimeOfDay) {
  const p = timePresets[time];
  (scene.background as T.Color).setHex(p.sky);
  const fog = scene.fog as T.FogExp2;
  fog.color.setHex(p.fog); fog.density = p.density;
  sun.color.setHex(p.sun); sun.intensity = p.strength;
  sun.position.set(p.position[0], p.position[1], p.position[2]);
  ambient.color.setHex(time === 'night' ? 0xaebbd6 : p.fog);
  ambient.groundColor.setHex(time === 'night' ? 0x14131a : 0x48454a);
  ambient.intensity = p.ambient; rim.intensity = p.rim;
  const materials = new Set<T.Material>();
  scene.traverse(o => {
    if (o instanceof T.Light && typeof o.userData.nightIntensity === 'number')
      o.intensity = p.lights ? o.userData.nightIntensity : 0;
    if (o instanceof T.Light && typeof o.userData.dayOffIntensity === 'number')
      o.intensity = time === 'day' ? 0 : o.userData.dayOffIntensity;
    if (o instanceof T.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  for (const m of materials) {
    if (m instanceof T.MeshStandardMaterial && typeof m.userData.nightGlow === 'number')
      m.emissiveIntensity = p.lights ? m.userData.nightGlow : 0;
    if (m instanceof T.MeshStandardMaterial && typeof m.userData.dayOffGlow === 'number')
      m.emissiveIntensity = time === 'day' ? 0 : m.userData.dayOffGlow;
  }
  return p;
}
