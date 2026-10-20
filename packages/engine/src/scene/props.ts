// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { Cell } from "../map";
import type { Space } from "./space";

/** Shared materials and the cover barriers and relay station the rules place. */

const materialCache = new Map<string, T.MeshStandardMaterial>();
export function mat(color: T.ColorRepresentation, metalness = 0.35, roughness = 0.65) {
  const key = `${color}:${metalness}:${roughness}`;
  if (!materialCache.has(key))
    materialCache.set(key, new T.MeshStandardMaterial({ color, metalness, roughness }));
  return materialCache.get(key)!;
}

export const concrete = mat(0x343842),
  edge = mat(0x626672),
  metal = mat(0x242833, 0.75, 0.3),
  dark = mat(0x11151e),
  amber = new T.MeshStandardMaterial({ color: 0xffc476, emissive: 0xff9b33, emissiveIntensity: 2.4 }),
  cyan = new T.MeshStandardMaterial({ color: 0xd8e2ff, emissive: 0x829bdf, emissiveIntensity: 2.1 });

const cube = new T.BoxGeometry(1, 1, 1);

function box(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  m: T.Material = concrete,
) {
  const o = new T.Mesh(cube, m);
  o.position.set(x, y, z);
  o.scale.set(w, h, d);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

function cyl(parent: T.Object3D, x: number, y: number, z: number, r: number, h: number, m: T.Material = metal) {
  const o = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  parent.add(o);
  return o;
}

/** A striped concrete barrier on every low-cover cell. */
export function buildCovers(scene: T.Scene, space: Space) {
  for (const cell of space.map.covers) {
    const g = new T.Group();
    g.position.copy(space.vec(cell));
    scene.add(g);
    const barrier = new T.BoxGeometry(1.22, 0.86, 0.66);
    const positions = barrier.attributes.position;
    for (let i = 0; i < positions.count; i++)
      if (positions.getY(i) > 0) positions.setZ(i, positions.getZ(i) * 0.4);
    barrier.computeVertexNormals();
    const body = new T.Mesh(barrier, mat(0x8f918d, 0.03, 0.94));
    body.position.y = 0.47;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    box(g, 0, 0.09, 0, 1.3, 0.18, 0.72, mat(0x7b7f7d, 0.03, 0.94));
    for (const side of [-1, 1]) {
      box(g, 0, 0.77, side * 0.143, 1.15, 0.18, 0.025, mat(0xdd9b38, 0.05, 0.7));
      for (let j = 0; j < 5; j++)
        box(g, -0.45 + j * 0.225, 0.77, side * 0.161, 0.075, 0.17, 0.015, dark).rotation.z = -0.45;
    }
    for (const n of [-1, 1]) box(g, n * 0.43, 0.94, 0, 0.09, 0.08, 0.1, amber);
  }
}

/** The relay station on the objective cell, with its beacon and light. */
export function buildRelay(scene: T.Scene, space: Space, relay: Cell) {
  const station = new T.Group();
  station.position.copy(space.vec(relay));
  scene.add(station);
  cyl(station, 0, 0.15, 0, 0.6, 0.3, metal);
  box(station, 0, 0.8, 0, 0.55, 1.3, 0.55, dark);
  box(station, 0, 1.13, 0.285, 0.4, 0.52, 0.02, cyan);
  box(station, 0, 1.55, 0, 0.72, 0.12, 0.72, edge);
  const pillar = new T.Mesh(
    new T.CylinderGeometry(0.025, 0.025, 5, 8),
    new T.MeshBasicMaterial({ color: 0xeac78a, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  pillar.position.y = 3;
  station.add(pillar);
  const ring = new T.Mesh(
    new T.RingGeometry(0.75, 0.8, 48),
    new T.MeshBasicMaterial({ color: 0xf4c583, transparent: true, opacity: 0.65, side: T.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  station.add(ring);
  const light = new T.PointLight(0x9eafff, 5, 6);
  light.position.copy(space.vec(relay, 2));
  scene.add(light);
}
