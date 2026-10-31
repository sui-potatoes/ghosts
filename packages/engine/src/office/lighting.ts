// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { officeProps } from "./plan.ts";
import type { TimeOfDay } from "../scene-weather.ts";

/** Fixed indoor sources. Eight wide ceiling spots, three task lamps and two
 * doorway lights; only two ceiling spots allocate shadow maps. No frame work. */
export function addOfficeLighting(scene: T.Scene) {
  const housing = new T.MeshStandardMaterial({ color: 0x303b40, metalness: 0.6, roughness: 0.45 });
  const trim = new T.MeshStandardMaterial({ color: 0x9ba8a7, metalness: 0.7, roughness: 0.4 });
  const diffuser = new T.MeshStandardMaterial({ color: 0xe4eee6, emissive: 0xd5eddf, emissiveIntensity: 2.8, roughness: 0.65 });
  const warm = new T.MeshStandardMaterial({ color: 0xffdfad, emissive: 0xffc47a, emissiveIntensity: 2.5 });
  const access = new T.MeshStandardMaterial({ color: 0x96dfd3, emissive: 0x68cbb7, emissiveIntensity: 2.2 });
  const cube = new T.BoxGeometry(1, 1, 1);
  let parent: T.Object3D = scene;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material) => {
    const mesh = new T.Mesh(cube, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    // Fixture housings must not shadow their own emitters.
    mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const positions: [number, number][] = [];
  for (const z of [-1.7, 4.1]) for (const x of [-5.4, 0, 5.4]) positions.push([x, z]);
  positions.push([-5.4, -7.05], [5.4, -7.05]);
  positions.forEach(([x, z], i) => {
    // Slim suspended battens preserve the roofless tactical view.
    box(x, 3.08, z, 1.65, 0.075, 0.3, housing);
    box(x, 3.038, z, 1.54, 0.018, 0.24, diffuser);
    // A narrow upper lens makes the lit fixture legible from the tactical camera.
    box(x, 3.122, z, 1.54, 0.009, 0.045, diffuser);
    for (const end of [-0.72, 0.72]) box(x + end, 3.09, z, 0.035, 0.09, 0.32, trim);
    const light = new T.SpotLight(i >= 6 ? 0xd7e9f6 : 0xe4f0e2, i >= 6 ? 48 : 70, i >= 6 ? 5.5 : 8, 1.04, 0.72, 2);
    light.name = `office-ceiling-${i}`;
    light.position.set(x, 2.99, z); light.target.position.set(x, 0, z);
    light.castShadow = i === 0 || i === 2;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.15; light.shadow.camera.far = 8;
    light.shadow.bias = -0.0003; light.shadow.normalBias = 0.025;
    light.shadow.radius = 3;
    scene.add(light, light.target);
  });

  // Lamps sit on existing reception / workstation desks. The heads point at the work surface.
  for (const [x, z] of [[-8.53, 6.85], [5.84, 6.49], [-7.2, -2.45]]) {
    const fixture = new T.Group();
    fixture.userData.supportProp = officeProps.filter(p => p.office?.kind === "desk" || p.office?.kind === "desk-tucked" || p.office?.kind === "corner-desk")
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0].id;
    scene.add(fixture); parent = fixture;
    box(x, 0.785, z, 0.19, 0.035, 0.14, housing);
    box(x, 0.97, z, 0.024, 0.35, 0.024, trim);
    box(x + 0.055, 1.14, z, 0.14, 0.025, 0.025, trim);
    box(x + 0.1, 1.12, z, 0.22, 0.055, 0.15, housing);
    box(x + 0.1, 1.088, z, 0.18, 0.012, 0.12, warm);
    const lamp = new T.SpotLight(0xffcb8c, 3.5, 2.1, 1.0, 0.85, 2);
    lamp.name = "office-task-lamp";
    lamp.position.set(x + 0.1, 1.07, z); lamp.target.position.set(x + 0.2, 0.74, z - 0.13);
    fixture.add(lamp, lamp.target);
    parent = scene;
  }

  for (const x of [-4.05, 4.05]) {
    box(x, 2.83, -5.38, 0.62, 0.19, 0.13, housing);
    box(x, 2.83, -5.305, 0.54, 0.12, 0.02, access);
    // Simple illuminated doorway marker, readable without a texture download.
    box(x - 0.13, 2.83, -5.29, 0.018, 0.08, 0.008, housing);
    box(x + 0.06, 2.83, -5.29, 0.14, 0.018, 0.008, housing);
    const light = new T.PointLight(0x8cdcca, 1.2, 1.5, 2);
    light.name = "office-access-light"; light.position.set(x, 2.76, -5.16); scene.add(light);
  }
}

/** Interior exposure and diffuse bounce replace the outdoor sun/sky model.
 * Time changes window-side fill; the office's electric fixtures stay on. */
export function applyOfficeLighting(scene: T.Scene, key: T.DirectionalLight,
  ambient: T.HemisphereLight, rim: T.DirectionalLight, time: TimeOfDay) {
  scene.background = new T.Color(0x10191f);
  scene.fog = null;
  key.intensity = 0; key.castShadow = false;
  ambient.color.setHex(0xd1e1df); ambient.groundColor.setHex(0x45443a);
  ambient.intensity = time === "day" ? 1.05 : 0.85;
  rim.color.setHex(time === "evening" ? 0xffd7b1 : 0xadc7db);
  rim.position.set(16, 5, -4); rim.intensity = time === "day" ? 0.4 : 0.18;
  rim.castShadow = false;
  return 1.25;
}
