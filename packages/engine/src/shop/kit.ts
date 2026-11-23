// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The shop pack's authoring kit: shared materials per finish, box / cylinder
 * primitives, vertex-coloured merchandise (one material for every product on
 * a module: one draw call however many colours), semantic parts that stay
 * separate (door leaves), and a seeded random stream per variant. Builders
 * work in metres, floor-origin, +Z front, in the cell's own coordinates.
 */
import * as T from "three";
import { CELL } from "../map.ts";
import { propRandom } from "../environment.ts";
import type { InteriorFinish, ShopFinish, WoodFinish } from "./catalog.ts";
import { SignAtlas } from "./signs.ts";

export const C = CELL;
/** Half a cell: modules run edge to edge from -H to H. */
export const H = CELL / 2;
/** Where a wall-backed unit's back sits: clear of a wall panel on the north edge (0.07 deep). */
export const BACK = -0.6;

export type Shape = "box" | "can" | "cup" | "tri" | "ball" | "bottle";

/** The merchandise and fixture colours shared by every pack builder. */
export const tones = {
  drinks: [0x3f6f8a, 0x9c3b32, 0xd9d4c3, 0x6a7f4a, 0x2b2b2b, 0xc89a3e, 0x8fb7c4, 0xe0dccf, 0x5b3d63, 0xd2652d, 0x7fa36a, 0xb8463a],
  bento: [0x8a5a35, 0xb8743a, 0x6d7d3e, 0xc9b48a, 0x9b3a2f, 0xa88a52],
  dairy: [0xe8e6de, 0x9fbcd6, 0xd9a6a8, 0xe4d48a, 0xdedbd0, 0x8fae8a],
  snacks: [0xc23a2e, 0xe0b23c, 0x3d6e9e, 0x5f8a3c, 0x7c4a8c, 0xd8d2c0, 0x2e2e33, 0xd4682f, 0x9a7b3c, 0x4f6f78],
  goods: [0xd8d6cc, 0x6f8fa6, 0xb9c4c0, 0x8c3b2e, 0x3e5f7a, 0xc7b37a, 0x5a6a5c, 0xe6e2d6, 0x9da6a8],
  ice: [0xe8e2d2, 0x7b4a33, 0xd88e9a, 0x9fc4d8, 0xe1c46a, 0x6f9a5d, 0x4a3328],
  rice: 0xe6e1d3,
  nori: 0x1f2622,
};

interface Livery { body: number; header: number; stripe: number }
/** The fictional chains' liveries, and the unbranded default. Interior light stays cold regardless. */
export const liveries: Record<ShopFinish, Livery> = {
  plain: { body: 0x5f666a, header: 0x46505a, stripe: 0xa9b4b7 },
  eleventy: { body: 0x4f4a57, header: 0x2a2238, stripe: 0xf2c14e },
  yandottir: { body: 0x4b5a59, header: 0x1d6f6a, stripe: 0xf6e7d0 },
};

/** Wood stains: body and the darker trim beside it. */
export const stains: Record<WoodFinish, [wood: number, trim: number]> = {
  cedar: [0x8a6646, 0x4f3a28],
  smoked: [0x5a4231, 0x33261c],
  black: [0x2c2622, 0x5e4630],
};

export class Kit {
  private readonly materials = new Map<string, T.MeshStandardMaterial>();
  readonly geometries = new Set<T.BufferGeometry>();
  private readonly items = new Map<string, T.BufferGeometry>();
  readonly box1: T.BoxGeometry;
  private readonly cylinders = new Map<string, T.CylinderGeometry>();

  private atlas?: SignAtlas;

  constructor() {
    this.box1 = this.geometry(new T.BoxGeometry(1, 1, 1));
  }

  /** The lettering atlas, made on first use. */
  get signs() { return (this.atlas ??= new SignAtlas()); }

  geometry<G extends T.BufferGeometry>(g: G): G { this.geometries.add(g); return g; }

  /** A shared material: `glow` lights it from within at that strength. */
  material(color: number, metalness = 0, roughness = 0.7, glow = 0, emissive = color) {
    const key = `${color}:${metalness}:${roughness}:${glow}:${emissive}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color, metalness, roughness,
        ...(glow ? { emissive, emissiveIntensity: glow } : {}) });
      this.materials.set(key, m);
    }
    return m;
  }

  /** Sheet glass: transparent, no depth write, no shadow. */
  glass(tint = 0x9cc6cb, opacity = 0.18) {
    const key = `glass:${tint}:${opacity}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color: tint, metalness: 0.2, roughness: 0.12,
        transparent: true, opacity, depthWrite: false });
      this.materials.set(key, m);
    }
    return m;
  }

  /** The one merchandise material: colours ride the vertices. */
  get goods() {
    let m = this.materials.get("goods");
    if (!m) {
      m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04 });
      this.materials.set("goods", m);
    }
    return m;
  }

  /** Flat paint on a floor: polygon offset wins the depth test over the ground. */
  paint(color: number) {
    const key = `paint:${color}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color, roughness: 0.85,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.materials.set(key, m);
    }
    return m;
  }

  private readonly tori = new Map<string, T.TorusGeometry>();

  torus(tube: number, segments: number) {
    const key = `${tube}:${segments}`;
    let g = this.tori.get(key);
    if (!g) { g = this.geometry(new T.TorusGeometry(1, tube, 5, segments)); this.tori.set(key, g); }
    return g;
  }

  cylinder(top: number, bottom: number, segments: number) {
    const key = `${top}:${bottom}:${segments}`;
    let g = this.cylinders.get(key);
    if (!g) { g = this.geometry(new T.CylinderGeometry(top, bottom, 1, segments)); this.cylinders.set(key, g); }
    return g;
  }

  /** A unit merchandise shape in one colour (vertex coloured), cached per shape and colour. */
  item(shape: Shape, color: number) {
    const key = `${shape}:${color}`;
    let g = this.items.get(key);
    if (!g) {
      const base =
        shape === "can" ? new T.CylinderGeometry(0.5, 0.5, 1, 7) :
        shape === "cup" ? new T.CylinderGeometry(0.5, 0.4, 1, 8) :
        // Apex up, face to the front: an onigiri or a sandwich wedge.
        shape === "tri" ? new T.CylinderGeometry(0.66, 0.66, 1, 3).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, -0.165, 0) :
        shape === "ball" ? new T.CylinderGeometry(0.42, 0.5, 1, 6) :
        shape === "bottle" ? new T.CylinderGeometry(0.42, 0.5, 1, 6) :
        new T.BoxGeometry(1, 1, 1);
      const c = new T.Color(color), n = base.getAttribute("position").count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      base.setAttribute("color", new T.BufferAttribute(colors, 3));
      g = this.geometry(base);
      this.items.set(key, g);
    }
    return g;
  }

  dispose() {
    this.atlas?.dispose(); this.atlas = undefined;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear(); this.materials.clear(); this.items.clear(); this.cylinders.clear(); this.tori.clear();
  }
}

/** One asset under construction. */
export class Build {
  readonly root = new T.Group();
  readonly random: () => number;
  readonly livery: Livery;

  readonly kit: Kit;
  readonly finish: InteriorFinish;
  readonly variant: number;
  /** Which local faces are outside (bits: 1 +z, 2 +x, 4 -z, 8 -x); a building draws only those. */
  readonly faces: number;

  constructor(kit: Kit, name: string, finish: InteriorFinish, variant: number, faces = 15) {
    this.kit = kit; this.finish = finish; this.variant = variant; this.faces = faces;
    this.root.name = name;
    let seed = variant * 7919 + 17;
    for (let i = 0; i < name.length; i++) seed = Math.imul(seed ^ name.charCodeAt(i), 2654435761) >>> 0;
    this.random = propRandom(seed);
    this.livery = liveries[finish as ShopFinish] ?? liveries.plain;
  }

  // Common materials, by role.
  get body() { return this.kit.material(this.livery.body, 0.35, 0.55); }
  get header() { return this.kit.material(this.livery.header, 0.1, 0.6); }
  get stripe() { return this.kit.material(this.livery.stripe, 0.05, 0.6); }
  get dark() { return this.kit.material(0x1b2125, 0.2, 0.7); }
  get steel() { return this.kit.material(0x8e979a, 0.7, 0.38); }
  get chrome() { return this.kit.material(0xc2c9cb, 0.85, 0.25); }
  get wire() { return this.kit.material(0x6d777b, 0.6, 0.45); }
  /** A fridge or chiller's lit interior back. */
  get cold() { return this.kit.material(0xb7d3d8, 0, 0.5, 0.7, 0xbfe6ee); }
  get coldDim() { return this.kit.material(0x4a585c, 0, 0.6, 0.08, 0x9fc9d2); }
  /** A tube or LED strip, cold white. */
  get strip() { return this.kit.material(0xe4f4f6, 0, 0.4, 1.3, 0xd9f2f6); }
  get laminate() { return this.kit.material(0xb3ada0, 0.05, 0.62); }
  get paper() { return this.kit.material(0xe9e4d5, 0, 0.95); }
  /** Stained joinery and its darker trim (the stain the placement picked; cedar by default). */
  get wood() { return this.kit.material((stains[this.finish as WoodFinish] ?? stains.cedar)[0], 0, 0.78); }
  get woodTrim() { return this.kit.material((stains[this.finish as WoodFinish] ?? stains.cedar)[1], 0, 0.8); }
  /** Pale untreated timber: counter tops, chopping boards, hinoki. */
  get hinoki() { return this.kit.material(0xc9ab80, 0, 0.72); }
  get ceramic() { return this.kit.material(0xe6e1d6, 0, 0.4); }
  get warm() { return this.kit.material(0xffd7a0, 0, 0.4, 1.1, 0xffb060); }

  /** The local face yaws (0 +z, π/2 +x, π -z, -π/2 -x) that are outside. */
  outsideFaces() {
    return [0, Math.PI / 2, Math.PI, -Math.PI / 2].filter((_, i) => this.faces & (1 << i));
  }

  pick<V>(list: readonly V[]): V { return list[Math.floor(this.random() * list.length) % list.length]; }

  private add(g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, parent: T.Object3D) {
    const o = new T.Mesh(g, m); o.position.set(x, y, z);
    o.castShadow = !(m as T.MeshStandardMaterial).transparent; o.receiveShadow = true;
    parent.add(o); return o;
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, m: T.Material, parent: T.Object3D = this.root) {
    const o = this.add(this.kit.box1, m, x, y, z, parent); o.scale.set(w, h, d); return o;
  }

  cyl(x: number, y: number, z: number, r: number, h: number, m: T.Material, segments = 10, parent: T.Object3D = this.root, top = r) {
    const o = this.add(this.kit.cylinder(top / r, 1, segments), m, x, y, z, parent); o.scale.set(r, h, r); return o;
  }

  /** A product (or any small vertex-coloured shape), base at `y`. */
  item(shape: Shape, color: number, x: number, y: number, z: number, w: number, h: number, d: number, parent: T.Object3D = this.root) {
    const o = this.add(this.kit.item(shape, color), this.kit.goods, x, y + h / 2, z, parent);
    o.scale.set(w, h, d); return o;
  }

  /**
   * A sign from `lettering.ts`, facing +z with its centre at x, y, z: a
   * `w` × `h` ground plate in the entry's ground colour (none when clear)
   * and the baked glyphs over it in its ink. `paint` lays it flat on a floor.
   */
  sign(id: string, x: number, y: number, z: number, w: number, h: number, parent: T.Object3D = this.root,
    look: "print" | "lit" | "paint" = "print", plate = true) {
    const atlas = this.kit.signs, entry = atlas.entry(id);
    const g = new T.Group(); g.position.set(x, y, z); parent.add(g);
    if (look === "paint") g.rotation.x = -Math.PI / 2;
    if (plate && entry.ground >= 0)
      this.box(0, 0, -0.002, w, h, 0.004, look === "lit" ? this.kit.material(entry.ground, 0, 0.6, 0.5) : this.kit.material(entry.ground, 0, 0.7), g);
    const [gw, gh] = atlas.fit(id, w, h);
    const o = this.add(atlas.plane(id, gw, gh), atlas.glyphs(entry.ink, look), 0, 0, 0.001, g);
    o.castShadow = false;
    return g;
  }

  /** A ring of radius `R` (tube `r`) standing in the XY plane, facing +z. */
  ring(x: number, y: number, z: number, R: number, r: number, m: T.Material, parent: T.Object3D = this.root, segments = 16) {
    const o = this.add(this.kit.torus(r / R, segments), m, x, y, z, parent); o.scale.setScalar(R); return o;
  }

  /** A round bar from a to b. */
  tube(a: T.Vector3, c: T.Vector3, r: number, m: T.Material, parent: T.Object3D = this.root, segments = 6) {
    const o = this.add(this.kit.cylinder(1, 1, segments), m, (a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2, parent);
    o.scale.set(r, a.distanceTo(c), r);
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), c.clone().sub(a).normalize());
    return o;
  }

  /** A semantic part that stays its own mesh group (door leaves, lids). */
  part(name: string, x = 0, y = 0, z = 0, parent: T.Object3D = this.root) {
    const g = new T.Group(); g.name = name; g.userData.part = true;
    g.position.set(x, y, z); parent.add(g); return g;
  }

  /** A turned frame (a corner's second arm); flattened into its part when built. */
  frame(yaw: number, x = 0, z = 0) {
    const g = new T.Group(); g.rotation.y = yaw; g.position.set(x, 0, z); this.root.add(g); return g;
  }
}

/** Hoist meshes out of plain frames into the nearest part (or the root), keeping world transforms. */
export function flatten(root: T.Group) {
  root.updateMatrixWorld(true);
  const visit = (group: T.Object3D, owner: T.Object3D) => {
    for (const child of [...group.children]) {
      if (child instanceof T.Mesh) { if (group !== owner) owner.attach(child); continue; }
      if (child.userData.part) visit(child, child);
      else { visit(child, owner); if (child !== owner && !child.children.length) child.removeFromParent(); }
    }
  };
  visit(root, root);
}
