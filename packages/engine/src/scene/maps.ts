// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type * as T from "three";
import { buildDistrict, loadDistrictTextures } from "../district";
import type { Occluder } from "./occlusion";
import { buildOffice } from "../office/scene";
import type { TimeOfDay } from "../scene-weather";
import type { Weather } from "./precipitation";
import { applyOfficeLighting } from "../office/lighting";
import type { PropAssets } from "./prop-assets";

/** Meshes the scenery may place: the same catalog assets combat destroys. */
export interface SceneryKit {
  props: PropAssets;
}

/** How a map looks: its textures and its scenery. The rules know only the `MapPlan`. */
export interface MapView {
  /** The scenery itself supplies cover meshes (e.g. office furniture). */
  furnishedCover?: boolean;
  defaults?: { time: TimeOfDay; weather: Weather };
  /** Interior maps provide their own exposure / fill and omit outdoor atmosphere. */
  interiorLighting?: (scene: T.Scene, key: T.DirectionalLight, ambient: T.HemisphereLight,
    rim: T.DirectionalLight, time: TimeOfDay) => number;
  /** Load and upload textures before the first build. */
  load(renderer: T.WebGLRenderer): Promise<void>;
  /** Add the scenery; buildings that may hide units come back as occluders. */
  build(scene: T.Scene, kit: SceneryKit): Occluder[];
}

const views: Record<string, MapView> = {
  kora: { load: loadDistrictTextures, build: buildDistrict },
  office: { load: async () => {}, build: buildOffice, furnishedCover: true,
    interiorLighting: applyOfficeLighting, defaults: { time: "night", weather: "clear" } },
};

export function mapView(id: string): MapView {
  const view = views[id];
  if (!view) throw new Error(`No scenery for map "${id}"`);
  return view;
}
