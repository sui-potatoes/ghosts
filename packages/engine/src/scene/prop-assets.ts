// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { DestructibleMesh, FractureOptions } from "@dgreenheck/three-pinata";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { propRandom, type MapProp } from "../environment.ts";
import { cracksWhenDamaged, deformPropGeometry } from "./prop-deformation.ts";
import { OfficeAssets, type OfficeKind } from "../office/assets.ts";

export interface PropDamageStage {
  intact: T.Group;
  /** Cumulative fragment indices already detached from this standing prop. */
  shed: Set<number>;
}

export interface PropAsset {
  intact: T.Group;
  frame: T.Group;
  fragments: T.Mesh[];
  bounds: T.Box3;
  smoke?: T.Vector3;
  colliders?: T.Box3[];
}

/** Shared finishes, meshes and prefractures. No mesh cutting in the combat loop. */
export class PropAssets {
  private readonly office = new OfficeAssets();
  private readonly assets = new Map<string, PropAsset>();
  private readonly geometries = new Set<T.BufferGeometry>();
  private readonly materials = new Map<string, T.MeshStandardMaterial>();
  private readonly textures = new Set<T.Texture>();
  private readonly sources = new Map<PropAsset, T.Group>();
  private readonly stages = new Map<PropAsset, Map<number, PropDamageStage>>();

  /** Cached only when damaged: no per-frame geometry work or additional prefracturing. */
  damaged(prop: MapProp, amount: number): PropDamageStage | undefined {
    if (cracksWhenDamaged(prop.kind) || amount <= 0) return undefined;
    const asset = this.get(prop);
    const level = amount < 0.3 ? 0 : amount < 0.65 ? 1 : 2;
    const stages = this.stages.get(asset) ?? new Map<number, PropDamageStage>();
    this.stages.set(asset, stages);
    const cached = stages.get(level);
    if (cached) return cached;
    const strength = [0.2, 0.55, 0.9][level];
    const threshold = [0, 0.3, 0.65][level];
    const intact = new T.Group(), shed = new Set<number>();
    const source = this.sources.get(asset)!;
    source.updateMatrixWorld(true);
    for (const child of source.children) {
      if (!(child instanceof T.Mesh)) continue;
      if (child.userData.shedAt !== undefined && child.userData.shedAt <= threshold) {
        if (child.userData.fragmentIndex !== undefined) shed.add(child.userData.fragmentIndex);
        continue;
      }
      const geometry = this.geometry(child.geometry.clone().applyMatrix4(child.matrixWorld));
      deformPropGeometry(geometry, asset.bounds, prop.kind, strength);
      intact.add(new T.Mesh(geometry, child.material));
    }
    this.merge(intact);
    const stage = { intact, shed };
    stages.set(level, stage);
    return stage;
  }

  material(color: number, metalness = 0.1, roughness = 0.8) {
    const key = `${color}:${metalness}:${roughness}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new T.MeshStandardMaterial({ color, metalness, roughness });
      this.materials.set(key, material);
    }
    return material;
  }

  geometry<G extends T.BufferGeometry>(geometry: G): G {
    this.geometries.add(geometry);
    return geometry;
  }

  private label(text: string, warning: boolean) {
    const key = `label:${text}:${warning}`;
    let material = this.materials.get(key);
    if (material) return material;
    material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 256; canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = warning ? "#e5b45d" : "#d5d3bd";
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = "#263037"; ctx.lineWidth = 7; ctx.strokeRect(7, 7, 242, 114);
      ctx.fillStyle = "#263037"; ctx.font = "bold 28px monospace"; ctx.textAlign = "center";
      ctx.fillText(text, 128, 56);
      ctx.font = "14px monospace"; ctx.fillText(warning ? "KORA / WORK ZONE" : "KORA / FREIGHT 07", 128, 89);
      for (let i = 0; i < 25; i++) ctx.fillRect(64 + i * 5, 100, i % 3 ? 2 : 3, 12);
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      this.textures.add(texture);
      material.map = texture;
    }
    this.materials.set(key, material);
    return material;
  }

  get(prop: MapProp): PropAsset {
    if (prop.kind.startsWith("office-")) return this.getOffice(prop);
    const variant = prop.seed % 3;
    const key = `${prop.kind}:${variant}:${!!prop.cover}:${!!prop.y}:${prop.storefront?.width ?? prop.pane?.width ?? ""}:${prop.storefront?.height ?? prop.pane?.height ?? ""}`;
    const cached = this.assets.get(key);
    if (cached) return cached;
    const random = propRandom(variant * 83 + 773);
    const intact = new T.Group(), frame = new T.Group(), fragments: T.Mesh[] = [];
    const steel = this.material(0x3f4b4e, 0.72, 0.48);
    const rust = this.material(0x75513e, 0.3, 0.92);
    const rubber = this.material(0x20272a, 0.05, 0.96);
    const paint = this.material(0xc9c8b6, 0.15, 0.65);
    const yellow = this.material(0xc99943, 0.15, 0.65);
    const concrete = this.material(0x8b8d85, 0.02, 0.94);
    const wood = this.material([0x8e7655, 0xa28b69, 0x75624b][variant], 0.02, 0.93);
    const faded = this.material([0x576d68, 0x8b5342, 0x596976][variant], 0.5, 0.72);

    const mesh = (geo: T.BufferGeometry, material: T.Material, x: number, y: number, z: number, parent: T.Group = intact) => {
      const part = new T.Mesh(this.geometry(geo), material);
      part.position.set(x, y, z);
      part.castShadow = true; part.receiveShadow = true;
      parent.add(part);
      return part;
    };
    const flexible = ["cargo", "fence-sheet", "sign"].includes(prop.kind);
    const segments = (length: number) => flexible ? Math.max(1, Math.min(8, Math.ceil(length / 0.22))) : 1;
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, m: T.Material, parent = intact) =>
      mesh(new T.BoxGeometry(w, h, d, segments(w), segments(h), segments(d)), m, x, y, z, parent);
    const cylinder = (x: number, y: number, z: number, radius: number, h: number, m: T.Material) =>
      mesh(new T.CylinderGeometry(radius, radius, h, 16), m, x, y, z);
    const loose = (part: T.Mesh) => {
      const clone = new T.Mesh(part.geometry, part.material);
      clone.position.copy(part.position); clone.quaternion.copy(part.quaternion);
      part.userData.fragmentIndex = fragments.length;
      fragments.push(clone);
      return part;
    };
    const fracture = (part: T.Mesh, count: number, flat = false, inner = concrete) => {
      const source = new DestructibleMesh(part.geometry, part.material as T.Material, inner);
      source.position.copy(part.position); source.quaternion.copy(part.quaternion);
      source.updateMatrixWorld(true);
      for (const shard of source.fracture(new FractureOptions({
        fragmentCount: count, seed: variant * 103 + 17 + fragments.length,
        voronoiOptions: { mode: flat ? "2.5D" : "3D", projectionAxis: "z" },
      }))) {
        this.geometry(shard.geometry);
        // Plain meshes: their resources belong to this cache, not to individual debris.
        const fragment = new T.Mesh(shard.geometry, shard.material);
        fragment.position.copy(shard.position); fragment.quaternion.copy(shard.quaternion);
        fragments.push(fragment);
      }
    };
    const decal = (text: string, x: number, y: number, z: number, w: number, h: number, warning = false) =>
      mesh(new T.PlaneGeometry(w, h, Math.min(8, Math.ceil(w / 0.12)), Math.min(8, Math.ceil(h / 0.12))),
        this.label(text, warning), x, y, z);
    const bolts = (width: number, height: number, z: number) => {
      for (const x of [-width / 2, width / 2]) for (const y of [0.15, height - 0.1])
        box(x, y, z, 0.035, 0.035, 0.02, paint);
    };

    let smoke: T.Vector3 | undefined;
    switch (prop.kind) {
      case "crate": {
        // Separate boards, corner battens, steel straps, nails and freight stencil.
        for (let i = 0; i < 5; i++) {
          for (const side of [-1, 1]) {
            const board = loose(box(-0.47 + i * 0.235, 0.48, side * 0.3, 0.225, 0.76, 0.045, wood));
            if (side === 1 && (i === 1 || i === 3)) board.userData.shedAt = i === 1 ? 0.3 : 0.65;
          }
          box(-0.47 + i * 0.235, 0.875, 0, 0.225, 0.045, 0.65, wood);
        }
        for (const side of [-1, 1]) {
          loose(box(side * 0.59, 0.48, 0, 0.05, 0.8, 0.64, wood));
          for (const y of [0.15, 0.77]) {
            box(0, y, side * 0.335, 1.24, 0.095, 0.045, wood);
            for (const x of [-0.53, 0.53]) box(x, y, side * 0.362, 0.026, 0.026, 0.012, steel);
          }
          box(side * 0.36, 0.48, 0.364, 0.045, 0.84, 0.012, steel);
          box(side * 0.36, 0.905, 0, 0.045, 0.012, 0.68, steel);
          box(side * 0.43, 0.06, 0, 0.13, 0.12, 0.65, wood);
        }
        decal("UP ↑ ↑", 0, 0.5, 0.37, 0.32, 0.24);
        for (let i = 0; i < 14; i++) {
          const scratch = box((random() - 0.5) * 1.05, 0.25 + random() * 0.45, 0.326,
            0.02 + random() * 0.12, 0.006, 0.003, rust);
          const board = Math.round((scratch.position.x + 0.47) / 0.235);
          if (board === 1 || board === 3) scratch.userData.shedAt = board === 1 ? 0.3 : 0.65;
        }
        break;
      }
      case "cargo": {
        fracture(box(0, 0.48, 0, 1.18, 0.8, 0.61, faded), 10, false, steel);
        for (const side of [-1, 1]) {
          for (const x of [-0.51, 0.51]) box(x, 0.48, side * 0.32, 0.055, 0.85, 0.065, steel);
          for (const y of [0.12, 0.84]) box(0, y, side * 0.32, 1.22, 0.06, 0.065, steel);
          const handle = loose(box(0, 0.61, side * 0.35, 0.24, 0.07, 0.04, rubber));
          if (side === 1) handle.userData.shedAt = 0.65;
        }
        for (const x of [-0.38, 0.38]) {
          box(x, 0.47, 0.34, 0.09, 0.14, 0.04, paint);
          box(x, 0.04, 0, 0.16, 0.08, 0.64, rubber);
        }
        decal("SUPPLY 07", 0, 0.35, 0.313, 0.38, 0.18);
        break;
      }
      case "barrels":
      case "smoking-barrel": {
        const burning = prop.kind === "smoking-barrel";
        for (const x of burning ? [0] : [-0.32, 0.32]) {
          const radius = burning ? 0.31 : 0.265;
          // Steel drums separate into rigid curved strips and lids.
          for (let i = 0; i < 6; i++) {
            const panel = loose(mesh(new T.CylinderGeometry(radius, radius, 0.78, 3, 1, true, i * Math.PI / 3, Math.PI / 3),
              faded, x, 0.45, 0));
            if (i === 0) panel.userData.shedAt = burning ? 0.3 : 0.65;
            if (burning && i === 5) panel.userData.shedAt = 0.65;
          }
          for (const y of [0.08, 0.3, 0.62, 0.84]) {
            const ring = mesh(new T.TorusGeometry(radius + 0.008, 0.018, 4, 16), steel, x, y, 0);
            ring.rotation.x = Math.PI / 2;
          }
          loose(cylinder(x, 0.09, 0, radius, 0.035, steel));
          const lid = cylinder(x, 0.82, 0, radius - 0.015, 0.025, burning ? rubber : faded);
          if (!burning) loose(lid).userData.shedAt = x < 0 ? 0.3 : 0.65;
          if (!burning) {
            cylinder(x + 0.1, 0.85, 0.08, 0.035, 0.025, steel).userData.shedAt = x < 0 ? 0.3 : 0.65;
            decal("OIL", x, 0.47, radius + 0.006, 0.2, 0.2, true).userData.shedAt = 0.65;
          } else {
            const embers = this.material(0x57251a, 0.1, 0.9);
            embers.emissive.setHex(0xff6b24); embers.emissiveIntensity = 1.7;
            for (let i = 0; i < 6; i++) {
              const coal = box((random() - 0.5) * 0.35, 0.84, (random() - 0.5) * 0.35, 0.12, 0.035, 0.06, embers);
              coal.rotation.y = random() * Math.PI;
            }
            smoke = new T.Vector3(0, 0.85, 0);
          }
          for (let i = 0; i < 8; i++)
            box(x + (random() - 0.5) * radius, 0.2 + random() * 0.5, radius,
              0.02, 0.04 + random() * 0.06, 0.006, rust).userData.shedAt = burning ? 0.3 : 0.65;
        }
        break;
      }
      case "barrier": {
        const geo = new T.BoxGeometry(1.22, 0.78, 0.65);
        const vertices = geo.attributes.position;
        for (let i = 0; i < vertices.count; i++)
          if (vertices.getY(i) > 0) vertices.setZ(i, vertices.getZ(i) * 0.45);
        geo.computeVertexNormals();
        fracture(mesh(geo, concrete, 0, 0.48, 0), 14);
        box(0, 0.08, 0, 1.28, 0.16, 0.7, concrete);
        for (const side of [-1, 1]) {
          box(0, 0.72, side * 0.205, 1.16, 0.18, 0.025, yellow);
          for (let i = 0; i < 5; i++)
            box(-0.45 + i * 0.22, 0.72, side * 0.222, 0.07, 0.17, 0.015, rubber).rotation.z = -0.45;
          box(side * 0.44, 0.9, 0, 0.1, 0.06, 0.11, paint);
          box(side * 0.4, 0.1, 0.357, 0.18, 0.06, 0.015, rubber);
        }
        break;
      }
      case "fence-chain":
      case "fence-sheet":
      case "fence-picket": {
        const w = prop.cover ? 1.2 : 2.3, h = prop.cover ? 0.9 : 1.85;
        for (const x of [-w / 2, w / 2]) {
          loose(box(x, h / 2, 0, 0.065, h, 0.075, steel));
          box(x, 0.05, 0, 0.25, 0.1, 0.45, concrete);
          box(x, h + 0.025, 0, 0.09, 0.05, 0.09, paint);
        }
        for (const y of [0.22, h - 0.12]) loose(box(0, y, 0, w, 0.055, 0.06, steel));
        if (prop.kind === "fence-sheet") {
          for (let i = 0; i < 4; i++) {
            const panel = loose(box(-w * 0.375 + i * w / 4, h / 2, 0, w / 4 - 0.012, h - 0.22, 0.035, faded));
            if (i === 1 || i === 2) panel.userData.shedAt = i === 1 ? 0.3 : 0.65;
          }
          for (let x = -w / 2 + 0.06; x < w / 2; x += 0.11) {
            const rib = box(x, h / 2, 0.033, 0.027, h - 0.22, 0.035, faded);
            const panel = Math.floor((x + w / 2) / (w / 4));
            if (panel === 1 || panel === 2) rib.userData.shedAt = panel === 1 ? 0.3 : 0.65;
          }
          decal("KEEP OUT", 0, h * 0.6, 0.058, w * 0.4, 0.22, true).userData.shedAt = 0.3;
          bolts(w - 0.13, h, 0.057);
        } else if (prop.kind === "fence-picket") {
          for (let x = -w / 2 + 0.14, i = 0; x < w / 2; x += 0.19, i++) {
            const board = loose(box(x, h / 2, 0.04, 0.12, h - 0.12, 0.055, wood));
            const tip = box(x, h - 0.025, 0.04, 0.085, 0.085, 0.055, wood);
            tip.rotation.z = Math.PI / 4;
            if (i === 1 || i === 3) board.userData.shedAt = tip.userData.shedAt = i === 1 ? 0.3 : 0.65;
          }
        } else {
          // Diamond mesh is geometry, avoiding alpha sorting/shadow artifacts.
          const sections: T.Mesh[][] = [[], [], []];
          for (const slope of [-1, 1]) {
            for (let start = -w / 2 - h; start <= w / 2 + h; start += 0.19) {
              const y0 = Math.max(0.25, slope > 0 ? -w / 2 - start : start - w / 2);
              const y1 = Math.min(h - 0.15, slope > 0 ? w / 2 - start : start + w / 2);
              if (y1 <= y0) continue;
              const wire = box(start + slope * (y0 + y1) / 2, (y0 + y1) / 2, 0,
                0.012, (y1 - y0) * Math.SQRT2, 0.012, steel);
              wire.rotation.z = -slope * Math.PI / 4;
              const section = Math.max(0, Math.min(2, Math.floor((wire.position.x + w / 2) / (w / 3))));
              sections[section].push(wire);
            }
          }
          // Detached sections retain the actual wires instead of becoming solid plates.
          for (const [i, wires] of sections.entries()) {
            const section = new T.Group();
            for (const wire of wires) {
              section.add(wire.clone());
              wire.userData.fragmentIndex = fragments.length;
              if (i === 1) wire.userData.shedAt = 0.65;
            }
            this.merge(section);
            const panel = section.children[0] as T.Mesh | undefined;
            if (panel) fragments.push(panel);
          }
        }
        break;
      }
      case "cone": {
        loose(box(0, 0.035, 0, 0.38, 0.07, 0.38, rubber));
        const orange = this.material(0xd77439, 0.04, 0.72);
        loose(mesh(new T.CylinderGeometry(0.025, 0.16, 0.56, 12), orange, 0, 0.34, 0));
        for (const y of [0.29, 0.45]) {
          const r = 0.16 - ((y - 0.06) / 0.56) * 0.135;
          mesh(new T.CylinderGeometry(r - 0.009, r + 0.01, 0.08, 12), paint, 0, y, 0);
        }
        break;
      }
      case "sign": {
        loose(box(0, 0.78, 0, 0.055, 1.55, 0.055, steel));
        box(0, 0.06, 0, 0.58, 0.12, 0.4, rubber);
        loose(box(0, 1.32, 0, 0.86, 0.56, 0.04, steel));
        for (const side of [-1, 1]) {
          const face = decal(["DETOUR →", "CAUTION", "DELIVERY"][variant], 0, 1.32, side * 0.025, 0.82, 0.52, true);
          face.rotation.y = side < 0 ? Math.PI : 0;
        }
        break;
      }
      case "vending": {
        // The streetLife machines, placeable: shell, lit display, product grid.
        const shell = this.material([0xc7c9c1, 0x823e37, 0x33505e][variant], 0.2, 0.55);
        let display = this.materials.get("vending-display");
        if (!display) {
          // The district's machine, same display glow (streetLife, district.ts).
          display = new T.MeshStandardMaterial({
            color: 0xb4c9c3, emissive: 0xc8eeec, emissiveIntensity: 1.6, roughness: 0.45 });
          display.userData.dayOffGlow = 1.6;
          this.materials.set("vending-display", display);
        }
        fracture(box(0, 0.91, 0, 0.84, 1.82, 0.64, shell), 8);
        box(0, 1.2, 0.33, 0.69, 0.96, 0.025, display);
        decal("DRINKS", 0, 1.74, 0.335, 0.7, 0.16);
        for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++)
          box(-0.26 + col * 0.13, 0.85 + row * 0.25, 0.36, 0.07, 0.16, 0.045,
            this.material([0xa44b3e, 0xbbab65, 0x54747b, 0xabae9e][(row + col) % 4], 0.1, 0.6));
        box(0, 0.35, 0.34, 0.5, 0.19, 0.04, rubber);
        box(0.3, 0.6, 0.34, 0.08, 0.14, 0.025, steel);
        break;
      }
      case "bicycle": {
        // The parking-recess bikes: torus wheels, a tube frame, saddle and bars.
        const tone = this.material([0x8c9c9d, 0xa58873, 0x5e7271][variant], 0.35, 0.55);
        const tube = (a: T.Vector3, c: T.Vector3, r: number, m: T.Material = tone) => {
          const part = mesh(new T.CylinderGeometry(r, r, a.distanceTo(c), 6), m,
            (a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
          part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), c.clone().sub(a).normalize());
          return part;
        };
        const v = (y: number, z: number) => new T.Vector3(0, y, z);
        for (const z of [-0.55, 0.55]) {
          const wheel = mesh(new T.TorusGeometry(0.31, 0.025, 6, 18), rubber, 0, 0.32, z);
          wheel.rotation.y = Math.PI / 2;
          loose(wheel);
          tube(v(0.32, z - 0.29), v(0.32, z + 0.29), 0.008, steel);
        }
        for (const [a, c] of [
          [v(0.32, -0.55), v(0.38, 0)], [v(0.32, -0.55), v(0.83, -0.15)], [v(0.38, 0), v(0.83, -0.15)],
          [v(0.83, -0.15), v(0.86, 0.39)], [v(0.38, 0), v(0.86, 0.39)], [v(0.86, 0.39), v(0.32, 0.55)],
        ]) tube(a, c, 0.022);
        box(0, 0.88, -0.15, 0.17, 0.045, 0.25, rubber);
        tube(v(0.85, 0.4), v(1.02, 0.42), 0.022, steel);
        const bars = mesh(new T.CylinderGeometry(0.02, 0.02, 0.42, 6), steel, 0, 1.02, 0.42);
        bars.rotation.z = Math.PI / 2;
        break;
      }
      case "pallet": {
        // The curbside delivery stacks: a timber pallet under taped cartons.
        const timber = this.material(0x776450, 0.04, 0.9);
        const carton = this.material(0x9c8160, 0.03, 0.92);
        fracture(box(0, 0.09, 0, 1.1, 0.18, 0.8, timber), 6, true, wood);
        for (let n = 0; n < 3; n++) {
          const stack = loose(box(-0.34 + n * 0.34, 0.38, 0, 0.3, 0.4, 0.6, carton));
          if (n === 1) stack.userData.shedAt = 0.5;
          box(-0.34 + n * 0.34, 0.59, 0, 0.045, 0.02, 0.6, this.material(0xc3ac86, 0.1, 0.7));
        }
        break;
      }
      case "utility-pole": {
        // The street's poles: timber mast, crossarm, transformer, insulators.
        loose(box(0, 3, 0, 0.13, 6, 0.13, this.material(0x6c6c68, 0.04, 0.9)));
        box(0, 5.6, 0, 1.15, 0.1, 0.1, this.material(0x3b444a, 0.3, 0.7));
        box(0.15, 4.65, 0, 0.35, 0.6, 0.3, this.material(0x727b7a, 0.5, 0.6));
        for (let k = 0; k < 3; k++)
          box(-0.4 + k * 0.4, 5.72, 0, 0.08, 0.16, 0.08, this.material(0xa1aaa3, 0.1, 0.7));
        break;
      }
      case "block-cover":
      case "block-high":
      case "block-weak":
      case "block-obstacle":
      case "block-solid":
      case "block-fill": {
        // Typed stand-ins: edge cover is a slab along its edge; area blockers
        // and building fill take the whole cell.
        const spec: Record<string, [height: number, depth: number, body: T.Material]> = {
          "block-cover": [0.86, 0.34, concrete],
          "block-high": [2.2, 0.3, this.material(0x495058, 0.12, 0.86)],
          "block-weak": [2.05, 0.26, this.material(0x9a8f78, 0.05, 0.9)],
          "block-obstacle": [1.25, 1.16, rust],
          "block-solid": [1.05, 1.16, steel],
          "block-fill": [2.6, 1.16, this.material(0x343a44, 0.08, 0.9)],
        };
        const [h, d, body] = spec[prop.kind];
        const w = 1.16;
        if (prop.kind === "block-solid" || prop.kind === "block-fill") box(0, h / 2, 0, w, h, d, body);
        else fracture(box(0, h / 2, 0, w, h, d, body), prop.kind === "block-weak" ? 14 : 8);
        // A band near the top names the role at a glance; weak cover warns.
        box(0, h - 0.09, 0, w + 0.015, 0.11, d + 0.015, prop.kind === "block-weak" ? yellow : paint);
        break;
      }
      case "wall":
      case "window-wall": {
        const window = prop.kind === "window-wall";
        const masonry = this.material([0x8d796b, 0x737f7b, 0x9b9785][variant], 0.02, 0.95);
        if (window) {
          fracture(box(0, 0.45, 0, 2.3, 0.9, 0.24, masonry), 5, true);
          fracture(box(0, 1.99, 0, 2.3, 0.22, 0.24, masonry), 3, true);
          for (const x of [-0.93, 0.93]) fracture(box(x, 1.4, 0, 0.44, 1, 0.24, masonry), 3, true);
          box(0, 0.92, 0, 1.5, 0.08, 0.38, concrete);
        } else fracture(box(0, 1.05, 0, 2.3, 2.1, 0.24, masonry), 16, true);
        box(0, 2.13, 0, 2.4, 0.08, 0.32, concrete);
        for (const side of [-1, 1]) {
          for (let row = 0; row < 7; row++) {
            const y = 0.15 + row * 0.3;
            if (!window || y < 0.9) box(0, y, side * 0.122, 2.28, 0.012, 0.008, concrete);
            for (let x = -0.95 + (row % 2) * 0.25; x < 1.1; x += 0.5)
              if (!window || y < 0.9 || Math.abs(x) > 0.73)
                box(x, y + 0.14, side * 0.122, 0.012, 0.27, 0.008, concrete);
          }
        }
        break;
      }
      case "glass": {
        if (prop.storefront || prop.pane) {
          const { width, height } = (prop.storefront ?? prop.pane)!;
          const glass = this.material(0x91b4c0, 0.1, 0.22);
          glass.transparent = true; glass.opacity = 0.16; glass.depthWrite = false;
          fracture(box(0, height / 2, 0, width, height, 0.018, glass), 10, true, glass);
          break;
        }
        const w = prop.y ? 1.42 : 2.3, h = prop.y ? 0.94 : 2.05;
        const glass = this.material(0x9cc6cb, 0.22, 0.17);
        glass.transparent = true; glass.opacity = 0.3; glass.depthWrite = false;
        fracture(box(0, h / 2 + 0.02, 0, w, h, 0.026, glass), 16, true, glass);
        // Frame stays after the pane shatters.
        for (const x of [-w / 2, w / 2]) box(x, h / 2, 0, 0.04, h + 0.05, 0.055, steel, frame);
        for (const y of [0, h]) box(0, y, 0, w, 0.04, 0.055, steel, frame);
        break;
      }
    }
    const bounds = new T.Box3().setFromObject(intact);
    const source = intact.clone();
    this.merge(intact);
    this.merge(frame);
    const asset = { intact, frame, fragments, bounds, smoke };
    this.assets.set(key, asset);
    this.sources.set(asset, source);
    return asset;
  }

  private getOffice(prop: MapProp): PropAsset {
    const spec = prop.office ?? { kind: prop.kind.slice(7) as OfficeKind };
    const key = `office:${spec.kind}:${spec.finish ?? "sage"}:${!!spec.open}`;
    const cached = this.assets.get(key);
    if (cached) return cached;
    const authored = this.office.parts(spec.kind, spec.finish);
    const hinge = authored.getObjectByName("door-hinge");
    if (hinge && spec.open) hinge.rotation.y = Math.PI / 2;
    authored.updateMatrixWorld(true);
    const source = new T.Group(), frame = new T.Group(), fragments: T.Mesh[] = [];
    const glazed = spec.kind === "glass-wall" || spec.kind === "glass-door";
    const candidates: { mesh: T.Mesh; volume: number }[] = [];
    authored.traverse(child => {
      if (!(child instanceof T.Mesh)) return;
      const material = child.material as T.MeshStandardMaterial;
      const glass = material.transparent;
      // Vision panes in steel fixtures have their own health / mesh.
      if (!glazed && (glass || child.userData.glazing)) return;
      const geometry = this.geometry(child.geometry.clone().applyMatrix4(child.matrixWorld));
      const mesh = new T.Mesh(geometry, material);
      mesh.castShadow = !glass; mesh.receiveShadow = true;
      if (glazed && !glass && !child.userData.glazing) { frame.add(mesh); return; }
      source.add(mesh);
      if (glass) {
        const destructible = new DestructibleMesh(geometry, material, material);
        for (const shard of destructible.fracture(new FractureOptions({ fragmentCount: 10, seed: 731,
          voronoiOptions: { mode: "2.5D", projectionAxis: spec.open ? "x" : "z" } }))) {
          this.geometry(shard.geometry);
          const fragment = new T.Mesh(shard.geometry, shard.material);
          fragment.position.copy(shard.position); fragment.quaternion.copy(shard.quaternion);
          fragments.push(fragment);
        }
        return;
      }
      if (glazed) return;
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new T.Vector3());
      let name = "";
      for (let parent = child.parent; parent && parent !== authored; parent = parent.parent) name += `/${parent.name}`;
      // Remove real rigid panels, never warp metal or upholstered furniture.
      if (name.includes("bin-lid") || name.includes("backrest") || name.includes("drawer-2") ||
        ((spec.kind === "desk" || spec.kind === "desk-tucked" || spec.kind === "corner-desk") && size.x > 0.8 && size.y > 0.25 && size.y < 0.5))
        mesh.userData.shedAt = 0.65;
      const area = Math.max(size.x * size.y, size.x * size.z, size.y * size.z);
      if (area > 0.006) candidates.push({ mesh, volume: size.x * size.y * size.z });
    });
    // Bounded rigid fragments. Tiny switches, labels and keys stay in the intact
    // model but never become hundreds of independent physics bodies.
    candidates.sort((a, b) => b.volume - a.volume);
    for (const { mesh } of candidates.slice(0, 18)) {
      const center = mesh.geometry.boundingBox!.getCenter(new T.Vector3());
      const geometry = this.geometry(mesh.geometry.clone().translate(-center.x, -center.y, -center.z));
      const fragment = new T.Mesh(geometry, mesh.material); fragment.position.copy(center);
      mesh.userData.fragmentIndex = fragments.length; fragments.push(fragment);
    }
    const bounds = new T.Box3().setFromObject(source);
    const intact = source.clone(); this.merge(intact); this.merge(frame);
    const asset = { intact, frame, fragments, bounds,
      colliders: glazed ? [bounds] : candidates.slice(0, 18).map(c => c.mesh.geometry.boundingBox!.clone()) };
    this.assets.set(key, asset); this.sources.set(asset, source);
    return asset;
  }

  /** Merge within an asset only, so each prop can still be removed independently. */
  private merge(group: T.Group) {
    group.updateMatrixWorld(true);
    const batches = new Map<T.Material, T.BufferGeometry[]>();
    for (const child of group.children) {
      if (!(child instanceof T.Mesh)) continue;
      const material = child.material as T.Material;
      const geometries = batches.get(material) ?? [];
      geometries.push(child.geometry.clone().applyMatrix4(child.matrixWorld));
      batches.set(material, geometries);
    }
    group.clear();
    for (const [material, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      for (const part of geometries) part.dispose();
      if (!geometry) throw new Error("Incompatible prop geometry");
      const mesh = new T.Mesh(this.geometry(geometry), material);
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  dispose() {
    this.office.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.assets.clear();
    this.sources.clear(); this.stages.clear();
  }
}
