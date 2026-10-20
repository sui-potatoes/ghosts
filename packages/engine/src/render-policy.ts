// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

export type RenderMode = "battery" | "smooth";
/** Null means no animation frame should be requested at all. */
export function renderCadence(
  mode: RenderMode,
  visible: boolean,
  active: boolean,
): number | null {
  if (!visible || (mode === "battery" && !active)) return null;
  return active ? 60 : 30;
}
export function renderPixelRatio(
  width: number,
  height: number,
  dpr: number,
  mode: RenderMode,
): number {
  const budget = mode === "battery" ? 1_000_000 : 2_000_000;
  return Math.min(
    dpr,
    mode === "battery" ? 1 : 1.5,
    Math.sqrt(budget / Math.max(1, width * height)),
  );
}
