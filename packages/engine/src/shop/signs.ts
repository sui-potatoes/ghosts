// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The shop pack's lettering: every string of `lettering.ts` baked offline
 * (`scripts/bake-lettering.mjs`) as white glyphs on clear into one shipped
 * image, `letteringAtlas` naming each string's rectangle. A sign is its
 * ground plate in the entry's ground colour plus a glyph plane cut out of
 * the atlas and tinted with the entry's ink, so one glyph image serves every
 * colour, lit or printed. No font is shipped or drawn at runtime.
 */
import * as T from "three";
import { demoAsset } from "../demo-assets.ts";
import { letteringAtlas } from "./lettering-atlas.ts";
import { letteringById } from "./lettering.ts";

export type SignLook = "print" | "lit" | "paint";

/** The atlas texture and the tinted glyph materials cut from it. */
export class SignAtlas {
  private readonly texture?: T.Texture;
  private readonly materials = new Map<string, T.MeshStandardMaterial>();
  private readonly planes = new Map<string, T.PlaneGeometry>();

  constructor() {
    if (typeof document === "undefined") return;
    this.texture = new T.TextureLoader().load(demoAsset(letteringAtlas.file));
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** Glyphs in one ink: printed, glowing (lanterns, the pay station) or painted on a floor. */
  glyphs(ink: number, look: SignLook) {
    const key = `${ink}:${look}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({
        color: ink, roughness: look === "paint" ? 0.85 : 0.7, alphaTest: 0.45,
        ...(this.texture ? { alphaMap: this.texture } : {}),
        ...(look === "lit" ? { emissive: ink, emissiveIntensity: 0.6 } : {}),
        ...(look === "paint" ? { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 } : {}),
      });
      // The alpha map is white-on-clear: alphaTest keeps glyph edges out of sorting.
      if (!this.texture) m.visible = false;
      m.userData.decal = true;
      this.materials.set(key, m);
    }
    return m;
  }

  /** A plane of `w` × `h` metres facing +z, mapped to one string's rectangle. */
  plane(id: string, w: number, h: number) {
    const key = `${id}:${w.toFixed(3)}:${h.toFixed(3)}`;
    let g = this.planes.get(key);
    if (!g) {
      const rect = letteringAtlas.rects[id];
      if (!rect) throw new Error(`No baked lettering ${id}: re-run scripts/bake-lettering.mjs`);
      const [u0, v0, u1, v1] = rect;
      g = new T.PlaneGeometry(w, h);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      this.planes.set(key, g);
    }
    return g;
  }

  /** The glyph block's size inside a `w` × `h` plate: the baked aspect kept, a margin left. */
  fit(id: string, w: number, h: number, margin = 0.88): [number, number] {
    const aspect = letteringAtlas.rects[id]?.[4] ?? 1;
    const gw = Math.min(w * margin, h * margin * aspect);
    return [gw, gw / aspect];
  }

  entry(id: string) {
    const entry = letteringById.get(id);
    if (!entry) throw new Error(`No lettering ${id}`);
    return entry;
  }

  dispose() {
    for (const g of this.planes.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.texture?.dispose();
  }
}
