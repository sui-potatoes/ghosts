// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { Occluder } from "../scene/occlusion";
import { OfficeAssets } from "./assets";
import { addOfficeLighting } from "./lighting";
import { officeProps } from "./plan";
import { buildOfficeFloor } from "./flooring";

/** A roofless office cutaway. Tall opaque panels hide when they obscure the squad. */
export function buildOffice(scene: T.Scene): Occluder[] {
  const assets = new OfficeAssets();
  const occluders: Occluder[] = [];
  // Office props are drawn by Destruction, with the same meshes and live health.
  const slab = new T.Mesh(new T.BoxGeometry(20.55, 0.22, 17.85), assets.material(0x303d45));
  slab.position.set(0, -0.12, 0); slab.receiveShadow = true; scene.add(slab);
  scene.add(buildOfficeFloor());
  addOfficeLighting(scene);
  const wallLabel = (text: string, x: number, y: number, z: number, width: number) => {
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#27373e"; ctx.fillRect(0, 0, 1024, 128);
    ctx.font = "500 60px monospace"; ctx.fillStyle = "#d2e1d8"; ctx.textAlign = "center"; ctx.fillText(text, 512, 84);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.PlaneGeometry(width, width / 8), new T.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
    mesh.userData.supportProp = officeProps.filter(p => p.kind === "office-steel-wall" || p.kind === "office-window-wall")
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0].id;
    mesh.position.set(x, y, z); scene.add(mesh);
  };
  wallLabel("07 / PROCUREMENT", 0, 2.25, -8.68, 3.6);
  wallLabel("RECORDS / AUTHORIZED PERSONNEL", -0.65, 2.45, -5.31, 2.6);
  // All live resources are attached to the scene; Battlefield owns their disposal.
  return occluders;
}
