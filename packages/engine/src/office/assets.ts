// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// The roster itself is plain data in `catalog.ts`; this module authors the meshes.
export { officeCatalog, officeFinishes } from "./catalog.ts";
export type { OfficeKind, OfficeFinish } from "./catalog.ts";
import type { OfficeFinish, OfficeKind } from "./catalog.ts";

/** Metres, floor-origin, +Z is the front. Desktop objects have their base at Y=0.
 * Architecture snaps on a 1.35m module. Door leaves retain a named hinge pivot.
 * Clones share GPU resources: dispose the pack only after removing all instances. */
export class OfficeAssets {
  private readonly templates = new Map<string, T.Group>();
  private readonly partTemplates = new Map<string, T.Group>();
  private readonly geometries = new Set<T.BufferGeometry>();
  private readonly materials = new Map<string, T.MeshStandardMaterial>();

  material(color: number, metalness = 0, roughness = 0.7, glow = false) {
    const key = `${color}:${metalness}:${roughness}:${glow}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color, metalness, roughness,
        ...(glow ? { emissive: color, emissiveIntensity: 0.65 } : {}) });
      this.materials.set(key, m);
    }
    return m;
  }

  private geometry<G extends T.BufferGeometry>(g: G): G { this.geometries.add(g); return g; }

  create(kind: OfficeKind, finish: OfficeFinish = "sage"): T.Group {
    const key = `${kind}:${finish}`;
    let template = this.templates.get(key);
    if (!template) {
      template = this.build(kind, finish);
      this.templates.set(key, template);
    }
    return template.clone(true);
  }

  /** Individual authored pieces for rigid breakage; same transforms / finishes as the intact model. */
  parts(kind: OfficeKind, finish: OfficeFinish = "sage"): T.Group {
    this.create(kind, finish);
    return this.partTemplates.get(`${kind}:${finish}`)!.clone(true);
  }

  private build(kind: OfficeKind, finish: OfficeFinish) {
    const root = new T.Group(); root.name = kind;
    root.userData.officeKind = kind;
    const steel = this.material(0x404c53, 0.7, 0.38);
    const trim = this.material(0x9da9aa, 0.75, 0.32);
    const black = this.material(0x1e292e, 0.15, 0.65);
    const cream = this.material(0xd3d5c9, 0.1, 0.65);
    const paper = this.material(0xe9e4d5, 0, 0.96);
    const ink = this.material(0x63777c, 0, 0.85);
    const fabric = this.material({ sage: 0x627d75, slate: 0x647487, sand: 0x9b846a }[finish], 0, 0.97);
    const wood = this.material({ sage: 0xb5a281, slate: 0xa3aab0, sand: 0xc0a078 }[finish], 0, 0.84);
    const blue = this.material(0x5fbbc6, 0.1, 0.4, true);
    const orange = this.material(0xe6ac60, 0.05, 0.6);
    const glass = this.material(0x8fc3ca, 0.15, 0.18);
    glass.transparent = true; glass.opacity = 0.2; glass.depthWrite = false;
    const boxGeometry = this.geometry(new T.BoxGeometry(1, 1, 1));
    const cylinderGeometry = this.geometry(new T.CylinderGeometry(1, 1, 1, 12));
    const mesh = (g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, parent = root) => {
      const o = new T.Mesh(g, m); o.position.set(x, y, z);
      o.castShadow = m !== glass; o.receiveShadow = true; parent.add(o); return o;
    };
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, m = steel, parent = root) => {
      const o = mesh(boxGeometry, m, x, y, z, parent); o.scale.set(w, h, d); return o;
    };
    const cyl = (x: number, y: number, z: number, r: number, h: number, m = steel, parent = root) => {
      const o = mesh(cylinderGeometry, m, x, y, z, parent); o.scale.set(r, h, r); return o;
    };
    const part = (name: string, x = 0, y = 0, z = 0) => {
      const g = new T.Group(); g.name = name; g.position.set(x, y, z); root.add(g); return g;
    };
    const handle = (x: number, y: number, z: number, w = 0.16, parent = root) => {
      box(x, y, z + 0.025, w, 0.025, 0.025, trim, parent);
      for (const sign of [-1, 1]) box(x + sign * (w / 2 - 0.012), y, z, 0.025, 0.025, 0.05, trim, parent);
    };
    const lines = (x: number, y: number, z: number, width: number, count: number, parent = root) => {
      for (let i = 0; i < count; i++) box(x, y, z + i * 0.025, width * (i === count - 1 ? 0.65 : 1), 0.001, 0.003, ink, parent);
    };
    const sheet = (x: number, y: number, z: number, angle = 0, parent = root) => {
      const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = angle; parent.add(g);
      box(0, 0.002, 0, 0.21, 0.004, 0.297, paper, g);
      box(-0.04, 0.005, -0.105, 0.09, 0.001, 0.018, ink, g);
      lines(0, 0.005, -0.065, 0.16, 7, g);
    };
    const keyboard = (parent: T.Group, y = 0) => {
      box(0, y + 0.014, 0, 0.43, 0.028, 0.145, black, parent);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++)
        box(-0.19 + c * 0.034, y + 0.033, -0.051 + r * 0.032, 0.027, 0.009, 0.025, trim, parent);
      box(0, y + 0.033, 0.058, 0.16, 0.008, 0.02, trim, parent);
    };
    const screen = (parent: T.Group, x: number, y: number, z: number, w: number, h: number) => {
      box(x, y, z, w, h, 0.038, black, parent);
      box(x, y, z + 0.021, w - 0.035, h - 0.038, 0.003, this.material(0x183b48, 0.1, 0.5, true), parent);
      box(x, y + h * 0.32, z + 0.025, w * 0.85, 0.015, 0.002, blue, parent);
      for (let i = 0; i < 5; i++) {
        box(x - w * 0.3, y + h * 0.17 - i * h * 0.095, z + 0.025, w * 0.12, 0.007, 0.002, trim, parent);
        box(x + w * 0.05, y + h * 0.17 - i * h * 0.095, z + 0.025, w * (0.24 + (i % 3) * 0.08), 0.007, 0.002, blue, parent);
      }
      box(x + w * 0.4, y - h * 0.46, z + 0.023, 0.008, 0.004, 0.002, blue, parent);
    };
    const desk = (w: number, d: number, x = 0, z = 0) => {
      const top = part("desktop", x, 0, z);
      box(0, 0.74, 0, w, 0.045, d, wood, top);
      box(0, 0.713, 0, w - 0.02, 0.012, d - 0.02, black, top);
      for (const side of [-1, 1]) {
        box(x + side * (w / 2 - 0.08), 0.36, z, 0.045, 0.72, d - 0.12, cream);
        box(x + side * (w / 2 - 0.08), 0.025, z, 0.09, 0.05, d - 0.08, black);
      }
      box(x, 0.43, z - d / 2 + 0.06, w - 0.16, 0.34, 0.025, cream);
      box(x, 0.64, z - d / 2 + 0.12, w - 0.2, 0.06, 0.12, steel);
      cyl(x + w / 2 - 0.17, 0.766, z - d / 2 + 0.12, 0.035, 0.006, black);
    };
    const keypad = (parent: T.Group) => {
      box(0, 0.12, 0, 0.13, 0.24, 0.042, steel, parent);
      box(0, 0.192, 0.023, 0.094, 0.045, 0.006, black, parent);
      for (let i = 0; i < 4; i++) box(-0.027 + i * 0.018, 0.19, 0.027, 0.01, 0.008, 0.003, blue, parent);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++)
        box(-0.032 + c * 0.032, 0.142 - r * 0.03, 0.026, 0.024, 0.022, 0.012, r === 3 && c === 2 ? blue : trim, parent);
      box(0, 0.015, 0.024, 0.07, 0.008, 0.004, blue, parent);
    };

    switch (kind) {
      case "desk": desk(1.25, 0.72); break;
      case "desk-tucked": {
        desk(1.25, 0.72);
        const chair = this.parts("task-chair", finish);
        chair.name = "tucked-chair";
        chair.position.z = 0.28; chair.rotation.y = Math.PI;
        root.add(chair);
        break;
      }
      case "corner-desk": desk(1.25, 0.72); desk(0.65, 0.65, -0.3, 0.685); break;
      case "meeting-table": {
        box(0, 0.76, 0, 1.16, 0.065, 2.55, wood, part("tabletop"));
        for (const z of [-0.77, 0.77]) {
          box(0, 0.36, z, 0.15, 0.72, 0.3, steel);
          box(0, 0.025, z, 0.9, 0.05, 0.45, black);
        }
        box(0, 0.795, 0, 0.18, 0.006, 0.48, steel);
        for (const z of [-0.15, 0.15]) box(0, 0.8, z, 0.1, 0.008, 0.07, black);
        break;
      }
      case "task-chair": {
        cyl(0, 0.24, 0, 0.032, 0.4, trim);
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5;
          const leg = box(Math.sin(angle) * 0.14, 0.105, Math.cos(angle) * 0.14, 0.045, 0.035, 0.31, steel);
          leg.rotation.y = angle;
          const wheel = cyl(Math.sin(angle) * 0.28, 0.045, Math.cos(angle) * 0.28, 0.045, 0.07, black);
          wheel.rotation.z = Math.PI / 2;
        }
        box(0, 0.46, 0, 0.49, 0.09, 0.47, fabric, part("seat"));
        box(0, 0.6, -0.21, 0.065, 0.38, 0.045, steel);
        const back = part("backrest");
        box(0, 0.83, -0.235, 0.47, 0.56, 0.06, black, back).rotation.x = -0.1;
        box(0, 0.84, -0.195, 0.41, 0.49, 0.04, fabric, back).rotation.x = -0.1;
        for (let i = 0; i < 7; i++) box(0, 0.66 + i * 0.055, -0.168 - i * 0.005, 0.37, 0.009, 0.004, black, back);
        for (const s of [-1, 1]) {
          box(s * 0.28, 0.55, 0, 0.035, 0.22, 0.035, steel);
          box(s * 0.28, 0.66, 0, 0.07, 0.04, 0.28, black);
        }
        break;
      }
      case "visitor-chair": {
        for (const x of [-0.23, 0.23]) for (const z of [-0.2, 0.2]) {
          box(x, 0.23, z, 0.028, 0.46, 0.028, trim);
          box(x, 0.016, z, 0.035, 0.032, 0.035, black);
        }
        box(0, 0.46, 0, 0.5, 0.07, 0.46, fabric);
        for (const x of [-0.22, 0.22]) box(x, 0.68, -0.2, 0.025, 0.45, 0.025, trim);
        box(0, 0.79, -0.21, 0.49, 0.3, 0.055, fabric);
        break;
      }
      case "monitor": {
        box(0, 0.014, 0, 0.27, 0.028, 0.19, black);
        box(0, 0.12, -0.035, 0.055, 0.23, 0.055, trim);
        screen(part("display"), 0, 0.32, 0, 0.57, 0.34);
        break;
      }
      case "computer": {
        box(0, 0.215, 0, 0.19, 0.43, 0.4, black);
        box(0, 0.215, 0.203, 0.18, 0.41, 0.012, steel);
        for (let i = 0; i < 12; i++) box(0, 0.07 + i * 0.012, 0.211, 0.13, 0.005, 0.005, black);
        box(0, 0.35, 0.212, 0.13, 0.025, 0.006, black);
        box(0.055, 0.39, 0.213, 0.012, 0.012, 0.004, blue);
        for (const x of [-0.04, 0.01]) box(x, 0.29, 0.213, 0.028, 0.009, 0.005, black);
        break;
      }
      case "laptop": {
        box(0, 0.016, 0, 0.35, 0.032, 0.24, trim);
        const keys = part("keyboard", 0, 0.025, -0.03); keys.scale.setScalar(0.7); keyboard(keys);
        box(0, 0.034, 0.07, 0.11, 0.003, 0.055, steel);
        const lid = part("screen-hinge", 0, 0.035, -0.11); lid.rotation.x = -0.2;
        screen(lid, 0, 0.12, 0, 0.35, 0.24);
        break;
      }
      case "keyboard": {
        keyboard(root);
        box(0.3, 0.002, 0, 0.18, 0.004, 0.2, fabric);
        const mouse = mesh(this.geometry(new T.SphereGeometry(1, 12, 8)), black, 0.3, 0.022, 0);
        mouse.scale.set(0.032, 0.021, 0.055);
        box(0.3, 0.043, -0.015, 0.005, 0.005, 0.016, trim);
        break;
      }
      case "papers":
        for (let i = 0; i < 6; i++) sheet((i % 3 - 1) * 0.007, i * 0.005, (i % 2) * 0.008, (i % 3 - 1) * 0.06);
        break;
      case "folders": {
        for (let i = 0; i < 3; i++) {
          const folder = part(`folder-${i}`, i * 0.018, i * 0.018, i * 0.01); folder.rotation.y = i * 0.08;
          box(0, 0.008, 0, 0.255, 0.016, 0.325, i === 1 ? fabric : orange, folder);
          box(-0.07 + i * 0.06, 0.008, -0.17, 0.07, 0.016, 0.03, i === 1 ? fabric : orange, folder);
          sheet(0, 0.018, 0, 0, folder);
          box(0.055, 0.03, 0, 0.12, 0.008, 0.325, i === 1 ? fabric : orange, folder);
        }
        break;
      }
      case "binders": {
        for (let i = 0; i < 4; i++) {
          const x = (i - 1.5) * 0.073;
          box(x, 0.155, 0, 0.065, 0.31, 0.25, i % 2 ? fabric : steel);
          box(x, 0.155, 0.129, 0.038, 0.12, 0.006, paper);
          box(x, 0.2, 0.134, 0.027, 0.008, 0.002, ink);
          const ring = cyl(x, 0.055, 0.13, 0.012, 0.006, black); ring.rotation.x = Math.PI / 2;
          box(x, 0.315, 0.005, 0.05, 0.008, 0.22, paper);
        }
        break;
      }
      case "desk-tray": {
        for (const y of [0.015, 0.09]) {
          box(0, y, 0, 0.27, 0.012, 0.34, steel);
          for (const x of [-0.13, 0.13]) box(x, y + 0.02, 0, 0.012, 0.05, 0.34, trim);
          box(0, y + 0.02, -0.165, 0.26, 0.05, 0.012, trim);
          sheet(0, y + 0.01, 0);
        }
        for (const x of [-0.13, 0.13]) box(x, 0.06, -0.12, 0.012, 0.12, 0.015, trim);
        break;
      }
      case "printer": {
        box(0, 0.15, 0, 0.51, 0.3, 0.43, cream);
        box(0, 0.31, -0.025, 0.49, 0.025, 0.36, steel);
        box(0, 0.22, 0.22, 0.36, 0.06, 0.02, black);
        box(0, 0.18, 0.3, 0.35, 0.02, 0.2, steel);
        sheet(0, 0.195, 0.22);
        box(0.16, 0.29, 0.18, 0.09, 0.018, 0.06, blue);
        handle(0, 0.075, 0.218, 0.13);
        break;
      }
      case "cubicle": {
        for (const s of [-1, 1]) {
          box(s * 0.64, 0.6, 0, 0.035, 1.2, 0.09, trim);
          box(s * 0.64, 0.025, 0, 0.08, 0.05, 0.4, steel);
        }
        box(0, 0.62, 0, 1.25, 1.1, 0.065, fabric, part("panel"));
        for (const y of [0.09, 1.19]) box(0, y, 0, 1.3, 0.025, 0.08, trim);
        for (const s of [-1, 1]) {
          box(0, 0.33, s * 0.039, 1.22, 0.02, 0.012, steel);
          for (let i = 0; i < 3; i++) {
            box(-0.35 + i * 0.23, 0.85 + (i % 2) * 0.1, s * 0.039, 0.16, 0.21, 0.003, i === 1 ? orange : paper);
            box(-0.35 + i * 0.23, 0.94 + (i % 2) * 0.1, s * 0.043, 0.014, 0.014, 0.005, blue);
          }
        }
        break;
      }
      case "steel-door":
      case "glass-door": {
        for (const x of [-0.625, 0.625]) box(x, 1.35, 0, 0.1, 2.7, 0.16, steel);
        box(0, 2.64, 0, 1.35, 0.12, 0.16, steel);
        const door = part("door-hinge", -0.57, 0, 0);
        const glazed = kind === "glass-door";
        if (glazed) box(0.57, 1.3, 0, 1.12, 2.52, 0.055, glass, door);
        else {
          // A real aperture: the vision pane has no opaque panel behind it.
          box(0.57, 0.86, 0, 1.12, 1.66, 0.055, cream, door);
          box(0.57, 2.305, 0, 1.12, 0.51, 0.055, cream, door);
          for (const x of [0.2075, 0.9325]) box(x, 1.87, 0, 0.395, 0.36, 0.055, cream, door);
        }
        for (const x of [0.025, 1.115]) box(x, 1.3, 0, 0.045, 2.54, 0.065, trim, door);
        for (const y of [0.06, 2.54]) box(0.57, y, 0, 1.14, 0.07, 0.065, trim, door);
        if (glazed) {
          box(0.96, 1.14, 0.085, 0.025, 0.42, 0.025, trim, door).userData.glazing = true;
          for (const y of [0.96, 1.32]) box(0.96, y, 0.06, 0.025, 0.025, 0.08, trim, door).userData.glazing = true;
        } else {
          for (const x of [0.395, 0.745]) box(x, 1.87, 0, 0.025, 0.39, 0.075, steel, door);
          for (const y of [1.69, 2.05]) box(0.57, y, 0, 0.375, 0.025, 0.075, steel, door);
          box(0.57, 1.87, 0, 0.33, 0.36, 0.018, glass, door);
          box(0.57, 0.22, 0.036, 1.05, 0.3, 0.012, trim, door);
          box(0.97, 1.18, 0.039, 0.065, 0.2, 0.02, steel, door);
          handle(0.9, 1.18, 0.065, 0.16, door);
          for (let i = 0; i < 7; i++) box(0.57, 0.48 + i * 0.036, 0.032, 0.55, 0.012, 0.006, steel, door);
        }
        for (const y of [0.35, 1.35, 2.25]) cyl(0, y, 0.045, 0.025, 0.15, trim, door);
        box(0.1, 2.43, 0.08, 0.24, 0.08, 0.08, steel);
        break;
      }
      case "keypad": keypad(root); break;
      case "steel-wall":
      case "window-wall":
      case "glass-wall": {
        const fullGlass = kind === "glass-wall", windowed = kind === "window-wall";
        for (const x of [-0.65, 0.65]) box(x, 1.35, 0, 0.05, 2.7, 0.14, steel);
        for (const y of [0.04, 2.66]) box(0, y, 0, 1.35, 0.08, 0.14, steel);
        if (fullGlass) {
          box(0, 1.35, 0, 1.25, 2.55, 0.018, glass, part("glazing"));
        } else if (windowed) {
          box(0, 0.48, 0, 1.25, 0.88, 0.12, cream);
          box(0, 2.52, 0, 1.25, 0.24, 0.12, cream);
          box(0, 1.66, 0, 1.22, 1.46, 0.02, glass, part("glazing"));
          for (const y of [0.93, 2.39]) box(0, y, 0, 1.3, 0.055, 0.16, trim);
          box(0, 1.66, 0, 0.035, 1.46, 0.06, steel);
        } else {
          box(0, 1.35, 0, 1.25, 2.55, 0.12, cream, part("panel"));
          for (const y of [0.3, 2.34]) box(0, y, 0.065, 1.23, 0.018, 0.014, trim);
          for (const x of [-0.57, 0.57]) for (const y of [0.18, 1.35, 2.52])
            box(x, y, 0.065, 0.018, 0.018, 0.012, steel);
        }
        box(0, 0.09, 0.08, 1.35, 0.12, 0.035, steel);
        break;
      }
      case "filing-cabinet": {
        box(0, 0.51, 0, 0.52, 1.02, 0.61, steel);
        for (let i = 0; i < 3; i++) {
          const drawer = part(`drawer-${i}`), y = 0.18 + i * 0.325;
          box(0, y, 0.313, 0.48, 0.305, 0.025, cream, drawer);
          handle(0, y + 0.045, 0.338, 0.16, drawer);
          box(-0.12, y - 0.06, 0.33, 0.13, 0.045, 0.008, trim, drawer);
          box(-0.12, y - 0.06, 0.336, 0.11, 0.03, 0.002, paper, drawer);
        }
        break;
      }
      case "shelf": {
        for (const x of [-0.59, 0.59]) for (const z of [-0.22, 0.22]) box(x, 0.95, z, 0.035, 1.9, 0.035, steel);
        for (const y of [0.09, 0.54, 0.99, 1.44, 1.89]) box(0, y, 0, 1.22, 0.035, 0.48, trim);
        for (const y of [0.12, 0.57, 1.02]) for (const x of [-0.36, 0.03, 0.39]) {
          box(x, y + 0.16, 0, 0.31, 0.32, 0.39, x === 0.03 ? fabric : wood);
          box(x, y + 0.18, 0.198, 0.13, 0.075, 0.004, paper);
          box(x, y + 0.28, 0.2, 0.08, 0.02, 0.008, black);
        }
        break;
      }
      case "wastebasket": {
        cyl(0, .02, 0, .145, .035, steel);
        // Open wire cage: tapered ribs and hoops reveal the contents.
        for (const y of [.055, .15, .245, .35]) {
          const r = .145 + y * .075;
          const ring = mesh(this.geometry(new T.TorusGeometry(r, .007, 4, 24)), steel, 0, y, 0);
          ring.rotation.x = Math.PI / 2;
        }
        for (let i = 0; i < 20; i++) {
          const a = i * Math.PI / 10;
          const rib = box(Math.sin(a) * .158, .19, Math.cos(a) * .158, .006, .33, .006, steel);
          rib.rotation.set(Math.cos(a) * .075, 0, -Math.sin(a) * .075);
        }
        for (const [x, y, z] of [[-.045, .08, .025], [.05, .12, -.03], [-.015, .19, -.025]]) {
          const scrap = mesh(this.geometry(new T.DodecahedronGeometry(.065, 0)), paper, x, y, z);
          scrap.scale.set(1, .7, .8); scrap.rotation.set(.4 + y, x * 7, z * 8);
        }
        break;
      }
      case "recycling-bin": {
        const plastic = this.material({ sage: 0x306a91, slate: 0x385e85, sand: 0x487b93 }[finish], .03, .72);
        box(0, .025, 0, .39, .05, .35, black);
        for (const x of [-.19, .19]) box(x, .3, 0, .025, .54, .35, plastic);
        for (const z of [-.165, .165]) box(0, .3, z, .36, .54, .025, plastic);
        box(0, .49, 0, .34, .02, .29, black);
        const lid = part("bin-lid");
        for (const z of [-.125, .125]) box(0, .595, z, .43, .07, .14, plastic, lid);
        for (const x of [-.18, .18]) box(x, .595, 0, .07, .07, .11, plastic, lid);
        // Paper-slot symbol, readable without a texture or text download.
        box(0, .37, .181, .17, .18, .006, paper);
        for (const y of [.33, .37, .41]) box(0, y, .186, .11, .009, .004, plastic);
        for (const x of [-.205, .205]) box(x, .49, 0, .012, .045, .12, black);
        break;
      }
      case "pedal-bin": {
        const stainless = this.material(0xb0babd, .85, .3);
        cyl(0, .025, 0, .205, .05, black);
        // Separate curved steel panels become rigid debris rather than bending.
        for (let i = 0; i < 8; i++) mesh(this.geometry(new T.CylinderGeometry(.2, .19, .48, 3, 1, true,
          i * Math.PI / 4, Math.PI / 4)), stainless, 0, .29, 0);
        cyl(0, .51, 0, .185, .02, black);
        const lid = part("bin-lid");
        cyl(0, .55, 0, .214, .035, stainless, lid);
        box(0, .56, -.195, .13, .05, .055, steel);
        box(0, .06, .215, .14, .035, .1, black);
        box(0, .08, .23, .105, .008, .055, stainless);
        box(0, .29, -.195, .025, .48, .025, steel);
        break;
      }
      case "wheelie-bin": {
        const plastic = this.material({ sage: 0x3f6956, slate: 0x4c6176, sand: 0x8b7650 }[finish], .03, .8);
        box(0, .1, 0, .45, .08, .44, plastic);
        for (const x of [-.24, .24]) box(x, .5, 0, .035, .78, .48, plastic);
        for (const z of [-.225, .225]) box(0, .5, z, .45, .78, .035, plastic);
        for (const x of [-.15, .15]) box(x, .49, .25, .025, .63, .022, plastic);
        box(0, .84, 0, .43, .02, .4, black);
        const lid = part("bin-lid");
        box(0, .925, 0, .56, .065, .56, plastic, lid);
        box(0, .932, .285, .21, .035, .04, black, lid);
        for (const x of [-.19, .19]) box(x, .88, -.29, .035, .14, .11, plastic);
        box(0, .94, -.33, .41, .035, .035, black);
        const axle = cyl(0, .12, -.18, .025, .59, steel); axle.rotation.z = Math.PI / 2;
        for (const x of [-.28, .28]) {
          const wheel = cyl(x, .12, -.18, .115, .07, black); wheel.rotation.z = Math.PI / 2;
          const hub = cyl(x * 1.13, .12, -.18, .045, .008, trim); hub.rotation.z = Math.PI / 2;
        }
        box(0, .61, .247, .18, .13, .005, cream);
        for (let i = 0; i < 5; i++) box(-.06 + i * .03, .61, .252, .012, .075, .004, steel);
        break;
      }
      case "locker": {
        box(0, 0.97, 0, 0.6, 1.94, 0.5, steel);
        for (const x of [-0.15, 0.15]) {
          box(x, 0.99, 0.255, 0.282, 1.85, 0.025, fabric);
          for (const y of [0.25, 1.65]) for (let i = 0; i < 4; i++) box(x, y + i * 0.04, 0.272, 0.17, 0.013, 0.005, black);
          box(x + 0.08, 1.04, 0.28, 0.025, 0.16, 0.025, trim);
          box(x, 1.44, 0.273, 0.09, 0.045, 0.003, paper);
        }
        break;
      }
    }
    // Merge within each semantic part. Hinges / removable panels remain separate.
    const merge = (group: T.Group) => {
      for (const child of [...group.children]) if (child instanceof T.Group) merge(child);
      const batches = new Map<T.Material, T.Mesh[]>();
      for (const child of group.children) if (child instanceof T.Mesh && !Array.isArray(child.material)) {
        const list = batches.get(child.material) ?? []; list.push(child); batches.set(child.material, list);
      }
      for (const [material, meshes] of batches) {
        const transformed = meshes.map(m => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
        const geometry = mergeGeometries(transformed, false);
        for (const g of transformed) g.dispose();
        if (!geometry) throw new Error(`Cannot batch office asset ${kind}`);
        const m = new T.Mesh(this.geometry(geometry), material);
        m.castShadow = material !== glass; m.receiveShadow = true;
        group.remove(...meshes); group.add(m);
      }
    };
    this.partTemplates.set(`${kind}:${finish}`, root.clone(true));
    merge(root);
    return root;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear(); this.materials.clear(); this.templates.clear(); this.partTemplates.clear();
  }
}
