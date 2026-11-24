// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The schematic look shared by the training simulation (`guide/sim-scene.ts`)
 * and the layout view (`layout-view.ts`): tones read from the theme, unlit
 * glow materials pushed past the bloom threshold, and the geometry of a tile's
 * sides. Pure drawing helpers; neither scene's behaviour lives here.
 */
import * as T from "three";
import { CELL, type Cell } from "../map.ts";
import type { Side } from "../guide/cover.ts";

/** The simulation's tones, read from the theme. */
export interface SimPalette {
  void: T.Color;
  floor: T.Color;
  grid: T.Color;
  wall: T.Color;
  high: T.Color;
  low: T.Color;
  hostile: T.Color;
}

function token(el: Element | null, name: string, fallback: string): T.Color {
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  const c = new T.Color();
  try {
    c.setStyle(raw || fallback);
  } catch {
    c.setStyle(fallback);
  }
  return c;
}

/** The palette from the theme tokens on the page (the encounter's root when mounted). */
export function simPalette(): SimPalette {
  const doc = typeof document !== "undefined" ? document : null;
  const root = doc?.querySelector(".encounter") ?? doc?.documentElement ?? null;
  const text = token(root, "--text-color", "#ffffff");
  const accent = token(root, "--accent-color", "#7fe3ef");
  const background = token(root, "--background-color", "#0a0b0d");
  const surface = token(root, "--surface-color", "#101215");
  const hostile = token(root, "--hostile", "#d67c73");
  return {
    void: background.clone().lerp(new T.Color(0, 0, 0), 0.4),
    floor: surface.clone().lerp(background, 0.5),
    grid: accent.clone().lerp(background, 0.8),
    wall: text.clone().lerp(background, 0.12),
    high: accent.clone(),
    low: accent.clone().lerp(background, 0.5),
    hostile,
  };
}

/** Unlit and pushed past the bloom threshold: a glowing line or face. */
export const glow = (c: T.Color, strength = 1.8, opacity = 1) =>
  new T.MeshBasicMaterial({
    color: c.clone().multiplyScalar(strength),
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
export const lineGlow = (c: T.Color, strength = 1.8) =>
  new T.LineBasicMaterial({ color: c.clone().multiplyScalar(strength), toneMapped: false });

/** The world point of a cell's centre at height `y`. */
export const centre = ([x, z]: Cell, y = 0) => new T.Vector3(x * CELL, y, z * CELL);

/** The midpoint of a cell's side and the direction along it. */
export function sideSeat(cell: Cell, side: Side): { mid: T.Vector3; along: "x" | "z"; inward: T.Vector3 } {
  const c = centre(cell);
  const h = CELL / 2;
  switch (side) {
    case "top":
      return { mid: c.clone().add(new T.Vector3(0, 0, -h)), along: "x", inward: new T.Vector3(0, 0, 1) };
    case "bottom":
      return { mid: c.clone().add(new T.Vector3(0, 0, h)), along: "x", inward: new T.Vector3(0, 0, -1) };
    case "left":
      return { mid: c.clone().add(new T.Vector3(-h, 0, 0)), along: "z", inward: new T.Vector3(1, 0, 0) };
    case "right":
      return { mid: c.clone().add(new T.Vector3(h, 0, 0)), along: "z", inward: new T.Vector3(-1, 0, 0) };
  }
}

export const NEXT: Record<Side, Cell> = { left: [-1, 0], top: [0, -1], right: [1, 0], bottom: [0, 1] };
export const BACK: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
export const SIDES: Side[] = ["left", "top", "right", "bottom"];

/** Heights in metres: a wall stands over a unit, high cover to the shoulder, low cover to the waist. */
export const WALL_H = 2.6,
  HIGH_H = 1.9,
  LOW_H = 0.85;

