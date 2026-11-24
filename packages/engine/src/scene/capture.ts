// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type * as T from "three";
import { TIMES, WEATHERS, type LookTime, type LookWeather, type SceneLook } from "../scene-look";

/**
 * Dev only: `&capture` on a `?shot=` turns the held frame into a location
 * still (`app/scripts/locations/capture.mjs`). Without it nothing here runs.
 *
 * - Only the 3D canvas shows: the HUD, name plates, the guide and every other
 *   page element are hidden.
 * - No grid, selection ring, ranges, path, threat or hover, and no units
 *   unless `&units` asks for them.
 * - No cutaway: buildings stay whole, whatever stands in front. `&cut` cuts
 *   away what stands between the camera and its target instead (an interior).
 * - `&scale=2` draws at that pixel ratio, past the render budget, for a
 *   supersampled frame the script scales down.
 * - `&look=night:heavy-rain` pins the game's look (`scene-look.ts`) over a
 *   drawn one.
 */
export interface Capture {
  units: boolean;
  cut: boolean;
  scale: number | null;
  look: SceneLook | null;
}

function parse(): Capture | null {
  if (typeof location === "undefined") return null;
  const query = new URLSearchParams(location.search);
  if (!query.has("shot") || !query.has("capture")) return null;
  const scale = Number(query.get("scale"));
  const [time, weather] = (query.get("look") ?? "").split(":") as [LookTime, LookWeather];
  return {
    units: query.has("units"),
    cut: query.has("cut"),
    scale: scale > 0 && scale <= 4 ? scale : null,
    look: TIMES.includes(time) && WEATHERS[time].includes(weather) ? { time, weather } : null,
  };
}

export const capture = parse();

if (capture && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent =
    "body * { visibility: hidden !important; } #viewport > canvas { visibility: visible !important; }";
  document.head.append(style);
}

/** Hide `objects` for one draw; returns the restore. */
export function hideForCapture(objects: readonly T.Object3D[]): () => void {
  const shown = objects.filter((o) => o.visible);
  for (const o of shown) o.visible = false;
  return () => {
    for (const o of shown) o.visible = true;
  };
}
