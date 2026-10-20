// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type * as T from "three";
import { buildDistrict, loadDistrictTextures } from "../district";
import type { Occluder } from "./occlusion";

/** How a map looks: its textures and its scenery. The rules know only the `MapPlan`. */
export interface MapView {
  /** Load and upload textures before the first build. */
  load(renderer: T.WebGLRenderer): Promise<void>;
  /** Add the scenery; buildings that may hide units come back as occluders. */
  build(scene: T.Scene): Occluder[];
}

const views: Record<string, MapView> = {
  kora: { load: loadDistrictTextures, build: buildDistrict },
};

export function mapView(id: string): MapView {
  const view = views[id];
  if (!view) throw new Error(`No scenery for map "${id}"`);
  return view;
}
